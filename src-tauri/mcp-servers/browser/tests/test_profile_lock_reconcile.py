"""Tests for profile lock reconciliation and Chrome Singleton cleanup.

These cover the class of failures observed in Run c2225fd1 where:

1. The idle-cleanup loop auto-closed a browser instance via
   `browser_manager.close_instance` directly, bypassing the MCP tool wrapper
   that owns the `_instance_profiles` mapping. The profile lock was never
   released, so the next `spawn_browser(profile="default")` failed with
   "Profile 'default' is already in use by another task" forever (the
   lock file's PID was the still-alive MCP server process, so the
   stale-PID detector in profile_manager could not help).

2. Chrome's `SingletonLock` / `SingletonSocket` / `SingletonCookie` files
   were left behind by a crashed Chrome inside the profile's user-data
   directory, causing nodriver to surface the cryptic "Failed to connect
   to browser — one of the causes could be when you are running as root"
   error on the retry spawn.

3. Chrome wrote ``profile.exit_type = "Crashed"`` because nodriver killed it
   with SIGTERM/SIGKILL, preventing a clean exit.  On next startup Chrome
   displayed the toast "Something went wrong when opening your profile.
   Some features may be unavailable."

The fixes live in `server.py::_reconcile_profile_locks`,
`server.py::_cleanup_stale_chrome_singletons`, and
`server.py::_reset_profile_crash_state`.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import profile_manager as _pm  # noqa: E402
import server  # noqa: E402


class _FakeInstance:
    def __init__(self, instance_id: str) -> None:
        self.instance_id = instance_id


@pytest.fixture
def isolated_profiles(monkeypatch, tmp_path):
    """Point profile_manager at a throwaway root so tests cannot touch
    the user's real ~/.openhelm/profiles directory."""
    fake_root = tmp_path / "profiles"
    fake_root.mkdir()
    monkeypatch.setattr(_pm, "PROFILES_ROOT", str(fake_root))
    monkeypatch.setattr(_pm, "PROFILES_META", str(fake_root / "profiles.json"))
    # Also reset the server-side instance-profile mapping between tests.
    server._instance_profiles.clear()
    yield fake_root
    server._instance_profiles.clear()


class TestReconcileProfileLocks:
    """`_reconcile_profile_locks` releases locks whose owning instance is gone."""

    def test_releases_lock_when_instance_is_gone(self, isolated_profiles):
        """The core regression test for Run c2225fd1.

        Simulate the exact state we land in after the idle reaper fires:
        - The profile lock file exists (was acquired by spawn_browser).
        - `_instance_profiles` still points at the dead instance_id.
        - `browser_manager.list_instances()` no longer returns it.

        After reconcile, the lock must be gone and the mapping empty.
        """
        _pm.create_profile("default")
        _pm.acquire_lock("default")
        assert _pm.is_profile_locked("default")

        dead_id = "dead-instance-123"
        server._instance_profiles[dead_id] = "default"

        # browser_manager.list_instances() returns nothing → instance is gone.
        with patch.object(
            server.browser_manager, "list_instances",
            AsyncMock(return_value=[])
        ):
            released = asyncio.run(server._reconcile_profile_locks())

        assert released == ["default"], (
            "reconcile must report which profiles it released"
        )
        assert not _pm.is_profile_locked("default"), (
            "reconcile must release the orphaned lock file so the next "
            "spawn_browser(profile='default') can acquire it"
        )
        assert dead_id not in server._instance_profiles, (
            "reconcile must drop the orphaned mapping entry"
        )

    def test_preserves_lock_when_instance_still_alive(self, isolated_profiles):
        """If the instance is still live, reconcile must NOT release its lock."""
        _pm.create_profile("default")
        _pm.acquire_lock("default")
        live_id = "alive-instance-456"
        server._instance_profiles[live_id] = "default"

        with patch.object(
            server.browser_manager, "list_instances",
            AsyncMock(return_value=[_FakeInstance(live_id)])
        ):
            released = asyncio.run(server._reconcile_profile_locks())

        assert released == []
        assert _pm.is_profile_locked("default"), (
            "reconcile must never touch locks whose instance is still alive"
        )
        assert server._instance_profiles.get(live_id) == "default"

    def test_partial_reconcile_releases_only_orphans(self, isolated_profiles):
        """Mixed state: one live, one dead — only the dead one is released."""
        _pm.create_profile("default")
        _pm.create_profile("xcom")
        _pm.acquire_lock("default")
        _pm.acquire_lock("xcom")

        live_id = "alive-111"
        dead_id = "dead-222"
        server._instance_profiles[live_id] = "default"
        server._instance_profiles[dead_id] = "xcom"

        with patch.object(
            server.browser_manager, "list_instances",
            AsyncMock(return_value=[_FakeInstance(live_id)])
        ):
            released = asyncio.run(server._reconcile_profile_locks())

        assert released == ["xcom"]
        assert _pm.is_profile_locked("default"), "live profile keeps its lock"
        assert not _pm.is_profile_locked("xcom"), "orphaned profile is released"

    def test_reconcile_swallows_list_instances_errors(self, isolated_profiles):
        """If listing instances raises, reconcile must return [] not crash."""
        server._instance_profiles["any-id"] = "default"
        _pm.create_profile("default")

        with patch.object(
            server.browser_manager, "list_instances",
            AsyncMock(side_effect=RuntimeError("connection died"))
        ):
            released = asyncio.run(server._reconcile_profile_locks())

        assert released == []


