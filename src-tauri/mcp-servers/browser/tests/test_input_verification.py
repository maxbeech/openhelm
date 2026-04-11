"""Tests for paste_text/type_text verification + smart selector resolver.

These tests pin the Run 700f4539 regressions: a comma-separated union
selector silently landed on Reddit's search box and `paste_text` returned
`True` even though nothing was pasted into the real comment field. After
the fix, paste_text/type_text must return a verification dict that the
agent can use to detect the failure.
"""

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dom_handler import DOMHandler


# ---------------------------------------------------------------------------
# _build_input_verification — pure function, easy to exercise.
# ---------------------------------------------------------------------------


def test_verification_success_when_actual_matches_expected():
    resolved = {
        "selector": "div[slot=\"rte\"]",
        "tag": "div",
        "editor_kind": "contenteditable",
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Great post — curious how you handle rate limits?",
        actual="Great post — curious how you handle rate limits?",
        resolved=resolved,
        original_selector="div[slot=\"rte\"]",
        action="paste_text",
    )
    assert result["success"] is True
    assert result["verified"] is True
    assert result["inserted_chars"] == result["expected_chars"]
    assert result["warnings"] == []


def test_verification_fails_when_field_is_empty_after_paste():
    """Lexical/ProseMirror can silently swallow execCommand('insertText').
    The verifier must notice the field is still empty.
    """
    resolved = {
        "selector": "div[slot=\"rte\"]",
        "editor_kind": "contenteditable",
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Hello world, this is a comment.",
        actual="",
        resolved=resolved,
        original_selector="div[slot=\"rte\"]",
        action="paste_text",
    )
    assert result["success"] is False
    assert result["verified"] is False
    assert result["inserted_chars"] == 0
    assert any("did NOT verify" in w for w in result["warnings"])


def test_verification_warns_when_search_input_gets_long_text():
    """The Reddit search box bug: comma-union selector matched <input name='q'>
    with placeholder 'Search in r/ClaudeAI'. A user comment is long; pasting
    it into search is always wrong. The warning must surface.
    """
    resolved = {
        "selector": "input[name=\"q\"]",
        "editor_kind": "input-search",
        "name": "q",
        "placeholder": "Search in r/ClaudeAI",
        "looks_like_search": True,
        "match_count": 3,
    }
    long_comment = "x" * 300
    result = DOMHandler._build_input_verification(
        expected=long_comment,
        actual=long_comment,  # even if it "worked", it's the wrong field
        resolved=resolved,
        original_selector="textarea, [contenteditable], input[type=\"text\"]",
        action="paste_text",
    )
    # The text is technically present but the warning about search input
    # must be there so the agent can course-correct.
    assert any("search input" in w for w in result["warnings"])


def test_verification_warns_about_union_selector_when_multiple_matched():
    resolved = {
        "selector": "input[name=\"q\"]",
        "editor_kind": "input-search",
        "name": "q",
        "looks_like_search": True,
        "match_count": 4,
    }
    result = DOMHandler._build_input_verification(
        expected="short",
        actual="short",
        resolved=resolved,
        original_selector="textarea, [contenteditable], input[type=\"text\"]",
        action="paste_text",
    )
    assert any("Union selector matched" in w for w in result["warnings"])


def test_verification_flags_contenteditable_blocker_on_silent_reject():
    """LinkedIn/Slack class: the resolver finds a real visible
    contenteditable editor, the insertion runs without errors, but the
    field is still empty afterwards. The verifier must emit a blocker tag
    so the agent stops retrying and reports the run as blocked.
    """
    resolved = {
        "selector": "div[contenteditable=\"true\"]",
        "tag": "div",
        "editor_kind": "contenteditable",
        "is_real_editor": True,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Hi — I saw your note about hiring.",
        actual="",
        resolved=resolved,
        original_selector="div[contenteditable=\"true\"]",
        action="paste_text",
    )
    assert result["verified"] is False
    assert result.get("blocker") == "contenteditable_editor_rejected_insert"


