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
    # Round 10 (2026-04-12) additions — address CDP/Cloudflare 2026
    # detection. Neutralise media-permission prompts that can leak
    # bot-ness when left unanswered, and suppress the Automation
    # Extension which ships auto-controlled Chrome metadata.
    "--use-fake-ui-for-media-stream",
    "--disable-features=AutomationControlled",
    "--disable-extensions-except=",
    # Disable SyncPrefAccess signal which some sites probe.
    "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter",
    # Round 11 (2026-04-13) additions — suppress first-run Chrome
    # experience signals that real interactive Chrome users would
    # have already passed through. A fresh profile that shows a
    # first-run banner is one of the cheapest "automation" tells.
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    # Round 11: prevent macOS/Windows keychain password-manager
    # prompts (which automated Chrome can't answer, and which leak
    # "no human at the wheel" behaviourally). Use-mock-keychain is
    # Mac-specific belt-and-braces with --password-store=basic.
    "--password-store=basic",
    "--use-mock-keychain",
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
# Brand profile — single source of truth for JS Client Hints AND HTTP Sec-CH-UA
# ---------------------------------------------------------------------------
#
# Round 11 (2026-04-13): Reddit's Snoosheriff and Cloudflare's CF-RAY
# cross-check the JS-side ``navigator.userAgentData.getHighEntropyValues()``
# output against the HTTP ``Sec-CH-UA-*`` request headers. If the JS says
# "Mac ARM Chrome 131" but the HTTP headers say "Windows Chrome 120", the
# mismatch (the "Franken-fingerprint") scores higher than no spoofing at
# all. We compute a consistent brand profile once here and feed the same
# values into both the HTTP headers (via ``Network.setExtraHTTPHeaders``)
# and the JS patches (via templated placeholders).
#
# The profile targets stable Chrome on the host OS and architecture. It
# does NOT attempt to spoof a different OS than the one we're actually
# running on — spoofing OS here would create a TLS-JA4 vs header mismatch
# that's detectable at the Cloudflare transport layer (and we can't fix
# that from JS or HTTP). Instead we normalise values that real Chrome
# reports by default, so the spoofed JS matches the real HTTP and the
# HTTP matches the real JS.
#
# Chrome major version: we hard-code a recent stable release (138). This
# is a known tradeoff — if the actual Chrome on this machine is much
# older or much newer, the header version will mismatch the UA reported
# by the binary. A future improvement should query
# ``Browser.getVersion`` at spawn time and derive the major dynamically.

_CHROME_MAJOR_VERSION = "138"
_CHROME_FULL_VERSION = "138.0.7204.101"


