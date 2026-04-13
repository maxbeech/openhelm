"""Tests for Round 11 stealth improvements (2026-04-13).

Round 11 addresses the 2026-era CDP detection vectors that Cloudflare,
Reddit's Snoosheriff, and DataDome exploit. The biggest single change
is eliminating the two `uc.cdp.runtime.enable()` call sites in the
browser MCP — those were the #1 CDP detection vector. Other changes:

- HTTP `Sec-CH-UA-*` header alignment with JS-side userAgentData spoofs
  (fixes the "Franken-fingerprint" that Reddit blank-pages on).
- Patch 30: `Function.prototype.toString` WeakSet cloak + `window.__oh_register`.
- Patch 31: `Element.prototype.attachShadow` force-open mode + shadow DOM walker.
- Patch 32: `document.hidden` / `visibilityState` always 'visible'.
- Patch 33: canvas `getImageData` noise (extending existing toDataURL patch).
- 5 new Chrome args (no-first-run, no-default-browser-check, etc.).

These tests are source-level — they verify the patches are present in
the right files at the right positions. Real-browser regression tests
against `bot.sannysoft.com` / `creepjs` happen during the E2E verification
pass, not here.
"""

from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

JS_DIR = SRC_DIR / "js"


def _read(path: Path) -> str:
    return path.read_text()


# ---------------------------------------------------------------------------
# A.1 — Runtime.enable elimination
# ---------------------------------------------------------------------------


class TestRuntimeEnableEliminated:
    """The #1 Round 11 change: neither cdp_function_executor nor
    cdp_element_cloner may call uc.cdp.runtime.enable() anymore.

    Holding the CDP Runtime domain open is the primary CDP detection
    vector in 2026 (patchright, rebrowser-patches, ZenDriver all agree).
    """

    def test_function_executor_never_calls_runtime_enable(self):
        src = _read(SRC_DIR / "cdp_function_executor.py")
        # Remove all comments and docstrings so mentions in explanatory
        # text don't trip the guard.
        # Docstrings: strip triple-quoted blocks.
        stripped = re.sub(r'"""[\s\S]*?"""', "", src)
        stripped = re.sub(r"'''[\s\S]*?'''", "", stripped)
        # Line comments
        stripped = re.sub(r"#.*", "", stripped)
        # The real call would be one of:
        #   await tab.send(uc.cdp.runtime.enable())
        # or some variant. After Round 11 the regex-level ban is:
        assert "cdp.runtime.enable" not in stripped, (
            "cdp_function_executor.py must not call uc.cdp.runtime.enable() "
            "after Round 11 — it is a primary 2026 CDP detection vector. "
            "The enable_runtime() method is now a no-op."
        )

    def test_element_cloner_never_calls_runtime_enable(self):
        src = _read(SRC_DIR / "cdp_element_cloner.py")
        stripped = re.sub(r'"""[\s\S]*?"""', "", src)
        stripped = re.sub(r"'''[\s\S]*?'''", "", stripped)
        stripped = re.sub(r"#.*", "", stripped)
        assert "cdp.runtime.enable" not in stripped, (
            "cdp_element_cloner.py must not call uc.cdp.runtime.enable() "
            "after Round 11 — the cloner only needs DOM and CSS domains "
            "which are safe to enable."
        )

    def test_enable_runtime_is_noop(self):
        """The public `enable_runtime` method is kept for backwards compat
        but must be a no-op (return True without sending any CDP command)."""
        src = _read(SRC_DIR / "cdp_function_executor.py")
        # Find the enable_runtime method body
        m = re.search(
            r"async def enable_runtime\(self, tab: Tab\) -> bool:(.*?)(?=\n    async def |\nclass )",
            src,
            re.DOTALL,
        )
        assert m, "enable_runtime method not found"
        body = m.group(1)
        # Strip the docstring before checking — the docstring legitimately
        # mentions tab.send in explanatory prose. We only care about the
        # actual code lines.
        body_no_doc = re.sub(r'"""[\s\S]*?"""', "", body)
        # The body must NOT contain a call to tab.send(...)
        assert "tab.send" not in body_no_doc, (
            "enable_runtime must be a no-op — no tab.send(...) call in code "
            "(docstrings can mention it for context)."
        )
        # And must still return True somewhere
        assert "return True" in body_no_doc


