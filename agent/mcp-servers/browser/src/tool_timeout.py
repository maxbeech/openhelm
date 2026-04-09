"""
Per-tool-call timeout decorator for MCP tool handlers.

Wraps async tool handlers with asyncio.wait_for() to prevent indefinite hangs.
When a tool exceeds its timeout, raises an Exception that FastMCP converts to
a proper MCP error response — this lets Claude Code see the failure and try a
different approach, rather than going silent and triggering the 600s silence timeout.
"""

import asyncio
import functools
from typing import Any, Callable, Coroutine

# Tools that get an extended timeout (heavy operations)
EXTENDED_TIMEOUT_TOOLS = frozenset({
    "take_screenshot",
    "clone_element_complete",
    "clone_element_progressive",
    "clone_element_to_file",
    "extract_complete_element_cdp",
    "extract_complete_element_to_file",
    "get_page_content",
    "get_page_digest",
    "find_on_page",
    "find_by_role",
    "navigate",
    "click_element",
    "paste_text",
})

# Tools that need a long timeout (character-by-character typing can take minutes)
LONG_TIMEOUT_TOOLS = frozenset({
    "type_text",
})

DEFAULT_TIMEOUT_S = 60
EXTENDED_TIMEOUT_S = 120
LONG_TIMEOUT_S = 300


def with_timeout(timeout_s: float | None = None):
    """
    Decorator that wraps an async function with asyncio.wait_for().

    If timeout_s is None, auto-selects based on the function name:
    - Functions in LONG_TIMEOUT_TOOLS get LONG_TIMEOUT_S (300s)
    - Functions in EXTENDED_TIMEOUT_TOOLS get EXTENDED_TIMEOUT_S (120s)
    - All others get DEFAULT_TIMEOUT_S (60s)

    On timeout, raises an Exception so FastMCP returns a proper MCP error.
    """

    def decorator(func: Callable[..., Coroutine]) -> Callable[..., Coroutine]:
        effective = timeout_s
        if effective is None:
            if func.__name__ in LONG_TIMEOUT_TOOLS:
                effective = LONG_TIMEOUT_S
            elif func.__name__ in EXTENDED_TIMEOUT_TOOLS:
                effective = EXTENDED_TIMEOUT_S
            else:
                effective = DEFAULT_TIMEOUT_S

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await asyncio.wait_for(
                    func(*args, **kwargs), timeout=effective
                )
            except asyncio.TimeoutError:
                raise Exception(
                    f"Tool '{func.__name__}' timed out after {effective}s. "
                    f"The browser operation took too long — try a simpler "
                    f"approach or check if the browser is responding."
                )
            # Let other exceptions propagate naturally — FastMCP's built-in
            # error handling will return a proper MCP error response.

        return wrapper

    return decorator
