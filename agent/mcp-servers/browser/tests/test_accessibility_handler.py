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
        from dom_handler import DOMHandler

        async def _run():
            tab = AsyncMock()
            tab.evaluate = AsyncMock(side_effect=[
                {"scroll_top": 0, "scroll_height": 5000, "viewport_height": 720},
                None,  # scroll execution
                {"scroll_top": 500, "scroll_height": 5000, "viewport_height": 720},
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
        from dom_handler import DOMHandler

        async def _run():
            tab = AsyncMock()
            tab.evaluate = AsyncMock(side_effect=[
                {"scroll_top": 0, "scroll_height": 5000, "viewport_height": 720},
                None,
                {"scroll_top": 2500, "scroll_height": 5000, "viewport_height": 720},
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
