// ═══════════════════════════════════════════════════════════════════════
// ROUND 11 PATCHES (2026-04-13) — MUST run first
// ═══════════════════════════════════════════════════════════════════════
// These new patches (30–33) are defensive upgrades that target the
// 2026-era CDP detection vectors Cloudflare, Reddit (Snoosheriff), and
// DataDome all exploit — specifically:
//   • Function.prototype.toString probe ("is this function native code?")
//   • Closed-mode shadow DOM challenges (Cloudflare Turnstile checkbox)
//   • document.visibilityState leaking 'hidden' on CDP-driven tabs
//   • Canvas getImageData fingerprinting (reads raw pixels directly,
//     bypassing the toDataURL/toBlob overrides in stealth_fingerprint.js)
// Patches 30 MUST run before any other patch because subsequent
// patches register themselves with __oh_register() so their toString()
// values return [native code] even when introspected.
// ═══════════════════════════════════════════════════════════════════════

// ── 30. Function.prototype.toString global cloak ──────────────────────
// The canonical bot-detection probe: call .toString() on every native
// function you care about (Object.defineProperty, Proxy, chrome.runtime
// methods, etc.) and check whether the source contains "[native code]".
// Any patch that replaces a native function without also monkey-patching
// .toString leaks its presence immediately. The old approach was to shim
// .toString per-function; Round 11 takes the global approach — we wrap
// Function.prototype.toString once and register patched functions in a
// WeakSet. For any registered function, toString returns the expected
// native-code stub. For everything else, we delegate to the original.
//
// This pattern is straight from puppeteer-extra-stealth utils
// (https://github.com/berstend/puppeteer-extra/blob/master/packages/
//  puppeteer-extra-plugin-stealth/evasions/_utils/index.js) and is the
// #1 gap Castle.io identifies in nodriver-based stealth frameworks.
try {
  var __oh_patched = new WeakSet();
  var _origFnToString = Function.prototype.toString;

  function _ohFnToString() {
    // Special-case: asking toString on toString itself must return the
    // original native source, not recurse.
    if (this === Function.prototype.toString) {
      return _origFnToString.call(_origFnToString);
    }
    if (__oh_patched.has(this)) {
      var name = '';
      try { name = (this.name || ''); } catch (e) {}
      return 'function ' + name + '() { [native code] }';
    }
    return _origFnToString.call(this);
  }

  Function.prototype.toString = _ohFnToString;
  __oh_patched.add(Function.prototype.toString);

  // Public helper: every subsequent patch calls window.__oh_register(fn)
  // after replacing a native function so fn.toString() returns native code.
  window.__oh_register = function (fn) {
    try { __oh_patched.add(fn); } catch (e) {}
    return fn;
  };
} catch (e) {}

// ── 31. attachShadow force-open + shadow DOM re-injection ─────────────
// Cloudflare Turnstile renders its "Verify you are human" checkbox
// inside a mode:'closed' shadow DOM iframe. CDP cannot query into closed
// shadow roots from outside — they are browser-enforced. But we run
// BEFORE any page script (via Page.addScriptToEvaluateOnNewDocument),
// so we can intercept Element.prototype.attachShadow and force mode:'open'
// regardless of what the caller passes. When Cloudflare's challenge code
// subsequently calls attachShadow({mode:'closed'}), it gets an open root
// instead, and CDP + JS can then reach the checkbox via shadowRoot.
//
// Caveat from research: this enables FINDING and CLICKING the checkbox,
// but Turnstile also applies behavioural ML scoring (mouse path, attention
// timing) that JS patches alone cannot defeat. Fall back to
// request_user_help for interactive Turnstile challenges. This patch is a
// PREREQUISITE for future OS-level mouse-event bypass, not a full fix.
//
// Reference: chromedp issue #1608; patchright README "interaction with
// elements in closed shadow DOMs".
try {
  var _origAttachShadow = Element.prototype.attachShadow;
  function _ohAttachShadow(init) {
    init = init || {};
    init.mode = 'open';
    return _origAttachShadow.call(this, init);
  }
  Element.prototype.attachShadow = _ohAttachShadow;
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohAttachShadow);
  }

  // Re-inject chrome.runtime into any existing open shadow roots via a
  // MutationObserver. This covers the case where a shadow root was
  // attached before our observer started (e.g. after navigation).
  try {
    var _ohReinjectShadow = function (root) {
      try {
        if (!root || !root.host) return;
        // Shadow roots don't have their own window, but pages can query
        // root.host.ownerDocument.defaultView.chrome which already points
        // at the main window — Patch 1 already covers that. Nothing to do
        // here for chrome.runtime per se, but we walk nested shadows so
        // other patches (via __oh_register) remain consistent across
        // shadow boundaries.
        var nested = root.querySelectorAll('*');
        for (var i = 0; i < Math.min(nested.length, 500); i++) {
          if (nested[i].shadowRoot) {
            _ohReinjectShadow(nested[i].shadowRoot);
          }
        }
      } catch (e) {}
    };
    var _ohObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n && n.shadowRoot) {
            _ohReinjectShadow(n.shadowRoot);
          }
        }
      }
    });
    // Start observing once DOM is ready
    if (document.documentElement) {
      _ohObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        _ohObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      });
    }
  } catch (e) {}
} catch (e) {}

