"""Accessibility-based page understanding and element search utilities.

Uses Chrome DevTools Protocol Accessibility and DOM domains to provide
token-efficient page comprehension — typically 5-15K tokens vs 188K+ for
raw HTML or 25K per screenshot.
"""

import asyncio
from math import ceil
from typing import Any, Dict, List, Optional

import nodriver as uc
from nodriver import Tab

from debug_logger import debug_logger

# Roles that add noise without semantic value — filtered by default
_SKIP_ROLES = frozenset({
    "generic", "none", "presentation", "InlineTextBox",
    "LineBreak", "ignored",
})

# Maximum chars of text to include per node in the digest
_MAX_NODE_TEXT = 200


class AccessibilityHandler:
    """Provides token-efficient page understanding via CDP Accessibility tree."""

    # ------------------------------------------------------------------
    # get_page_digest
    # ------------------------------------------------------------------
    @staticmethod
    async def get_page_digest(
        tab: Tab,
        max_tokens: int = 15000,
        trigger_lazy_load: bool = False,
        include_links: bool = True,
    ) -> Dict[str, Any]:
        """Return a compact, semantic digest of the current page.

        Uses the CDP Accessibility tree — invisible to websites, no JS
        executed on the page, and dramatically smaller than raw HTML.

        Args:
            tab: The browser tab.
            max_tokens: Approximate token budget for the digest text.
            trigger_lazy_load: Scroll through the page first to force
                IntersectionObserver-based lazy content into the DOM.
            include_links: Include link href targets in the output.

        Returns:
            dict with keys: digest, url, title, node_count,
            estimated_tokens, truncated, scroll_position.
        """
        try:
            # Gather page metadata
            url = await tab.evaluate("window.location.href")
            title = await tab.evaluate("document.title")
            scroll_info = await tab.evaluate("""(() => {
                return {
                    scrollTop: Math.round(window.scrollY),
                    scrollHeight: document.body.scrollHeight,
                    viewportHeight: window.innerHeight
                };
            })()""")

            # Optionally trigger lazy-load by scrolling through the page
            if trigger_lazy_load:
                await _trigger_lazy_load(tab)
                # Re-measure after lazy load
                scroll_info = await tab.evaluate("""(() => {
                    return {
                        scrollTop: Math.round(window.scrollY),
                        scrollHeight: document.body.scrollHeight,
                        viewportHeight: window.innerHeight
                    };
                })()""")

            # Enable accessibility domain (required for consistent node IDs)
            await tab.send(uc.cdp.accessibility.enable())

            try:
                nodes = await tab.send(uc.cdp.accessibility.get_full_ax_tree())
            finally:
                # Always disable to avoid ongoing performance cost
                try:
                    await tab.send(uc.cdp.accessibility.disable())
                except Exception:
                    pass

            # Build parent→children index and filter
            filtered = _filter_nodes(nodes, include_links)

            # Format into annotated outline
            digest = _format_digest(
                filtered, title, url, scroll_info, include_links, max_tokens
            )

            estimated_tokens = len(digest) // 4
            truncated = estimated_tokens > max_tokens

            return {
                "digest": digest,
                "url": url,
                "title": title,
                "node_count": len(filtered),
                "estimated_tokens": estimated_tokens,
                "truncated": truncated,
                "scroll_position": scroll_info,
            }

        except Exception as e:
            debug_logger.log_error("AccessibilityHandler", "get_page_digest", e)
            raise Exception(f"Failed to get page digest: {e}")

    # ------------------------------------------------------------------
    # find_on_page  (DOM.performSearch)
    # ------------------------------------------------------------------
    @staticmethod
    async def find_on_page(
        tab: Tab,
        query: str,
        scroll_to: bool = True,
        match_index: int = 0,
    ) -> Dict[str, Any]:
        """Search the DOM for text/selector and optionally scroll to it.

        Uses CDP DOM.performSearch which matches text content, attribute
        values, CSS selectors, and XPath — all invisible to the website.

        Args:
            tab: The browser tab.
            query: Plain text, CSS selector, or XPath to search for.
            scroll_to: Scroll the found element into view.
            match_index: Which match to target (0-based).

        Returns:
            dict with found, total_matches, match_index, position,
            scrolled_to, selector_hint, context_text.
        """
        try:
            search_id, count = await tab.send(
                uc.cdp.dom.perform_search(query)
            )

            if count == 0:
                try:
                    await tab.send(uc.cdp.dom.discard_search_results(search_id))
                except Exception:
                    pass
                return {
                    "found": False,
                    "total_matches": 0,
                    "query": query,
                }

            # Clamp match_index
            idx = min(match_index, count - 1)

            node_ids = await tab.send(
                uc.cdp.dom.get_search_results(search_id, idx, idx + 1)
            )

            result: Dict[str, Any] = {
                "found": True,
                "total_matches": count,
                "match_index": idx,
                "scrolled_to": False,
                "selector_hint": None,
                "context_text": None,
                "position": None,
            }

            if node_ids:
                node_id = node_ids[0]

                # Scroll into view
                if scroll_to:
                    try:
                        await tab.send(
                            uc.cdp.dom.scroll_into_view_if_needed(
                                node_id=node_id
                            )
                        )
                        result["scrolled_to"] = True
                        await asyncio.sleep(0.3)
                    except Exception:
                        pass

                # Get position via box model
                try:
                    box = await tab.send(
                        uc.cdp.dom.get_box_model(node_id=node_id)
                    )
                    if box and box.content:
                        quad = box.content
                        # quad is [x1,y1, x2,y2, x3,y3, x4,y4]
                        x = min(quad[0], quad[6])
                        y = min(quad[1], quad[3])
                        w = max(quad[2], quad[4]) - x
                        h = max(quad[5], quad[7]) - y
                        result["position"] = {
                            "x": round(x), "y": round(y),
                            "width": round(w), "height": round(h),
                        }
                except Exception:
                    pass

                # Get selector hint and context text
                try:
                    remote_obj = await tab.send(
                        uc.cdp.dom.resolve_node(node_id=node_id)
                    )
                    if remote_obj and remote_obj.object_id:
                        # Compute selector + context
                        hint_result = await tab.send(
                            uc.cdp.runtime.call_function_on(
                                function_declaration="""function() {
                                    var el = this;
                                    // Selector hint
                                    var sel = '';
                                    if (el.id) {
                                        sel = '#' + el.id;
                                    } else if (el.getAttribute && el.getAttribute('data-testid')) {
                                        sel = '[data-testid="' + el.getAttribute('data-testid') + '"]';
                                    } else if (el.getAttribute && el.getAttribute('aria-label')) {
                                        sel = '[aria-label="' + el.getAttribute('aria-label') + '"]';
                                    } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
                                        var cls = el.className.trim().split(/\\s+/)[0];
                                        sel = el.tagName.toLowerCase() + '.' + cls;
                                    } else {
                                        sel = el.tagName ? el.tagName.toLowerCase() : '';
                                    }
                                    // Context text
                                    var text = (el.textContent || '').trim().substring(0, 200);
                                    return JSON.stringify({selector: sel, text: text});
                                }""",
                                object_id=remote_obj.object_id,
                                return_by_value=True,
                            )
                        )
                        if hint_result and hint_result.value:
                            import json
                            parsed = json.loads(hint_result.value)
                            result["selector_hint"] = parsed.get("selector")
                            result["context_text"] = parsed.get("text")
                except Exception:
                    pass

            # Clean up
            try:
                await tab.send(uc.cdp.dom.discard_search_results(search_id))
            except Exception:
                pass

            return result

        except Exception as e:
            debug_logger.log_error("AccessibilityHandler", "find_on_page", e)
            raise Exception(f"Failed to find on page: {e}")

    # ------------------------------------------------------------------
    # find_by_role  (Accessibility.queryAXTree)
    # ------------------------------------------------------------------
    @staticmethod
    async def find_by_role(
        tab: Tab,
        role: Optional[str] = None,
        name: Optional[str] = None,
        scroll_to: bool = True,
        match_index: int = 0,
    ) -> Dict[str, Any]:
        """Find elements by accessible role and/or name.

        Uses CDP Accessibility.queryAXTree — invisible to websites.

        Args:
            tab: The browser tab.
            role: ARIA role to search for (e.g. "button", "link", "textbox").
            name: Accessible name to match (e.g. "Submit", "Reply").
            scroll_to: Scroll the first match into view.
            match_index: Which match to scroll to (0-based).

        Returns:
            dict with found, total_matches, matches list, scrolled_to.
        """
        if not role and not name:
            raise Exception("At least one of 'role' or 'name' must be provided")

        try:
            await tab.send(uc.cdp.accessibility.enable())

            try:
                nodes = await tab.send(
                    uc.cdp.accessibility.query_ax_tree(
                        accessible_name=name,
                        role=role,
                    )
                )
            finally:
                try:
                    await tab.send(uc.cdp.accessibility.disable())
                except Exception:
                    pass

            if not nodes:
                return {
                    "found": False,
                    "total_matches": 0,
                    "role": role,
                    "name": name,
                }

            # Build match list (compact)
            matches = []
            for node in nodes[:20]:  # Cap at 20 results
                match: Dict[str, Any] = {
                    "role": node.role.value if node.role else None,
                    "name": node.name.value if node.name else None,
                }
                if node.backend_dom_node_id:
                    match["backend_node_id"] = int(node.backend_dom_node_id)
                if node.properties:
                    for prop in node.properties:
                        if prop.name.value == "url":
                            match["url"] = prop.value.value
                matches.append(match)

            result: Dict[str, Any] = {
                "found": True,
                "total_matches": len(nodes),
                "matches": matches,
                "scrolled_to": False,
            }

            # Scroll to the requested match
            idx = min(match_index, len(nodes) - 1)
            target = nodes[idx]
            if scroll_to and target.backend_dom_node_id:
                try:
                    await tab.send(
                        uc.cdp.dom.scroll_into_view_if_needed(
                            backend_node_id=target.backend_dom_node_id
                        )
                    )
                    result["scrolled_to"] = True
                    await asyncio.sleep(0.3)
                except Exception:
                    pass

            return result

        except Exception as e:
            debug_logger.log_error("AccessibilityHandler", "find_by_role", e)
            raise Exception(f"Failed to find by role: {e}")