def test_verification_flags_hidden_editor_blocker():
    """Reddit signup-modal class: the editor we resolved to is hidden
    (no activator fired, no fallback found). The verifier must flag this
    so the agent reports the run as blocked rather than thrashing.
    """
    resolved = {
        "selector": "textarea",
        "editor_kind": "textarea",
        "is_real_editor": True,
        "is_visible": False,
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Interesting thread.",
        actual="",
        resolved=resolved,
        original_selector="textarea",
        action="paste_text",
    )
    assert result["verified"] is False
    assert result.get("blocker") == "editor_hidden_or_overlay"


def test_verification_does_not_flag_blocker_on_success():
    """When the paste verified, no blocker should be emitted even if the
    target happens to be a contenteditable editor."""
    resolved = {
        "selector": "div[contenteditable=\"true\"]",
        "editor_kind": "contenteditable",
        "is_real_editor": True,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Hello",
        actual="Hello",
        resolved=resolved,
        original_selector="div[contenteditable=\"true\"]",
        action="paste_text",
    )
    assert result["verified"] is True
    assert "blocker" not in result


def test_verification_tolerates_whitespace_normalisation():
    """Rich text editors often add trailing newlines or wrap paragraphs.
    A comment-with-newline should still verify.
    """
    resolved = {"editor_kind": "contenteditable", "looks_like_search": False, "match_count": 1}
    result = DOMHandler._build_input_verification(
        expected="Line one\nLine two",
        actual="Line one\n\nLine two\n",
        resolved=resolved,
        original_selector="div[contenteditable]",
        action="paste_text",
    )
    assert result["verified"] is True


# ---------------------------------------------------------------------------
# _resolve_input_target — the smart resolver. We mock tab.evaluate.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolver_picks_contenteditable_over_search_input():
    """The fix for Run 700f4539: when the page has both a search input and
    a contenteditable editor, the resolver must prefer the editor.

    We drive the real JS resolver by mocking tab.evaluate to return the
    JSON it would have produced for the "comment editor wins" case.
    """
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": "div[slot=\"rte\"]:nth-of-type(1)",
        "tag": "div",
        "editor_kind": "contenteditable",
        "placeholder": None,
        "aria_label": "Add a comment",
        "name": None,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 2,
        "matched_parts": ["[contenteditable]"],
        "score": 125,
    }))
    resolved = await DOMHandler._resolve_input_target(
        tab, "textarea, [contenteditable], input[type=\"text\"]"
    )
    assert resolved["editor_kind"] == "contenteditable"
    assert resolved["looks_like_search"] is False
    # The resolver ran our JS against the tab exactly once.
    assert tab.evaluate.await_count == 1


@pytest.mark.asyncio
async def test_resolver_flags_search_input_when_no_editor_available():
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": "input[name=\"q\"]",
        "tag": "input",
        "editor_kind": "input-search",
        "placeholder": "Search in r/ClaudeAI",
        "aria_label": None,
        "name": "q",
        "is_visible": True,
        "looks_like_search": True,
        "match_count": 1,
        "matched_parts": ["input[type=\"text\"]"],
        "score": 25,
    }))
    resolved = await DOMHandler._resolve_input_target(
        tab, "textarea, [contenteditable], input[type=\"text\"]"
    )
    assert resolved["looks_like_search"] is True
    assert resolved["editor_kind"] == "input-search"


@pytest.mark.asyncio
async def test_resolver_returns_none_on_no_match():
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": None,
        "match_count": 0,
        "matched_parts": [],
    }))
    resolved = await DOMHandler._resolve_input_target(tab, "#does-not-exist")
    assert resolved["selector"] is None
    assert resolved["match_count"] == 0


# ---------------------------------------------------------------------------
# paste_text end-to-end (with mocked tab) — guards against the Run 700f4539
# failure mode of silently returning True.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolver_exposes_activator_for_hidden_editor():
    """Run 33c3ef25 regression: when the chosen editor is hidden behind a
    collapsed placeholder, the resolver must surface an `activator_selector`
    that paste_text can click to expand it.
    """
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": "div[name=\"body\"]",
        "tag": "div",
        "editor_kind": "contenteditable",
        "placeholder": None,
        "aria_label": None,
        "name": "body",
        "is_visible": False,
        "looks_like_search": False,
        "match_count": 1,
        "matched_parts": ["[contenteditable]"],
        "activator_selector": "[data-oh-activator=\"1\"]",
        "activator_text": "Join the conversation",
    }))
    resolved = await DOMHandler._resolve_input_target(
        tab, "div[contenteditable]"
    )
    assert resolved["is_visible"] is False
    assert resolved["activator_selector"] == "[data-oh-activator=\"1\"]"
    assert "Join the conversation" in resolved["activator_text"]