// ── 32. document.hidden + visibilityState always 'visible' ────────────
// CDP-driven browsers can run with an unfocused or background tab, and
// document.hidden leaks 'true' / document.visibilityState leaks 'hidden'
// in those states. Cloudflare's challenge JS reads visibilityState during
// the "Just a moment" interstitial — if it sees 'hidden', it suspects
// automated navigation and escalates the challenge.
try {
  var _ohHiddenGetter = function () { return false; };
  var _ohVisStateGetter = function () { return 'visible'; };
  Object.defineProperty(Document.prototype, 'hidden', {
    get: _ohHiddenGetter,
    configurable: true,
  });
  Object.defineProperty(Document.prototype, 'visibilityState', {
    get: _ohVisStateGetter,
    configurable: true,
  });
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohHiddenGetter);
    window.__oh_register(_ohVisStateGetter);
  }
  // Some detectors ALSO check webkitVisibilityState (legacy).
  try {
    var _ohWkVisStateGetter = function () { return 'visible'; };
    var _ohWkHiddenGetter = function () { return false; };
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
      get: _ohWkVisStateGetter,
      configurable: true,
    });
    Object.defineProperty(Document.prototype, 'webkitHidden', {
      get: _ohWkHiddenGetter,
      configurable: true,
    });
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(_ohWkVisStateGetter);
      window.__oh_register(_ohWkHiddenGetter);
    }
  } catch (e) {}
} catch (e) {}

// ── 40. document.hasFocus() always true ──────────────────────────────
// CDP browsers run unfocused or minimized. document.hasFocus() returns
// false in those states, which real interactive users almost never produce
// while actively browsing. Cloudflare, DataDome, and PerimeterX all
// check this as a bot signal. Patch 32 covers document.hidden /
// visibilityState but NOT hasFocus() — this closes that gap.
try {
  var _origHasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function () { return true; };
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(Document.prototype.hasFocus);
  }
} catch (e) {}

// ═══════════════════════════════════════════════════════════════════════
// ROUND 14 PATCHES (2026-04-14) — classic chrome.* stubs + window.close guard
// ═══════════════════════════════════════════════════════════════════════
// The 2026-04-14 prod log analysis showed Reddit / Snoosheriff was actively
// crashing Chrome renderer processes on first DOM interaction. Research
// confirmed the missing classic headless-detection probes (chrome.loadTimes,
// chrome.csi, chrome.app.isInstalled) are still actively used by SnooSheriff
// and Cloudflare's bm.js — we stub chrome.runtime (Patch 1) but never stubbed
// these three siblings. Also adding a window.close() guard so SPA anti-bot
// JS that calls window.close() to abandon a suspicious tab cannot take our
// session down with it.
// ═══════════════════════════════════════════════════════════════════════

// ── 41. chrome.loadTimes() stub ──────────────────────────────────────
// Real Chrome (non-headless) exposes window.chrome.loadTimes() — a
// deprecated timing API still present in Chrome 138+ for compatibility.
// Headless/CDP Chrome omits it. FingerprintJS, CreepJS, and Snoosheriff
// all probe for it. Returns a realistic object matching the live Chrome
// shape. Reference: puppeteer-extra-stealth `chrome.loadTimes` evasion.
try {
  if (window.chrome && typeof window.chrome.loadTimes !== 'function') {
    var _loadTimesStart = (performance && performance.timing && performance.timing.navigationStart)
      ? performance.timing.navigationStart / 1000
      : Date.now() / 1000 - 1.5;
    var _ohLoadTimes = function () {
      return {
        get commitLoadTime() { return _loadTimesStart + 0.25; },
        get connectionInfo() { return 'h2'; },
        get finishDocumentLoadTime() { return _loadTimesStart + 1.15; },
        get finishLoadTime() { return _loadTimesStart + 1.65; },
        get firstPaintAfterLoadTime() { return 0; },
        get firstPaintTime() { return _loadTimesStart + 0.35; },
        get navigationType() { return 'Other'; },
        get npnNegotiatedProtocol() { return 'h2'; },
        get requestTime() { return _loadTimesStart; },
        get startLoadTime() { return _loadTimesStart; },
        get wasAlternateProtocolAvailable() { return false; },
        get wasFetchedViaSpdy() { return true; },
        get wasNpnNegotiated() { return true; },
      };
    };
    window.chrome.loadTimes = _ohLoadTimes;
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(window.chrome.loadTimes);
    }
  }
} catch (e) {}

