"""Tests for the accessibility handler — page digest and search tools."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from dataclasses import dataclass, field
from typing import List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from accessibility_handler import (
    AccessibilityHandler,
    _filter_nodes,
    _format_digest,
)


# ---------------------------------------------------------------------------
# Helpers: minimal AXNode stubs
# ---------------------------------------------------------------------------

@dataclass
class FakeAXValue:
    value: str


@dataclass
class FakeAXProperty:
    name: FakeAXValue
    value: FakeAXValue


@dataclass
class FakeAXNode:
    node_id: str
    ignored: bool = False
    role: Optional[FakeAXValue] = None
    name: Optional[FakeAXValue] = None
    value: Optional[FakeAXValue] = None
    properties: Optional[List[FakeAXProperty]] = None
    parent_id: Optional[str] = None
    child_ids: Optional[List[str]] = None
    backend_dom_node_id: Optional[int] = None
    frame_id: Optional[str] = None


def _make_tree():
    """Build a small fake AX tree for testing."""
    return [
        FakeAXNode(
            node_id="1", role=FakeAXValue("RootWebArea"),
            name=FakeAXValue("Test Page"),
            child_ids=["2", "3", "4", "5"],
        ),
        FakeAXNode(
            node_id="2", role=FakeAXValue("heading"),
            name=FakeAXValue("Welcome"),
            parent_id="1",
            properties=[FakeAXProperty(FakeAXValue("level"), FakeAXValue("1"))],
        ),
        FakeAXNode(
            node_id="3", role=FakeAXValue("link"),
            name=FakeAXValue("About"),
            parent_id="1",
            properties=[FakeAXProperty(FakeAXValue("url"), FakeAXValue("/about"))],
        ),
        FakeAXNode(
            node_id="4", role=FakeAXValue("button"),
            name=FakeAXValue("Submit"),
            parent_id="1",
        ),
        # Ignored node — should be filtered out
        FakeAXNode(
            node_id="5", role=FakeAXValue("generic"),
            name=FakeAXValue("wrapper div"),
            parent_id="1", ignored=False,
        ),
    ]


# ---------------------------------------------------------------------------
# Tests: _filter_nodes
# ---------------------------------------------------------------------------

class TestFilterNodes:
    def test_filters_ignored_nodes(self):
        nodes = [
            FakeAXNode(node_id="1", role=FakeAXValue("RootWebArea"),
                       name=FakeAXValue("Page"), child_ids=["2"]),
            FakeAXNode(node_id="2", role=FakeAXValue("button"),
                       name=FakeAXValue("OK"), parent_id="1", ignored=True),
        ]
        result = _filter_nodes(nodes, include_links=True)
        # Root should be kept, ignored button should be filtered
        roles = [r["role"] for r in result]
        assert "button" not in roles

    def test_filters_generic_role(self):
        nodes = _make_tree()
        result = _filter_nodes(nodes, include_links=True)
        roles = [r["role"] for r in result]
        assert "generic" not in roles

    def test_keeps_heading_with_level(self):
        nodes = _make_tree()
        result = _filter_nodes(nodes, include_links=True)
        heading = [r for r in result if r["role"] == "heading"][0]
        assert heading["name"] == "Welcome"
        assert heading["props"]["level"] == "1"

    def test_keeps_link_with_url(self):
        nodes = _make_tree()
        result = _filter_nodes(nodes, include_links=True)
        link = [r for r in result if r["role"] == "link"][0]
        assert link["name"] == "About"
        assert link["props"]["url"] == "/about"

    def test_excludes_links_when_disabled(self):
        nodes = _make_tree()
        result = _filter_nodes(nodes, include_links=False)
        link = [r for r in result if r["role"] == "link"][0]
        assert "url" not in link.get("props", {})

    def test_preserves_depth(self):
        nodes = _make_tree()
        result = _filter_nodes(nodes, include_links=True)
        # Root is depth 0, children are depth 1
        root = result[0]
        assert root["depth"] == 0
        children = result[1:]
        for child in children:
            assert child["depth"] == 1


# ---------------------------------------------------------------------------
# Tests: _format_digest
# ---------------------------------------------------------------------------

class TestFormatDigest:
    def test_includes_header(self):
        nodes = _make_tree()
        filtered = _filter_nodes(nodes, include_links=True)
        digest = _format_digest(
            filtered, "Test Page", "https://example.com",
            {"scrollTop": 0, "scrollHeight": 1000, "viewportHeight": 720},
            include_links=True, max_tokens=15000,
        )
        assert "# Page: Test Page" in digest
        assert "URL: https://example.com" in digest
        assert "Scroll:" in digest

    def test_includes_heading_level(self):
        nodes = _make_tree()
        filtered = _filter_nodes(nodes, include_links=True)
        digest = _format_digest(
            filtered, "Test", "https://example.com",
            {"scrollTop": 0, "scrollHeight": 1000, "viewportHeight": 720},
            include_links=True, max_tokens=15000,
        )
        assert "[heading-1]" in digest
        assert '"Welcome"' in digest

    def test_includes_link_target(self):
        nodes = _make_tree()
        filtered = _filter_nodes(nodes, include_links=True)
        digest = _format_digest(
            filtered, "Test", "https://example.com",
            {"scrollTop": 0, "scrollHeight": 1000, "viewportHeight": 720},
            include_links=True, max_tokens=15000,
        )
        assert "[link]" in digest
        assert "-> /about" in digest

    def test_truncates_when_over_budget(self):
        nodes = _make_tree()
        filtered = _filter_nodes(nodes, include_links=True)
        # Very small budget — should truncate
        digest = _format_digest(
            filtered, "Test", "https://example.com",
            {"scrollTop": 0, "scrollHeight": 1000, "viewportHeight": 720},
            include_links=True, max_tokens=10,  # Extremely small
        )
        assert "truncated" in digest


# ---------------------------------------------------------------------------
# Tests: click_element helpers (CSS-to-XPath, text hint extraction)
# ---------------------------------------------------------------------------

class TestCSSToXPath:
    def test_attr_equals(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('button[aria-label="Back"]')
        assert result == '//button[@aria-label="Back"]'

    def test_attr_contains(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('[data-testid*="comment"]')
        assert result == '//*[contains(@data-testid, "comment")]'

    def test_class_selector(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('.my-class')
        assert result == '//*[contains(@class, "my-class")]'

    def test_id_selector(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('#main')
        assert result == '//*[@id="main"]'

    def test_tag_class(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('div.container')
        assert result == '//div[contains(@class, "container")]'

    def test_returns_none_for_complex(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('div > span.foo:nth-child(2)')
        assert result is None

    def test_returns_none_for_xpath(self):
        from dom_handler import DOMHandler
        result = DOMHandler._css_selector_to_xpath('//div[@class="foo"]')
        assert result is None


class TestExtractTextHint:
    def test_extracts_aria_label(self):
        from dom_handler import DOMHandler
        result = DOMHandler._extract_text_hint('button[aria-label="Back"]')
        assert result == "Back"

    def test_extracts_title(self):
        from dom_handler import DOMHandler
        result = DOMHandler._extract_text_hint('[title="Close dialog"]')
        assert result == "Close dialog"

    def test_extracts_contains_aria_label(self):
        from dom_handler import DOMHandler
        result = DOMHandler._extract_text_hint('[aria-label*="reply"]')
        assert result == "reply"

    def test_returns_none_for_plain_class(self):
        from dom_handler import DOMHandler
        result = DOMHandler._extract_text_hint('.my-button')
        assert result is None


# ---------------------------------------------------------------------------
# Tests: scroll_page return value (mocked)
# ---------------------------------------------------------------------------

class TestScrollPageReturn:
    def test_returns_dict_with_metrics(self):
        import asyncio
        import json
        from dom_handler import DOMHandler

        async def _run():
            tab = AsyncMock()
            # scroll_page now uses JSON.stringify, so evaluate returns JSON strings
            tab.evaluate = AsyncMock(side_effect=[
                json.dumps({"scroll_top": 0, "scroll_height": 5000, "viewport_height": 720}),
                None,  # scroll execution
                json.dumps({"scroll_top": 500, "scroll_height": 5000, "viewport_height": 720}),
            ])
            return await DOMHandler.scroll_page(tab, direction="down", amount=500)

        result = asyncio.run(_run())
        assert isinstance(result, dict)
        assert result["success"] is True
        assert result["at_top"] is False
        assert result["at_bottom"] is False
        assert "position_percent" in result
        assert "pages_remaining" in result
        assert "before" in result
        assert "after" in result

    def test_percent_scroll(self):
        import asyncio
        import json
        from dom_handler import DOMHandler

        async def _run():
            tab = AsyncMock()
            tab.evaluate = AsyncMock(side_effect=[
                json.dumps({"scroll_top": 0, "scroll_height": 5000, "viewport_height": 720}),
                None,
                json.dumps({"scroll_top": 2500, "scroll_height": 5000, "viewport_height": 720}),
            ])
            return await DOMHandler.scroll_page(tab, percent=50)

        result = asyncio.run(_run())
        assert isinstance(result, dict)
        assert result["success"] is True


# ---------------------------------------------------------------------------
# Tests: tool_timeout includes new tools
# ---------------------------------------------------------------------------

class TestToolTimeoutConfig:
    def test_new_tools_in_extended_timeout(self):
        from tool_timeout import EXTENDED_TIMEOUT_TOOLS
        assert "get_page_digest" in EXTENDED_TIMEOUT_TOOLS
        assert "find_on_page" in EXTENDED_TIMEOUT_TOOLS
        assert "find_by_role" in EXTENDED_TIMEOUT_TOOLS


# ---------------------------------------------------------------------------
# Tests: CDP hang protection — the primary fix for the Reddit hang bug
# ---------------------------------------------------------------------------

class TestCdpHangProtection:
    """Verify that unresponsive CDP calls fail fast with useful errors
    instead of hanging until the 120s MCP tool timeout fires."""

    def test_find_by_role_total_timeout_wrapper_exists(self):
        """find_by_role must enforce a total timeout budget shorter
        than the 120s MCP tool timeout so hangs produce a fast,
        actionable error message."""
        from accessibility_handler import _FN_TOTAL_TIMEOUT_S
        assert _FN_TOTAL_TIMEOUT_S < 120
        assert _FN_TOTAL_TIMEOUT_S >= 10  # Not unreasonably aggressive

    def test_cdp_helper_wraps_with_timeout(self):
        """The _cdp helper must apply asyncio.wait_for so every CDP
        call is individually bounded."""
        import asyncio
        from accessibility_handler import _cdp, _CDP_CALL_TIMEOUT_S

        async def _run():
            tab = MagicMock()
            # Simulate a hanging CDP call — tab.send never completes
            never = asyncio.Future()
            tab.send = MagicMock(return_value=never)
            try:
                await _cdp(tab, "fake_command", timeout_s=0.1)
                return "no_timeout"
            except asyncio.TimeoutError:
                return "timed_out"

        assert asyncio.run(_run()) == "timed_out"
        assert _CDP_CALL_TIMEOUT_S > 0

    def test_get_page_digest_uses_fast_path_by_default(self):
        """Default mode must be 'fast' (JS extraction), not 'semantic'
        (CDP AX tree) — the AX tree is too slow on Reddit."""
        import asyncio
        import inspect
        # Verify the default parameter value
        sig = inspect.signature(AccessibilityHandler.get_page_digest)
        assert sig.parameters["mode"].default == "fast"

    def test_js_fast_digest_returns_mode_fast(self):
        """The fast JS path must tag its output with mode='fast' so
        callers can tell which path produced the digest."""
        import asyncio
        import json
        from accessibility_handler import _js_fast_digest

        async def _run():
            tab = MagicMock()
            # Mock tab.evaluate to return a plausible JSON result
            fake_js_output = json.dumps({
                "lines": [
                    '[heading-1] "Welcome"',
                    '[link] "Sign in" -> /login',
                    '[button] "Submit"',
                ],
                "scanned": 150,
                "budget_exceeded": False,
                "chars": 80,
            })
            tab.evaluate = MagicMock(return_value=asyncio.sleep(0, result=fake_js_output))
            return await _js_fast_digest(
                tab,
                title="Test",
                url="https://example.com",
                scroll_info={"scrollTop": 0, "scrollHeight": 1000, "viewportHeight": 720},
                max_tokens=15000,
            )

        result = asyncio.run(_run())
        assert result["mode"] == "fast"
        assert result["node_count"] == 3
        assert "[heading-1]" in result["digest"]
        assert "[link]" in result["digest"]
        assert "[button]" in result["digest"]

    def test_find_by_role_fails_fast_on_enable_hang(self):
        """If accessibility.enable() hangs, find_by_role must raise
        a fast error — not block the full 120s MCP timeout."""
        import asyncio
        import time

        async def _run():
            tab = MagicMock()
            # Make every tab.send hang forever
            tab.send = MagicMock(return_value=asyncio.Future())

            start = time.monotonic()
            try:
                # Patch to a tiny total timeout for test speed
                with patch(
                    "accessibility_handler._FN_TOTAL_TIMEOUT_S", 0.5
                ), patch(
                    "accessibility_handler._CDP_CALL_TIMEOUT_S", 0.2
                ):
                    await AccessibilityHandler.find_by_role(
                        tab, role="button", name="Submit"
                    )
                return ("no_error", time.monotonic() - start)
            except Exception as e:
                return (str(e), time.monotonic() - start)

        result, elapsed = asyncio.run(_run())
        # Must fail (not hang) and must fail within a few seconds
        assert "timed out" in result.lower() or "hung" in result.lower()
        assert elapsed < 5, f"find_by_role took {elapsed}s to fail"


# ---------------------------------------------------------------------------
# find_on_page JS-first rewrite (Round 4, Run 33c3ef25 regression)
#
# The old CDP DOM.performSearch path either failed with "DOM agent is not
# enabled" or returned matches with all useful fields (selector_hint,
# position, scrolled_to) null. The rewrite runs a single JS evaluate that
# must ALWAYS return a usable selector_hint when it finds a match.
# ---------------------------------------------------------------------------


class TestFindOnPageJsFirst:
    def test_find_on_page_returns_usable_selector_hint_on_match(self):
        import asyncio
        import json as _json

        payload = _json.dumps({
            "found": True,
            "total_matches": 3,
            "match_index": 0,
            "scrolled_to": True,
            "selector_hint": '[data-oh-find="1"]',
            "context_text": "Join the conversation",
            "position": {"x": 100, "y": 400, "width": 480, "height": 48},
            "tag": "button",
            "is_visible": True,
        })
        tab = MagicMock()
        tab.evaluate = AsyncMock(return_value=payload)
        result = asyncio.run(
            AccessibilityHandler.find_on_page(tab, "Join the conversation")
        )
        assert result["found"] is True
        # selector_hint MUST be populated — this is the key regression fix.
        assert result["selector_hint"] is not None
        assert result["selector_hint"] == '[data-oh-find="1"]'
        assert result["position"] is not None
        assert result["scrolled_to"] is True
        # Single evaluate call — no CDP DOM.performSearch fallback dance.
        assert tab.evaluate.await_count == 1

    def test_find_on_page_returns_not_found_on_empty_result(self):
        import asyncio
        import json as _json

        payload = _json.dumps({
            "found": False,
            "total_matches": 0,
            "query": "nonsense-that-does-not-exist",
        })
        tab = MagicMock()
        tab.evaluate = AsyncMock(return_value=payload)
        result = asyncio.run(
            AccessibilityHandler.find_on_page(tab, "nonsense-that-does-not-exist")
        )
        assert result["found"] is False
        assert result["total_matches"] == 0

    def test_find_on_page_tolerates_unparseable_eval_result(self):
        """If the JS eval somehow returns non-JSON, the tool must
        degrade to a not-found response instead of raising."""
        import asyncio
        tab = MagicMock()
        tab.evaluate = AsyncMock(return_value="garbage {not json")
        result = asyncio.run(
            AccessibilityHandler.find_on_page(tab, "anything")
        )
        assert result["found"] is False
        assert "error" in result or result["total_matches"] == 0

    def test_find_on_page_does_not_use_cdp_dom_perform_search(self):
        """Confirms the rewrite is JS-first: no tab.send calls should be
        made by find_on_page (the old path called DOM.performSearch via
        tab.send)."""
        import asyncio
        import json as _json
        tab = MagicMock()
        tab.evaluate = AsyncMock(return_value=_json.dumps({
            "found": True, "total_matches": 1, "match_index": 0,
            "selector_hint": "#x", "scrolled_to": True,
            "position": {"x": 0, "y": 0, "width": 10, "height": 10},
            "context_text": "x", "tag": "div", "is_visible": True,
        }))
        tab.send = AsyncMock()
        asyncio.run(AccessibilityHandler.find_on_page(tab, "#x"))
        assert tab.send.await_count == 0
