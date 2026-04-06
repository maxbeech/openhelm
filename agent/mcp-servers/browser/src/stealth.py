"""
Stealth JS patches injected via Page.addScriptToEvaluateOnNewDocument.

Each patch targets a specific detectable signal. Patches run before any page
script so they cannot be bypassed by the page itself.

Signals patched
---------------
1. chrome.runtime stub          — absence detected by FingerprintJS
2. console %c probe suppression — DevTools-open detector (FingerprintJS)
3. screen.colorDepth / pixelDepth — Apple ProMotion reports 30-bit (rare/anomalous)
4. navigator.webdriver cleanup  — remove own-property override; prototype stays false
5. permissions.query            — returns 'default' for notifications (not 'denied')
6. navigator.plugins mock       — automated Chrome often reports 0 plugins

Chrome launch args
------------------
get_stealth_args() returns args that complement the JS patches at the C++ level:
  --disable-blink-features=AutomationControlled  (removes the JS webdriver flag)
  --disable-infobars                             (no "controlled by automation" bar)
"""

from typing import List
import nodriver as uc


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
    # Prevent renderer crashes on heavy anti-bot pages (CAPTCHA, etc.)
    "--disable-gpu",
    "--disable-software-rasterizer",
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
# Stealth script — injected on every new document
# ---------------------------------------------------------------------------

