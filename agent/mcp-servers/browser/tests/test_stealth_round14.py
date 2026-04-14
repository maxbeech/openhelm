"""Tests for Round 14 stealth + resilience improvements (2026-04-14).

Round 14 targets the Reddit CDP process-crash pattern and the MCP-tool
cold-start race surfaced by the 2026-04-14 prod run analysis:

1. Auto-cleanup of dead browser instances so agents transparently recover
   from Reddit/X CDP crashes via a plain spawn_browser retry (no manual
   close_instance required).
2. `browser_manager.list_instances()` filters ERROR-state instances by
   default, so the server's profile lock reconciler releases locks held
   by zombies.
3. Classic `chrome.loadTimes()`, `chrome.csi()`, `chrome.app.isInstalled`
   stubs (Patches 41-43) — still actively probed by Snoosheriff and
   Cloudflare bm.js even though they're "deprecated."
4. `window.close()` guard (Patch 44) — prevents anti-bot JS from
   closing our tab out from under the CDP socket.
5. Deprecated filesystem API stubs (Patch 45) — prevents renderer crashes
   triggered by calls to removed Chrome internals.
"""

from __future__ import annotations

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
# A. browser_manager dead-instance auto-cleanup
# ---------------------------------------------------------------------------


class TestDeadInstanceAutoCleanup:
    """get_tab must auto-schedule cleanup of a crashed Chrome so the
    next spawn_browser(profile=<same>) transparently gets a fresh one.

    Prior behaviour: a Reddit / anti-bot CDP crash left a zombie entry
    in `_instances` AND in `_instance_profiles`. Every spawn attempt
    on the same profile returned the zombie via the cross-compaction
    reuse path, and the agent was stuck until the 5-minute idle reaper
    ran. Round 14 fixes this at the source by scheduling an async
    cleanup inside `get_tab` right before it raises the CDP-lost error.
    """

    def test_get_tab_schedules_cleanup_on_cdp_lost(self):
        src = _read(SRC_DIR / "browser_manager.py")
        # Must reference the new cleanup method inside get_tab's error path
        assert "_cleanup_dead_instance" in src, (
            "browser_manager.py must define _cleanup_dead_instance() "
            "(Round 14)"
        )
        assert "create_task(self._cleanup_dead_instance" in src, (
            "get_tab must schedule an async cleanup of dead instances "
            "so spawn_browser can transparently recover (Round 14)"
        )

    def test_cleanup_dead_instance_removes_from_instances(self):
        src = _read(SRC_DIR / "browser_manager.py")
        # The fallback path in _cleanup_dead_instance must force-remove
        # from self._instances even if close_instance raises.
        assert "self._instances.pop(instance_id, None)" in src, (
            "_cleanup_dead_instance must force-remove from _instances "
            "on close_instance failure (Round 14)"
        )

    def test_cdp_lost_error_mentions_auto_cleanup(self):
        src = _read(SRC_DIR / "browser_manager.py")
        # The error message must tell the agent it's auto-cleaned up,
        # not "please close_instance and spawn_browser" (which races
        # the async cleanup and produces confusing errors).
        assert "auto-cleaned" in src, (
            "get_tab's CDP-lost error must tell the agent the dead "
            "instance is being auto-cleaned up (Round 14)"
        )


# ---------------------------------------------------------------------------
# B. list_instances filters ERROR state by default
# ---------------------------------------------------------------------------


class TestListInstancesFiltersErrored:
    """`browser_manager.list_instances()` must filter out ERROR-state
    instances by default so the server's profile-lock reconciler sees
    zombies as "gone" and releases their locks. Callers that genuinely
    need the raw list (debugging, cleanup) opt in via include_errored.
    """

    def test_list_instances_signature_has_include_errored_param(self):
        import inspect
        # Load browser_manager module, not the server (server imports
        # it lazily and has side effects we don't want in tests).
        browser_manager_src = _read(SRC_DIR / "browser_manager.py")
        assert "async def list_instances(self, include_errored: bool = False)" in browser_manager_src, (
            "BrowserManager.list_instances must accept include_errored=False "
            "(Round 14)"
        )

    def test_list_instances_filters_error_state_by_default(self):
        src = _read(SRC_DIR / "browser_manager.py")
        # The implementation must skip ERROR-state entries unless include_errored
        assert "BrowserState.ERROR" in src, "browser_manager must import BrowserState.ERROR"
        # Specific pattern: the filter expression
        assert "if data['instance'].state != BrowserState.ERROR" in src, (
            "list_instances must filter ERROR-state instances (Round 14)"
        )


# ---------------------------------------------------------------------------
# C. Round 14 stealth_core.js patches (41-45)
# ---------------------------------------------------------------------------


class TestPatch41ChromeLoadTimes:
    """chrome.loadTimes() stub — still actively probed by Snoosheriff."""

    def test_patch_41_defines_chrome_loadtimes(self):
        src = _read(JS_DIR / "stealth_core.js")
        assert "chrome.loadTimes" in src, "Patch 41 must define chrome.loadTimes"
        # The stub must return an object with the canonical property names
        assert "finishLoadTime" in src, (
            "Patch 41's chrome.loadTimes() return value must include "
            "finishLoadTime (canonical Chrome shape)"
        )
        assert "wasFetchedViaSpdy" in src
        assert "npnNegotiatedProtocol" in src

    def test_patch_41_registered_with_oh_register(self):
        src = _read(JS_DIR / "stealth_core.js")
        # Find the Patch 41 block
        match = re.search(
            r"// ── 41\..*?// ── 42\.",
            src,
            re.DOTALL,
        )
        assert match, "Patch 41 block not found in stealth_core.js"
        patch_block = match.group(0)
        assert "__oh_register" in patch_block, (
            "Patch 41 must register chrome.loadTimes via __oh_register "
            "so toString() returns [native code]"
        )


