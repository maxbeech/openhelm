"""Tests for Issue 19 (hallucinated browser instance IDs) and Issue 22
(navigate() returning success=false with no error).

Both are source-level assertions plus a lightweight async unit test — no
real Chrome is spawned so these run in any CI environment.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import server  # noqa: E402


def _underlying(func):
    return getattr(func, "__wrapped__", None) or getattr(func, "fn", None) or func


class TestInstanceNotFoundEnriched:
    """Issue 19: after context compaction, agents occasionally pass a
    human-readable name (e.g. "hn-session") as instance_id. The raised
    exception must list the real live UUIDs so the agent can recover in
    one call instead of needing a follow-up list_instances."""

    def test_helper_exists_and_is_async(self):
        assert hasattr(server, "_format_instance_not_found"), (
            "server module must expose _format_instance_not_found helper"
        )
        assert inspect.iscoroutinefunction(server._format_instance_not_found), (
            "_format_instance_not_found must be async (it calls "
            "browser_manager.list_instances which is async)"
        )

    def test_instance_not_found_raises_via_helper(self):
        """All tool-site 'Instance not found' raises must go through the
        helper, not build the old bare string inline."""
        src = inspect.getsource(_underlying(server.navigate))
        assert "_format_instance_not_found(instance_id)" in src, (
            "navigate() must raise via _format_instance_not_found so the "
            "error message lists available instance_ids"
        )
        # And the bare legacy string must be gone from this function.
        assert 'raise Exception(f"Instance not found: {instance_id}")' not in src

    def test_helper_includes_available_ids_when_present(self):
        """Given a running browser_manager with one fake instance, the
        helper's message must include that instance's UUID so the agent
        can retry with a real id."""

        fake_instance = SimpleNamespace(instance_id="uuid-aaa-111")

        class _FakeManager:
            async def list_instances(self):
                return [fake_instance]

        original = server.browser_manager
        server.browser_manager = _FakeManager()  # type: ignore[assignment]
        try:
            msg = asyncio.run(
                server._format_instance_not_found("hn-session")
            )
        finally:
            server.browser_manager = original

        assert "hn-session" in msg, "echoes the bad id the agent passed"
        assert "uuid-aaa-111" in msg, "must list the real UUID for recovery"
        assert "UUID" in msg or "spawn_browser" in msg, (
            "message must explain that ids are UUIDs assigned by spawn_browser"
        )

    def test_helper_handles_empty_instance_list(self):
        class _EmptyManager:
            async def list_instances(self):
                return []

        original = server.browser_manager
        server.browser_manager = _EmptyManager()  # type: ignore[assignment]
        try:
            msg = asyncio.run(
                server._format_instance_not_found("browser_1")
            )
        finally:
            server.browser_manager = original

        assert "spawn_browser" in msg, (
            "empty-list message must tell the agent to call spawn_browser"
        )


class TestNavigateAttachesErrorOnFailure:
    """Issue 22: navigate() used to return {"success": false} with an empty
    title and no error field, which pushed agents into blind retries
    against unreachable hosts. The response must now always carry an
    explicit `error` string when success is false."""

    def test_navigate_source_captures_error_and_attaches_to_response(self):
        src = inspect.getsource(_underlying(server.navigate))
        # The function must track a navigate_error variable.
        assert "navigate_error" in src, (
            "navigate() must track navigate_error so CDP failures are "
            "surfaced to the caller"
        )
        # On TimeoutError it must record a descriptive message (not just
        # log and swallow it like before).
        assert "Page.navigate CDP call timed out" in src
        # And when navigation_started is false, the response must include
        # an error field — this is the bit Issue 22 was missing.
        assert 'response["error"]' in src, (
            "navigate() must populate response['error'] when success is "
            "false so agents get a diagnostic instead of a silent failure"
        )
