"""
Stealth JS patches injected via Page.addScriptToEvaluateOnNewDocument.

Patches are stored as external JS files in the js/ directory (stealth_*.js).
They are concatenated into a single IIFE and injected before any page script
on every navigation, so they cannot be bypassed by the page itself.

The loader also injects:
  - A per-session random seed (__STEALTH_SEED__) for consistent fingerprint
    noise within a session but different across sessions.
  - Platform-specific WebGL renderer/vendor strings so fingerprints match
    the real hardware.

Chrome launch args
------------------
get_stealth_args() returns args that complement the JS patches at the C++ level:
  --disable-blink-features=AutomationControlled  (removes the JS webdriver flag)
  --disable-infobars                             (no "controlled by automation" bar)
"""

import platform
import random
from pathlib import Path
from typing import List

import nodriver as uc


# ---------------------------------------------------------------------------
# Monkey-patch: nodriver 0.47 Cookie.from_json crashes on Chrome 131+
# because Chrome removed the 'sameParty' field from CDP cookie responses.
# The original code uses json['sameParty'] (hard access); we patch it to
# use json.get('sameParty', False) so cookies parse without error.
# ---------------------------------------------------------------------------
try:
    _orig_cookie_from_json = uc.cdp.network.Cookie.from_json.__func__

    @classmethod  # type: ignore[misc]
    def _patched_cookie_from_json(cls, json):
        json.setdefault("sameParty", False)
        return _orig_cookie_from_json(cls, json)

    uc.cdp.network.Cookie.from_json = _patched_cookie_from_json
except Exception:
    pass  # If nodriver API changed, skip — the fix isn't needed


# ---------------------------------------------------------------------------
# Chrome launch-arg additions (complement the JS patches at C++ level)
# ---------------------------------------------------------------------------

STEALTH_CHROME_ARGS: List[str] = [
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-features=ChromeWhatsNewUI",
    # Disable background throttling — prevents CDP timeouts on inactive tabs
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    # Reduce memory pressure on heavy SPAs (prevents CDP socket drops)
    "--disable-features=TranslateUI",
    "--disable-ipc-flooding-protection",
    # Disable hang monitor that can kill unresponsive renderers
    "--disable-hang-monitor",
    # Shared memory fallback for containers (harmless on desktop)
    "--disable-dev-shm-usage",
    # Increase shared memory limit for large pages
    "--disable-features=VizDisplayCompositor",
    # Keep CDP connection alive during heavy page loads
    "--enable-features=NetworkServiceInProcess",
]


def get_stealth_args() -> List[str]:
    """Return extra Chrome launch args needed for stealth operation."""
    return list(STEALTH_CHROME_ARGS)


# ---------------------------------------------------------------------------
# Platform-specific fingerprint profile
# ---------------------------------------------------------------------------

def _get_stealth_profile() -> dict:
    """Return platform-appropriate fingerprint values for WebGL etc."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        if "arm" in machine:
            return {
                "WEBGL_VENDOR": "Google Inc. (Apple)",
                "WEBGL_RENDERER": "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
            }
        return {
            "WEBGL_VENDOR": "Google Inc. (Intel Inc.)",
            "WEBGL_RENDERER": "ANGLE (Intel Inc., Intel Iris OpenGL Engine, OpenGL 4.1)",
        }
    if system == "linux":
        return {
            "WEBGL_VENDOR": "Google Inc. (Mesa)",
            "WEBGL_RENDERER": "ANGLE (Mesa, llvmpipe, OpenGL 4.5)",
        }
    # Windows default
    return {
        "WEBGL_VENDOR": "Google Inc. (NVIDIA)",
        "WEBGL_RENDERER": "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)",
    }


# ---------------------------------------------------------------------------
# JS file loader — reads js/stealth_*.js, concatenates into IIFE
# ---------------------------------------------------------------------------

_JS_DIR = Path(__file__).parent / "js"
_cached_script: str | None = None


def _load_stealth_scripts(seed: int | None = None) -> str:
    """Load and concatenate all stealth JS files into a single IIFE."""
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    parts: list[str] = []
    for js_file in sorted(_JS_DIR.glob("stealth_*.js")):
        parts.append(js_file.read_text())

    combined = "\n".join(parts)

    # Inject session seed
    combined = combined.replace("__STEALTH_SEED__", str(seed))

    # Inject platform-specific values
    profile = _get_stealth_profile()
    for key, value in profile.items():
        combined = combined.replace(f"__STEALTH_{key}__", value)

    return f"(function(){{'use strict';\n{combined}\n}})();"


async def inject_stealth(tab: uc.core.tab.Tab) -> None:
    """
    Inject stealth patches via Page.addScriptToEvaluateOnNewDocument.

    The script runs before any page script on every navigation in this tab,
    so patches cannot be detected or removed by the page itself.

    IMPORTANT: Page.enable() must be called first — without it, the CDP
    Page domain is inactive and addScriptToEvaluateOnNewDocument silently
    registers scripts that never execute.

    A fresh random seed is generated per injection so each browser instance
    has a unique but session-stable fingerprint.
    """
    # Activate the Page domain — required for addScriptToEvaluateOnNewDocument
    await tab.send(uc.cdp.page.enable())

    script = _load_stealth_scripts()
    await tab.send(
        uc.cdp.page.add_script_to_evaluate_on_new_document(script)
    )