STEALTH_SCRIPT = """
(function () {
  'use strict';

  // ── 1. chrome.runtime stub ──────────────────────────────────────────────
  // CDP connections omit window.chrome.runtime.  Its absence is used by
  // FingerprintJS and similar tools as a "Developer Tools active" signal.
  // Real Chrome (no extensions) exposes a limited runtime object; we replicate
  // only the surface area needed to pass the absence check.
  if (window.chrome && window.chrome.runtime === undefined) {
    const noop = function () {};
    const noopListener = {
      addListener: noop,
      removeListener: noop,
      hasListener: function () { return false; },
    };
    window.chrome.runtime = {
      id: undefined,
      lastError: undefined,
      onMessage: noopListener,
      onConnect: noopListener,
      onInstalled: noopListener,
      onStartup: noopListener,
      onSuspend: noopListener,
      onUpdateAvailable: noopListener,
      sendMessage: noop,
      connect: function () {
        return {
          name: '',
          disconnect: noop,
          onDisconnect: noopListener,
          onMessage: noopListener,
          postMessage: noop,
        };
      },
      getURL: function () { return ''; },
      getManifest: function () { return {}; },
      reload: noop,
      requestUpdateCheck: function () {
        return Promise.resolve({ status: 'no_update' });
      },
      PlatformOs: {
        MAC: 'mac', WIN: 'win', ANDROID: 'android',
        CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd',
      },
      PlatformArch: {
        ARM: 'arm', ARM64: 'arm64',
        X86_32: 'x86-32', X86_64: 'x86-64',
        MIPS: 'mips', MIPS64: 'mips64',
      },
      RequestUpdateCheckStatus: {
        THROTTLED: 'throttled',
        NO_UPDATE: 'no_update',
        UPDATE_AVAILABLE: 'update_available',
      },
    };
  }

  // ── 2. Console %c probe suppression ────────────────────────────────────
  // When CDP is active Chrome calls custom toString() on console.log format
  // args to invoke DevTools formatting — this is used as a devtools-open
  // detector (the "RegExp toString sentinel" trick used by FingerprintJS).
  try {
    var _nativeLog = console.log.bind(console);
    console.log = function () {
      var args = Array.prototype.slice.call(arguments);
      var isProbe = (
        args.length >= 2 &&
        typeof args[0] === 'string' &&
        args[0].indexOf('%c') !== -1 &&
        args.slice(1).some(function (a) {
          return (
            a != null &&
            typeof a === 'object' &&
            typeof a.toString === 'function' &&
            a.toString !== Object.prototype.toString &&
            a.toString !== RegExp.prototype.toString
          );
        })
      );
      if (!isProbe) {
        return _nativeLog.apply(console, arguments);
      }
    };
    console.log.toString = _nativeLog.toString.bind(_nativeLog);
  } catch (e) {}

  // ── 3. Screen color-depth normalisation ────────────────────────────────
  // Apple ProMotion / HDR displays report colorDepth=30 (10-bit per channel).
  // This value is rare and contributes to anomaly scores.  Override to 24.
  try {
    Object.defineProperty(screen, 'colorDepth', {
      get: function () { return 24; }, configurable: true,
    });
    Object.defineProperty(screen, 'pixelDepth', {
      get: function () { return 24; }, configurable: true,
    });
  } catch (e) {}

  // ── 4. navigator.webdriver cleanup ─────────────────────────────────────
  // --disable-blink-features=AutomationControlled prevents Chrome from setting
  // this flag, but as belt-and-suspenders we ensure no own-property override
  // exists and the prototype descriptor returns false (matching real Chrome).
  try {
    if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
      delete navigator.__proto__.webdriver;
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: function () { return false; },
        configurable: true,
        enumerable: true,
      });
    }
  } catch (e) {}

  // ── 5. permissions.query — notifications ──────────────────────────────
  // Automated Chrome returns 'denied' for notifications; real browsers that
  // have never been prompted return 'default'.
  try {
    var _origQuery = window.navigator.permissions.query.bind(
      window.navigator.permissions
    );
    window.navigator.permissions.__proto__.query = function (params) {
      if (params && params.name === 'notifications') {
        var state = (typeof Notification !== 'undefined' && Notification.permission)
          ? Notification.permission
          : 'default';
        return Promise.resolve({ state: state });
      }
      return _origQuery(params);
    };
    window.navigator.permissions.__proto__.query.toString =
      _origQuery.toString.bind(_origQuery);
  } catch (e) {}

  // ── 6. navigator.plugins mock ──────────────────────────────────────────
  // CDP-connected Chrome may launch with 0 plugins. Real Chrome ships with
  // at least 3 (PDF Plugin, PDF Viewer, Native Client).
  try {
    if (navigator.plugins && navigator.plugins.length === 0) {
      var fakeMime = function (type, desc, ext) {
        return Object.assign(Object.create(MimeType.prototype), {
          type: type, description: desc, suffixes: ext,
        });
      };
      var makePlugin = function (name, desc, filename, mimes) {
        var p = Object.assign(Object.create(Plugin.prototype), {
          name: name, description: desc, filename: filename,
          length: mimes.length,
        });
        mimes.forEach(function (m, i) { p[i] = m; m.enabledPlugin = p; });
        return p;
      };
      var pdf1 = fakeMime('application/x-google-chrome-pdf',
        'Portable Document Format', 'pdf');
      var pdf2 = fakeMime('application/pdf', 'Portable Document Format', 'pdf');
      var nacl1 = fakeMime('application/x-nacl', 'Native Client Executable', '');
      var nacl2 = fakeMime('application/x-pnacl',
        'Portable Native Client Executable', '');
      var plugins = [
        makePlugin('Chrome PDF Plugin', 'Portable Document Format',
          'internal-pdf-viewer', [pdf1]),
        makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', [pdf2]),
        makePlugin('Native Client', '', 'internal-nacl-plugin', [nacl1, nacl2]),
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: function () {
          var arr = Object.create(PluginArray.prototype);
          plugins.forEach(function (p, i) { arr[i] = p; });
          Object.defineProperty(arr, 'length', {
            get: function () { return plugins.length; },
          });
          arr.item = function (i) { return arr[i]; };
          arr.namedItem = function (n) {
            return plugins.find(function (p) { return p.name === n; }) || null;
          };
          arr.refresh = function () {};
          return arr;
        },
        enumerable: true, configurable: true,
      });
    }
  } catch (e) {}

  // ── 7. Remove cdc_ variables (Chrome DevTools marker) ─────────────────
  // Chromedriver injects window.cdc_adoQpoasnfa76pfcZLmcfl_* variables.
  // nodriver doesn't set these, but some anti-bot scripts check for any
  // window property starting with "cdc_" as a blanket CDP detection.
  try {
    var cdcKeys = Object.keys(window).filter(function (k) {
      return k.startsWith('cdc_') || k.startsWith('$cdc_');
    });
    cdcKeys.forEach(function (k) { delete window[k]; });

    // Prevent future cdc_ properties from being set
    var _origDefProp = Object.defineProperty;
    Object.defineProperty = function (obj, prop, desc) {
      if (obj === window && typeof prop === 'string' &&
          (prop.startsWith('cdc_') || prop.startsWith('$cdc_'))) {
        return obj; // silently ignore
      }
      return _origDefProp.call(Object, obj, prop, desc);
    };
    Object.defineProperty.toString = _origDefProp.toString.bind(_origDefProp);
  } catch (e) {}

  // ── 8. navigator.userAgentData mock ───────────────────────────────────
  // Modern Chrome exposes NavigatorUAData. Automated Chrome may report
  // unexpected values or omit brands.  Normalise to match real Chrome.
  try {
    if (navigator.userAgentData) {
      var _origGetHEV = navigator.userAgentData.getHighEntropyValues;
      navigator.userAgentData.getHighEntropyValues = function (hints) {
        return _origGetHEV.call(navigator.userAgentData, hints).then(function (values) {
          // Ensure "Google Chrome" brand is present
          if (values.brands && !values.brands.some(function (b) {
            return b.brand === 'Google Chrome';
          })) {
            values.brands.push({ brand: 'Google Chrome', version: values.uaFullVersion || '136' });
          }
          return values;
        });
      };
      navigator.userAgentData.getHighEntropyValues.toString = function () {
        return 'function getHighEntropyValues() { [native code] }';
      };
    }
  } catch (e) {}

  // ── 9. Error.stack sanitisation ───────────────────────────────────────
  // CDP evaluation wraps code in an internal function whose path leaks
  // in Error.stack traces (e.g. "puppeteer_evaluation_script" or
  // ":Runtime.evaluate").  Anti-bot scripts create errors and inspect
  // their stacks.  We override Error.prepareStackTrace to strip these.
  try {
    var _origPrepare = Error.prepareStackTrace;
    Error.prepareStackTrace = function (error, stack) {
      var filtered = stack.filter(function (frame) {
        var fn = frame.getFileName() || '';
        return fn.indexOf('puppeteer') === -1 &&
               fn.indexOf('__puppeteer') === -1 &&
               fn.indexOf('Runtime.evaluate') === -1 &&
               fn.indexOf('devtools') === -1 &&
               fn.indexOf('__cdp') === -1;
      });
      if (_origPrepare) {
        return _origPrepare(error, filtered);
      }
      return error + '\\n' + filtered.map(function (f) {
        return '    at ' + f.toString();
      }).join('\\n');
    };
  } catch (e) {}

  // ── 10. Prevent CDP detection via iframe contentWindow ────────────────
  // Some sites create iframes and check contentWindow.chrome.runtime
  // or similar properties in the iframe context.
  try {
    var _origCreate = document.createElement.bind(document);
    document.createElement = function () {
      var el = _origCreate.apply(document, arguments);
      if (arguments[0] && arguments[0].toLowerCase() === 'iframe') {
        var _origAppend = el.__proto__.appendChild || Node.prototype.appendChild;
        // Re-inject stealth into iframe contentWindow after it loads
        el.addEventListener('load', function () {
          try {
            if (el.contentWindow && el.contentWindow.chrome &&
                el.contentWindow.chrome.runtime === undefined) {
              el.contentWindow.chrome.runtime = window.chrome.runtime;
            }
          } catch (e) {} // cross-origin will throw, that's fine
        });
      }
      return el;
    };
    document.createElement.toString = _origCreate.toString.bind(_origCreate);
  } catch (e) {}

  // ── 11. Window.outerWidth/outerHeight alignment ───────────────────────
  // Headless or automated Chrome may report outerWidth == innerWidth
  // (no chrome UI). Real browsers have ~100px difference for window chrome.
  try {
    if (window.outerWidth === window.innerWidth) {
      Object.defineProperty(window, 'outerWidth', {
        get: function () { return window.innerWidth + 15; },
        configurable: true,
      });
      Object.defineProperty(window, 'outerHeight', {
        get: function () { return window.innerHeight + 85; },
        configurable: true,
      });
    }
  } catch (e) {}

})();
"""


async def inject_stealth(tab: uc.core.tab.Tab) -> None:
    """
    Inject stealth patches via Page.addScriptToEvaluateOnNewDocument.

    The script runs before any page script on every navigation in this tab,
    so patches cannot be detected or removed by the page itself.

    Args:
        tab: The nodriver Tab to patch.
    """
    await tab.send(
        uc.cdp.page.add_script_to_evaluate_on_new_document(STEALTH_SCRIPT)
    )