class TestPatch42ChromeCsi:
    """chrome.csi() stub — Google's internal timing API, part of the
    canonical 'is this non-headless Chrome' probe."""

    def test_patch_42_defines_chrome_csi(self):
        src = _read(JS_DIR / "stealth_core.js")
        assert "chrome.csi" in src, "Patch 42 must define chrome.csi"
        assert "onloadT" in src, (
            "Patch 42's chrome.csi() return value must include onloadT "
            "(canonical Chrome shape)"
        )
        assert "startE" in src
        assert "pageT" in src

    def test_patch_42_registered_with_oh_register(self):
        src = _read(JS_DIR / "stealth_core.js")
        match = re.search(
            r"// ── 42\..*?// ── 43\.",
            src,
            re.DOTALL,
        )
        assert match, "Patch 42 block not found in stealth_core.js"
        patch_block = match.group(0)
        assert "__oh_register" in patch_block, (
            "Patch 42 must register chrome.csi via __oh_register"
        )


class TestPatch43ChromeApp:
    """chrome.app + isInstalled stub — FingerprintJS's headlessChrome
    test checks that chrome.app exists with isInstalled."""

    def test_patch_43_defines_chrome_app(self):
        src = _read(JS_DIR / "stealth_core.js")
        # Find the Patch 43 block
        match = re.search(
            r"// ── 43\..*?// ── 44\.",
            src,
            re.DOTALL,
        )
        assert match, "Patch 43 block not found in stealth_core.js"
        patch_block = match.group(0)
        assert "isInstalled" in patch_block, (
            "Patch 43 must define chrome.app.isInstalled (canonical "
            "FingerprintJS probe)"
        )
        # InstallState + RunningState enums
        assert "InstallState" in patch_block
        assert "RunningState" in patch_block


class TestPatch44WindowCloseGuard:
    """window.close() guard — prevents Snoosheriff from closing our
    tab out from under the CDP socket (which caused the
    ConnectionRefusedError(61) crashes on Reddit scroll_page).
    """

    def test_patch_44_overrides_window_close(self):
        src = _read(JS_DIR / "stealth_core.js")
        match = re.search(
            r"// ── 44\..*?// ── 45\.",
            src,
            re.DOTALL,
        )
        assert match, "Patch 44 block not found in stealth_core.js"
        patch_block = match.group(0)
        # The guard must override window.close with a no-op
        assert "window.close" in patch_block, (
            "Patch 44 must reference window.close"
        )
        assert "_ohWindowClose" in patch_block, (
            "Patch 44 must define _ohWindowClose as the no-op replacement"
        )

    def test_patch_44_registered_with_oh_register(self):
        src = _read(JS_DIR / "stealth_core.js")
        match = re.search(
            r"// ── 44\..*?// ── 45\.",
            src,
            re.DOTALL,
        )
        assert match
        assert "__oh_register(window.close)" in match.group(0), (
            "Patch 44 must register window.close via __oh_register so its "
            ".toString() returns [native code] and anti-bot JS can't detect "
            "the override"
        )


class TestPatch45DeprecatedFileSystemApiStubs:
    """webkitRequestFileSystem stub — prevents anti-bot JS from
    crashing the renderer via calls to removed Chrome internals."""

    def test_patch_45_defines_webkit_filesystem_stub(self):
        src = _read(JS_DIR / "stealth_core.js")
        assert "webkitRequestFileSystem" in src
        assert "webkitResolveLocalFileSystemURL" in src


# ---------------------------------------------------------------------------
# D. Round 14 patches mirror to src-tauri copy
# ---------------------------------------------------------------------------


class TestSrcTauriMirror:
    """The src-tauri/ copy of stealth_core.js must be byte-identical
    to the agent-side copy, same policy as every previous round."""

    def test_stealth_core_js_is_byte_identical(self):
        agent_copy = _read(JS_DIR / "stealth_core.js")
        # The Tauri copy lives outside the test's SRC_DIR
        tauri_path = (
            Path(__file__).resolve().parents[4]
            / "src-tauri"
            / "mcp-servers"
            / "browser"
            / "src"
            / "js"
            / "stealth_core.js"
        )
        tauri_copy = _read(tauri_path)
        assert agent_copy == tauri_copy, (
            "src-tauri copy of stealth_core.js must be byte-identical "
            "to the agent copy (Round 14 mirror discipline)"
        )

    def test_browser_manager_py_is_byte_identical(self):
        agent_copy = _read(SRC_DIR / "browser_manager.py")
        tauri_path = (
            Path(__file__).resolve().parents[4]
            / "src-tauri"
            / "mcp-servers"
            / "browser"
            / "src"
            / "browser_manager.py"
        )
        tauri_copy = _read(tauri_path)
        assert agent_copy == tauri_copy, (
            "src-tauri copy of browser_manager.py must be byte-identical "
            "to the agent copy (Round 14)"
        )