# ---------------------------------------------------------------------------
# A.2 — Sec-CH-UA HTTP header alignment
# ---------------------------------------------------------------------------


class TestSecChUaHeaderAlignment:
    """stealth.py must inject HTTP Sec-CH-UA-* headers that match the
    JS-side userAgentData.brands spoof."""

    def test_brand_profile_helper_exists(self):
        import stealth  # noqa: WPS433

        assert hasattr(stealth, "_brand_profile"), (
            "stealth.py must export _brand_profile() helper"
        )
        profile = stealth._brand_profile()
        # Minimum required keys for both HTTP and JS consumers
        required = {
            "ua", "sec_ch_ua", "sec_ch_ua_mobile", "sec_ch_ua_platform",
            "sec_ch_ua_full_version_list", "sec_ch_ua_platform_version",
            "sec_ch_ua_arch", "sec_ch_ua_bitness", "sec_ch_ua_model",
            "chrome_major", "chrome_full", "platform_name", "brand_js",
        }
        missing = required - set(profile.keys())
        assert not missing, f"_brand_profile() missing keys: {missing}"

    def test_brand_profile_js_and_headers_agree_on_chrome_major(self):
        import stealth  # noqa: WPS433

        profile = stealth._brand_profile()
        # The brand_js list must contain an entry with version == chrome_major
        chrome_major = profile["chrome_major"]
        versions = [b.get("version") for b in profile["brand_js"]]
        assert chrome_major in versions, (
            "brand_js must include the Chrome major version "
            f"(chrome_major={chrome_major}, versions in brand_js={versions}). "
            "Mismatches here are the Franken-fingerprint vector."
        )
        # sec_ch_ua header string must embed the same major version
        assert f'"Google Chrome";v="{chrome_major}"' in profile["sec_ch_ua"]

    def test_inject_stealth_sends_network_enable_and_sec_ch_ua(self):
        """Source-level: inject_stealth must call both page.enable AND
        network.set_extra_http_headers (the Sec-CH-UA injection)."""
        src = _read(SRC_DIR / "stealth.py")
        # inject_stealth is at the bottom of the file. Just slice from
        # its definition to end-of-file and search inside that.
        idx = src.find("async def inject_stealth(")
        assert idx >= 0, "inject_stealth function not found in stealth.py"
        body = src[idx:]
        # Page domain enable (was already there)
        assert "page.enable" in body
        # Round 11: must now also set extra HTTP headers
        assert "set_extra_http_headers" in body, (
            "inject_stealth must call Network.setExtraHTTPHeaders to set "
            "Sec-CH-UA-* headers aligned with the JS brand spoof."
        )
        # Network domain must be enabled before setExtraHTTPHeaders
        assert "network.enable" in body

    def test_stealth_core_js_uses_brand_placeholders(self):
        """Patch 8 in stealth_core.js must consume the __OH_BRAND_LIST__ and
        __OH_CHROME_MAJOR__ placeholders so JS values match HTTP headers."""
        js = _read(JS_DIR / "stealth_core.js")
        assert "__OH_BRAND_LIST__" in js, (
            "stealth_core.js Patch 8 must reference __OH_BRAND_LIST__ "
            "placeholder — templated in from _brand_profile() at load time."
        )
        assert "__OH_CHROME_MAJOR__" in js
        assert "__OH_PLATFORM_NAME__" in js

    def test_load_stealth_scripts_replaces_brand_placeholders(self):
        """The loader must substitute the brand placeholders before
        returning the JS bundle."""
        import stealth  # noqa: WPS433

        loaded = stealth._load_stealth_scripts(seed=12345)
        # After loading, the placeholders must NOT survive verbatim —
        # they should have been replaced with concrete values.
        assert "__OH_BRAND_LIST__" not in loaded, (
            "_load_stealth_scripts must replace __OH_BRAND_LIST__ with "
            "the JSON brand list before returning."
        )
        assert "__OH_CHROME_MAJOR__" not in loaded
        assert "__OH_PLATFORM_NAME__" not in loaded