// ── 42. chrome.csi() stub ────────────────────────────────────────────
// Real Chrome exposes window.chrome.csi() — a chrome-internal timing
// function used by Google for client-side instrumentation. Headless
// Chrome omits it; its absence is a classic bot signal checked by every
// major fingerprinter since 2019. Returns an object with realistic
// millisecond timestamps anchored to navigation start.
try {
  if (window.chrome && typeof window.chrome.csi !== 'function') {
    var _csiStartTimeMs = (performance && performance.timing && performance.timing.navigationStart)
      ? performance.timing.navigationStart
      : Date.now() - 1500;
    var _ohCsi = function () {
      return {
        onloadT: _csiStartTimeMs + 1500,
        pageT: Math.floor(Date.now() - _csiStartTimeMs),
        startE: _csiStartTimeMs,
        tran: 15,
      };
    };
    window.chrome.csi = _ohCsi;
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(window.chrome.csi);
    }
  }
} catch (e) {}

// ── 43. chrome.app + isInstalled stub ────────────────────────────────
// Real Chrome (non-headless, non-extension) exposes
// window.chrome.app.isInstalled === false, plus InstallState / RunningState
// enums. FingerprintJS's "headlessChrome" test specifically checks that
// chrome.app exists and has isInstalled. Headless Chrome sets chrome.app
// to undefined. We replicate the exact shape real Chrome 138+ exposes.
try {
  if (window.chrome && window.chrome.app === undefined) {
    var _ohChromeApp = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      getDetails: function () { return null; },
      getIsInstalled: function () { return false; },
      runningState: function () { return 'cannot_run'; },
    };
    try {
      Object.defineProperty(window.chrome, 'app', {
        get: function () { return _ohChromeApp; },
        configurable: true,
      });
    } catch (e2) {
      window.chrome.app = _ohChromeApp;
    }
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(_ohChromeApp.getDetails);
      window.__oh_register(_ohChromeApp.getIsInstalled);
      window.__oh_register(_ohChromeApp.runningState);
    }
  }
} catch (e) {}

// ── 44. window.close() guard ─────────────────────────────────────────
// Reddit's Snoosheriff and some Cloudflare challenges call window.close()
// when they detect automation, causing the tab (and our whole CDP session)
// to die mid-task. Real Chrome only allows window.close() on windows that
// were opened via window.open() by the SAME script — scripted close of a
// user-opened tab is silently ignored in modern Chrome. We enforce the
// same policy proactively: window.close() from page scripts becomes a
// no-op, so anti-bot JS that tries to "terminate" our tab instead hits a
// dead end and the tab survives.
//
// This is why Reddit scroll_page calls sometimes produced
// ConnectionRefusedError(61, "Connect call failed ('127.0.0.1', PORT)") —
// SnooSheriff closed the tab out from under our CDP socket. The close
// itself was not a crash; the socket died because the tab did.
try {
  var _origWindowClose = window.close;
  var _ohWindowClose = function () {
    // Silently no-op. Real Chrome also no-ops this for windows not
    // opened by script, so anti-bot JS cannot distinguish our guard
    // from normal Chrome policy.
    try {
      console.debug('[stealth] window.close() blocked (tab was not script-opened)');
    } catch (e2) {}
  };
  window.close = _ohWindowClose;
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(window.close);
  }
} catch (e) {}

// ── 45. Guard against Chrome renderer-crash triggers ────────────────
// Some anti-bot JS tries to call removed / internal APIs (e.g. the
// deprecated `window.webkitRequestFileSystem`) to intentionally trigger
// a Chrome-side crash that looks like a site bug. Make the deprecated
// removed APIs silently no-op functions rather than throw or crash.
try {
  if (typeof window.webkitRequestFileSystem === 'undefined') {
    window.webkitRequestFileSystem = function (_type, _size, onSuccess, _onError) {
      // Fail silently via the error callback if provided
      setTimeout(function () {
        if (typeof _onError === 'function') {
          try {
            _onError({ name: 'NotSupportedError', message: 'File system API not supported' });
          } catch (e2) {}
        }
      }, 0);
    };
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(window.webkitRequestFileSystem);
    }
  }
  if (typeof window.webkitResolveLocalFileSystemURL === 'undefined') {
    window.webkitResolveLocalFileSystemURL = function (_url, _onSuccess, _onError) {
      setTimeout(function () {
        if (typeof _onError === 'function') {
          try {
            _onError({ name: 'NotSupportedError', message: 'File system API not supported' });
          } catch (e2) {}
        }
      }, 0);
    };
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(window.webkitResolveLocalFileSystemURL);
    }
  }
} catch (e) {}

