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

# Hard timeout for the CDP getFullAXTree call (seconds).
# Complex SPAs like Reddit can have enormous trees that hang the call.
_AX_TREE_TIMEOUT_S = 15

# Individual CDP command timeout (seconds). Applied to every tab.send()
# call so no single command can hang. Complex SPAs like Reddit have been
# observed to hang on Accessibility.enable() and DOM.getDocument() — so
# every CDP call MUST be wrapped in _cdp() below.
_CDP_CALL_TIMEOUT_S = 8

# Total budget for the whole function. Must be < the MCP tool timeout
# (120s) so we fail fast with a useful error instead of the generic
# "Tool timed out after 120s".
_FN_TOTAL_TIMEOUT_S = 25

# Maximum AX nodes to process — prevents OOM on huge pages
_MAX_AX_NODES = 5000

# Default tree depth limit — keeps response size manageable
_DEFAULT_DEPTH = 8


async def _cdp(tab: Tab, command: Any, timeout_s: float = _CDP_CALL_TIMEOUT_S) -> Any:
    """Send a CDP command with an individual timeout.

    Every CDP call on complex SPAs (Reddit, Discord, X) MUST go through
    this helper. Raw `await tab.send(...)` has been observed to hang
    indefinitely on Accessibility.enable() and DOM.getDocument() under
    certain conditions, which would otherwise trigger the outer 120s
    MCP tool timeout with no diagnostic info.
    """
    return await asyncio.wait_for(tab.send(command), timeout=timeout_s)


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
        mode: str = "fast",
    ) -> Dict[str, Any]:
        """Return a compact, semantic digest of the current page.

        By default uses a fast, narrow JavaScript extraction that works
        reliably on heavy SPAs like Reddit, X, and Discord (target: <5s
        total). Pass `mode="semantic"` to use the richer CDP Accessibility
        tree — slower and can hang on some pages.

        Args:
            tab: The browser tab.
            max_tokens: Approximate token budget for the digest text.
            trigger_lazy_load: Scroll through the page first to force
                IntersectionObserver-based lazy content into the DOM.
            include_links: Include link href targets in the output.
            mode: "fast" (default, JS extraction) or "semantic" (CDP AX tree).

        Returns:
            dict with keys: digest, url, title, node_count,
            estimated_tokens, truncated, scroll_position, mode.
        """
        try:
            return await asyncio.wait_for(
                AccessibilityHandler._get_page_digest_impl(
                    tab, max_tokens, trigger_lazy_load, include_links, mode
                ),
                timeout=_FN_TOTAL_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            debug_logger.log_warning(
                "AccessibilityHandler", "get_page_digest",
                f"Total timeout ({_FN_TOTAL_TIMEOUT_S}s) — page hung."
            )
            raise Exception(
                f"get_page_digest timed out after {_FN_TOTAL_TIMEOUT_S}s. "
                "The page DOM is stuck. Try take_screenshot(max_width=800, "
                "grayscale=True) instead, or reload_page and try again."
            )

    @staticmethod
    async def _get_page_digest_impl(
        tab: Tab,
        max_tokens: int,
        trigger_lazy_load: bool,
        include_links: bool,
        mode: str,
    ) -> Dict[str, Any]:
        """Implementation body — wrapped with a total timeout by the
        public get_page_digest above."""
        try:
            import json as _json
            # Gather page metadata.
            # Use JSON.stringify to get plain Python dicts (nodriver's
            # evaluate returns opaque objects for JS objects).
            url = await asyncio.wait_for(
                tab.evaluate("window.location.href"), timeout=3
            )
            title = await asyncio.wait_for(
                tab.evaluate("document.title"), timeout=3
            )
            _scroll_js = """JSON.stringify({
                scrollTop: Math.round(window.scrollY),
                scrollHeight: document.body.scrollHeight,
                viewportHeight: window.innerHeight
            })"""
            scroll_info = _json.loads(
                await asyncio.wait_for(
                    tab.evaluate(f"(() => {_scroll_js})()"), timeout=3
                )
            )

            # Optionally trigger lazy-load by scrolling through the page
            if trigger_lazy_load:
                await _trigger_lazy_load(tab)
                scroll_info = _json.loads(
                    await asyncio.wait_for(
                        tab.evaluate(f"(() => {_scroll_js})()"), timeout=3
                    )
                )

            # FAST PATH: narrow JS extraction. Default mode — works on
            # heavy SPAs where the AX tree is too slow.
            if mode != "semantic":
                return await _js_fast_digest(
                    tab, title, url, scroll_info, max_tokens, include_links
                )

            # SEMANTIC PATH: CDP Accessibility tree. Opt-in only.
            try:
                await _cdp(tab, uc.cdp.accessibility.enable())
            except asyncio.TimeoutError:
                debug_logger.log_warning(
                    "AccessibilityHandler", "get_page_digest",
                    "Accessibility.enable() hung, using JS fast path"
                )
                return await _js_fast_digest(
                    tab, title, url, scroll_info, max_tokens, include_links
                )

            try:
                nodes = await _cdp(
                    tab,
                    uc.cdp.accessibility.get_full_ax_tree(
                        depth=_DEFAULT_DEPTH
                    ),
                    timeout_s=_AX_TREE_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                debug_logger.log_warning(
                    "AccessibilityHandler", "get_page_digest",
                    f"AX tree timed out after {_AX_TREE_TIMEOUT_S}s, "
                    "falling back to JS fast path"
                )
                return await _js_fast_digest(
                    tab, title, url, scroll_info, max_tokens, include_links
                )
            finally:
                try:
                    await _cdp(
                        tab, uc.cdp.accessibility.disable(), timeout_s=3
                    )
                except Exception:
                    pass

            # Cap node count to prevent processing huge trees
            if len(nodes) > _MAX_AX_NODES:
                nodes = nodes[:_MAX_AX_NODES]

            filtered = _filter_nodes(nodes, include_links)
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
                "mode": "semantic",
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
            return await asyncio.wait_for(
                AccessibilityHandler._find_on_page_impl(
                    tab, query, scroll_to, match_index
                ),
                timeout=_FN_TOTAL_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            raise Exception(
                f"find_on_page timed out after {_FN_TOTAL_TIMEOUT_S}s. "
                "The page is unresponsive — try reload_page() first."
            )
        except Exception as e:
            debug_logger.log_error("AccessibilityHandler", "find_on_page", e)
            raise Exception(f"Failed to find on page: {e}")

    @staticmethod
    async def _find_on_page_impl(
        tab: Tab,
        query: str,
        scroll_to: bool,
        match_index: int,
    ) -> Dict[str, Any]:
        """JavaScript-first find-on-page implementation.

        The old implementation used CDP `DOM.performSearch`, which on
        Reddit/X/Discord routinely either raised "DOM agent is not enabled"
        or returned node IDs that couldn't be resolved (`selector_hint: null,
        position: null, scrolled_to: false`). See Run 33c3ef25 for a full
        reproduction.

        This rewrite runs a single `tab.evaluate(...)` that:
          1. Searches for `query` as (a) a CSS selector, (b) an XPath if it
             starts with `//`, or (c) case-insensitive text content across
             common clickable/content tags.
          2. Tags the chosen match with `data-oh-find="1"` so the returned
             `selector_hint` is always usable by `click_element`/`paste_text`.
          3. Scrolls it into view.
          4. Returns position, selector hint, and short context text.

        No CDP DOM domain interaction — works on pages where DOM.enable
        has never been called.
        """
        import json as _json

        js = """
        (function(rawQuery, scrollTo, matchIndex) {
            function visible(el) {
                if (!el) return false;
                var s = window.getComputedStyle(el);
                if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }
            function buildSelector(el) {
                if (!el) return null;
                if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
                var parts = [];
                var cur = el;
                for (var i = 0; i < 5 && cur && cur !== document.body; i++) {
                    var tag = cur.tagName.toLowerCase();
                    var piece = tag;
                    if (cur.getAttribute('name')) piece += '[name="' + cur.getAttribute('name').replace(/"/g, '\\\\"') + '"]';
                    else if (cur.getAttribute('data-testid')) piece += '[data-testid="' + cur.getAttribute('data-testid') + '"]';
                    else if (cur.getAttribute('role')) piece += '[role="' + cur.getAttribute('role') + '"]';
                    else if (cur.classList.length > 0) {
                        var cls = Array.from(cur.classList).slice(0, 2).map(function(c){return '.' + CSS.escape(c);}).join('');
                        piece += cls;
                    }
                    if (cur.parentNode) {
                        var siblings = Array.from(cur.parentNode.children).filter(function(s){return s.tagName === cur.tagName;});
                        if (siblings.length > 1) piece += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
                    }
                    parts.unshift(piece);
                    cur = cur.parentElement;
                    try {
                        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
                    } catch (e) {}
                }
                return parts.join(' > ');
            }
            function clearStale() {
                var stale = document.querySelectorAll('[data-oh-find="1"]');
                for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-oh-find');
            }

            var q = String(rawQuery || '').trim();
            if (!q) return JSON.stringify({found: false, total_matches: 0, reason: 'empty query'});

            var matches = [];

            // Strategy 1: XPath if it starts with //
            if (q.indexOf('//') === 0) {
                try {
                    var iter = document.evaluate(q, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (var xi = 0; xi < iter.snapshotLength; xi++) {
                        var n = iter.snapshotItem(xi);
                        if (n && n.nodeType === 1) matches.push(n);
                    }
                } catch (e) {}
            }

            // Strategy 2: CSS selector
            if (matches.length === 0) {
                try {
                    var nodes = document.querySelectorAll(q);
                    for (var ci = 0; ci < nodes.length; ci++) matches.push(nodes[ci]);
                } catch (e) {}
            }

            // Strategy 3: case-insensitive text search across common
            // interactive/content tags. Prefer visible, shortest-text matches
            // so "Add a comment" beats a paragraph that merely contains the
            // phrase as a substring.
            if (matches.length === 0) {
                var qLower = q.toLowerCase();
                var scanSel = 'button, a, [role="button"], [role="link"], [role="textbox"], [role="menuitem"], [aria-label], [placeholder], h1, h2, h3, h4, h5, h6, label, summary, li, span, p, div';
                var candidates = [];
                try {
                    var allNodes = document.querySelectorAll(scanSel);
                    for (var si = 0; si < allNodes.length && candidates.length < 200; si++) {
                        var el = allNodes[si];
                        var haystack = (
                            (el.innerText || el.textContent || '') + ' ' +
                            (el.getAttribute('aria-label') || '') + ' ' +
                            (el.getAttribute('placeholder') || '') + ' ' +
                            (el.getAttribute('title') || '') + ' ' +
                            (el.getAttribute('value') || '')
                        ).toLowerCase();
                        if (haystack.indexOf(qLower) === -1) continue;
                        var own = ((el.innerText || el.textContent || '').trim());
                        candidates.push({el: el, textLen: own.length, vis: visible(el)});
                    }
                } catch (e) {}
                // Sort: visible first, then shortest text (closest to exact match)
                candidates.sort(function(a, b) {
                    if (a.vis !== b.vis) return a.vis ? -1 : 1;
                    return a.textLen - b.textLen;
                });
                for (var ki = 0; ki < candidates.length; ki++) matches.push(candidates[ki].el);
            }

            if (matches.length === 0) {
                return JSON.stringify({
                    found: false, total_matches: 0, query: q
                });
            }

            var idx = Math.max(0, Math.min(matchIndex, matches.length - 1));
            var best = matches[idx];

            clearStale();
            best.setAttribute('data-oh-find', '1');

            var scrolledTo = false;
            if (scrollTo) {
                try {
                    best.scrollIntoView({block: 'center', inline: 'nearest'});
                    scrolledTo = true;
                } catch (e) {}
            }

            var rect = best.getBoundingClientRect();
            var selectorHint = buildSelector(best);
            if (!selectorHint || document.querySelectorAll(selectorHint).length !== 1) {
                selectorHint = '[data-oh-find="1"]';
            }

            var contextText = (best.innerText || best.textContent || '').trim();
            if (contextText.length > 200) contextText = contextText.slice(0, 197) + '...';

            return JSON.stringify({
                found: true,
                total_matches: matches.length,
                match_index: idx,
                scrolled_to: scrolledTo,
                selector_hint: selectorHint,
                context_text: contextText,
                position: {
                    x: Math.round(rect.left + window.scrollX),
                    y: Math.round(rect.top + window.scrollY),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                tag: (best.tagName || '').toLowerCase(),
                is_visible: visible(best)
            });
        })(%s, %s, %s)
        """ % (_json.dumps(query), "true" if scroll_to else "false", str(int(match_index)))

        raw = await asyncio.wait_for(tab.evaluate(js), timeout=6)
        if not raw:
            return {"found": False, "total_matches": 0, "query": query}
        try:
            return _json.loads(raw)
        except Exception:
            return {"found": False, "total_matches": 0, "query": query,
                    "error": "find_on_page returned unparseable result"}

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
            return await asyncio.wait_for(
                AccessibilityHandler._find_by_role_impl(
                    tab, role, name, scroll_to, match_index
                ),
                timeout=_FN_TOTAL_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            debug_logger.log_warning(
                "AccessibilityHandler", "find_by_role",
                f"Total timeout ({_FN_TOTAL_TIMEOUT_S}s) on role={role} name={name}"
            )
            raise Exception(
                f"find_by_role timed out after {_FN_TOTAL_TIMEOUT_S}s. "
                "The page's accessibility tree is too complex or hung. "
                "Try get_page_digest first to see what's on the page, or "
                "use find_on_page(query) with a text query instead."
            )
        except Exception as e:
            debug_logger.log_error("AccessibilityHandler", "find_by_role", e)
            raise Exception(f"Failed to find by role: {e}")

    @staticmethod
    async def _find_by_role_impl(
        tab: Tab,
        role: Optional[str],
        name: Optional[str],
        scroll_to: bool,
        match_index: int,
    ) -> Dict[str, Any]:
        """Implementation body — wrapped with a total timeout by the
        public find_by_role above."""
        try:
            # Both of these calls are wrapped — on Reddit they can hang
            # the full 120s MCP timeout otherwise.
            try:
                await _cdp(tab, uc.cdp.accessibility.enable())
            except asyncio.TimeoutError:
                raise Exception(
                    "Accessibility.enable() hung — page DOM is stuck. "
                    "Try reload_page() or use find_on_page(query) instead."
                )

            try:
                # query_ax_tree requires a root node reference.
                # Get the document's DOM node ID first.
                try:
                    doc = await _cdp(tab, uc.cdp.dom.get_document())
                except asyncio.TimeoutError:
                    raise Exception(
                        "DOM.getDocument() hung — page is unresponsive. "
                        "Try reload_page() or navigate away and back."
                    )
                root_node_id = doc.node_id if doc else None

                try:
                    nodes = await _cdp(
                        tab,
                        uc.cdp.accessibility.query_ax_tree(
                            node_id=root_node_id,
                            accessible_name=name,
                            role=role,
                        ),
                        timeout_s=10,
                    )
                except asyncio.TimeoutError:
                    nodes = []
            finally:
                try:
                    await _cdp(
                        tab, uc.cdp.accessibility.disable(), timeout_s=3
                    )
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
                    await _cdp(
                        tab,
                        uc.cdp.dom.scroll_into_view_if_needed(
                            backend_node_id=target.backend_dom_node_id
                        ),
                        timeout_s=5,
                    )
                    result["scrolled_to"] = True
                    await asyncio.sleep(0.3)
                except Exception:
                    pass

            return result

        except Exception:
            # Re-raise so the outer wrapper can log and translate
            raise


# ======================================================================
# Private helpers
# ======================================================================

async def _trigger_lazy_load(tab: Tab) -> None:
    """Scroll through the page to force lazy-loaded content into the DOM."""
    try:
        import json as _json
        metrics = _json.loads(await tab.evaluate(
            """(() => JSON.stringify({
                height: document.body.scrollHeight,
                viewport: window.innerHeight
            }))()"""
        ))

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


async def _js_fast_digest(
    tab: Tab,
    title: str,
    url: str,
    scroll_info: Dict[str, Any],
    max_tokens: int,
    include_links: bool = True,
) -> Dict[str, Any]:
    """Fast JS-based page digest — the default path.

    Scans the DOM with narrow, specific selectors (no wildcards like
    `[class*="text"]` which match thousands of elements on Reddit).
    Enforces a hard 4-second JS budget via performance.now() so it
    cannot hang even on enormous SPAs. Only looks at elements that
    are roughly in/near the viewport, avoiding the full lazy-loaded
    feed on infinite-scroll pages.

    Expected timing: <2s on Reddit, <500ms on simple pages.
    """
    try:
        char_limit = max_tokens * 4
        # Hard JS-side budget. If exceeded, the collector breaks out
        # and returns what it has. 4000ms leaves slack under our 8s
        # individual CDP timeout.
        js_budget_ms = 4000

        data = await asyncio.wait_for(
            tab.evaluate(
                f"""(() => {{
                    const charLimit = {char_limit};
                    const deadline = performance.now() + {js_budget_ms};
                    const includeLinks = {str(include_links).lower()};
                    const out = [];
                    let chars = 0;

                    // Helper: is element probably visible?
                    // We use offsetParent as a cheap heuristic —
                    // it's null for display:none and detached nodes.
                    // For fixed/sticky elements we fall back to bounding rect.
                    const isVisible = (el) => {{
                        if (!el || !el.isConnected) return false;
                        if (el.offsetParent !== null) return true;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    }};

                    // Helper: is element near the viewport? We only
                    // care about content within ~3 screens of the
                    // current scroll position — anything further is
                    // noise on infinite-scroll pages.
                    const viewportH = window.innerHeight;
                    const nearViewport = (el) => {{
                        try {{
                            const r = el.getBoundingClientRect();
                            return r.bottom > -viewportH && r.top < viewportH * 3;
                        }} catch (e) {{ return false; }}
                    }};

                    const overBudget = () => chars > charLimit || performance.now() > deadline;

                    const push = (line) => {{
                        out.push(line);
                        chars += line.length + 1;
                    }};

                    // Narrow selector. No wildcards. Specific tag list only.
                    // This is the key difference from the old fallback:
                    // [class*="text"] matches thousands of elements on Reddit
                    // and takes 10+ seconds to scan. This selector matches
                    // only semantically meaningful interactive elements.
                    const SEL = [
                        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                        'a[href]',
                        'button',
                        '[role="button"]',
                        '[role="link"]',
                        '[role="heading"]',
                        '[role="textbox"]',
                        '[role="searchbox"]',
                        '[role="combobox"]',
                        '[role="checkbox"]',
                        '[role="radio"]',
                        '[role="tab"]',
                        '[role="menuitem"]',
                        'input:not([type="hidden"])',
                        'textarea',
                        '[contenteditable="true"]',
                        'label',
                        'article',
                        '[role="article"]',
                    ].join(',');

                    const els = document.querySelectorAll(SEL);
                    // Hard cap — 3000 elements is more than any sane page.
                    const max = Math.min(els.length, 3000);

                    for (let i = 0; i < max; i++) {{
                        if (overBudget()) break;
                        const el = els[i];
                        if (!isVisible(el)) continue;
                        if (!nearViewport(el)) continue;

                        const tag = el.tagName.toLowerCase();
                        const role = el.getAttribute('role') || '';
                        const text = (el.innerText || el.textContent || '').trim().substring(0, 180);
                        const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
                        const name = label || text;

                        if (tag === 'h1' || tag === 'h2' || tag === 'h3' ||
                            tag === 'h4' || tag === 'h5' || tag === 'h6') {{
                            if (name) push('[heading-' + tag[1] + '] "' + name + '"');
                        }} else if (tag === 'a' && el.getAttribute('href')) {{
                            if (!name) continue;
                            const href = el.getAttribute('href') || '';
                            if (includeLinks && href) {{
                                const shortHref = href.length > 80 ? href.substring(0, 77) + '...' : href;
                                push('[link] "' + name + '" -> ' + shortHref);
                            }} else {{
                                push('[link] "' + name + '"');
                            }}
                        }} else if (tag === 'button' || role === 'button') {{
                            if (name) push('[button] "' + name + '"');
                        }} else if (tag === 'input') {{
                            const type = (el.getAttribute('type') || 'text').toLowerCase();
                            const placeholder = el.getAttribute('placeholder') || label || el.getAttribute('name') || '';
                            if (placeholder || el.value) {{
                                const v = el.value ? ' value="' + String(el.value).substring(0, 60) + '"' : '';
                                push('[' + type + '] "' + placeholder + '"' + v);
                            }}
                        }} else if (tag === 'textarea' || el.getAttribute('contenteditable') === 'true' || role === 'textbox') {{
                            const placeholder = el.getAttribute('placeholder') || label || '';
                            push('[textbox] "' + placeholder + '"');
                        }} else if (tag === 'article' || role === 'article') {{
                            const snippet = text.substring(0, 200);
                            if (snippet) push('[article] "' + snippet + '"');
                        }} else if (role) {{
                            if (name) push('[' + role + '] "' + name + '"');
                        }}
                    }}

                    return JSON.stringify({{
                        lines: out,
                        scanned: max,
                        budget_exceeded: performance.now() > deadline,
                        chars: chars,
                    }});
                }})()"""
            ),
            timeout=6,  # Python-side kill-switch (JS has its own 4s)
        )

        import json as _json
        if isinstance(data, str):
            parsed = _json.loads(data)
        elif isinstance(data, dict):
            parsed = data
        else:
            parsed = {"lines": [], "scanned": 0, "budget_exceeded": False}

        lines_data = parsed.get("lines", [])
        budget_exceeded = parsed.get("budget_exceeded", False)

        scroll_top = scroll_info.get("scrollTop", 0)
        scroll_height = scroll_info.get("scrollHeight", 1)
        viewport = scroll_info.get("viewportHeight", 720)
        pct = round(scroll_top / max(scroll_height, 1) * 100, 1)

        header = [
            f"# Page: {title}",
            f"URL: {url}",
            f"Scroll: {pct}% ({scroll_top}/{scroll_height}px, viewport {viewport}px)",
            "",
        ]
        if budget_exceeded:
            header.append(
                f"[digest truncated — JS budget exceeded, {len(lines_data)} elements captured]"
            )
            header.append("")

        digest = "\n".join(header + list(lines_data))
        estimated_tokens = len(digest) // 4

        return {
            "digest": digest,
            "url": url,
            "title": title,
            "node_count": len(lines_data),
            "estimated_tokens": estimated_tokens,
            "truncated": budget_exceeded or estimated_tokens > max_tokens,
            "scroll_position": scroll_info,
            "mode": "fast",
        }

    except asyncio.TimeoutError:
        debug_logger.log_warning(
            "AccessibilityHandler", "_js_fast_digest",
            "JS fast digest hit Python-side timeout"
        )
        raise Exception(
            "get_page_digest: page is unresponsive even to JavaScript. "
            "Try reload_page() and retry, or use take_screenshot."
        )
    except Exception as e:
        debug_logger.log_error(
            "AccessibilityHandler", "_js_fast_digest", e
        )
        raise Exception(f"JS fast digest failed: {e}")


# Backwards-compat alias — a few older callers may still import the
# old name. Keep for one release.
_js_fallback_digest = _js_fast_digest