# ---------------------------------------------------------------------------
# A.3 — Patch 30: Function.prototype.toString WeakSet cloak
# ---------------------------------------------------------------------------


class TestPatch30ToStringCloak:
    """Patch 30 must be present in stealth_core.js and must run FIRST
    (before any subsequent patch that registers with it)."""

    def test_weakset_cloak_installed_before_other_patches(self):
        js = _read(JS_DIR / "stealth_core.js")
        # The cloak defines __oh_patched WeakSet and window.__oh_register
        assert "__oh_patched" in js
        assert "window.__oh_register" in js
        assert "new WeakSet" in js

    def test_cloak_appears_before_patch_1(self):
        """Patch 30 must appear earlier in the source than Patch 1
        (chrome.runtime stub) so the WeakSet is ready when later patches
        try to register functions with it."""
        js = _read(JS_DIR / "stealth_core.js")
        cloak_idx = js.find("__oh_patched")
        patch1_idx = js.find("chrome.runtime stub")
        assert cloak_idx >= 0 and patch1_idx >= 0
        assert cloak_idx < patch1_idx, (
            "Round 11 Patch 30 (toString WeakSet cloak) must appear "
            "before Patch 1 in stealth_core.js so window.__oh_register "
            "is ready when Patch 1 and later patches execute."
        )

    def test_cloak_returns_native_code_string(self):
        """Source-level: the cloak's override must return a string
        containing '[native code]' for registered functions."""
        js = _read(JS_DIR / "stealth_core.js")
        assert "[native code]" in js
        # And the delegation-to-original path must also be present
        assert "_origFnToString.call" in js


# ---------------------------------------------------------------------------
# A.4 — Patch 31: attachShadow force-open + shadow DOM walker
# ---------------------------------------------------------------------------


class TestPatch31ShadowDOM:
    def test_attach_shadow_forced_to_open_mode(self):
        js = _read(JS_DIR / "stealth_core.js")
        # The override must set init.mode = 'open' regardless of input.
        assert "init.mode = 'open'" in js or 'init.mode = "open"' in js, (
            "Element.prototype.attachShadow must be overridden to force "
            "mode:'open' so CDP can reach Cloudflare Turnstile shadow DOM."
        )
        # The original must be captured and called
        assert "_origAttachShadow" in js

    def test_attach_shadow_registered_with_cloak(self):
        js = _read(JS_DIR / "stealth_core.js")
        # The replacement function must register with __oh_register so
        # its .toString() returns [native code].
        assert "_ohAttachShadow" in js
        assert "__oh_register(_ohAttachShadow)" in js

    def test_mutation_observer_walks_shadow_roots(self):
        js = _read(JS_DIR / "stealth_core.js")
        assert "MutationObserver" in js
        assert "shadowRoot" in js


# ---------------------------------------------------------------------------
# A.5 — Patch 32: visibilityState always 'visible'
# ---------------------------------------------------------------------------


class TestPatch32Visibility:
    def test_document_hidden_always_false(self):
        js = _read(JS_DIR / "stealth_core.js")
        # defineProperty on Document.prototype.hidden with get → false
        m = re.search(
            r"defineProperty\(Document\.prototype,\s*'hidden'[^)]*get:\s*function\s*\(\)\s*\{\s*return false",
            js,
            re.DOTALL,
        )
        assert m, "document.hidden getter must always return false"

    def test_visibility_state_always_visible(self):
        js = _read(JS_DIR / "stealth_core.js")
        assert "visibilityState" in js
        assert "'visible'" in js
        # Must also cover webkit prefix for legacy detectors
        assert "webkitVisibilityState" in js

    def test_get_image_data_noised(self):
        """Patch 33 extension: getImageData must be overridden in
        stealth_fingerprint.js so canvas pixel-read fingerprints are
        noised, not just toDataURL/toBlob."""
        js = _read(JS_DIR / "stealth_fingerprint.js")
        assert "CanvasRenderingContext2D.prototype.getImageData" in js, (
            "Round 11: stealth_fingerprint.js must override getImageData "
            "so Cloudflare Turnstile's direct-pixel-read fingerprint is "
            "also noised (toDataURL alone is insufficient)."
        )
        # And must use the session-deterministic noise helper
        assert "__stealthHash" in js