// ═══════════════════════════════════════════════════════════════════════
// END ROUND 14 PATCHES
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// END ROUND 11 PATCHES — legacy patches 1–11 follow
// ═══════════════════════════════════════════════════════════════════════

// ── 1. chrome.runtime stub ──────────────────────────────────────────────
// CDP connections omit window.chrome.runtime.  Its absence is used by
// FingerprintJS and similar tools as a "Developer Tools active" signal.
// Real Chrome (no extensions) exposes a limited runtime object; we replicate
// only the surface area needed to pass the absence check.
try {
  if (window.chrome && window.chrome.runtime === undefined) {
    var noop = function () {};
    var noopListener = {
      addListener: noop,
      removeListener: noop,
      hasListener: function () { return false; },
    };
    window.chrome.runtime = {
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
} catch (e) {}

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
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(console.log);
  }
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
// exists and the prototype descriptor returns undefined. Real Chrome with
// the blink feature disabled returns undefined (not false). Some 2026-era
// detectors specifically check for `false` as a patched value — returning
// undefined matches genuine unautomated Chrome behaviour.
try {
  if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
    delete navigator.__proto__.webdriver;
  }
  var _ohWebdriverGetter = function () { return undefined; };
  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: _ohWebdriverGetter,
    configurable: true,
    enumerable: true,
  });
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohWebdriverGetter);
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
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(window.navigator.permissions.__proto__.query);
  }
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
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(Object.defineProperty);
  }
} catch (e) {}

// ── 8. navigator.userAgentData mock ───────────────────────────────────
// Modern Chrome exposes NavigatorUAData. Automated Chrome may report
// unexpected values or omit brands.  Normalise to match real Chrome
// AND to match the HTTP Sec-CH-UA-* headers set via Network.setExtraHTTPHeaders
// in stealth.py (Round 11). The brand list, Chrome major version, and
// platform name are templated in from Python so both sides agree —
// fixing the "Franken-fingerprint" mismatch Reddit/Cloudflare exploit.
try {
  if (navigator.userAgentData) {
    // Templated from stealth.py::_brand_profile(). Examples:
    //   __OH_BRAND_LIST__    → [{"brand":"Not)A;Brand","version":"99"},
    //                           {"brand":"Google Chrome","version":"138"},
    //                           {"brand":"Chromium","version":"138"}]
    //   __OH_CHROME_MAJOR__  → 138
    //   __OH_CHROME_FULL__   → 138.0.7204.101
    //   __OH_PLATFORM_NAME__ → macOS / Windows / Linux
    var __ohBrandList = __OH_BRAND_LIST__;
    var __ohChromeMajor = '__OH_CHROME_MAJOR__';
    var __ohChromeFull = '__OH_CHROME_FULL__';
    var __ohPlatformName = '__OH_PLATFORM_NAME__';

    var _origGetHEV = navigator.userAgentData.getHighEntropyValues;
    navigator.userAgentData.getHighEntropyValues = function (hints) {
      return _origGetHEV.call(navigator.userAgentData, hints).then(function (values) {
        // Replace brands entirely with the consistent brand list.
        // This ensures the JS side matches the HTTP Sec-CH-UA header.
        values.brands = __ohBrandList.slice();
        values.fullVersionList = __ohBrandList.map(function (b) {
          return { brand: b.brand, version: b.brand === 'Not)A;Brand' ? '99.0.0.0' : __ohChromeFull };
        });
        values.uaFullVersion = __ohChromeFull;
        values.platform = __ohPlatformName;
        return values;
      });
    };
    navigator.userAgentData.getHighEntropyValues.toString = function () {
      return 'function getHighEntropyValues() { [native code] }';
    };

    // Also normalise the low-entropy brands getter so pages that read
    // navigator.userAgentData.brands directly see the consistent list.
    try {
      Object.defineProperty(navigator.userAgentData, 'brands', {
        get: function () { return __ohBrandList.slice(); },
        configurable: true,
      });
      Object.defineProperty(navigator.userAgentData, 'platform', {
        get: function () { return __ohPlatformName; },
        configurable: true,
      });
    } catch (e) {}
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
    return error + '\n' + filtered.map(function (f) {
      return '    at ' + f.toString();
    }).join('\n');
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
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(document.createElement);
  }
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
