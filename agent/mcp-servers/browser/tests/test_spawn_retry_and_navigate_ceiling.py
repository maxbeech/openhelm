"""Tests for Issue 16 (spawn retry / -32000) and Issue 17 (navigate ceiling).

These are source-level assertions — they intentionally avoid spawning Chrome
or talking to CDP, so they run in any CI environment.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import browser_manager as bm_mod  # noqa: E402
import server  # noqa: E402


def _underlying(func):
    return getattr(func, "__wrapped__", None) or getattr(func, "fn", None) or func


class TestSpawnRetryHardening:
    """Issue 16: transient -32000 "Browser window not found" must be retried
    and, critically, the returned browser must be probed for a usable page
    target before the spawn is considered successful."""

    def test_max_spawn_retries_is_at_least_four(self):
        assert bm_mod.BrowserManager.MAX_SPAWN_RETRIES >= 4, (
            "spawn_browser should retry at least 4 times so the transient "
            "-32000 recovery path has room to breathe (profile lock + "
            "stale-Chrome cleanup take 2-3 attempts to settle)."
        )

    def test_do_spawn_probes_main_tab_before_returning(self):
        src = inspect.getsource(bm_mod.BrowserManager._do_spawn)
        # The probe must call update_targets + evaluate to verify the tab
        # is actually reachable over CDP (not just that main_tab returned
        # something).
        assert "update_targets" in src, (
            "_do_spawn must refresh targets after uc.start so main_tab "
            "picks up the real page target, not a stale one."
        )
        assert 'evaluate("1")' in src, (
            "_do_spawn must probe the candidate tab with a trivial "
            "evaluate() so half-alive Chrome instances are detected "
            "before spawn_browser returns."
        )

    def test_do_spawn_tears_down_half_alive_browser_on_probe_failure(self):
        src = inspect.getsource(bm_mod.BrowserManager._do_spawn)
        # When the probe fails we must stop() the browser so the profile
        # lock is released before the outer retry loop tries again.
        assert "browser.stop()" in src, (
            "_do_spawn must call browser.stop() when the tab probe fails, "
            "otherwise the half-alive Chrome keeps the profile locked and "
            "every retry hits the same -32000 error."
        )


class TestNavigateInternalCeiling:
    """Issue 17: navigate() must guarantee it returns before the outer
    120s MCP tool_timeout fires, so callers always see a soft
    ``success=False`` response instead of a hard tool failure."""

    def test_navigate_clamps_timeout_below_outer_wrapper(self):
        src = inspect.getsource(_underlying(server.navigate))
        assert "NAVIGATE_INTERNAL_CEILING_S" in src, (
            "navigate() must declare an internal ceiling constant so the "
            "internal timeout never exceeds the outer MCP wrapper."
        )
        # The ceiling must be strictly below the extended tool timeout.
        from tool_timeout import EXTENDED_TIMEOUT_S
        # Extract the numeric literal assigned to NAVIGATE_INTERNAL_CEILING_S.
        import re
        match = re.search(
            r"NAVIGATE_INTERNAL_CEILING_S\s*=\s*([0-9.]+)", src
        )
        assert match, "Could not find NAVIGATE_INTERNAL_CEILING_S assignment"
        ceiling = float(match.group(1))
        assert ceiling < EXTENDED_TIMEOUT_S, (
            f"Internal ceiling {ceiling}s must be < outer "
            f"EXTENDED_TIMEOUT_S ({EXTENDED_TIMEOUT_S}s)"
        )
        # And leave meaningful headroom (>=30s) for get_tab reconnect,
        # URL/title reads, and CAPTCHA probe.
        assert EXTENDED_TIMEOUT_S - ceiling >= 30, (
            f"Ceiling {ceiling}s leaves only "
            f"{EXTENDED_TIMEOUT_S - ceiling}s of headroom — too tight."
        )

    def test_get_tab_probe_budget_fits_under_navigate_headroom(self):
        """The get_tab() retry schedule must not eat more than ~20s so the
        navigate internal ceiling still has budget to drive the actual
        navigation."""
        src = inspect.getsource(bm_mod.BrowserManager.get_tab)
        # Current schedule: timeout = 4.0 + attempt * 2.0, 3 attempts,
        # plus two 2.0s sleeps between retries = max ~22s.
        assert "4.0 + attempt * 2.0" in src, (
            "get_tab() retry schedule was widened beyond the 4/6/8s budget; "
            "this risks blowing the navigate internal ceiling."
        )