@pytest.mark.asyncio
async def test_open_collapsed_editor_clicks_activator_and_reresolves():
    """When _open_collapsed_editor runs, it clicks the activator (via a
    JS eval) and re-runs the resolver. After the click, the new resolve
    should return a visible real editor.
    """
    tab = MagicMock()
    tab.send = AsyncMock()

    # Round 5: new flow does [click, original re-resolve, generic fallback]
    # per attempt. If original re-resolve returns a visible real editor, the
    # fallback is skipped. Mock the visible editor on the first re-resolve.
    resolve_payload_visible = json.dumps({
        "selector": "div[name=\"body\"]",
        "tag": "div",
        "editor_kind": "contenteditable",
        "is_real_editor": True,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    })
    tab.evaluate = AsyncMock(side_effect=[
        True,                      # activator click succeeded
        resolve_payload_visible,   # re-resolve returns visible real editor
    ])

    initial = {
        "selector": "div[name=\"body\"]",
        "is_visible": False,
        "activator_selector": "[data-oh-activator=\"1\"]",
        "activator_text": "Join the conversation",
    }
    result = await DOMHandler._open_collapsed_editor(
        tab, initial, "div[contenteditable]"
    )
    assert result["is_visible"] is True
    assert result["is_real_editor"] is True
    assert result["activator_clicked"] is True
    assert result["activator_text"] == "Join the conversation"
    # Two evaluate calls: click + original re-resolve (fallback skipped).
    assert tab.evaluate.await_count == 2


@pytest.mark.asyncio
async def test_open_collapsed_editor_falls_back_to_generic_editor_scan():
    """Run ff8198fe regression: the selector_hint from find_on_page pointed
    at a Reddit <faceplate-textarea-input> trigger wrapper. After clicking,
    the real Lexical editor appears, but the ORIGINAL selector can't find
    it because that selector was specific to the wrapper. The generic
    editor fallback scan must pick up the real editor.
    """
    tab = MagicMock()
    tab.send = AsyncMock()

    # Flow per attempt: click → original re-resolve → generic fallback.
    # On attempt 1: click OK, original re-resolve still returns the wrapper
    # (no real editor), generic fallback finds a visible contenteditable.
    resolve_wrapper_still = json.dumps({
        "selector": "faceplate-textarea-input.w-full",
        "tag": "faceplate-textarea-input",
        "editor_kind": "unknown",
        "is_real_editor": False,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    })
    resolve_real_editor = json.dumps({
        "selector": 'div[name="body"]',
        "tag": "div",
        "editor_kind": "contenteditable",
        "is_real_editor": True,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
    })
    tab.evaluate = AsyncMock(side_effect=[
        True,                    # activator click succeeded
        resolve_wrapper_still,   # original re-resolve: still the wrapper
        resolve_real_editor,     # generic fallback: real editor found
    ])

    initial = {
        "selector": "faceplate-textarea-input.w-full",
        "is_visible": True,
        "is_real_editor": False,
        "activator_selector": "[data-oh-activator=\"1\"]",
        "activator_text": "Join the conversation",
    }
    result = await DOMHandler._open_collapsed_editor(
        tab, initial, "faceplate-textarea-input.w-full"
    )
    assert result["selector"] == 'div[name="body"]'
    assert result["is_real_editor"] is True
    assert result["is_visible"] is True
    assert result["fallback_editor_used"] is True
    assert result["activator_clicked"] is True
    # 3 evaluates: click + original re-resolve + generic fallback.
    assert tab.evaluate.await_count == 3


