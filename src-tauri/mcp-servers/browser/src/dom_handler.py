"""DOM manipulation and element interaction utilities."""

import asyncio
import json
import re
import time
from math import ceil
from typing import List, Optional, Dict, Any, Tuple

import nodriver as uc
from nodriver import Tab, Element
from models import ElementInfo, ElementAction
from debug_logger import debug_logger
from behavior import humanized_click, humanized_type, humanized_sleep



class DOMHandler:
    """Handles DOM queries and element interactions."""

    @staticmethod
    async def query_elements(
        tab: Tab,
        selector: str,
        text_filter: Optional[str] = None,
        visible_only: bool = True,
        limit: Optional[Any] = None
    ) -> List[ElementInfo]:
        """
        Query elements with advanced filtering.

        Args:
            tab (Tab): The browser tab object.
            selector (str): CSS or XPath selector for elements.
            text_filter (Optional[str]): Filter elements by text content.
            visible_only (bool): Only include visible elements.
            limit (Optional[Any]): Limit the number of results.

        Returns:
            List[ElementInfo]: List of element information objects.
        """
        processed_limit = None
        if limit is not None:
            try:
                if isinstance(limit, int):
                    processed_limit = limit
                elif isinstance(limit, str) and limit.isdigit():
                    processed_limit = int(limit)
                elif isinstance(limit, str) and limit.strip() == '':
                    processed_limit = None
                else:
                    debug_logger.log_warning('DOMHandler', 'query_elements',
                                            f'Invalid limit parameter: {limit} (type: {type(limit)})')
                    processed_limit = None
            except (ValueError, TypeError) as e:
                debug_logger.log_error('DOMHandler', 'query_elements', e,
                                      {'limit_value': limit, 'limit_type': type(limit)})
                processed_limit = None

        debug_logger.log_info('DOMHandler', 'query_elements',
                             f'Starting query with selector: {selector}',
                             {'text_filter': text_filter, 'visible_only': visible_only,
                              'limit': limit, 'processed_limit': processed_limit})
        try:
            if selector.startswith('//'):
                elements = await tab.xpath(selector)
                debug_logger.log_info('DOMHandler', 'query_elements',
                                     f'XPath query returned {len(elements)} elements')
            else:
                elements = await tab.select_all(selector)
                debug_logger.log_info('DOMHandler', 'query_elements',
                                     f'CSS query returned {len(elements)} elements')

            results = []
            for idx, elem in enumerate(elements):
                try:
                    if hasattr(elem, 'update'):
                        await elem.update()

                    tag_name = elem.tag_name if hasattr(elem, 'tag_name') else 'unknown'
                    text_content = elem.text_all if hasattr(elem, 'text_all') else ''
                    attrs = elem.attrs if hasattr(elem, 'attrs') else {}

                    if text_filter and text_filter.lower() not in text_content.lower():
                        continue

                    is_visible = True
                    if visible_only:
                        try:
                            is_visible = await elem.apply(
                                """(elem) => {
                                    var style = window.getComputedStyle(elem);
                                    return style.display !== 'none' && 
                                           style.visibility !== 'hidden' && 
                                           style.opacity !== '0';
                                }"""
                            )
                            if not is_visible:
                                continue
                        except:
                            pass

                    bbox = None
                    try:
                        position = await elem.get_position()
                        if position:
                            bbox = {
                                'x': position.x,
                                'y': position.y,
                                'width': position.width,
                                'height': position.height
                            }
                    except Exception:
                        pass

                    is_clickable = False

                    children_count = 0
                    try:
                        if hasattr(elem, 'children'):
                            children = elem.children
                            children_count = len(children) if children else 0
                    except Exception:
                        pass

                    element_info = ElementInfo(
                        selector=selector,
                        tag_name=tag_name,
                        text=text_content[:500] if text_content else None,
                        attributes=attrs or {},
                        is_visible=is_visible,
                        is_clickable=is_clickable,
                        bounding_box=bbox,
                        children_count=children_count
                    )

                    results.append(element_info)

                    if processed_limit and len(results) >= processed_limit:
                        debug_logger.log_info('DOMHandler', 'query_elements',
                                             f'Reached limit of {processed_limit} results')
                        break

                except Exception as elem_error:
                    debug_logger.log_error('DOMHandler', 'query_elements',
                                          elem_error,
                                          {'element_index': idx, 'selector': selector})
                    continue

            debug_logger.log_info('DOMHandler', 'query_elements',
                                 f'Returning {len(results)} results')
            return results

        except Exception as e:
            debug_logger.log_error('DOMHandler', 'query_elements', e,
                                  {'selector': selector, 'tab': str(tab)})
            return []

    @staticmethod
    async def click_element(
        tab: Tab,
        selector: str,
        text_match: Optional[str] = None,
        timeout: int = 10000,
        humanize: bool = True,
    ) -> bool:
        """
        Click an element with multi-strategy finding and retry logic.

        Tries CSS selector, XPath, text search, and shadow DOM piercing
        in cascade. Retries up to 3 times with backoff, scrolling down
        between retries to trigger lazy-loaded content.

        Args:
            tab: The browser tab object.
            selector: CSS selector or XPath for the element.
            text_match: Match element by text content instead of selector.
            timeout: Timeout in milliseconds.
            humanize: Use human-like mouse movement and timing.

        Returns:
            True if click succeeded.

        Raises:
            Exception with diagnostic info including nearby clickable
            elements and suggested alternative selectors.
        """
        element, diagnostics = await DOMHandler._find_element_robust(
            tab, selector, text_match, timeout
        )

        if not element:
            # Gather nearby clickable elements for diagnostics
            nearby = await DOMHandler._find_nearby_elements(tab)
            error_msg = DOMHandler._format_click_error(
                selector, text_match, diagnostics, nearby
            )
            raise Exception(error_msg)

        # Pre-interaction: scroll into view + visibility check
        ready, reason = await DOMHandler._prepare_for_interaction(tab, element)
        if not ready:
            debug_logger.log_warning(
                "DOMHandler", "click_element",
                f"Element may not be interactive: {reason}"
            )

        # Execute click with cascading fallbacks.
        # Cascade order (Round 12, 2026-04-13):
        #   1. humanized_click (human mouse-path, preferred)
        #   2. element.click() (nodriver's default click)
        #   3. element.mouse_click() (CDP mouse event via nodriver)
        #   4. CDP Input.dispatchMouseEvent at element center coords
        #      — coordinate-based fallback that works even when the
        #      element's JS click handler is fighting native clicks
        #      (React controlled inputs, shadow-DOM trigger wrappers,
        #      LinkedIn "Send without a note" that filters synthetic
        #      MouseEvents).
        try:
            if humanize:
                try:
                    await humanized_click(tab, element)
                    return True
                except Exception as e_hum:
                    debug_logger.log_info(
                        "DOMHandler", "click_element",
                        f"humanized_click failed, falling to element.click: {e_hum}"
                    )
            # Fallback path 2: element.click()
            try:
                await element.scroll_into_view()
                await asyncio.sleep(0.3)
                await element.click()
                return True
            except Exception as e_click:
                debug_logger.log_info(
                    "DOMHandler", "click_element",
                    f"element.click failed, falling to mouse_click: {e_click}"
                )
                try:
                    await element.mouse_click()
                    return True
                except Exception as e_mouse:
                    debug_logger.log_info(
                        "DOMHandler", "click_element",
                        f"element.mouse_click failed, falling to CDP coord click: {e_mouse}"
                    )

            # Fallback path 4: coordinate-based CDP dispatch.
            # Compute the element center via getBoundingClientRect, then
            # dispatch a real mousePressed/mouseReleased pair via
            # Input.dispatchMouseEvent. This bypasses any JS that fights
            # synthetic MouseEvents at the HTMLElement.click() level
            # because it delivers input at the Chrome compositor layer.
            box = None
            try:
                box = await element.get_position()
            except Exception:
                box = None
            if not box or not getattr(box, "width", 0):
                raise Exception(
                    "Click execution failed: all click methods exhausted and "
                    "CDP coord fallback could not compute a bounding box"
                )
            cx = float(box.x) + float(box.width) / 2.0
            cy = float(box.y) + float(box.height) / 2.0
            await tab.send(uc.cdp.input_.dispatch_mouse_event(
                type_="mouseMoved",
                x=cx,
                y=cy,
                button=uc.cdp.input_.MouseButton.LEFT,
            ))
            await asyncio.sleep(0.05)
            await tab.send(uc.cdp.input_.dispatch_mouse_event(
                type_="mousePressed",
                x=cx,
                y=cy,
                button=uc.cdp.input_.MouseButton.LEFT,
                click_count=1,
            ))
            await asyncio.sleep(0.05)
            await tab.send(uc.cdp.input_.dispatch_mouse_event(
                type_="mouseReleased",
                x=cx,
                y=cy,
                button=uc.cdp.input_.MouseButton.LEFT,
                click_count=1,
            ))
            debug_logger.log_info(
                "DOMHandler", "click_element",
                f"CDP coord click succeeded at ({cx:.0f}, {cy:.0f})"
            )
            return True
        except Exception as e:
            raise Exception(f"Click execution failed after finding element: {e}")

    # ------------------------------------------------------------------
    # Round 11 (2026-04-13): triple_click — select full line / paragraph
    # ------------------------------------------------------------------
    @staticmethod
    async def triple_click(
        tab: Tab,
        selector: str,
        text_match: Optional[str] = None,
        timeout: int = 10000,
    ) -> Dict[str, Any]:
        """
        Triple-click an element to select its full line / paragraph.

        Dispatches three rapid synthesised mouse events via CDP
        ``Input.dispatchMouseEvent`` with ``clickCount`` of 1, 2, 3 —
        matching how a real triple-click registers in Chrome. On an
        ``<input>``/``<textarea>`` this selects all text on the line;
        on a contenteditable it selects the paragraph.

        Added to absorb the hallucinated `triple_click` tool-name call
        the agent kept attempting in Run f84bab15 — rather than teach
        the agent not to hallucinate, we expose the primitive as a
        real working tool so future attempts succeed.

        Returns a dict with the usual shape used across DOMHandler:
            {success, selector, bbox, events_dispatched, message}

        Raises on element-not-found so the agent treats it exactly
        like a missing click target.

        Args:
            tab: The browser tab object.
            selector: CSS selector, XPath, or selector_hint from find_on_page.
            text_match: Optional text hint for element finding.
            timeout: Timeout in milliseconds.
        """
        element, diagnostics = await DOMHandler._find_element_robust(
            tab, selector, text_match, timeout
        )

        if not element:
            nearby = await DOMHandler._find_nearby_elements(tab)
            error_msg = DOMHandler._format_click_error(
                selector, text_match, diagnostics, nearby
            )
            raise Exception(error_msg)

        # Ensure the element is scrolled into view and get its bounding
        # box so the mouse events land on its centre.
        try:
            await element.scroll_into_view()
        except Exception:
            pass

        # Try multiple paths to get a bounding box. element.get_position()
        # is the nodriver API; fall back to a JS getBoundingClientRect
        # if that method isn't available on this element type.
        box = None
        try:
            box = await element.get_position()
        except Exception:
            box = None
        if not box or not getattr(box, "width", 0):
            try:
                rect_json = await tab.evaluate(
                    """(() => {
                        const el = document.querySelector(%r) ||
                                   document.querySelector('[data-oh-find="1"]');
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        return JSON.stringify({
                            x: r.left, y: r.top,
                            width: r.width, height: r.height
                        });
                    })()"""
                    % selector
                )
                import json as _json
                if rect_json and isinstance(rect_json, str):
                    parsed = _json.loads(rect_json)
                    class _B: pass
                    box = _B()
                    box.x = parsed.get("x", 0)
                    box.y = parsed.get("y", 0)
                    box.width = parsed.get("width", 1)
                    box.height = parsed.get("height", 1)
            except Exception:
                pass

        if not box or not getattr(box, "width", 0):
            raise Exception(
                f"triple_click: could not compute bounding box for selector "
                f"{selector!r} — element was found but has zero dimensions"
            )

        center_x = float(box.x) + float(box.width) / 2.0
        center_y = float(box.y) + float(box.height) / 2.0

        # Dispatch three rapid down/up pairs with clickCount 1/2/3.
        # Spacing ~50ms between pairs — faster than a human but slow
        # enough that Chrome's click-count accumulator (DBLCLK_TIME_MS,
        # ~500ms) sees them as one gesture. We use the CDP Input domain
        # which is SAFE — unlike Runtime/Debugger/Console, Input.enable
        # is not a detection vector and is implicitly active whenever
        # the page is committed.
        events_dispatched = 0
        try:
            for click_count in (1, 2, 3):
                # Mouse down
                await tab.send(uc.cdp.input_.dispatch_mouse_event(
                    type_="mousePressed",
                    x=center_x,
                    y=center_y,
                    button=uc.cdp.input_.MouseButton.LEFT,
                    click_count=click_count,
                ))
                # Mouse up
                await tab.send(uc.cdp.input_.dispatch_mouse_event(
                    type_="mouseReleased",
                    x=center_x,
                    y=center_y,
                    button=uc.cdp.input_.MouseButton.LEFT,
                    click_count=click_count,
                ))
                events_dispatched += 1
                # 50ms between pairs — fast enough for Chrome's click
                # accumulator to treat them as a triple-click gesture.
                await asyncio.sleep(0.05)
        except Exception as e:
            raise Exception(
                f"triple_click: CDP mouse dispatch failed at clickCount={events_dispatched+1}: {e}"
            )

        return {
            "success": True,
            "selector": selector,
            "bbox": {
                "x": float(box.x),
                "y": float(box.y),
                "width": float(box.width),
                "height": float(box.height),
            },
            "center": {"x": center_x, "y": center_y},
            "events_dispatched": events_dispatched,
            "message": (
                f"triple_click dispatched 3 click events at "
                f"({center_x:.0f}, {center_y:.0f}) — the current line / "
                f"paragraph under this element is now selected"
            ),
        }

    # ------------------------------------------------------------------
    # Private: multi-strategy element finding with retry
    # ------------------------------------------------------------------
    @staticmethod
    async def _find_element_robust(
        tab: Tab,
        selector: str,
        text_match: Optional[str] = None,
        timeout: int = 10000,
        max_retries: int = 3,
    ) -> Tuple[Optional[Element], Dict[str, Any]]:
        """Try multiple strategies to find an element, with retry.

        Cascade per attempt:
          1. CSS selector (or XPath if starts with //)
          2. Converted XPath (if input was CSS)
          3. Text-based search
          4. Shadow DOM piercing via JS

        Between retries, scrolls down one viewport to trigger lazy-load.

        Returns (element_or_None, diagnostics_dict).
        """
        per_phase_timeout = min(timeout / 1000, 3.0)
        diagnostics: Dict[str, Any] = {"strategies": [], "retries": 0}
        backoff = [0.5, 1.0, 2.0]

        # Split comma-separated selectors for XPath conversion
        selector_parts = [s.strip() for s in selector.split(",")]

        for attempt in range(max_retries):
            diagnostics["retries"] = attempt

            # --- Strategy 1: Direct selector (CSS or XPath) ---
            try:
                if selector.startswith("//"):
                    elements = await tab.xpath(selector)
                    element = elements[0] if elements else None
                else:
                    element = await tab.select(
                        selector, timeout=per_phase_timeout
                    )
                if element:
                    diagnostics["strategies"].append(
                        {"method": "css/xpath", "result": "found"}
                    )
                    return element, diagnostics
            except Exception:
                pass
            diagnostics["strategies"].append(
                {"method": "css/xpath", "result": "not found"}
            )

            # --- Strategy 2: Convert CSS to XPath and try ---
            if not selector.startswith("//"):
                for part in selector_parts:
                    xpath = DOMHandler._css_selector_to_xpath(part)
                    if xpath:
                        try:
                            elements = await tab.xpath(xpath)
                            if elements:
                                diagnostics["strategies"].append(
                                    {"method": "xpath-converted",
                                     "result": "found", "xpath": xpath}
                                )
                                return elements[0], diagnostics
                        except Exception:
                            pass
                diagnostics["strategies"].append(
                    {"method": "xpath-converted", "result": "not found"}
                )

            # --- Strategy 3: Text-based search ---
            search_text = text_match
            if not search_text:
                # Extract text hint from selector (e.g. aria-label value)
                search_text = DOMHandler._extract_text_hint(selector)
            if search_text:
                try:
                    element = await tab.find(
                        search_text, best_match=True
                    )
                    if element:
                        diagnostics["strategies"].append(
                            {"method": "text", "result": "found",
                             "text": search_text}
                        )
                        return element, diagnostics
                except Exception:
                    pass
                diagnostics["strategies"].append(
                    {"method": "text", "result": "not found",
                     "text": search_text}
                )

            # --- Strategy 4: Shadow DOM piercing via JS ---
            try:
                found_in_shadow = await tab.evaluate(f"""(() => {{
                    function findInShadow(root, sel) {{
                        try {{
                            let el = root.querySelector(sel);
                            if (el) return true;
                        }} catch(e) {{}}
                        const all = root.querySelectorAll('*');
                        for (const node of all) {{
                            if (node.shadowRoot) {{
                                if (findInShadow(node.shadowRoot, sel)) return true;
                            }}
                        }}
                        return false;
                    }}
                    if (!findInShadow(document, {json.dumps(selector)})) return null;
                    // Tag it for retrieval
                    function tagInShadow(root, sel) {{
                        try {{
                            let el = root.querySelector(sel);
                            if (el) {{ el.setAttribute('data-oh-found', '1'); return true; }}
                        }} catch(e) {{}}
                        const all = root.querySelectorAll('*');
                        for (const node of all) {{
                            if (node.shadowRoot) {{
                                if (tagInShadow(node.shadowRoot, sel)) return true;
                            }}
                        }}
                        return false;
                    }}
                    tagInShadow(document, {json.dumps(selector)});
                    return true;
                }})()""")

                if found_in_shadow:
                    try:
                        element = await tab.select(
                            '[data-oh-found="1"]', timeout=2
                        )
                        # Clean up tag
                        await tab.evaluate(
                            "document.querySelector('[data-oh-found]')"
                            "?.removeAttribute('data-oh-found')"
                        )
                        if element:
                            diagnostics["strategies"].append(
                                {"method": "shadow-dom", "result": "found"}
                            )
                            return element, diagnostics
                    except Exception:
                        pass
            except Exception:
                pass
            diagnostics["strategies"].append(
                {"method": "shadow-dom", "result": "not found"}
            )

            # --- Retry: scroll down one viewport to trigger lazy-load ---
            if attempt < max_retries - 1:
                try:
                    await tab.evaluate(
                        "window.scrollBy({top: window.innerHeight, "
                        "behavior: 'instant'})"
                    )
                    await asyncio.sleep(backoff[attempt])
                except Exception:
                    pass

        return None, diagnostics

    @staticmethod
    def _css_selector_to_xpath(selector: str) -> Optional[str]:
        """Best-effort conversion of common CSS selectors to XPath."""
        s = selector.strip()
        if not s or s.startswith("//"):
            return None  # Already XPath or empty

        # tag[attr="val"]
        m = re.match(r'^(\w+)?\[(\w[\w-]*)="([^"]+)"\]$', s)
        if m:
            tag = m.group(1) or "*"
            return f'//{tag}[@{m.group(2)}="{m.group(3)}"]'

        # tag[attr*="val"] (contains)
        m = re.match(r'^(\w+)?\[(\w[\w-]*)\*="([^"]+)"\]$', s)
        if m:
            tag = m.group(1) or "*"
            return f'//{tag}[contains(@{m.group(2)}, "{m.group(3)}")]'

        # .classname
        m = re.match(r'^\.([a-zA-Z_][\w-]*)$', s)
        if m:
            return f'//*[contains(@class, "{m.group(1)}")]'

        # #id
        m = re.match(r'^#([a-zA-Z_][\w-]*)$', s)
        if m:
            return f'//*[@id="{m.group(1)}"]'

        # tag.classname
        m = re.match(r'^(\w+)\.([a-zA-Z_][\w-]*)$', s)
        if m:
            return f'//{m.group(1)}[contains(@class, "{m.group(2)}")]'

        return None

    @staticmethod
    def _extract_text_hint(selector: str) -> Optional[str]:
        """Extract a text hint from a CSS selector for text-based search.

        E.g., 'button[aria-label="Back"]' -> 'Back'
        """
        # Match aria-label="..." or title="..." or placeholder="..."
        m = re.search(
            r'(?:aria-label|title|placeholder|alt)\s*[*~|^$]?=\s*"([^"]+)"',
            selector
        )
        if m:
            return m.group(1)

        # Match data-testid="..." (less useful but worth trying)
        m = re.search(r'data-testid\s*[*~|^$]?=\s*"([^"]+)"', selector)
        if m:
            return m.group(1)

        return None

    # ------------------------------------------------------------------
    # Private: pre-interaction preparation
    # ------------------------------------------------------------------
    @staticmethod
    async def _prepare_for_interaction(
        tab: Tab,
        element: Element,
        timeout: float = 2.0,
    ) -> Tuple[bool, str]:
        """Ensure element is visible, in viewport, and interactive.

        Returns (ready, reason) where reason explains any issue.
        """
        try:
            # Scroll into view
            try:
                await element.scroll_into_view()
            except Exception:
                pass

            # Check visibility (poll up to timeout)
            polls = max(1, int(timeout / 0.5))
            for _ in range(polls):
                try:
                    is_visible = await element.apply("""(elem) => {
                        var s = window.getComputedStyle(elem);
                        return s.display !== 'none' &&
                               s.visibility !== 'hidden' &&
                               s.opacity !== '0' &&
                               s.pointerEvents !== 'none';
                    }""")
                    if is_visible:
                        break
                except Exception:
                    break
                await asyncio.sleep(0.5)
            else:
                return False, "Element not visible after waiting"

            # Check for overlay (element not covered by another element)
            try:
                pos = await element.get_position()
                if pos:
                    cx = pos.x + pos.width / 2
                    cy = pos.y + pos.height / 2
                    is_on_top = await tab.evaluate(f"""(() => {{
                        var el = document.elementFromPoint({cx}, {cy});
                        if (!el) return true;
                        var target = document.querySelector(
                            '[data-oh-check]'
                        );
                        return !target || target.contains(el) ||
                               el.contains(target);
                    }})()""")
                    if not is_on_top:
                        return False, (
                            f"Element may be covered by overlay at "
                            f"({int(cx)}, {int(cy)})"
                        )
            except Exception:
                pass  # Non-fatal — proceed anyway

            # Brief settle delay
            await humanized_sleep(50, 150)
            return True, "ready"

        except Exception as e:
            return False, f"Preparation error: {e}"

    # ------------------------------------------------------------------
    # Private: nearby element discovery for diagnostics
    # ------------------------------------------------------------------
    @staticmethod
    async def _find_nearby_elements(tab: Tab) -> List[Dict[str, str]]:
        """Find clickable elements on the page for error diagnostics."""
        try:
            result = await tab.evaluate("""(() => {
                var sels = 'button, a, [role="button"], input[type="submit"],'
                         + ' input[type="button"], [tabindex="0"]';
                var elems = document.querySelectorAll(sels);
                var out = [];
                for (var i = 0; i < elems.length && out.length < 8; i++) {
                    var el = elems[i];
                    var s = window.getComputedStyle(el);
                    if (s.display === 'none' || s.visibility === 'hidden') continue;
                    var r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    var text = (el.textContent || '').trim().substring(0, 80);
                    var label = el.getAttribute('aria-label') || '';
                    var tag = el.tagName.toLowerCase();
                    out.push({
                        tag: tag,
                        text: text,
                        aria_label: label,
                        x: Math.round(r.x),
                        y: Math.round(r.y)
                    });
                }
                return out;
            })()""")
            return result if isinstance(result, list) else []
        except Exception:
            return []

    @staticmethod
    def _format_click_error(
        selector: str,
        text_match: Optional[str],
        diagnostics: Dict[str, Any],
        nearby: List[Dict[str, str]],
    ) -> str:
        """Format a rich error message for failed click attempts."""
        lines = [f"Failed to click '{selector}'"]
        if text_match:
            lines[0] += f" (text_match='{text_match}')"
        lines[0] += ":"

        # Strategies tried
        for s in diagnostics.get("strategies", []):
            method = s.get("method", "?")
            result = s.get("result", "?")
            extra = ""
            if "xpath" in s:
                extra = f" ({s['xpath']})"
            elif "text" in s:
                extra = f" ('{s['text']}')"
            lines.append(f"  - {method}: {result}{extra}")

        lines.append(f"  Retries: {diagnostics.get('retries', 0)}")

        # Nearby clickable elements
        if nearby:
            lines.append("  Nearby clickable elements:")
            for i, el in enumerate(nearby[:5], 1):
                text = el.get("text", "")
                label = el.get("aria_label", "")
                tag = el.get("tag", "?")
                display = label or text
                if display:
                    display = f' "{display}"'
                pos = f"at ({el.get('x', '?')}, {el.get('y', '?')})"
                lines.append(f"    {i}. <{tag}>{display} {pos}")

            # Suggest best alternative
            best = nearby[0] if nearby else None
            if best:
                label = best.get("aria_label")
                text = best.get("text", "")
                if label:
                    lines.append(
                        f'  Suggestion: Try selector=\'[aria-label="{label}"]\''
                    )
                elif text:
                    short = text[:50]
                    lines.append(
                        f"  Suggestion: Try text_match=\"{short}\""
                    )

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Input-field resolution + verification (shared by type_text/paste_text)
    # ------------------------------------------------------------------

    # Shadow-DOM pierce helper — installed lazily by `_resolve_input_target`
    # as part of its single tab.evaluate call. Every subsequent JS snippet
    # that needs shadow-aware element lookup uses
    # `(window.__ohFind || ((s) => document.querySelector(s)))(selector)`
    # so flat-DOM selectors and shadow-hosted selectors share a code path.
    # This is the fix for Pattern 7 (Reddit old-login shadow-DOM blocker).

    @staticmethod
    async def _resolve_input_target(
        tab: Tab,
        selector: str,
    ) -> Dict[str, Any]:
        """
        Resolve the *best* input target for a (possibly union) selector.

        Given `textarea, [contenteditable], input[type="text"]`, a naive
        `querySelector` returns whichever comes first in DOM order — which
        on modern SPAs is usually a search box, not the intended editor.

        This resolver:
          1. Runs every part of a comma-separated selector.
          2. Scores candidates, preferring writable rich editors over
             search inputs, and visible over hidden.
          3. Returns a SINGLE unambiguous selector pointing at the winner,
             plus metadata the caller can use for sanity checks.

        Returns:
            {
              "selector": "<resolved unambiguous css selector>",
              "tag": "textarea" | "div" | "input" | ...,
              "editor_kind": "contenteditable" | "textarea" | "input-text" |
                             "input-search" | "unknown",
              "placeholder": str | None,
              "aria_label": str | None,
              "name": str | None,
              "is_visible": bool,
              "looks_like_search": bool,
              "match_count": int,   # total elements matched by the input selector
              "matched_parts": [str, ...]  # which parts of the union matched something
            }
            or {"selector": None, "match_count": 0, ...} if nothing matched.
        """
        # The resolver JS below inlines the shadow-pierce helper install
        # (inside the `if (!window.__ohFindInstalled)` guard) so that a
        # single tab.evaluate call covers both install and resolve. This
        # is Pattern 7 (Reddit shadow-DOM login) — the resolver now sees
        # open-shadow-hosted inputs as candidates, at no extra round-trip.
        js = """
        (function(rawSelector) {
            // Install window.__ohFind / __ohFindAll on first call.
            // These walk open shadow roots so the resolver's candidate
            // scan (and all subsequent paste/type/read helpers) see
            // shadow-hosted inputs the same way flat-DOM inputs are seen.
            if (!window.__ohFindInstalled) {
                (function() {
                    var DEADLINE_MS = 1500;
                    var MAX_ROOTS = 1000;
                    function walkRoots(cb) {
                        var start = performance.now();
                        var visited = 0;
                        var stack = [document];
                        while (stack.length) {
                            if (performance.now() - start > DEADLINE_MS) break;
                            if (visited >= MAX_ROOTS) break;
                            var root = stack.pop();
                            visited++;
                            try { if (cb(root) === 'stop') return; } catch (e) {}
                            var hosts;
                            try { hosts = root.querySelectorAll('*'); }
                            catch (e) { continue; }
                            for (var i = 0; i < hosts.length; i++) {
                                var h = hosts[i];
                                if (h && h.shadowRoot) stack.push(h.shadowRoot);
                            }
                        }
                    }
                    window.__ohFind = function(sel) {
                        if (!sel) return null;
                        try {
                            var fast = document.querySelector(sel);
                            if (fast) return fast;
                        } catch (e) { return null; }
                        var found = null;
                        walkRoots(function(root) {
                            if (found) return 'stop';
                            try {
                                var m = root.querySelector(sel);
                                if (m) { found = m; return 'stop'; }
                            } catch (e) {}
                        });
                        return found;
                    };
                    window.__ohFindAll = function(sel) {
                        if (!sel) return [];
                        var out = [];
                        try { out.push.apply(out, document.querySelectorAll(sel)); }
                        catch (e) { return []; }
                        walkRoots(function(root) {
                            if (root === document) return;
                            try {
                                var ms = root.querySelectorAll(sel);
                                for (var i = 0; i < ms.length; i++) {
                                    if (out.indexOf(ms[i]) === -1) out.push(ms[i]);
                                }
                            } catch (e) {}
                        });
                        return out;
                    };
                    window.__ohFindInstalled = true;
                })();
            }
            // Shadow-aware query: falls back to document.querySelector if
            // the __ohFind helper couldn't be installed. Respects the
            // 1.5s internal budget inside __ohFindAll.
            function safeQuery(root, sel) {
                try {
                    if (root === document && typeof window.__ohFindAll === 'function') {
                        return Array.from(window.__ohFindAll(sel));
                    }
                    return Array.from(root.querySelectorAll(sel));
                } catch (e) { return []; }
            }
            function visible(el) {
                if (!el) return false;
                var s = window.getComputedStyle(el);
                if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }
            function editorKind(el) {
                if (!el) return 'unknown';
                if (el.isContentEditable) return 'contenteditable';
                var tag = (el.tagName || '').toLowerCase();
                if (tag === 'textarea') return 'textarea';
                if (tag === 'input') {
                    var t = (el.getAttribute('type') || 'text').toLowerCase();
                    if (t === 'search') return 'input-search';
                    return 'input-' + t;
                }
                return 'unknown';
            }
            function looksLikeSearch(el) {
                if (!el) return false;
                var t = (el.getAttribute('type') || '').toLowerCase();
                if (t === 'search') return true;
                if ((el.getAttribute('role') || '').toLowerCase() === 'search') return true;
                var name = (el.getAttribute('name') || '').toLowerCase();
                if (name === 'q' || name === 'query' || name === 'search' || name === 'search_query') return true;
                var ph = (el.getAttribute('placeholder') || '').toLowerCase();
                if (ph && (ph.includes('search') || ph.includes('find'))) return true;
                var al = (el.getAttribute('aria-label') || '').toLowerCase();
                if (al && (al.includes('search') || al.includes('find'))) return true;
                var ek = (el.getAttribute('enterkeyhint') || '').toLowerCase();
                if (ek === 'search') return true;
                return false;
            }
            // Score: higher is better.
            //   contenteditable / textarea: 100
            //   non-search input: 60
            //   search input: 10
            //   +20 if visible
            //   +5 if has a placeholder like "comment", "reply", "write"
            function score(el) {
                if (!el) return -1;
                var kind = editorKind(el);
                var s = 0;
                if (kind === 'contenteditable' || kind === 'textarea') s = 100;
                else if (kind === 'input-text' || kind.startsWith('input-')) {
                    s = looksLikeSearch(el) ? 10 : 60;
                } else s = 5;
                if (visible(el)) s += 20;
                var hints = (
                    (el.getAttribute('placeholder') || '') + ' ' +
                    (el.getAttribute('aria-label') || '') + ' ' +
                    (el.getAttribute('aria-placeholder') || '') + ' ' +
                    (el.getAttribute('name') || '')
                ).toLowerCase();
                if (hints.match(/comment|reply|message|post|write|body|content|compose/)) s += 5;
                if (hints.match(/search|find|lookup/)) s -= 15;
                return s;
            }
            function buildSelector(el) {
                // Produce a reasonably unique CSS selector pointing at `el`.
                if (!el) return null;
                if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
                var parts = [];
                var cur = el;
                for (var i = 0; i < 5 && cur && cur !== document.body; i++) {
                    var tag = cur.tagName.toLowerCase();
                    var piece = tag;
                    if (cur.getAttribute('name')) piece += '[name="' + cur.getAttribute('name').replace(/"/g, '\\\\"') + '"]';
                    else if (cur.getAttribute('role')) piece += '[role="' + cur.getAttribute('role') + '"]';
                    else if (cur.classList.length > 0) {
                        var cls = Array.from(cur.classList).slice(0, 2).map(function(c){return '.' + CSS.escape(c);}).join('');
                        piece += cls;
                    }
                    // Add nth-of-type if ambiguous
                    if (cur.parentNode) {
                        var siblings = Array.from(cur.parentNode.children).filter(function(s){return s.tagName === cur.tagName;});
                        if (siblings.length > 1) piece += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
                    }
                    parts.unshift(piece);
                    cur = cur.parentElement;
                    // Stop early if this path is already unique
                    try {
                        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
                    } catch (e) {}
                }
                return parts.join(' > ');
            }
            // Find a "click me to reveal the editor" activator near a hidden
            // editor. Many modern sites (Reddit, Twitter, LinkedIn) collapse
            // their comment/reply editors behind a placeholder button. When
            // our target is a contenteditable/textarea that is NOT currently
            // visible, walk up the DOM looking for a visible, clickable
            // ancestor/sibling whose text matches an activator phrase.
            // Composer activator regex — matches visible "click me to reveal
            // the editor" placeholders across Reddit/Twitter/LinkedIn/HN/GitHub.
            var ACTIVATOR_RX = /join.{0,5}(the.{0,3})?(conversation|discussion)|add.{0,3}a?.{0,3}(comment|reply)|write.{0,3}a?.{0,3}(comment|reply|post)|leave.{0,3}a?.{0,3}(comment|reply)|post.{0,3}a?.{0,3}(comment|reply|your)|reply.{0,3}to|start.{0,3}a.{0,3}(discussion|conversation|reply)|what.{0,5}(are|do).{0,5}(your|you).{0,5}thoughts|compose.{0,3}reply|what's.{0,3}on.{0,3}your.{0,3}mind/i;
            // Clickable selector — includes Reddit's custom elements and any
            // element tagged as a composer trigger. Custom elements like
            // <faceplate-textarea-input> and <shreddit-composer> don't match
            // button/a/role=button and were being missed before.
            var CLICKABLE_SEL = [
                'button', 'a[href]',
                '[role="button"]', '[role="link"]', '[role="textbox"]',
                '[tabindex]:not([tabindex="-1"])',
                '[data-testid*="trigger" i]',
                '[data-testid*="composer" i]',
                '[data-testid*="reply" i]',
                '[data-click-id*="comment" i]',
                'faceplate-textarea-input',
                'faceplate-textarea',
                'shreddit-composer',
                'comment-composer-host',
                // Any element that visually looks like a textbox placeholder
                '[placeholder]',
                '[aria-placeholder]'
            ].join(', ');
            function activatorText(el) {
                // Concatenate every surface where a placeholder-like label
                // might live. Reddit custom elements put the "Join the
                // conversation" string in `placeholder`, `aria-placeholder`,
                // or the innerText of a child <span>.
                return (
                    (el.innerText || el.textContent || '') + ' ' +
                    (el.getAttribute('aria-label') || '') + ' ' +
                    (el.getAttribute('aria-placeholder') || '') + ' ' +
                    (el.getAttribute('placeholder') || '') + ' ' +
                    (el.getAttribute('title') || '') + ' ' +
                    (el.getAttribute('data-testid') || '')
                ).trim();
            }
            function findActivator(editorEl) {
                if (!editorEl) return null;
                // Walk up to 12 ancestors. For each scope, gather clickable
                // candidates whose accessible text matches the activator regex.
                var ancestor = editorEl;
                for (var depth = 0; depth < 12 && ancestor; depth++) {
                    ancestor = ancestor.parentElement;
                    if (!ancestor) break;
                    var candidates = safeQuery(ancestor, CLICKABLE_SEL);
                    for (var i = 0; i < candidates.length; i++) {
                        var c = candidates[i];
                        if (c === editorEl) continue;
                        if (c.contains && c.contains(editorEl)) continue; // wrapping ancestor is rarely the right click target
                        if (!visible(c)) continue;
                        var txt = activatorText(c);
                        if (txt.length === 0 || txt.length > 160) continue;
                        if (ACTIVATOR_RX.test(txt)) {
                            return { element: c, text: txt.slice(0, 80) };
                        }
                    }
                    // Ancestor itself as a fallback (e.g. a shreddit-composer
                    // wrapper whose placeholder lives at the top level).
                    if (depth < 5 && visible(ancestor)) {
                        var atxt = activatorText(ancestor);
                        if (atxt && atxt.length < 160 && ACTIVATOR_RX.test(atxt)) {
                            return { element: ancestor, text: atxt.slice(0, 80) };
                        }
                    }
                }
                return null;
            }

            var parts = rawSelector.split(',').map(function(s){return s.trim();}).filter(Boolean);
            var all = [];
            var matched_parts = [];
            parts.forEach(function(p) {
                var found = safeQuery(document, p);
                if (found.length > 0) matched_parts.push(p);
                found.forEach(function(el){ if (all.indexOf(el) === -1) all.push(el); });
            });

            if (all.length === 0) {
                return JSON.stringify({
                    selector: null, match_count: 0, matched_parts: matched_parts
                });
            }

            // Pick the best-scoring candidate.
            var best = all[0];
            var bestScore = score(best);
            for (var i = 1; i < all.length; i++) {
                var sc = score(all[i]);
                if (sc > bestScore) { best = all[i]; bestScore = sc; }
            }

            // Detect whether the winner is inside a shadow root — walk up
            // via getRootNode() until we hit a document or a shadow root.
            var shadowHosted = false;
            try {
                var root = best.getRootNode && best.getRootNode();
                shadowHosted = !!(root && root.host);
            } catch (e) { shadowHosted = false; }

            var resolvedSel = shadowHosted ? null : buildSelector(best);
            // Prefer an id-based selector if we built one. Otherwise fall back
            // to a sentinel attribute. For shadow-hosted elements, we set
            // the sentinel INSIDE the shadow root — downstream helpers
            // must use __ohFind to locate it (plain document.querySelector
            // won't pierce shadow boundaries). __ohFind handles both cases.
            if (shadowHosted || !resolvedSel || document.querySelectorAll(resolvedSel).length !== 1) {
                // Clear any stale sentinels (walk shadow roots too).
                function clearStale() {
                    try {
                        var flat = document.querySelectorAll('[data-oh-target="1"]');
                        for (var s = 0; s < flat.length; s++) flat[s].removeAttribute('data-oh-target');
                    } catch (e) {}
                    if (typeof window.__ohFindAll === 'function') {
                        try {
                            var deep = window.__ohFindAll('[data-oh-target="1"]');
                            for (var d = 0; d < deep.length; d++) deep[d].removeAttribute('data-oh-target');
                        } catch (e) {}
                    }
                }
                clearStale();
                best.setAttribute('data-oh-target', '1');
                resolvedSel = '[data-oh-target="1"]';
            }

            // Activator detection. Run in two scenarios:
            //  1. The chosen editor is hidden (collapsed composer). Look up
            //     the DOM for a visible placeholder to click.
            //  2. The chosen target is VISIBLE but isn't a real editor
            //     (editor_kind === 'unknown') — i.e. the "target" is itself
            //     a trigger wrapper like <faceplate-textarea-input> that,
            //     when clicked, reveals the real Lexical editor elsewhere.
            //     In this case the best element IS the activator.
            var activator_selector = null;
            var activator_text = null;
            var bestKind = editorKind(best);
            var bestIsRealEditor = (bestKind === 'contenteditable' ||
                                    bestKind === 'textarea' ||
                                    bestKind === 'input-text');
            function clearActSentinels() {
                var staleA = document.querySelectorAll('[data-oh-activator="1"]');
                for (var s2 = 0; s2 < staleA.length; s2++) staleA[s2].removeAttribute('data-oh-activator');
            }
            if (!visible(best)) {
                var act = findActivator(best);
                if (act && act.element) {
                    clearActSentinels();
                    act.element.setAttribute('data-oh-activator', '1');
                    activator_selector = '[data-oh-activator="1"]';
                    activator_text = act.text;
                }
            } else if (!bestIsRealEditor) {
                // Visible trigger wrapper. Check if its own text matches the
                // activator regex (Reddit: faceplate-textarea-input with
                // aria-placeholder/placeholder="Join the conversation").
                var selfTxt = activatorText(best);
                if (selfTxt && selfTxt.length < 160 && ACTIVATOR_RX.test(selfTxt)) {
                    clearActSentinels();
                    best.setAttribute('data-oh-activator', '1');
                    activator_selector = '[data-oh-activator="1"]';
                    activator_text = selfTxt.slice(0, 80);
                } else {
                    // Fallback: walk up looking for a sibling with the text.
                    var act2 = findActivator(best);
                    if (act2 && act2.element) {
                        clearActSentinels();
                        act2.element.setAttribute('data-oh-activator', '1');
                        activator_selector = '[data-oh-activator="1"]';
                        activator_text = act2.text;
                    }
                }
            }

            return JSON.stringify({
                selector: resolvedSel,
                tag: (best.tagName || '').toLowerCase(),
                editor_kind: bestKind,
                is_real_editor: bestIsRealEditor,
                placeholder: best.getAttribute('placeholder') || best.getAttribute('aria-placeholder'),
                aria_label: best.getAttribute('aria-label'),
                name: best.getAttribute('name'),
                is_visible: visible(best),
                looks_like_search: looksLikeSearch(best),
                match_count: all.length,
                matched_parts: matched_parts,
                score: bestScore,
                activator_selector: activator_selector,
                activator_text: activator_text,
                is_shadow_hosted: shadowHosted
            });
        })(%s)
        """ % json.dumps(selector)
        try:
            raw = await tab.evaluate(js)
            return json.loads(raw) if raw else {"selector": None, "match_count": 0}
        except Exception as e:
            debug_logger.log_warning(
                "DOMHandler", "_resolve_input_target",
                f"Selector resolution failed: {e}"
            )
            return {"selector": None, "match_count": 0, "error": str(e)}

    # Generic editor fallback selector — used when the original selector
    # points at a composer trigger wrapper (not a real editor) and we need
    # to find the real contenteditable/textarea somewhere else in the DOM.
    _GENERIC_EDITOR_FALLBACK = (
        'textarea:not([readonly]):not([disabled]), '
        '[contenteditable="true"], '
        '[role="textbox"][contenteditable="true"], '
        '[data-lexical-editor="true"]'
    )

    @staticmethod
    async def _click_via_js(tab: Tab, selector: str) -> bool:
        """Click an element via JS cascade. More reliable than tab.select for
        custom elements and shadow-DOM composers."""
        js = (
            "(() => {"
            f"  const el = document.querySelector({json.dumps(selector)});"
            "  if (!el) return false;"
            "  try { el.scrollIntoView({block: 'center'}); } catch(e) {}"
            "  try { el.focus({preventScroll: true}); } catch(e) {}"
            "  try { el.click(); } catch(e) {}"
            "  try {"
            "    const r = el.getBoundingClientRect();"
            "    const cx = r.left + r.width/2, cy = r.top + r.height/2;"
            "    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => {"
            "      const ev = t.startsWith('pointer')"
            "        ? new PointerEvent(t, {bubbles: true, cancelable: true, view: window,"
            "            clientX: cx, clientY: cy, pointerType: 'mouse', isPrimary: true, button: 0})"
            "        : new MouseEvent(t, {bubbles: true, cancelable: true, view: window,"
            "            clientX: cx, clientY: cy, button: 0});"
            "      el.dispatchEvent(ev);"
            "    });"
            "    return true;"
            "  } catch(e) { return false; }"
            "})()"
        )
        try:
            return bool(await tab.evaluate(js))
        except Exception:
            return False

    @staticmethod
    async def _open_collapsed_editor(
        tab: Tab,
        resolved: Dict[str, Any],
        original_selector: str,
    ) -> Dict[str, Any]:
        """Expand a collapsed composer so paste_text can reach the real
        editor.

        Called from paste_text/type_text in two cases:
          1. The chosen target is hidden AND has an `activator_selector`
             (e.g. a Reddit Lexical editor behind a "Join the conversation"
             placeholder).
          2. The chosen target is visible but is a composer *trigger
             wrapper* (editor_kind === 'unknown', is_real_editor === false)
             like <faceplate-textarea-input>. The wrapper itself IS the
             activator — clicking it reveals the real editor.

        After clicking the activator, re-resolves the target. If the
        original selector still doesn't yield a visible real editor (which
        happens when the selector was a selector_hint from find_on_page
        pointing at the trigger wrapper), falls back to a GENERIC editor
        scan across the document and picks the highest-scoring visible
        contenteditable/textarea. This is what makes the Reddit comment
        flow work end-to-end without the agent having to guess selectors.

        Returns the (possibly new) resolved dict. If no activator was
        available and no fallback editor was found, returns the original
        resolved dict unchanged.
        """
        activator = resolved.get("activator_selector")
        if not activator:
            return resolved

        debug_logger.log_info(
            "DOMHandler", "_open_collapsed_editor",
            f"Expanding composer via activator {activator!r} "
            f"(text={resolved.get('activator_text')!r})"
        )

        # Up to 2 click attempts with escalating waits.
        for attempt, wait_s in enumerate([0.6, 1.2]):
            clicked = await DOMHandler._click_via_js(tab, activator)
            if not clicked:
                # Activator element vanished between resolve and click —
                # treat as best-effort and fall through to re-resolve.
                debug_logger.log_warning(
                    "DOMHandler", "_open_collapsed_editor",
                    f"Activator click attempt {attempt + 1} returned false"
                )
            await asyncio.sleep(wait_s)

            # Re-resolve with the ORIGINAL selector first — if the agent
            # gave us a selector that points at the editor itself, we want
            # to use it.
            new_resolved = await DOMHandler._resolve_input_target(
                tab, original_selector
            )
            if (
                new_resolved.get("selector")
                and new_resolved.get("is_visible")
                and new_resolved.get("is_real_editor")
            ):
                new_resolved["activator_clicked"] = True
                new_resolved["activator_text"] = resolved.get("activator_text")
                return new_resolved

            # Fallback: GENERIC editor scan across the whole document.
            # This is the crucial path for Reddit's `comment-composer-host >
            # faceplate-textarea-input[data-testid="trigger-button"]`
            # selector — the trigger wrapper isn't an editor, and after we
            # click it the real Lexical editor appears elsewhere in the
            # subtree. The original selector can't find it; a generic
            # selector can.
            fallback = await DOMHandler._resolve_input_target(
                tab, DOMHandler._GENERIC_EDITOR_FALLBACK
            )
            if (
                fallback.get("selector")
                and fallback.get("is_visible")
                and fallback.get("is_real_editor")
            ):
                fallback["activator_clicked"] = True
                fallback["activator_text"] = resolved.get("activator_text")
                fallback["fallback_editor_used"] = True
                debug_logger.log_info(
                    "DOMHandler", "_open_collapsed_editor",
                    f"Generic editor fallback picked {fallback['selector']} "
                    f"({fallback.get('editor_kind')})"
                )
                return fallback

        # Neither re-resolve nor generic fallback produced a visible
        # editor after 2 attempts. Mark and return.
        resolved["activator_clicked"] = True
        return resolved

    @staticmethod
    async def _read_field_value(tab: Tab, selector: str) -> Optional[str]:
        """Read back the current value/text of an input-like element.

        Works for <input>/<textarea> (.value) and contenteditable
        (.innerText/.textContent). Returns None if the element isn't found.

        Uses the shadow-pierce helper `__ohFind` so this works for elements
        inside open shadow roots (e.g. old reddit login).
        """
        js = (
            "(() => {"
            "  const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
            f"  const el = finder({json.dumps(selector)});"
            "  if (!el) return null;"
            "  if (el.isContentEditable) return el.innerText || el.textContent || '';"
            "  if ('value' in el) return el.value == null ? '' : String(el.value);"
            "  return el.textContent || '';"
            "})()"
        )
        try:
            val = await tab.evaluate(js)
            return val if isinstance(val, str) else (str(val) if val is not None else None)
        except Exception:
            return None

    @staticmethod
    def _build_input_verification(
        expected: str,
        actual: Optional[str],
        resolved: Dict[str, Any],
        original_selector: str,
        action: str,
        method_used: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build the structured verification result returned by paste/type."""
        expected_chars = len(expected)
        inserted_chars = len(actual) if actual is not None else 0
        # Verified if the actual value contains the expected text (allowing
        # for editor-added formatting whitespace). We compare on a
        # whitespace-normalised basis to tolerate Lexical/ProseMirror quirks.
        def _norm(s: str) -> str:
            return re.sub(r"\s+", " ", s or "").strip()
        verified = False
        if actual is not None and expected_chars > 0:
            verified = _norm(expected) in _norm(actual) or (
                expected_chars > 0 and inserted_chars >= expected_chars * 0.95
                and _norm(actual).startswith(_norm(expected)[:40])
            )
        if expected_chars == 0:
            verified = inserted_chars == 0

        preview = (actual or "")[:160]
        resolved_clean = {
            k: resolved.get(k) for k in (
                "selector", "tag", "editor_kind", "is_real_editor",
                "placeholder", "aria_label", "name", "is_visible",
                "looks_like_search", "match_count", "activator_clicked",
                "activator_text", "fallback_editor_used",
            ) if k in resolved
        }
        warnings = []
        if resolved.get("looks_like_search") and expected_chars > 80:
            warnings.append(
                "Target element looks like a search input but you pasted a "
                "long string — did you mean to target a comment/reply field? "
                "Use a more specific selector."
            )
        if resolved.get("match_count", 0) > 1 and "," in original_selector:
            warnings.append(
                f"Union selector matched {resolved['match_count']} elements. "
                f"Resolver picked `{resolved.get('selector')}` "
                f"(kind={resolved.get('editor_kind')}). Prefer a specific "
                "selector next time."
            )
        if not resolved.get("is_visible", True):
            if resolved.get("activator_clicked"):
                warnings.append(
                    "Target editor was collapsed (hidden). An activator "
                    f"({resolved.get('activator_text')!r}) was clicked but the "
                    "editor still reports hidden — the composer may require "
                    "a human gesture (real mouse click) to expand. Try "
                    "`click_element` with the activator selector yourself, "
                    "then call `get_page_digest` to confirm the editor opened "
                    "before retrying paste_text."
                )
            else:
                warnings.append(
                    "Target editor is currently hidden (is_visible=false) and "
                    "no activator/placeholder could be found to expand it. "
                    "On sites like Reddit the comment field is collapsed until "
                    "you click 'Join the conversation'/'Add a comment' — find "
                    "that placeholder in the page digest and click it first."
                )
        if not verified:
            warnings.append(
                f"{action} did NOT verify. Expected {expected_chars} chars, "
                f"field now contains {inserted_chars} chars. The field may "
                "be guarded by a framework (Lexical/ProseMirror) that ignored "
                "the insertion, or the field was not actually focused."
            )

        # Blocker classification — when the agent sees a known blocker it
        # should STOP retrying and report the run as blocked rather than
        # burning turns on techniques that cannot possibly work. We only
        # flag a blocker when the insertion actually failed; a successful
        # paste never needs a blocker hint. These are generic heuristics
        # — the server has no platform-specific bypass logic, it just
        # names the blocker so the agent (and the human reading the run
        # log) can make an informed stop decision.
        blocker: Optional[str] = None
        if not verified:
            editor_kind = resolved.get("editor_kind")
            is_real_editor = resolved.get("is_real_editor", True)
            is_visible = resolved.get("is_visible", True)
            # Lexical/ProseMirror class: a real contenteditable that is
            # visible and focused but still rejects insertions is the
            # classic framework-guarded editor signature (LinkedIn
            # message composer, Slack compose, some Twitter inputs).
            if (
                editor_kind == "contenteditable"
                and is_real_editor
                and is_visible
                and inserted_chars == 0
            ):
                blocker = "contenteditable_editor_rejected_insert"
            # Collapsed-editor class: we resolved to a hidden target and
            # either no activator fired or the activator did not expand
            # the editor. On Reddit this is usually the signup-modal
            # overlay silently swallowing the real editor.
            elif not is_visible and inserted_chars == 0:
                blocker = "editor_hidden_or_overlay"

        result: Dict[str, Any] = {
            "success": verified,
            "verified": verified,
            "expected_chars": expected_chars,
            "inserted_chars": inserted_chars,
            "field_preview": preview,
            "resolved_target": resolved_clean,
            "warnings": warnings,
        }
        if method_used is not None:
            # Records which technique in the paste/type ladder actually
            # landed the text — "execCommand", "input_event",
            # "clipboard_event", "cdp_insert_text", "keyboard_paste", or
            # "react_native_setter". Agents use this to decide whether a
            # framework-guarded editor required a fallback path.
            result["method_used"] = method_used
        if blocker is not None:
            result["blocker"] = blocker
        return result

    @staticmethod
    async def type_text(
        tab: Tab,
        selector: str,
        text: str,
        clear_first: bool = True,
        delay_ms: int = 50,
        parse_newlines: bool = False,
        shift_enter: bool = False,
        humanize: bool = True,
    ) -> Dict[str, Any]:
        """
        Type text with human-like delays and optional newline parsing.

        Args:
            tab (Tab): The browser tab object.
            selector (str): CSS selector for the input element.
            text (str): Text to type.
            clear_first (bool): Clear input before typing.
            delay_ms (int): Delay between keystrokes in milliseconds.
            parse_newlines (bool): If True, parse \n as Enter key presses.
            shift_enter (bool): If True, use Shift+Enter instead of Enter (for chat apps).
            humanize (bool): Use human-like keystroke variance (default True).

        Returns:
            bool: True if typing succeeded, False otherwise.
        """
        try:
            # Smart resolve: pick the best matching writable editor, not just
            # whichever comes first in DOM order.
            resolved = await DOMHandler._resolve_input_target(tab, selector)
            resolved_selector = resolved.get("selector")
            if not resolved_selector:
                raise Exception(
                    f"Element not found (selector matched 0 elements): {selector}"
                )

            # Auto-expand collapsed composers. Run whenever EITHER:
            #   a) the resolved target is hidden (classic collapsed editor), OR
            #   b) the resolved target is visible but is a trigger *wrapper*
            #      (custom element like <faceplate-textarea-input>) rather
            #      than a real writable editor. In case (b) the wrapper is
            #      itself the activator — clicking it reveals the real
            #      Lexical editor elsewhere in the subtree, which the
            #      generic editor fallback will then locate.
            needs_expand = (
                (not resolved.get("is_visible"))
                or (not resolved.get("is_real_editor", True))
            )
            if needs_expand and resolved.get("activator_selector"):
                resolved = await DOMHandler._open_collapsed_editor(
                    tab, resolved, selector
                )
                resolved_selector = resolved.get("selector") or resolved_selector
            elif needs_expand:
                # No activator was detected, but the target isn't a real
                # editor (or is hidden). Try one final generic-editor scan
                # across the document — maybe the composer is already open
                # elsewhere and we just need to find it.
                fallback = await DOMHandler._resolve_input_target(
                    tab, DOMHandler._GENERIC_EDITOR_FALLBACK
                )
                if (
                    fallback.get("selector")
                    and fallback.get("is_visible")
                    and fallback.get("is_real_editor")
                ):
                    fallback["fallback_editor_used"] = True
                    resolved = fallback
                    resolved_selector = fallback["selector"]

            # Guard against pasting long content into a search input by
            # accident (see Run 700f4539: comma-union selector landed on
            # Reddit's search box).
            if resolved.get("looks_like_search") and len(text) > 200:
                raise Exception(
                    f"Refusing to type {len(text)} chars into a search input "
                    f"(resolved={resolved_selector}, name={resolved.get('name')}, "
                    f"placeholder={resolved.get('placeholder')!r}). "
                    "This almost certainly means your selector matched the "
                    "wrong element. Call `find_on_page` with a phrase from "
                    "the real comment field label (e.g. 'Add a comment', "
                    "'Join the conversation') and use its selector_hint."
                )

            selector = resolved_selector
            is_shadow = bool(resolved.get("is_shadow_hosted"))

            # For shadow-hosted targets (Pattern 7 Reddit shadow DOM
            # login): we can't get a native Element handle via
            # `tab.select()` (document.querySelector doesn't pierce
            # shadow boundaries). Fall back to the paste ladder so the
            # text still lands — the diagnostic cost is that humanized
            # typing is skipped on shadow-hosted fields, which is
            # acceptable for login flows.
            if is_shadow:
                _ok, method_used = await DOMHandler._paste_into_contenteditable_ladder(
                    tab, selector, text
                )
                await asyncio.sleep(0.15)
                actual = await DOMHandler._read_field_value(tab, selector)
                if not (actual and text.strip()[:40] in (actual or "")):
                    _ok2, react_method = await DOMHandler._react_native_setter_paste(
                        tab, selector, text
                    )
                    if _ok2:
                        method_used = react_method
                        actual = await DOMHandler._read_field_value(tab, selector)
                return DOMHandler._build_input_verification(
                    expected=text, actual=actual, resolved=resolved,
                    original_selector=selector, action="type_text",
                    method_used=method_used,
                )

            element = await tab.select(selector)
            if not element:
                raise Exception(f"Element not found after resolve: {selector}")

            await element.focus()
            await humanized_sleep(80, 150) if humanize else await asyncio.sleep(0.1)

            is_ce = await DOMHandler._is_contenteditable(tab, selector)

            if clear_first:
                if is_ce:
                    await DOMHandler._clear_contenteditable(tab, selector)
                else:
                    try:
                        await element.apply("(elem) => { elem.value = ''; }")
                    except Exception:
                        await DOMHandler._clear_contenteditable(tab, selector)
                await humanized_sleep(80, 150) if humanize else await asyncio.sleep(0.1)

            # For long text with humanization, use hybrid approach:
            # type the first portion naturally, then paste the rest to avoid timeout.
            HYBRID_THRESHOLD = 800  # chars — beyond this, switch to paste
            TYPED_PREFIX_LEN = 200  # chars typed naturally before pasting

            use_hybrid = humanize and len(text) > HYBRID_THRESHOLD

            if parse_newlines:
                from nodriver import cdp
                lines = text.split('\n')
                for i, line in enumerate(lines):
                    if humanize:
                        await humanized_type(tab, element, line, base_delay_ms=delay_ms)
                    else:
                        for char in line:
                            await element.send_keys(char)
                            await asyncio.sleep(delay_ms / 1000)

                    if i < len(lines) - 1:
                        if is_ce:
                            # For contenteditable: dispatch real key events
                            key_type = "rawKeyDown"
                            modifiers = 1 if shift_enter else 0  # 1 = Shift
                            await tab.send(cdp.input_.dispatch_key_event(
                                key_type, key="Enter", code="Enter",
                                modifiers=modifiers,
                                windows_virtual_key_code=13
                            ))
                            await tab.send(cdp.input_.dispatch_key_event(
                                "keyUp", key="Enter", code="Enter",
                                modifiers=modifiers,
                                windows_virtual_key_code=13
                            ))
                        elif shift_enter:
                            await element.apply('''(elem) => {
                                const start = elem.selectionStart;
                                const end = elem.selectionEnd;
                                const value = elem.value;
                                elem.value = value.substring(0, start) + '\\n' + value.substring(end);
                                elem.selectionStart = elem.selectionEnd = start + 1;
                                elem.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Enter', code: 'Enter',
                                    shiftKey: true, bubbles: true
                                }));
                                elem.dispatchEvent(new Event('input', { bubbles: true }));
                            }''')
                        else:
                            await element.apply('''(elem) => {
                                const start = elem.selectionStart;
                                const end = elem.selectionEnd;
                                const value = elem.value;
                                elem.value = value.substring(0, start) + '\\n' + value.substring(end);
                                elem.selectionStart = elem.selectionEnd = start + 1;
                                elem.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Enter', code: 'Enter',
                                    bubbles: true
                                }));
                                elem.dispatchEvent(new Event('input', { bubbles: true }));
                            }''')
                        await asyncio.sleep(delay_ms / 1000)
            else:
                if use_hybrid:
                    # Type first portion naturally, paste the rest
                    typed_part = text[:TYPED_PREFIX_LEN]
                    pasted_part = text[TYPED_PREFIX_LEN:]
                    await humanized_type(tab, element, typed_part, base_delay_ms=delay_ms)
                    await humanized_sleep(200, 400)
                    # Paste remainder using execCommand or clipboard
                    if is_ce:
                        await DOMHandler._paste_into_contenteditable(
                            tab, selector, pasted_part
                        )
                    else:
                        from nodriver import cdp
                        await tab.send(cdp.input_.insert_text(pasted_part))
                elif humanize:
                    await humanized_type(tab, element, text, base_delay_ms=delay_ms)
                else:
                    for char in text:
                        await element.send_keys(char)
                        await asyncio.sleep(delay_ms / 1000)

            # Verification: read the field back and compare.
            await asyncio.sleep(0.15)
            actual = await DOMHandler._read_field_value(tab, selector)

            # If we typed into a React-controlled input and the field is
            # still empty, fall through to the React native-setter path.
            # This catches the LinkedIn message composer where send_keys /
            # humanized_type fires DOM key events but React's value tracker
            # discards them. Only applies to non-contenteditable inputs.
            if (
                not is_ce
                and text
                and (not actual or text.strip()[:40] not in (actual or ""))
            ):
                _ok, react_method = await DOMHandler._react_native_setter_paste(
                    tab, selector, text
                )
                if _ok:
                    await asyncio.sleep(0.1)
                    actual = await DOMHandler._read_field_value(tab, selector)
                    return DOMHandler._build_input_verification(
                        expected=text,
                        actual=actual,
                        resolved=resolved,
                        original_selector=selector,
                        action="type_text",
                        method_used=react_method,
                    )

            return DOMHandler._build_input_verification(
                expected=text,
                actual=actual,
                resolved=resolved,
                original_selector=selector,
                action="type_text",
            )

        except Exception as e:
            raise Exception(f"Failed to type text: {str(e)}")

    @staticmethod
    async def _is_contenteditable(tab: Tab, selector: str) -> bool:
        """Check if an element is a contenteditable rich text editor.

        Shadow-DOM aware via `window.__ohFind`.
        """
        result = await tab.evaluate(
            '(() => {'
            '  const finder = (window.__ohFind || ((s) => document.querySelector(s)));'
            f'  const el = finder({json.dumps(selector)});'
            '  return el && (el.contentEditable === "true" || el.isContentEditable);'
            '})()'
        )
        return bool(result)

    @staticmethod
    async def _clear_contenteditable(tab: Tab, selector: str) -> None:
        """Clear a contenteditable element using execCommand.

        Shadow-DOM aware via `window.__ohFind`.
        """
        await tab.evaluate(
            '(() => {'
            '  const finder = (window.__ohFind || ((s) => document.querySelector(s)));'
            f'  const el = finder({json.dumps(selector)});'
            '  if (el) { el.focus(); }'
            '  document.execCommand("selectAll", false, null);'
            '  document.execCommand("delete", false, null);'
            '})()'
        )
        await asyncio.sleep(0.1)

    @staticmethod
    async def _paste_into_contenteditable_ladder(
        tab: Tab, selector: str, text: str
    ) -> Tuple[bool, str]:
        """
        Paste text into a contenteditable via a cascading ladder of techniques.

        Each step runs only if the previous one left the field empty (verified
        via `_read_field_value`). Order is fastest-to-slowest:

          1. `document.execCommand('insertText', ...)`
          2. Dispatch a `beforeinput` + `input` InputEvent with
             `inputType: 'insertText'`, `data: text`, `composed: true`.
             Lexical/ProseMirror listen on this path.
          3. Dispatch a `ClipboardEvent('paste')` with a populated
             `DataTransfer`. Many composers have a paste handler.
          4. CDP `Input.insertText` — types through the IME layer.
          5. System clipboard + Cmd/Ctrl+V via CDP `Input.dispatchKeyEvent`.

        Returns `(success, method_used)`. `method_used` names which step
        landed the text (or `"failed"` if none did).

        This is the fix for Pattern 1 (Reddit DM Lexical blocker) in the
        2026-04-12 remediation plan. Framework-guarded editors reject
        `execCommand` but accept the InputEvent/ClipboardEvent paths.
        """
        from nodriver import cdp
        import sys as _sys

        def _norm(s: Optional[str]) -> str:
            return re.sub(r"\s+", " ", s or "").strip()

        expected_norm = _norm(text)

        async def _check() -> bool:
            """Read field value and compare to expected text (normalised)."""
            val = await DOMHandler._read_field_value(tab, selector)
            if val is None:
                return False
            actual_norm = _norm(val)
            if not expected_norm:
                return actual_norm == ""
            if expected_norm in actual_norm:
                return True
            # Tolerate partial matches on long texts (framework may truncate
            # trailing whitespace or paragraph markers).
            if len(expected_norm) > 40 and actual_norm.startswith(expected_norm[:40]):
                return True
            return False

        safe_sel = json.dumps(selector)
        safe_text = json.dumps(text)
        # Shadow-aware element lookup prelude — inlined into each JS step
        # so every paste strategy uses `window.__ohFind` when available,
        # fallback to `document.querySelector`. The resolver path installs
        # __ohFind lazily on first call; direct callers that bypass the
        # resolver (rare) will hit the fallback branch.
        _finder_js = (
            "const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
        )

        # Focus the target first — all steps assume focus.
        try:
            await tab.evaluate(
                f"(() => {{ {_finder_js} const e = finder({safe_sel});"
                f"  if (e) {{ e.focus(); }} }})()"
            )
            await asyncio.sleep(0.05)
        except Exception:
            pass

        # -------- Step 1: execCommand('insertText') --------
        try:
            await tab.evaluate(
                "(() => {"
                f"  {_finder_js}"
                f"  const el = finder({safe_sel});"
                "  if (!el) return false;"
                "  el.focus();"
                f"  return document.execCommand('insertText', false, {safe_text});"
                "})()"
            )
            await asyncio.sleep(0.15)
            if await _check():
                return True, "execCommand"
        except Exception as e:
            print(f"[paste ladder] execCommand step failed: {e}", file=_sys.stderr)

        # -------- Step 2: dispatch InputEvent(beforeinput + input) --------
        try:
            await tab.evaluate(
                "(() => {"
                f"  {_finder_js}"
                f"  const el = finder({safe_sel});"
                "  if (!el) return false;"
                "  el.focus();"
                f"  const txt = {safe_text};"
                "  try {"
                "    const before = new InputEvent('beforeinput', {"
                "      inputType: 'insertText', data: txt,"
                "      bubbles: true, cancelable: true, composed: true"
                "    });"
                "    el.dispatchEvent(before);"
                "    const after = new InputEvent('input', {"
                "      inputType: 'insertText', data: txt,"
                "      bubbles: true, cancelable: false, composed: true"
                "    });"
                "    el.dispatchEvent(after);"
                "    return true;"
                "  } catch (e) { return false; }"
                "})()"
            )
            await asyncio.sleep(0.15)
            if await _check():
                return True, "input_event"
        except Exception as e:
            print(f"[paste ladder] input_event step failed: {e}", file=_sys.stderr)

        # -------- Step 3: dispatch ClipboardEvent('paste') --------
        try:
            await tab.evaluate(
                "(() => {"
                f"  {_finder_js}"
                f"  const el = finder({safe_sel});"
                "  if (!el) return false;"
                "  el.focus();"
                f"  const txt = {safe_text};"
                "  try {"
                "    const dt = new DataTransfer();"
                "    dt.setData('text/plain', txt);"
                "    const ev = new ClipboardEvent('paste', {"
                "      clipboardData: dt, bubbles: true, cancelable: true, composed: true"
                "    });"
                "    try { Object.defineProperty(ev, 'clipboardData', { value: dt }); }"
                "    catch (e) {}"
                "    el.dispatchEvent(ev);"
                "    return true;"
                "  } catch (e) { return false; }"
                "})()"
            )
            await asyncio.sleep(0.2)
            if await _check():
                return True, "clipboard_event"
        except Exception as e:
            print(f"[paste ladder] clipboard_event step failed: {e}", file=_sys.stderr)

        # -------- Step 4: CDP Input.insertText --------
        try:
            await tab.send(cdp.input_.insert_text(text))
            await asyncio.sleep(0.2)
            if await _check():
                return True, "cdp_insert_text"
        except Exception as e:
            print(f"[paste ladder] cdp_insert_text step failed: {e}", file=_sys.stderr)

        # -------- Step 5: System clipboard + Cmd/Ctrl+V --------
        try:
            # Write to navigator clipboard (may fail if permission denied).
            try:
                await tab.evaluate(
                    f"navigator.clipboard && navigator.clipboard.writeText({safe_text})"
                )
            except Exception:
                pass
            await asyncio.sleep(0.05)
            # Cmd+V on macOS (modifier 4 = Meta), fallback to Ctrl+V on other
            # platforms. Sending both is idempotent — extra key presses into a
            # focused contenteditable are harmless if the first worked.
            for modifier in (4, 2):  # Meta, Ctrl
                try:
                    await tab.send(cdp.input_.dispatch_key_event(
                        "rawKeyDown", modifiers=modifier,
                        key="v", code="KeyV", windows_virtual_key_code=86
                    ))
                    await tab.send(cdp.input_.dispatch_key_event(
                        "keyUp", modifiers=modifier,
                        key="v", code="KeyV", windows_virtual_key_code=86
                    ))
                except Exception:
                    pass
                await asyncio.sleep(0.15)
                if await _check():
                    return True, "keyboard_paste"
        except Exception as e:
            print(f"[paste ladder] keyboard_paste step failed: {e}", file=_sys.stderr)

        return False, "failed"

    @staticmethod
    async def _paste_into_contenteditable(tab: Tab, selector: str, text: str) -> bool:
        """Thin wrapper around the paste ladder for callers that only need
        a bool (e.g. `type_text`'s hybrid long-text path)."""
        success, _method = await DOMHandler._paste_into_contenteditable_ladder(
            tab, selector, text
        )
        return success

    @staticmethod
    async def _react_native_setter_paste(
        tab: Tab, selector: str, text: str
    ) -> Tuple[bool, str]:
        """
        Paste text into a React-controlled `<input>` or `<textarea>`.

        React 18 installs a `value` tracker on the prototype. Assigning
        `element.value = x` writes the DOM but the tracker sees no change
        and React never fires `onChange`. The fix is to grab the native
        setter from the prototype descriptor and call it on the element,
        then dispatch a bubbling `input` event.

        Only applies to `<input>`/`<textarea>`/`<select>` — contenteditable
        is handled by the ladder above. Detection heuristic: the target
        must have a property matching `/^__reactFiber/` or
        `/^__reactInternalInstance/` (React 16+).

        Returns `(success, method_used)`. `method_used` is
        `"react_native_setter"` on success, `"react_native_setter_na"` if
        the target isn't a React-controlled input (caller should try
        something else), or `"failed"` if the setter path ran but the
        value didn't land.
        """
        safe_sel = json.dumps(selector)
        safe_text = json.dumps(text)
        # __ohFind is installed lazily by the resolver; this path assumes
        # it's already present. Fallback to document.querySelector via
        # the inline `||` guard if not.
        try:
            result = await tab.evaluate(
                "(() => {"
                "  const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
                f"  const el = finder({safe_sel});"
                "  if (!el) return JSON.stringify({ok: false, reason: 'not_found'});"
                "  const tag = (el.tagName || '').toUpperCase();"
                "  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {"
                "    return JSON.stringify({ok: false, reason: 'wrong_tag', tag});"
                "  }"
                # React fiber detection — presence of any property key
                # starting with __reactFiber or __reactInternalInstance
                # means React owns this element.
                "  let isReact = false;"
                "  for (const k of Object.keys(el)) {"
                "    if (k.indexOf('__reactFiber') === 0 || k.indexOf('__reactInternalInstance') === 0) {"
                "      isReact = true; break;"
                "    }"
                "  }"
                "  if (!isReact) return JSON.stringify({ok: false, reason: 'not_react'});"
                "  try {"
                "    const ctor = tag === 'TEXTAREA' ? HTMLTextAreaElement"
                "               : tag === 'SELECT'   ? HTMLSelectElement"
                "               :                      HTMLInputElement;"
                "    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, 'value');"
                "    if (!desc || !desc.set) return JSON.stringify({ok: false, reason: 'no_setter'});"
                "    el.focus();"
                f"    desc.set.call(el, {safe_text});"
                "    el.dispatchEvent(new Event('input',  { bubbles: true }));"
                "    el.dispatchEvent(new Event('change', { bubbles: true }));"
                "    return JSON.stringify({ok: true, value_length: (el.value || '').length});"
                "  } catch (e) {"
                "    return JSON.stringify({ok: false, reason: 'exception', msg: String(e)});"
                "  }"
                "})()"
            )
            parsed: Dict[str, Any] = {}
            if isinstance(result, str):
                try:
                    parsed = json.loads(result)
                except Exception:
                    parsed = {}
            if not parsed.get("ok"):
                if parsed.get("reason") in ("wrong_tag", "not_react", "not_found", "no_setter"):
                    return False, "react_native_setter_na"
                return False, "failed"
            # Verify the value actually landed.
            await asyncio.sleep(0.1)
            actual = await DOMHandler._read_field_value(tab, selector)
            if actual and text.strip() and text.strip()[:40] in actual:
                return True, "react_native_setter"
            if actual and actual == text:
                return True, "react_native_setter"
            return False, "failed"
        except Exception:
            return False, "react_native_setter_na"

    @staticmethod
    async def paste_text(
        tab: Tab,
        selector: str,
        text: str,
        clear_first: bool = True
    ) -> Dict[str, Any]:
        """
        Paste text instantly. Handles both regular inputs and contenteditable
        rich text editors (Lexical, ProseMirror, etc.).

        Returns a verification dict — NOT a bare bool — so callers can
        confirm the text actually landed in the intended field. Historic
        runs have shown that silently returning `True` masks a whole class
        of "paste succeeded but the editor ignored it" bugs.

        Args:
            tab: The browser tab object.
            selector: CSS selector for the input element. May be a
                comma-separated union; the resolver will pick the best
                writable target and ignore search inputs.
            text: Text to paste.
            clear_first: Clear input before pasting.

        Returns:
            {
              "success": bool,            # True iff text was verified in field
              "verified": bool,           # same as success
              "expected_chars": int,
              "inserted_chars": int,      # chars actually in the field after paste
              "field_preview": str,       # first 160 chars of the field
              "resolved_target": {...},   # which element the resolver picked
              "warnings": [str, ...]      # actionable warnings for the agent
            }
        """
        from nodriver import cdp

        try:
            # Smart resolve: prefer contenteditable > textarea > non-search input.
            resolved = await DOMHandler._resolve_input_target(tab, selector)
            resolved_selector = resolved.get("selector")
            if not resolved_selector:
                raise Exception(
                    f"Element not found (selector matched 0 elements): {selector}"
                )

            # Auto-expand collapsed composers. Run whenever EITHER:
            #   a) the resolved target is hidden (classic collapsed editor), OR
            #   b) the resolved target is visible but is a trigger *wrapper*
            #      (custom element like <faceplate-textarea-input>) rather
            #      than a real writable editor. In case (b) the wrapper is
            #      itself the activator — clicking it reveals the real
            #      Lexical editor elsewhere in the subtree, which the
            #      generic editor fallback will then locate.
            needs_expand = (
                (not resolved.get("is_visible"))
                or (not resolved.get("is_real_editor", True))
            )
            if needs_expand and resolved.get("activator_selector"):
                resolved = await DOMHandler._open_collapsed_editor(
                    tab, resolved, selector
                )
                resolved_selector = resolved.get("selector") or resolved_selector
            elif needs_expand:
                # No activator was detected, but the target isn't a real
                # editor (or is hidden). Try one final generic-editor scan
                # across the document — maybe the composer is already open
                # elsewhere and we just need to find it.
                fallback = await DOMHandler._resolve_input_target(
                    tab, DOMHandler._GENERIC_EDITOR_FALLBACK
                )
                if (
                    fallback.get("selector")
                    and fallback.get("is_visible")
                    and fallback.get("is_real_editor")
                ):
                    fallback["fallback_editor_used"] = True
                    resolved = fallback
                    resolved_selector = fallback["selector"]

            # Guard rail: comma-union selectors on modern SPAs routinely land
            # on the global search input first. Pasting a long comment into
            # `<input name="q">` is always wrong — refuse fast so the agent
            # has to go back and pick a real target.
            if resolved.get("looks_like_search") and len(text) > 200:
                raise Exception(
                    f"Refusing to paste {len(text)} chars into a search input "
                    f"(resolved={resolved_selector}, name={resolved.get('name')}, "
                    f"placeholder={resolved.get('placeholder')!r}). "
                    "This almost certainly means your selector matched the "
                    "wrong element. Use `find_on_page` with a phrase from "
                    "the real comment/reply field's visible label and pass "
                    "its selector_hint to paste_text."
                )

            resolved_for_use = resolved
            selector = resolved_selector
            is_shadow = bool(resolved.get("is_shadow_hosted"))

            # For flat-DOM targets: use nodriver's tab.select() for a
            # native Element handle (enables .focus()/.apply() convenience
            # methods). For shadow-hosted targets (Pattern 7 Reddit
            # login): tab.select() uses document.querySelector internally
            # which can't pierce shadow boundaries, so skip it and do
            # focus/clear via JS through __ohFind.
            element = None
            if not is_shadow:
                element = await tab.select(selector)
                if not element:
                    raise Exception(f"Element not found after resolve: {selector}")
                await element.focus()
                await asyncio.sleep(0.1)
            else:
                # Shadow-hosted focus via JS.
                await tab.evaluate(
                    "(() => {"
                    "  const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
                    f"  const el = finder({json.dumps(selector)});"
                    "  if (el && el.focus) el.focus();"
                    "})()"
                )
                await asyncio.sleep(0.1)

            is_ce = await DOMHandler._is_contenteditable(tab, selector)

            if clear_first:
                if is_ce:
                    await DOMHandler._clear_contenteditable(tab, selector)
                else:
                    if element is not None:
                        try:
                            await element.apply("(elem) => { elem.value = ''; }")
                        except Exception:
                            await DOMHandler._clear_contenteditable(tab, selector)
                    else:
                        # Shadow-hosted <input>/<textarea>: clear via JS.
                        await tab.evaluate(
                            "(() => {"
                            "  const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
                            f"  const el = finder({json.dumps(selector)});"
                            "  if (el && 'value' in el) el.value = '';"
                            "})()"
                        )
                    await asyncio.sleep(0.1)

            method_used: str = "unknown"
            if is_ce:
                # Cascading 5-step ladder:
                # execCommand → InputEvent → ClipboardEvent → CDP insertText → keyboard.
                # Each step verifies via read-back before falling through.
                _ok, method_used = await DOMHandler._paste_into_contenteditable_ladder(
                    tab, selector, text
                )
            else:
                # For <input>/<textarea>: try CDP Input.insertText first (the
                # simple path that works for plain inputs), then fall through
                # to the React native-setter trick if the field is
                # React-controlled and the first attempt didn't land.
                await tab.send(cdp.input_.insert_text(text))
                method_used = "cdp_insert_text"
                await asyncio.sleep(0.15)
                read1 = await DOMHandler._read_field_value(tab, selector)
                if not read1 or (text and text[:40].strip() not in (read1 or "")):
                    # React-controlled input? Try the native setter trick.
                    _ok2, react_method = await DOMHandler._react_native_setter_paste(
                        tab, selector, text
                    )
                    if _ok2:
                        method_used = react_method

            # Verification: read the field back. For Lexical/ProseMirror,
            # execCommand may silently no-op — the read-back is the only
            # reliable signal.
            await asyncio.sleep(0.2)
            actual = await DOMHandler._read_field_value(tab, selector)

            # Round 12 (2026-04-13): retry pass for the common Reddit
            # failure mode captured in Run 9 — paste_text returned
            # `verified: false, inserted_chars: 0` even though the
            # activator was clicked and the fallback editor was found.
            # Root cause: the real Lexical editor was still mounting when
            # the ladder fired. A single re-resolve + re-paste pass fixes
            # this ~90% of the time, so we now do it inline before
            # returning the failure dict.
            inserted = len(actual or "")
            if inserted == 0 and text and (
                resolved_for_use.get("fallback_editor_used")
                or resolved_for_use.get("activator_clicked")
            ):
                debug_logger.log_info(
                    "DOMHandler", "paste_text",
                    "First pass inserted 0 chars after activator click — "
                    "waiting 800ms and retrying with a fresh resolve"
                )
                await asyncio.sleep(0.8)
                try:
                    retry_resolved = await DOMHandler._resolve_input_target(
                        tab, DOMHandler._GENERIC_EDITOR_FALLBACK
                    )
                    if (
                        retry_resolved.get("selector")
                        and retry_resolved.get("is_visible")
                        and retry_resolved.get("is_real_editor")
                    ):
                        retry_resolved["fallback_editor_used"] = True
                        retry_resolved["retry_pass"] = True
                        retry_selector = retry_resolved["selector"]
                        # Re-focus + re-type using the same ladder.
                        await tab.evaluate(
                            "(() => {"
                            "  const finder = (window.__ohFind || ((s) => document.querySelector(s)));"
                            f"  const el = finder({json.dumps(retry_selector)});"
                            "  if (el && el.focus) el.focus();"
                            "})()"
                        )
                        await asyncio.sleep(0.15)
                        retry_is_ce = await DOMHandler._is_contenteditable(
                            tab, retry_selector
                        )
                        if retry_is_ce:
                            _ok2, retry_method = await DOMHandler._paste_into_contenteditable_ladder(
                                tab, retry_selector, text
                            )
                            if _ok2:
                                method_used = f"{retry_method} (retry pass)"
                        else:
                            await tab.send(cdp.input_.insert_text(text))
                            method_used = "cdp_insert_text (retry pass)"
                        await asyncio.sleep(0.2)
                        retry_actual = await DOMHandler._read_field_value(
                            tab, retry_selector
                        )
                        if retry_actual and len(retry_actual) > 0:
                            actual = retry_actual
                            resolved_for_use = retry_resolved
                            selector = retry_selector
                            debug_logger.log_info(
                                "DOMHandler", "paste_text",
                                f"Retry pass succeeded: inserted "
                                f"{len(retry_actual)} chars via {method_used}"
                            )
                except Exception as retry_err:
                    debug_logger.log_warning(
                        "DOMHandler", "paste_text",
                        f"Retry pass failed (non-fatal): {retry_err}"
                    )

            return DOMHandler._build_input_verification(
                expected=text,
                actual=actual,
                resolved=resolved_for_use,
                original_selector=selector,
                action="paste_text",
                method_used=method_used,
            )

        except Exception as e:
            raise Exception(f"Failed to paste text: {str(e)}")

    @staticmethod
    async def select_option(
        tab: Tab,
        selector: str,
        value: Optional[str] = None,
        text: Optional[str] = None,
        index: Optional[int] = None
    ) -> bool:
        """
        Select option from dropdown using nodriver's native methods.

        Args:
            tab (Tab): The browser tab object.
            selector (str): CSS selector for the select element.
            value (Optional[str]): Option value to select.
            text (Optional[str]): Option text to select.
            index (Optional[int]): Option index to select.

        Returns:
            bool: True if option selected, False otherwise.
        """
        try:
            select_element = await tab.select(selector)
            if not select_element:
                raise Exception(f"Select element not found: {selector}")

            if text is not None:
                await select_element.send_keys(text)
                return True

            if value is not None:
                safe_selector = json.dumps(selector)
                safe_value = json.dumps(value)
                await tab.evaluate(f"""
                    const select = document.querySelector({safe_selector});
                    if (select) {{
                        select.value = {safe_value};
                        select.dispatchEvent(new Event('change', {{bubbles: true}}));
                    }}
                """)
                return True

            elif index is not None:
                safe_selector = json.dumps(selector)
                safe_index = int(index)
                await tab.evaluate(f"""
                    const select = document.querySelector({safe_selector});
                    if (select && {safe_index} >= 0 && {safe_index} < select.options.length) {{
                        select.selectedIndex = {safe_index};
                        select.dispatchEvent(new Event('change', {{bubbles: true}}));
                    }}
                """)
                return True

            raise Exception("No selection criteria provided (value, text, or index)")

        except Exception as e:
            raise Exception(f"Failed to select option: {str(e)}")

    @staticmethod
    async def get_element_state(
        tab: Tab,
        selector: str
    ) -> Dict[str, Any]:
        """
        Get complete state of an element.

        Args:
            tab (Tab): The browser tab object.
            selector (str): CSS selector for the element.

        Returns:
            Dict[str, Any]: Dictionary of element state properties.
        """
        try:
            element = await tab.select(selector)
            if not element:
                raise Exception(f"Element not found: {selector}")

            if hasattr(element, 'update'):
                await element.update()

            state = {
                'tag_name': element.tag_name if hasattr(element, 'tag_name') else 'unknown',
                'text': element.text if hasattr(element, 'text') else '',
                'text_all': element.text_all if hasattr(element, 'text_all') else '',
                'attributes': element.attrs if hasattr(element, 'attrs') else {},
                'is_visible': True,
                'is_clickable': False,
                'is_enabled': True,
                'value': element.attrs.get('value') if hasattr(element, 'attrs') else None,
                'href': element.attrs.get('href') if hasattr(element, 'attrs') else None,
                'src': element.attrs.get('src') if hasattr(element, 'attrs') else None,
                'class': element.attrs.get('class') if hasattr(element, 'attrs') else None,
                'id': element.attrs.get('id') if hasattr(element, 'attrs') else None,
                'position': await element.get_position() if hasattr(element, 'get_position') else None,
                'computed_style': {},
                'children_count': len(element.children) if hasattr(element, 'children') and element.children else 0,
                'parent_tag': None
            }

            return state

        except Exception as e:
            raise Exception(f"Failed to get element state: {str(e)}")

    @staticmethod
    async def wait_for_element(
        tab: Tab,
        selector: str,
        timeout: int = 30000,
        visible: bool = True,
        text_content: Optional[str] = None
    ) -> bool:
        """
        Wait for element to appear and match conditions.

        Args:
            tab (Tab): The browser tab object.
            selector (str): CSS selector for the element.
            timeout (int): Timeout in milliseconds.
            visible (bool): Wait for element to be visible.
            text_content (Optional[str]): Wait for element to contain text.

        Returns:
            bool: True if element matches conditions, False otherwise.
        """
        start_time = time.time()
        timeout_seconds = timeout / 1000

        while time.time() - start_time < timeout_seconds:
            try:
                element = await tab.select(selector)

                if element:
                    if visible:
                        try:
                            is_visible = await element.apply(
                                """(elem) => {
                                    var style = window.getComputedStyle(elem);
                                    return style.display !== 'none' && 
                                           style.visibility !== 'hidden' && 
                                           style.opacity !== '0';
                                }"""
                            )
                            if not is_visible:
                                await asyncio.sleep(0.5)
                                continue
                        except:
                            pass

                    if text_content:
                        text = element.text_all
                        if text_content not in text:
                            await asyncio.sleep(0.5)
                            continue

                    return True

            except Exception:
                pass

            await asyncio.sleep(0.5)

        return False

    @staticmethod
    async def execute_script(
        tab: Tab,
        script: str,
        args: Optional[List[Any]] = None
    ) -> Any:
        """
        Execute JavaScript in page context.

        Args:
            tab (Tab): The browser tab object.
            script (str): JavaScript code to execute.
            args (Optional[List[Any]]): Arguments for the script.

        Returns:
            Any: Result of script execution.
        """
        try:
            if args:
                serialized_args = ",".join(json.dumps(a) for a in args)
                result = await tab.evaluate(f'(function() {{ {script} }})({serialized_args})')
            else:
                try:
                    result = await tab.evaluate(script)
                except Exception as inner_e:
                    # LLM-generated scripts often use `return` at top level, which is
                    # invalid in bare eval context. Wrap in IIFE and retry — this also
                    # gives each script its own scope, preventing variable redeclaration
                    # errors across multiple sequential evaluate() calls on the same tab.
                    if "Illegal return statement" in str(inner_e) or "SyntaxError" in str(inner_e):
                        result = await tab.evaluate(f'(function() {{ {script} }})()')
                    else:
                        raise

            return result

        except Exception as e:
            raise Exception(f"Failed to execute script: {str(e)}")

    @staticmethod
    async def get_page_content(
        tab: Tab,
        include_frames: bool = False
    ) -> Dict[str, str]:
        """
        Get page HTML and text content.

        Args:
            tab (Tab): The browser tab object.
            include_frames (bool): Include iframe contents.

        Returns:
            Dict[str, str]: Dictionary with page content.
        """
        try:
            html = await tab.get_content()
            text = await tab.evaluate("document.body.innerText")

            content = {
                'html': html,
                'text': text,
                'url': await tab.evaluate("window.location.href"),
                'title': await tab.evaluate("document.title")
            }

            if include_frames:
                frames = []
                iframe_elements = await tab.select_all('iframe')

                for i, iframe in enumerate(iframe_elements):
                    try:
                        src = iframe.attrs.get('src') if hasattr(iframe, 'attrs') else None
                        if src:
                            frames.append({
                                'index': i,
                                'src': src,
                                'id': iframe.attrs.get('id') if hasattr(iframe, 'attrs') else None,
                                'name': iframe.attrs.get('name') if hasattr(iframe, 'attrs') else None
                            })
                    except Exception:
                        continue

                content['frames'] = frames

            return content

        except Exception as e:
            raise Exception(f"Failed to get page content: {str(e)}")

    @staticmethod
    async def scroll_page(
        tab: Tab,
        direction: str = "down",
        amount: int = 500,
        smooth: bool = True,
        percent: Optional[float] = None,
        wait_for_content: bool = False,
        timeout_ms: int = 3000,
    ) -> Dict[str, Any]:
        """
        Scroll the page and return scroll position metrics.

        Args:
            tab: The browser tab object.
            direction: Direction ('down', 'up', 'right', 'left', 'top', 'bottom').
            amount: Pixels to scroll (ignored when percent is set).
            smooth: Use smooth scrolling.
            percent: Scroll to this percentage of the page (0-100).
            wait_for_content: Wait for lazy-loaded content after scrolling.
            timeout_ms: Max time to wait for lazy content (ms).

        Returns:
            Dict with scroll metrics: success, before/after positions,
            position_percent, at_top, at_bottom, content_grew, pages_remaining.
        """
        try:
            # Capture metrics before scrolling.
            # Use JSON.stringify to ensure we get a plain Python dict
            # (nodriver's evaluate can return opaque objects for JS objects).
            _metrics_js = """JSON.stringify({
                scroll_top: Math.round(window.scrollY),
                scroll_height: document.body.scrollHeight,
                viewport_height: window.innerHeight
            })"""
            before = json.loads(await tab.evaluate(f"(() => {_metrics_js})()"))

            behavior = "'smooth'" if smooth else "'instant'"

            if percent is not None:
                target = f"Math.round(document.body.scrollHeight * {percent} / 100)"
                script = f"window.scrollTo({{top: {target}, behavior: {behavior}}})"
            elif direction == "down":
                script = f"window.scrollBy({{top: {amount}, left: 0, behavior: {behavior}}})"
            elif direction == "up":
                script = f"window.scrollBy({{top: -{amount}, left: 0, behavior: {behavior}}})"
            elif direction == "right":
                script = f"window.scrollBy({{top: 0, left: {amount}, behavior: {behavior}}})"
            elif direction == "left":
                script = f"window.scrollBy({{top: 0, left: -{amount}, behavior: {behavior}}})"
            elif direction == "top":
                script = f"window.scrollTo({{top: 0, left: 0, behavior: {behavior}}})"
            elif direction == "bottom":
                script = f"window.scrollTo({{top: document.body.scrollHeight, left: 0, behavior: {behavior}}})"
            else:
                raise ValueError(f"Invalid scroll direction: {direction}")

            await tab.evaluate(script)
            await asyncio.sleep(0.5 if smooth else 0.1)

            # Optionally wait for lazy-loaded content
            content_grew = False
            if wait_for_content:
                pre_height = await tab.evaluate("document.body.scrollHeight")
                elapsed = 0
                poll_interval = 0.2
                while elapsed * 1000 < timeout_ms:
                    await asyncio.sleep(poll_interval)
                    elapsed += poll_interval
                    cur_height = await tab.evaluate("document.body.scrollHeight")
                    if cur_height > pre_height:
                        content_grew = True
                        await asyncio.sleep(0.3)
                        break

            after = json.loads(await tab.evaluate(f"(() => {_metrics_js})()"))

            sh = max(after["scroll_height"], 1)
            vh = after["viewport_height"]
            st = after["scroll_top"]
            pct = round(st / max(sh - vh, 1) * 100, 1) if sh > vh else 0
            remaining = max(0, ceil((sh - st - vh) / max(vh, 1)))

            return {
                "success": True,
                "before": before,
                "after": after,
                "position_percent": min(pct, 100),
                "at_top": st <= 1,
                "at_bottom": st + vh >= sh - 1,
                "content_grew": content_grew,
                "pages_remaining": remaining,
            }

        except Exception as e:
            raise Exception(f"Failed to scroll page: {str(e)}")