# ======================================================================
# Private helpers
# ======================================================================

async def _trigger_lazy_load(tab: Tab) -> None:
    """Scroll through the page to force lazy-loaded content into the DOM."""
    try:
        metrics = await tab.evaluate("""(() => {
            return {
                height: document.body.scrollHeight,
                viewport: window.innerHeight
            };
        })()""")

        total = metrics.get("height", 0)
        viewport = metrics.get("viewport", 720)

        if total <= viewport:
            return

        # Scroll down in viewport-sized steps
        steps = min(ceil(total / viewport), 20)  # Cap at 20 scrolls
        for i in range(1, steps + 1):
            target = min(i * viewport, total)
            await tab.evaluate(
                f"window.scrollTo({{top: {target}, behavior: 'instant'}})"
            )
            await asyncio.sleep(0.4)

        # Scroll back to top
        await tab.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
        await asyncio.sleep(0.3)

    except Exception as e:
        debug_logger.log_warning(
            "AccessibilityHandler", "_trigger_lazy_load",
            f"Lazy load trigger failed (non-fatal): {e}"
        )


def _filter_nodes(
    nodes: List[Any],
    include_links: bool,
) -> List[Dict[str, Any]]:
    """Filter and flatten the AX tree into a list of relevant nodes."""
    # Build node lookup and parent→children map
    by_id: Dict[str, Any] = {}
    children_map: Dict[str, List[str]] = {}

    for node in nodes:
        nid = str(node.node_id)
        by_id[nid] = node
        if node.child_ids:
            children_map[nid] = [str(c) for c in node.child_ids]

    # Walk tree depth-first, collecting filtered nodes
    result: List[Dict[str, Any]] = []

    def _walk(node_id: str, depth: int) -> None:
        node = by_id.get(node_id)
        if not node:
            return

        role = node.role.value if node.role else ""
        name = node.name.value if node.name else ""
        value = node.value.value if node.value else ""

        # Skip ignored nodes but still walk children
        if node.ignored:
            for child_id in children_map.get(node_id, []):
                _walk(child_id, depth)
            return

        # Skip noise roles
        if role in _SKIP_ROLES:
            for child_id in children_map.get(node_id, []):
                _walk(child_id, depth)
            return

        # Skip empty static text (text is carried by parent name)
        if role == "StaticText" and not name.strip():
            return

        # Build entry
        entry: Dict[str, Any] = {
            "role": role,
            "depth": depth,
        }

        if name:
            entry["name"] = name[:_MAX_NODE_TEXT]
        if value:
            entry["value"] = value[:_MAX_NODE_TEXT]

        # Extract useful properties
        if node.properties:
            props: Dict[str, Any] = {}
            for prop in node.properties:
                pname = prop.name.value if hasattr(prop.name, 'value') else str(prop.name)
                pval = prop.value.value if hasattr(prop.value, 'value') else str(prop.value)
                if pname == "url" and include_links:
                    props["url"] = pval
                elif pname == "level":
                    props["level"] = pval
                elif pname in ("checked", "expanded", "disabled", "selected",
                               "required", "editable"):
                    props[pname] = pval
            if props:
                entry["props"] = props

        result.append(entry)

        # Recurse children
        for child_id in children_map.get(node_id, []):
            _walk(child_id, depth + 1)

    # Find root(s) — nodes with no parent_id
    for node in nodes:
        if node.parent_id is None:
            _walk(str(node.node_id), 0)
            break  # Usually only one root

    return result


