"""
CAPTCHA detection via DOM inspection + URL signals + optional LLM fallback.

Three-layer confidence-gated approach:
  Layer 1: DOM selectors + title check (zero tokens)
  Layer 2: Body text phrase search + URL signals (zero tokens)
  Layer 3: Haiku vision fallback — only when URL is suspicious but layers 1-2
            found nothing. Costs ~$0.001-0.003 per check; skipped if no API key.
"""

from typing import Any, Dict, List, Optional

# JavaScript that queries the DOM for CAPTCHA indicators, body phrases, and
# URL signals. Returns a flat list including a __meta__ sentinel at the end.
_DETECTION_JS = """
(() => {
  const results = [];

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }

  function check(selector, type, blocking, hint) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      results.push({
        type, selector, blocking, hint,
        visible: isVisible(el),
        tag: el.tagName.toLowerCase(),
      });
    }
  }

  // reCAPTCHA v2 widget
  check('.g-recaptcha', 'recaptcha_v2', true, 'click_checkbox');
  check('iframe[src*="recaptcha/api2"]', 'recaptcha_v2', true, 'click_checkbox');
  check('iframe[src*="recaptcha/enterprise"]', 'recaptcha_v2', true, 'click_checkbox');

  // reCAPTCHA v3 badge (non-blocking)
  check('.grecaptcha-badge', 'recaptcha_v3', false, 'none');

  // hCaptcha
  check('.h-captcha', 'hcaptcha', true, 'click_checkbox');
  check('iframe[src*="hcaptcha.com"]', 'hcaptcha', true, 'click_checkbox');

  // Cloudflare Turnstile
  check('.cf-turnstile', 'turnstile', true, 'wait');
  check('iframe[src*="challenges.cloudflare.com"]', 'turnstile', true, 'wait');

  // Cloudflare challenge page (full-page interstitial)
  check('#challenge-running', 'cloudflare_challenge', true, 'wait');
  check('#challenge-form', 'cloudflare_challenge', true, 'wait');

  // Page title check (case-insensitive)
  const lowerTitle = document.title.toLowerCase();
  if (lowerTitle === 'just a moment...' ||
      lowerTitle === 'attention required! | cloudflare' ||
      lowerTitle.includes('prove your humanity') ||
      lowerTitle.includes('are you a robot') ||
      lowerTitle.includes('verify you are human') ||
      lowerTitle.includes('security check') ||
      lowerTitle.includes('bot check') ||
      lowerTitle.includes('blocked')) {
    results.push({
      type: 'cloudflare_challenge', selector: 'title', visible: true,
      blocking: true, hint: 'wait', tag: 'title',
    });
  }

  // Body text phrase search — catches obfuscated/custom challenge pages
  const bodyText = (document.body && document.body.innerText || '').toLowerCase();
  const PHRASES = [
    'prove your humanity', 'are you a robot', 'verify you are human',
    'checking your browser', 'please complete the security check',
    'enable javascript and cookies to continue',
    'access to this page has been denied',
    'one more step', 'unusual traffic from your computer',
    'automated requests', 'human verification',
    'please verify you', 'bot protection',
  ];
  for (const phrase of PHRASES) {
    if (bodyText.includes(phrase)) {
      results.push({
        type: 'body_text_challenge', selector: 'body', visible: true,
        blocking: true, hint: 'wait', tag: 'body', matched_phrase: phrase,
      });
      break;  // one hit is enough
    }
  }

  // Generic captcha class/id selectors
  for (const el of document.querySelectorAll('*')) {
    const cls = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toLowerCase();
    if ((cls.includes('captcha') || id.includes('captcha')) &&
        !cls.includes('grecaptcha-badge') &&
        !cls.includes('g-recaptcha') &&
        !cls.includes('h-captcha') &&
        !cls.includes('cf-turnstile')) {
      results.push({
        type: 'generic',
        selector: el.id ? '#' + el.id : '.' + el.className.split(' ')[0],
        visible: isVisible(el), blocking: true, hint: 'unknown',
        tag: el.tagName.toLowerCase(),
      });
    }
  }

  // URL suspicious signal (packed as __meta__ sentinel)
  const url = window.location.href.toLowerCase();
  const urlSuspicious = [
    '/challenge', '/captcha', '/verify', '/checkpoint', '/sorry',
    '/blocked', '/bot-protection', '/robot', 'challenges.cloudflare.com',
    '?captcha', 'captcha=',
  ].some(p => url.includes(p));

  results.push({
    type: '__meta__', selector: '', visible: false, blocking: false,
    hint: 'none', tag: '', urlSuspicious,
  });

  return results;
})()
"""

# URL patterns that warrant the LLM fallback if DOM checks found nothing
_SUSPICIOUS_URL_PATTERNS = [
    '/challenge', '/captcha', '/verify', '/checkpoint', '/sorry',
    '/blocked', '/bot-protection', '/robot', 'challenges.cloudflare.com',
    '?captcha', 'captcha=',
]


class CaptchaDetector:
    """Detects CAPTCHA challenges via DOM + body text + URL signals."""

    async def detect(self, tab: Any) -> Dict[str, Any]:
        """
        Inspect the current page for CAPTCHA indicators.

        Returns:
            Dict with keys:
              - detected (bool)
              - captcha_type (str|None)
              - selectors (list[str])
              - is_blocking (bool)
              - auto_solve_hint (str)
              - url_suspicious (bool): URL matches challenge patterns
              - details (list[dict])
        """
        try:
            raw_results = await tab.evaluate(_DETECTION_JS)
        except Exception as e:
            return _empty_result(error=f"Detection script failed: {e}")

        if not raw_results:
            return _empty_result()

        # Extract metadata sentinel
        meta = next((r for r in raw_results if r.get("type") == "__meta__"), {})
        url_suspicious: bool = meta.get("urlSuspicious", False)

        # Filter to visible, non-meta elements
        visible = [
            r for r in raw_results
            if r.get("visible") and r.get("type") != "__meta__"
        ]

        if not visible:
            result = _empty_result()
            result["url_suspicious"] = url_suspicious
            return result

        blocking = [r for r in visible if r.get("blocking")]
        primary = blocking[0] if blocking else visible[0]
        selectors = list({r["selector"] for r in visible})

        return {
            "detected": True,
            "captcha_type": primary["type"],
            "selectors": selectors,
            "is_blocking": any(r.get("blocking") for r in visible),
            "auto_solve_hint": primary.get("hint", "unknown"),
            "url_suspicious": url_suspicious,
            "details": visible,
        }


def _empty_result(error: Optional[str] = None) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "detected": False,
        "captcha_type": None,
        "selectors": [],
        "is_blocking": False,
        "auto_solve_hint": "none",
        "url_suspicious": False,
        "details": [],
    }
    if error:
        result["error"] = error
    return result