class TestCleanupStaleChromeSingletons:
    """`_cleanup_stale_chrome_singletons` removes Chrome lock files that
    would otherwise block a fresh Chrome spawn into the same user-data-dir."""

    def test_removes_singleton_lock_symlink(self, tmp_path):
        """SingletonLock is a symlink; lexists + unlink must handle it
        even when the link target doesn't exist."""
        profile_dir = tmp_path / "profile"
        profile_dir.mkdir()
        # SingletonLock is typically a symlink to `hostname-pid`; the
        # target normally doesn't exist on disk after a crash.
        lock_path = profile_dir / "SingletonLock"
        os.symlink("nonexistent-target-12345", str(lock_path))
        assert os.path.lexists(str(lock_path))

        server._cleanup_stale_chrome_singletons(str(profile_dir))

        assert not os.path.lexists(str(lock_path)), (
            "stale SingletonLock symlink must be removed so the next Chrome "
            "spawn into this profile dir succeeds"
        )

    def test_removes_all_known_singleton_files(self, tmp_path):
        profile_dir = tmp_path / "profile"
        profile_dir.mkdir()
        for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
            (profile_dir / name).write_text("stale")

        server._cleanup_stale_chrome_singletons(str(profile_dir))

        for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
            assert not (profile_dir / name).exists(), (
                f"{name} must be removed"
            )

    def test_noop_when_profile_dir_missing(self, tmp_path):
        """Must not raise when the dir doesn't exist yet (first spawn)."""
        server._cleanup_stale_chrome_singletons(str(tmp_path / "nope"))
        # No assertion needed — just proving it doesn't raise.

    def test_noop_when_user_data_dir_is_none(self):
        """Opt-out / ephemeral path: user_data_dir=None must be a no-op."""
        server._cleanup_stale_chrome_singletons(None)