# ---------------------------------------------------------------------------
# A.6 — New Chrome args
# ---------------------------------------------------------------------------


class TestRound11ChromeArgs:
    """Five new stealth args must be present in STEALTH_CHROME_ARGS."""

    def test_chrome_args_include_new_stealth_args(self):
        import stealth  # noqa: WPS433

        args = set(stealth.STEALTH_CHROME_ARGS)
        required = {
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--password-store=basic",
            "--use-mock-keychain",
        }
        missing = required - args
        assert not missing, (
            f"STEALTH_CHROME_ARGS missing Round 11 stealth args: {missing}"
        )

    def test_chrome_args_have_no_duplicates(self):
        import stealth  # noqa: WPS433

        args = stealth.STEALTH_CHROME_ARGS
        # Flag names only (ignore = values for multi-feature args)
        flags = [a.split("=")[0] for a in args]
        seen = {}
        for f in flags:
            seen[f] = seen.get(f, 0) + 1
        # Note: --disable-features legitimately repeats (different feature
        # groups need separate args). Skip that specific flag.
        dupes = {
            f: n for f, n in seen.items()
            if n > 1 and f != "--disable-features"
        }
        assert not dupes, f"duplicate Chrome arg flags: {dupes}"


# ---------------------------------------------------------------------------
# D.1 — triple_click MCP tool
# ---------------------------------------------------------------------------


class TestTripleClickTool:
    """triple_click must be wired from dom_handler → server as a new MCP tool."""

    def test_dom_handler_defines_triple_click(self):
        import dom_handler  # noqa: WPS433

        assert hasattr(dom_handler.DOMHandler, "triple_click"), (
            "DOMHandler must expose a triple_click method"
        )
        # It must be a coroutine (async def)
        method = dom_handler.DOMHandler.triple_click
        assert inspect.iscoroutinefunction(
            method.__func__ if hasattr(method, "__func__") else method
        )

    def test_server_exposes_triple_click_tool(self):
        import server  # noqa: WPS433

        assert hasattr(server, "triple_click"), (
            "server.py must expose triple_click as an MCP tool so agents "
            "that hallucinate mcp__openhelm_browser__triple_click get a "
            "real working capability instead of a missing-tool error."
        )
        # Signature sanity
        sig = inspect.signature(
            getattr(server.triple_click, "__wrapped__", None)
            or getattr(server.triple_click, "fn", None)
            or server.triple_click
        )
        assert "instance_id" in sig.parameters
        assert "selector" in sig.parameters

    def test_triple_click_dispatches_three_mouse_events(self):
        """Source-level: the DOMHandler.triple_click body must iterate
        click_count from 1 → 3 and dispatch mouse events via CDP Input."""
        src = _read(SRC_DIR / "dom_handler.py")
        m = re.search(
            r"async def triple_click\(.*?\n        \"\"\"(.*?)\n    # -",
            src,
            re.DOTALL,
        )
        # Easier: just ensure the full body exists with the key constructs.
        full = re.search(
            r"async def triple_click\((.*?)# ------",
            src,
            re.DOTALL,
        )
        assert full, "triple_click source body not found"
        body = full.group(0)
        assert "click_count" in body
        assert "mousePressed" in body
        assert "mouseReleased" in body
        assert "dispatch_mouse_event" in body
        # The three clickCount values 1, 2, 3
        assert "(1, 2, 3)" in body