def _format_digest(
    nodes: List[Dict[str, Any]],
    title: str,
    url: str,
    scroll_info: Dict[str, Any],
    include_links: bool,
    max_tokens: int,
) -> str:
    """Format filtered nodes into a compact annotated outline."""
    scroll_top = scroll_info.get("scrollTop", 0)
    scroll_height = scroll_info.get("scrollHeight", 1)
    viewport = scroll_info.get("viewportHeight", 720)
    pct = round(scroll_top / max(scroll_height, 1) * 100, 1)

    lines: List[str] = [
        f"# Page: {title}",
        f"URL: {url}",
        f"Scroll: {pct}% ({scroll_top}/{scroll_height}px, viewport {viewport}px)",
        "",
    ]

    # Track token budget (rough: 4 chars per token)
    char_budget = max_tokens * 4
    chars_used = sum(len(l) + 1 for l in lines)
    truncated_count = 0

    for entry in nodes:
        if chars_used >= char_budget:
            truncated_count += 1
            continue

        depth = entry.get("depth", 0)
        indent = "  " * min(depth, 8)  # Cap indentation
        role = entry.get("role", "")
        name = entry.get("name", "")
        value = entry.get("value", "")
        props = entry.get("props", {})

        # Format the role tag
        level = props.get("level")
        if level and role == "heading":
            tag = f"heading-{level}"
        else:
            tag = role

        # Build the line
        parts: List[str] = []

        if name:
            parts.append(f'"{name}"')
        if value and value != name:
            parts.append(f'value="{value}"')

        # Link URL
        link_url = props.get("url")
        if link_url and include_links:
            # Shorten long URLs
            if len(link_url) > 80:
                link_url = link_url[:77] + "..."
            parts.append(f"-> {link_url}")

        # State properties
        for key in ("checked", "expanded", "disabled", "selected",
                     "required", "editable"):
            if key in props:
                val = props[key]
                if val is True or val == "true":
                    parts.append(key)
                elif val is False or val == "false":
                    parts.append(f"not-{key}")

        content = " ".join(parts)
        line = f"{indent}[{tag}] {content}".rstrip()

        # Skip empty lines (role-only with no content at leaf level)
        if not content and not entry.get("props"):
            continue

        chars_used += len(line) + 1
        lines.append(line)

    if truncated_count > 0:
        lines.append(f"\n[... {truncated_count} more nodes truncated]")

    return "\n".join(lines)