class TestResetProfileCrashState:
    """`_reset_profile_crash_state` clears the Crashed exit_type that causes
    Chrome to show "Something went wrong when opening your profile"."""

    def _make_prefs(self, profile_dir, exit_type="Crashed", extra=None):
        """Write a minimal Chrome Preferences file into profile_dir/Default/."""
        default_dir = profile_dir / "Default"
        default_dir.mkdir(parents=True, exist_ok=True)
        prefs = {"profile": {"exit_type": exit_type}}
        if extra:
            prefs["profile"].update(extra)
        (default_dir / "Preferences").write_text(
            json.dumps(prefs), encoding="utf-8"
        )
        return default_dir / "Preferences"

    def test_resets_crashed_exit_type(self, tmp_path):
        """A Crashed exit_type must be reset to Normal."""
        profile_dir = tmp_path / "profile"
        prefs_path = self._make_prefs(profile_dir, exit_type="Crashed")

        server._reset_profile_crash_state(str(profile_dir))

        with open(prefs_path) as f:
            prefs = json.load(f)
        assert prefs["profile"]["exit_type"] == "Normal", (
            "exit_type must be 'Normal' after reset"
        )

    def test_noop_when_already_normal(self, tmp_path):
        """Must not modify the file when exit_type is already Normal."""
        profile_dir = tmp_path / "profile"
        prefs_path = self._make_prefs(profile_dir, exit_type="Normal")
        mtime_before = prefs_path.stat().st_mtime

        server._reset_profile_crash_state(str(profile_dir))

        assert prefs_path.stat().st_mtime == mtime_before, (
            "Preferences must not be rewritten when exit_type is already Normal"
        )

    def test_removes_exited_cleanly_false(self, tmp_path):
        """exited_cleanly key must be removed (older Chrome compat field)."""
        profile_dir = tmp_path / "profile"
        self._make_prefs(
            profile_dir, exit_type="Crashed",
            extra={"exited_cleanly": False}
        )

        server._reset_profile_crash_state(str(profile_dir))

        prefs_path = profile_dir / "Default" / "Preferences"
        with open(prefs_path) as f:
            prefs = json.load(f)
        assert "exited_cleanly" not in prefs.get("profile", {}), (
            "exited_cleanly must be removed after reset"
        )

    def test_noop_when_no_preferences_file(self, tmp_path):
        """Must not raise when Default/Preferences doesn't exist (first spawn)."""
        profile_dir = tmp_path / "empty_profile"
        profile_dir.mkdir()
        server._reset_profile_crash_state(str(profile_dir))  # Must not raise.

    def test_noop_when_user_data_dir_is_none(self):
        """Ephemeral path: user_data_dir=None must be a no-op."""
        server._reset_profile_crash_state(None)  # Must not raise.

    def test_atomic_write_cleans_up_tmp_on_success(self, tmp_path):
        """The .openhelm_tmp staging file must not be left behind."""
        profile_dir = tmp_path / "profile"
        self._make_prefs(profile_dir, exit_type="Crashed")

        server._reset_profile_crash_state(str(profile_dir))

        tmp_file = profile_dir / "Default" / "Preferences.openhelm_tmp"
        assert not tmp_file.exists(), (
            "Temp file must be cleaned up after successful atomic write"
        )


class TestLockPidReuseDetection:
    """`is_profile_locked` must treat PID reuse as a stale lock.

    Without this, a sibling MCP subprocess could die, its PID could be
    reused by an unrelated Python/Node process, and the next spawn would
    see a live PID in the lock file and refuse to reap it — leading to
    "Profile 'default' is already in use" errors with no one actually
    using it.
    """

    def test_reused_pid_with_mismatched_start_time_is_stale(
        self, isolated_profiles
    ):
        import profile_manager as pm

        pm.create_profile("default")
        pm.acquire_lock("default")

        lock_file = os.path.join(
            str(isolated_profiles), "default", ".openhelm.lock"
        )
        with open(lock_file, "r") as f:
            data = __import__("json").load(f)

        assert data.get("pid") == os.getpid(), (
            "acquire_lock must record the caller's PID"
        )
        assert "pid_start_time" in data, (
            "acquire_lock must record the process start time for "
            "PID-reuse detection"
        )

        # Simulate PID reuse: rewrite the file with our own (live) PID but
        # a wildly-different recorded start time. The liveness check will
        # pass (this process is running), but the start-time check must
        # detect the mismatch and declare the lock stale.
        data["pid_start_time"] = 1.0  # far in the past
        with open(lock_file, "w") as f:
            __import__("json").dump(data, f)

        assert not pm.is_profile_locked("default"), (
            "PID-reuse detection must treat a mismatched start time as "
            "a stale lock so the next acquire_lock can proceed"
        )


