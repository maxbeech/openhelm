"""
Haiku vision fallback for CAPTCHA detection.

Only invoked when URL signals suggest a challenge page but DOM/body-text
patterns found nothing (the rare case of a fully custom challenge page).
Costs ~$0.001-0.003 per check. Gracefully skips if ANTHROPIC_API_KEY is unset.
"""

import asyncio
import os
from typing import Any, Optional

import requests as http

_API_URL = "https://api.anthropic.com/v1/messages"
_MODEL = "claude-haiku-4-5-20251001"
_PROMPT = (
    "Does this browser page show a CAPTCHA, robot verification, anti-bot "
    "challenge, or access-blocked screen that prevents normal use? "
    "Answer only YES or NO."
)


async def check_with_haiku(tab: Any) -> bool:
    """
    Take a screenshot and ask Haiku whether it shows a CAPTCHA/challenge.

    Returns True if Haiku says yes, False otherwise (including on errors or
    missing API key — fail-open, do not block the caller).
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return False

    try:
        screenshot_b64 = await _capture_screenshot_b64(tab)
        if not screenshot_b64:
            return False
        return await asyncio.to_thread(_call_haiku, api_key, screenshot_b64)
    except Exception:
        return False  # fail-open: don't block if Haiku is unavailable


async def _capture_screenshot_b64(tab: Any) -> Optional[str]:
    """Capture a PNG screenshot and return as base64 string."""
    try:
        import nodriver as uc
        result = await tab.send(uc.cdp.page.capture_screenshot(format_="png"))
        return result.data  # already base64-encoded PNG
    except Exception:
        return None


def _call_haiku(api_key: str, image_b64: str) -> bool:
    """Synchronous Anthropic API call (run via asyncio.to_thread)."""
    resp = http.post(
        _API_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": _MODEL,
            "max_tokens": 5,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
        },
        timeout=20,
    )
    if resp.status_code != 200:
        return False
    text = resp.json().get("content", [{}])[0].get("text", "").strip().upper()
    return text.startswith("YES")