def _brand_profile() -> dict:
    """
    Return a consistent brand profile for BOTH the JS Client Hints
    surface (navigator.userAgentData) AND the HTTP Sec-CH-UA-* headers.

    Returns a dict with keys:
        ua                           — the full User-Agent string
        sec_ch_ua                    — Sec-CH-UA header value
        sec_ch_ua_mobile             — "?0" or "?1"
        sec_ch_ua_platform           — "\"macOS\"" / "\"Windows\"" / "\"Linux\""
        sec_ch_ua_full_version_list  — full versioned brand list
        sec_ch_ua_platform_version   — platform version string
        sec_ch_ua_arch               — "\"arm\"" / "\"x86\""
        sec_ch_ua_bitness            — "\"64\""
        sec_ch_ua_model              — "\"\"" (empty on desktop)
        brand_js                     — JS array for navigator.userAgentData.brands
    """
    system = platform.system().lower()
    machine = platform.machine().lower()

    # Platform display name + UA platform fragment
    if system == "darwin":
        platform_name = "macOS"
        if "arm" in machine:
            ua_platform = "Macintosh; Intel Mac OS X 10_15_7"  # Chrome lies here too
            arch = "arm"
            platform_version = "14.5.0"
        else:
            ua_platform = "Macintosh; Intel Mac OS X 10_15_7"
            arch = "x86"
            platform_version = "14.5.0"
    elif system == "linux":
        platform_name = "Linux"
        ua_platform = "X11; Linux x86_64"
        arch = "x86"
        platform_version = "6.5.0"
    else:
        platform_name = "Windows"
        ua_platform = "Windows NT 10.0; Win64; x64"
        arch = "x86"
        platform_version = "15.0.0"

    major = _CHROME_MAJOR_VERSION
    full = _CHROME_FULL_VERSION

    ua = (
        f"Mozilla/5.0 ({ua_platform}) AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/{major}.0.0.0 Safari/537.36"
    )

    # Sec-CH-UA format: "Brand";v="major", "Brand";v="major", ...
    # Real Chrome rotates the Not*A*Brand placeholder per release cycle.
    sec_ch_ua = (
        f'"Not)A;Brand";v="99", '
        f'"Google Chrome";v="{major}", '
        f'"Chromium";v="{major}"'
    )
    sec_ch_ua_full_version_list = (
        f'"Not)A;Brand";v="99.0.0.0", '
        f'"Google Chrome";v="{full}", '
        f'"Chromium";v="{full}"'
    )

    # JSON-encodable brand list for the JS patches to consume.
    brand_js_list = [
        {"brand": "Not)A;Brand", "version": "99"},
        {"brand": "Google Chrome", "version": major},
        {"brand": "Chromium", "version": major},
    ]

    return {
        "ua": ua,
        "sec_ch_ua": sec_ch_ua,
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": f'"{platform_name}"',
        "sec_ch_ua_full_version_list": sec_ch_ua_full_version_list,
        "sec_ch_ua_platform_version": f'"{platform_version}"',
        "sec_ch_ua_arch": f'"{arch}"',
        "sec_ch_ua_bitness": '"64"',
        "sec_ch_ua_model": '""',
        "chrome_major": major,
        "chrome_full": full,
        "platform_name": platform_name,
        "brand_js": brand_js_list,
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

    # Inject platform-specific WebGL values
    profile = _get_stealth_profile()
    for key, value in profile.items():
        combined = combined.replace(f"__STEALTH_{key}__", value)

    # Round 11: inject the consistent brand profile so Patch 8 /
    # stealth_webgpu.js userAgentData brand lookups return the SAME
    # values that the HTTP Sec-CH-UA-* headers report. We emit a
    # JSON literal that the JS side can parse with JSON.parse() —
    # templating through a string replace keeps JS syntax clean.
    brand = _brand_profile()
    import json as _json
    brand_js_json = _json.dumps(brand["brand_js"])
    combined = combined.replace("__OH_BRAND_LIST__", brand_js_json)
    combined = combined.replace("__OH_CHROME_MAJOR__", brand["chrome_major"])
    combined = combined.replace("__OH_CHROME_FULL__", brand["chrome_full"])
    combined = combined.replace("__OH_PLATFORM_NAME__", brand["platform_name"])

    return f"(function(){{'use strict';\n{combined}\n}})();"


async def inject_stealth(tab: uc.core.tab.Tab) -> None:
    """
    Inject stealth patches via Page.addScriptToEvaluateOnNewDocument
    AND set consistent Sec-CH-UA-* HTTP headers via
    Network.setExtraHTTPHeaders.

    The script runs before any page script on every navigation in this tab,
    so patches cannot be detected or removed by the page itself.

    IMPORTANT: Page.enable() must be called first — without it, the CDP
    Page domain is inactive and addScriptToEvaluateOnNewDocument silently
    registers scripts that never execute. Network.enable() is similarly
    required for setExtraHTTPHeaders. Neither domain is a CDP detection
    vector; only Runtime / Debugger / Console are.

    A fresh random seed is generated per injection so each browser instance
    has a unique but session-stable fingerprint.

    Round 11 (2026-04-13): Also sets the full Sec-CH-UA Client Hints
    header stack so HTTP request metadata matches the JS-side
    userAgentData output. Fixes the "Franken-fingerprint" detection
    vector where JS and HTTP spoofs disagree — which is what Reddit's
    Snoosheriff and Cloudflare use to serve blank pages / Turnstile
    challenges to CDP-driven Chrome. See Round 11 in
    docs/browser/efficiency-improvements.md.
    """
    # Activate the Page domain — required for addScriptToEvaluateOnNewDocument
    await tab.send(uc.cdp.page.enable())

    script = _load_stealth_scripts()
    await tab.send(
        uc.cdp.page.add_script_to_evaluate_on_new_document(script)
    )

    # Round 11: Enable Network domain and set consistent Sec-CH-UA-*
    # HTTP headers. Network.enable is safe (unlike Runtime.enable) —
    # it is not a CDP detection vector in 2026. setExtraHTTPHeaders is
    # persistent for the lifetime of this tab and applies to the main
    # frame, all sub-frames, and all sub-resources.
    try:
        await tab.send(uc.cdp.network.enable())
        brand = _brand_profile()
        headers = {
            "Sec-CH-UA": brand["sec_ch_ua"],
            "Sec-CH-UA-Mobile": brand["sec_ch_ua_mobile"],
            "Sec-CH-UA-Platform": brand["sec_ch_ua_platform"],
            "Sec-CH-UA-Full-Version-List": brand["sec_ch_ua_full_version_list"],
            "Sec-CH-UA-Platform-Version": brand["sec_ch_ua_platform_version"],
            "Sec-CH-UA-Arch": brand["sec_ch_ua_arch"],
            "Sec-CH-UA-Bitness": brand["sec_ch_ua_bitness"],
            "Sec-CH-UA-Model": brand["sec_ch_ua_model"],
        }
        await tab.send(
            uc.cdp.network.set_extra_http_headers(headers=headers)
        )
    except Exception as e:
        # Header injection is belt-and-braces; the JS patches still run.
        # Log but do not raise — a Network domain hiccup should not kill
        # the spawn path.
        import sys as _sys
        print(
            f"[stealth] WARNING: Sec-CH-UA header injection failed: {e}",
            file=_sys.stderr,
        )