class TestWaitForUnlock:
    """`wait_for_unlock` turns a short overlap into a transparent wait."""

    def test_returns_true_immediately_when_not_locked(self, isolated_profiles):
        import profile_manager as pm

        pm.create_profile("default")
        assert pm.wait_for_unlock("default", timeout_seconds=1.0) is True

    def test_returns_false_when_still_locked(self, isolated_profiles):
        import profile_manager as pm

        pm.create_profile("default")
        pm.acquire_lock("default")
        # Short timeout — lock held by our own PID, so it stays locked.
        assert pm.wait_for_unlock(
            "default", timeout_seconds=0.3, poll_interval_seconds=0.1
        ) is False

    def test_wait_respects_zero_timeout(self, isolated_profiles):
        import profile_manager as pm

        pm.create_profile("default")
        # timeout_seconds=0 → single probe, no sleep
        assert pm.wait_for_unlock("default", timeout_seconds=0) is True


class TestReleaseAllHeldBy:
    """`release_all_held_by` clears every lock whose PID matches, idempotently."""

    def test_releases_only_matching_pid(self, isolated_profiles):
        import profile_manager as pm
        import json as _json

        pm.create_profile("default")
        pm.create_profile("xcom")
        pm.acquire_lock("default")
        pm.acquire_lock("xcom")

        # Write a lock for a different profile with a foreign PID
        pm.create_profile("other")
        other_lock = os.path.join(
            str(isolated_profiles), "other", ".openhelm.lock"
        )
        with open(other_lock, "w") as f:
            _json.dump({"pid": 999999, "locked_at": "2020-01-01"}, f)

        released = pm.release_all_held_by(os.getpid())

        assert sorted(released) == ["default", "xcom"]
        # Our own locks should be cleared
        assert not os.path.exists(
            os.path.join(str(isolated_profiles), "default", ".openhelm.lock")
        )
        assert not os.path.exists(
            os.path.join(str(isolated_profiles), "xcom", ".openhelm.lock")
        )
        # Foreign lock must be untouched
        assert os.path.exists(other_lock)

    def test_noop_when_no_profiles_exist(self, tmp_path, monkeypatch):
        import profile_manager as pm

        missing = tmp_path / "not-there"
        monkeypatch.setattr(pm, "PROFILES_ROOT", str(missing))
        # Must not raise when the root doesn't exist yet.
        assert pm.release_all_held_by(os.getpid()) == []


class TestReconcileDiskSweep:
    """`_reconcile_profile_locks` must also sweep stale locks on disk
    that were never tracked in `_instance_profiles`.
    """

    def test_disk_sweep_clears_lock_from_dead_sibling(
        self, isolated_profiles
    ):
        import profile_manager as pm
        import json as _json

        # A sibling MCP subprocess died without clean shutdown and left
        # behind a lock file with a dead PID — and it was never in *our*
        # `_instance_profiles`, so the in-memory reconcile path can't
        # see it. Only the disk sweep can clean it up.
        pm.create_profile("default")
        dead_lock = os.path.join(
            str(isolated_profiles), "default", ".openhelm.lock"
        )
        with open(dead_lock, "w") as f:
            _json.dump({"pid": 999999, "locked_at": "2020-01-01"}, f)
        assert os.path.exists(dead_lock)

        with patch.object(
            server.browser_manager, "list_instances",
            AsyncMock(return_value=[])
        ):
            released = asyncio.run(server._reconcile_profile_locks())

        assert "default" in released, (
            "disk sweep must pick up locks whose PID is dead even when "
            "the reconcile walk through _instance_profiles finds nothing"
        )
        assert not os.path.exists(dead_lock)
