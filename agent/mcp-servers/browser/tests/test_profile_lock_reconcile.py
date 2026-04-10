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

The fixes live in `server.py::_reconcile_profile_locks` and
`server.py::_cleanup_stale_chrome_singletons`.
"""

from __future__ import annotations

import asyncio
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
