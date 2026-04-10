"""Tests for spawn_browser kwarg tolerance and default-profile fallback.

These cover a class of failures observed in production where:

1. The LLM hallucinated an `instance_id="search_session"` kwarg on spawn_browser.
   Pydantic rejected it and the entire tool call failed. The fix accepts and
   ignores common alias kwargs (`instance_id`, `name`, `session_name`, `id`).

2. The LLM omitted `profile=` on spawn_browser, which historically created a
   brand-new ephemeral Chrome profile every call. Reddit / Cloudflare / HN
   sessions were lost between spawns. The fix defaults to `profile="default"`
   when neither `profile` nor `user_data_dir` is supplied.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import server  # noqa: E402


# FastMCP wraps tool functions with a decorator. `spawn_browser` in the module
# namespace may be the wrapped tool or the underlying function depending on the
# FastMCP version. We want the underlying coroutine for signature inspection.
def _underlying(func):
    return getattr(func, "__wrapped__", None) or getattr(func, "fn", None) or func


class TestSpawnBrowserAcceptsIgnoredKwargs:
    """spawn_browser must absorb common hallucinated kwargs without raising."""

    def test_signature_accepts_instance_id_alias(self):
        sig = inspect.signature(_underlying(server.spawn_browser))
        assert "instance_id" in sig.parameters, (
            "spawn_browser must declare `instance_id` as an ignored alias so "
            "Pydantic does not reject LLM calls that supply it."
        )
        assert sig.parameters["instance_id"].default is None

    def test_signature_accepts_other_aliases(self):
        sig = inspect.signature(_underlying(server.spawn_browser))
        for alias in ("name", "session_name", "id"):
            assert alias in sig.parameters, (
                f"spawn_browser must declare `{alias}` as an ignored alias."
            )
            assert sig.parameters[alias].default is None

    def test_docstring_explains_instance_id_is_output_only(self):
        doc = _underlying(server.spawn_browser).__doc__ or ""
        assert "instance_id" in doc
        # The docstring should make clear that instance_id is returned, not an input.
        assert (
            "auto-generated" in doc.lower()
            or "do not pass" in doc.lower()
            or "assigned by this tool" in doc.lower()
        ), "Docstring should clarify that instance_id is assigned by the tool, not passed in."


class TestSpawnBrowserDefaultProfileFallback:
    """If no profile/user_data_dir is given, spawn_browser must fall back to
    the shared `default` profile so cookies persist across spawns."""

    def test_source_sets_default_profile_when_none_supplied(self):
        """Source-level check: the fallback logic exists and targets `default`.

        We avoid actually spawning Chrome in a unit test — this inspects the
        function source for the sentinel branches.
        """
        src = inspect.getsource(_underlying(server.spawn_browser))
        # The guard branch must exist.
        assert "not profile" in src and "user_data_dir is None" in src, (
            "spawn_browser must guard on (not profile and user_data_dir is None)"
        )
        # Falls back to the literal "default" profile.
        assert '"default"' in src, (
            "spawn_browser must assign profile = \"default\" when neither "
            "profile nor user_data_dir is supplied."
        )

    def test_source_honours_empty_user_data_dir_as_opt_out(self):
        """Explicit opt-out: passing user_data_dir="" means 'I want ephemeral'."""
        src = inspect.getsource(_underlying(server.spawn_browser))
        assert 'user_data_dir == ""' in src, (
            "spawn_browser must treat empty-string user_data_dir as an opt-out "
            "from the default-profile fallback (true ephemeral mode)."
        )