@pytest.mark.asyncio
async def test_resolver_marks_trigger_wrapper_as_not_a_real_editor():
    """Run ff8198fe regression: find_on_page's selector_hint pointed at
    `comment-composer-host > faceplate-tracker > faceplate-textarea-input`.
    The resolver landed on a visible `faceplate-textarea-input` custom
    element with `editor_kind: unknown`. We must expose `is_real_editor`
    so paste_text can treat this as an activator and dig for the real
    Lexical editor after clicking it.
    """
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": "faceplate-textarea-input.w-full",
        "tag": "faceplate-textarea-input",
        "editor_kind": "unknown",
        "is_real_editor": False,
        "placeholder": "Join the conversation",
        "aria_label": None,
        "name": None,
        "is_visible": True,
        "looks_like_search": False,
        "match_count": 1,
        "matched_parts": ["faceplate-textarea-input"],
        "activator_selector": "[data-oh-activator=\"1\"]",
        "activator_text": "Join the conversation",
    }))
    resolved = await DOMHandler._resolve_input_target(
        tab, "faceplate-textarea-input"
    )
    assert resolved["is_visible"] is True
    assert resolved["is_real_editor"] is False
    # The wrapper itself is the activator — paste_text will click it.
    assert resolved["activator_selector"] == "[data-oh-activator=\"1\"]"


@pytest.mark.asyncio
async def test_open_collapsed_editor_is_noop_when_no_activator():
    """If the resolver didn't find an activator, _open_collapsed_editor
    must return the original resolved dict unchanged — no click attempted."""
    tab = MagicMock()
    tab.evaluate = AsyncMock()
    initial = {
        "selector": "div[name=\"body\"]",
        "is_visible": False,
        "activator_selector": None,
    }
    result = await DOMHandler._open_collapsed_editor(
        tab, initial, "div[contenteditable]"
    )
    assert result is initial
    assert tab.evaluate.await_count == 0


def test_verification_warns_about_hidden_editor_without_activator():
    resolved = {
        "selector": "div[name=\"body\"]",
        "editor_kind": "contenteditable",
        "is_visible": False,
        "looks_like_search": False,
        "match_count": 1,
    }
    result = DOMHandler._build_input_verification(
        expected="Hello",
        actual="",
        resolved=resolved,
        original_selector="div[contenteditable]",
        action="paste_text",
    )
    assert any("hidden" in w.lower() for w in result["warnings"])
    assert any("join the conversation" in w.lower() for w in result["warnings"])


def test_verification_notes_when_activator_click_failed_to_reveal_editor():
    resolved = {
        "selector": "div[name=\"body\"]",
        "editor_kind": "contenteditable",
        "is_visible": False,
        "looks_like_search": False,
        "match_count": 1,
        "activator_clicked": True,
        "activator_text": "Join the conversation",
    }
    result = DOMHandler._build_input_verification(
        expected="Hello",
        actual="",
        resolved=resolved,
        original_selector="div[contenteditable]",
        action="paste_text",
    )
    msg = " ".join(result["warnings"]).lower()
    assert "activator" in msg
    assert "real mouse" in msg or "human gesture" in msg


@pytest.mark.asyncio
async def test_paste_text_refuses_long_text_into_search_input():
    """If the resolver lands on a search input and the text is long, paste_text
    must RAISE, not return a dict claiming success. This is the guard rail
    that would have stopped the Reddit comment-into-search-box bug cold.
    """
    tab = MagicMock()
    tab.evaluate = AsyncMock(return_value=json.dumps({
        "selector": "input[name=\"q\"]",
        "tag": "input",
        "editor_kind": "input-search",
        "placeholder": "Search in r/ClaudeAI",
        "name": "q",
        "is_visible": True,
        "looks_like_search": True,
        "match_count": 3,
        "matched_parts": ["input[type=\"text\"]"],
    }))
    tab.select = AsyncMock(return_value=MagicMock())
    tab.send = AsyncMock()

    long_comment = "This is a long comment " * 30
    with pytest.raises(Exception) as exc_info:
        await DOMHandler.paste_text(
            tab,
            "textarea, [contenteditable], input[type=\"text\"]",
            long_comment,
            clear_first=False,
        )
    msg = str(exc_info.value)
    assert "search input" in msg.lower()
    assert "find_on_page" in msg  # the error tells the agent what to do next
