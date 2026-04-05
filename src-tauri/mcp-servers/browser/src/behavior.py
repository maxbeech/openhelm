"""
Behavioral variance for human-like browser interaction.

Provides humanized delays, Bezier mouse paths, keystroke variance, and
scroll jitter. Separate from stealth.py — stealth handles static JS
fingerprint patches (runs once per page load), while this module handles
dynamic interaction patterns (runs on every click/type/scroll).

Set OPENHELM_DETERMINISTIC=1 to disable randomness for test stability.
"""

import asyncio
import math
import os
import random
from typing import List, Optional, Tuple

import nodriver as uc

_DETERMINISTIC = os.environ.get("OPENHELM_DETERMINISTIC", "") == "1"


def _rand() -> float:
    """Return random float 0-1, or 0.5 in deterministic mode."""
    return 0.5 if _DETERMINISTIC else random.random()


def _gauss(mu: float, sigma: float) -> float:
    """Return gaussian random, or mu in deterministic mode."""
    return mu if _DETERMINISTIC else random.gauss(mu, sigma)


# ------------------------------------------------------------------
# Delay helpers
# ------------------------------------------------------------------


def humanized_delay_seconds(min_ms: float = 100, max_ms: float = 500) -> float:
    """
    Return a human-like delay in seconds (truncated normal distribution).

    Humans cluster around the mean — uniform random is too flat. We use a
    normal distribution centered at the midpoint and clamp to [min, max].
    """
    if _DETERMINISTIC:
        return (min_ms + max_ms) / 2 / 1000

    mu = (min_ms + max_ms) / 2
    sigma = (max_ms - min_ms) / 4  # ~95% of values within range
    delay_ms = _gauss(mu, sigma)
    delay_ms = max(min_ms, min(max_ms, delay_ms))
    return delay_ms / 1000


async def humanized_sleep(min_ms: float = 100, max_ms: float = 500) -> None:
    """Sleep for a human-like duration."""
    await asyncio.sleep(humanized_delay_seconds(min_ms, max_ms))


# ------------------------------------------------------------------
# Bezier mouse movement
# ------------------------------------------------------------------


def _cubic_bezier(
    t: float,
    p0: Tuple[float, float],
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    p3: Tuple[float, float],
) -> Tuple[float, float]:
    """Evaluate cubic Bezier curve at parameter t."""
    u = 1 - t
    x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
    y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
    return (x, y)


def bezier_mouse_path(
    start: Tuple[float, float],
    end: Tuple[float, float],
    steps: int = 20,
) -> List[Tuple[float, float]]:
    """
    Generate a human-like mouse path using a cubic Bezier curve.

    Two random control points create the natural arc humans make when
    moving a mouse — never a straight line.
    """
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dist = math.sqrt(dx**2 + dy**2)

    # Control points offset perpendicular to the line, scaled by distance
    spread = max(30, dist * 0.3)
    cp1 = (
        start[0] + dx * 0.25 + (_rand() - 0.5) * spread,
        start[1] + dy * 0.25 + (_rand() - 0.5) * spread,
    )
    cp2 = (
        start[0] + dx * 0.75 + (_rand() - 0.5) * spread,
        start[1] + dy * 0.75 + (_rand() - 0.5) * spread,
    )

    points = []
    for i in range(steps + 1):
        t = i / steps
        points.append(_cubic_bezier(t, start, cp1, cp2, end))
    return points


async def move_mouse_human(
    tab,
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    steps: int = 20,
) -> None:
    """
    Move the mouse along a Bezier curve path, dispatching CDP mouse events.

    Each segment has slight speed variance (80-120% of base inter-step delay).
    """
    path = bezier_mouse_path((from_x, from_y), (to_x, to_y), steps=steps)
    base_delay = humanized_delay_seconds(3, 8)  # 3-8ms per step

    for x, y in path:
        await tab.send(uc.cdp.input_.dispatch_mouse_event(
            type_="mouseMoved",
            x=x,
            y=y,
        ))
        # Per-step speed variance
        step_delay = base_delay * (0.8 + _rand() * 0.4)
        await asyncio.sleep(step_delay)


# ------------------------------------------------------------------
# Click helpers
# ------------------------------------------------------------------


async def humanized_click(tab, element) -> None:
    """
    Click an element with human-like behavior:
    1. Scroll into view
    2. Random pre-click delay (100-400ms)
    3. Move mouse along Bezier curve to element center
    4. Small pause before click (30-100ms)
    5. Click
    """
    await element.scroll_into_view()
    await humanized_sleep(100, 400)

    # Get element bounding box for mouse target
    try:
        box = await element.get_position()
        if box:
            center_x = box.x + box.width / 2 + (_rand() - 0.5) * box.width * 0.2
            center_y = box.y + box.height / 2 + (_rand() - 0.5) * box.height * 0.2

            # Start from a random nearby position
            start_x = center_x + (_rand() - 0.5) * 200
            start_y = center_y + (_rand() - 0.5) * 150

            await move_mouse_human(tab, start_x, start_y, center_x, center_y)
            await humanized_sleep(30, 100)
    except Exception:
        # Fallback: just scroll and pause if position not available
        await humanized_sleep(200, 500)

    try:
        await element.click()
    except Exception:
        await element.mouse_click()


# ------------------------------------------------------------------
# Typing helpers
# ------------------------------------------------------------------


async def humanized_type(
    tab,
    element,
    text: str,
    base_delay_ms: float = 50,
) -> None:
    """
    Type text with human-like keystroke timing.

    Features:
    - Per-keystroke delay variance (70-130% of base)
    - Occasional "thinking pauses" (300-800ms, ~10% probability)
    - Slightly faster for common letter sequences
    """
    for i, char in enumerate(text):
        await element.send_keys(char)

        # Base delay with variance
        variance = 0.7 + _rand() * 0.6  # 0.7 to 1.3
        delay = base_delay_ms * variance / 1000

        # Occasional thinking pause (~10% chance, not on first char)
        if i > 0 and _rand() < 0.10:
            delay += humanized_delay_seconds(300, 800)

        await asyncio.sleep(delay)


# ------------------------------------------------------------------
# Scroll helpers
# ------------------------------------------------------------------


def jittered_scroll(base_amount: int) -> int:
    """Add +-15% variance to a scroll amount."""
    jitter = 1.0 + (_rand() - 0.5) * 0.3  # 0.85 to 1.15
    return int(base_amount * jitter)
