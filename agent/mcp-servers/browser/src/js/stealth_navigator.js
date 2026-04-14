// ── 12. navigator.maxTouchPoints normalisation ─────────────────────────
// Desktop Chrome should report 0 touch points. Some VMs or containers
// report non-zero values which is an anomaly signal.
try {
  var _ohTouchGetter = function () { return 0; };
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
    get: _ohTouchGetter,
    configurable: true,
    enumerable: true,
  });
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohTouchGetter);
  }
} catch (e) {}

// ── 13. navigator.hardwareConcurrency normalisation ─────────────────────
// Clamp to the nearest common value (4, 8, 12, 16) to avoid leaking
// unusual core counts that could fingerprint specific hardware.
try {
  var _realHC = navigator.hardwareConcurrency || 8;
  var _commonHC = [4, 8, 12, 16];
  var _normHC = _commonHC.reduce(function (prev, curr) {
    return Math.abs(curr - _realHC) < Math.abs(prev - _realHC) ? curr : prev;
  });
  var _ohHCGetter = function () { return _normHC; };
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
    get: _ohHCGetter,
    configurable: true,
  });
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohHCGetter);
  }
} catch (e) {}

// ── 14. navigator.deviceMemory normalisation ────────────────────────────
// Clamp to standard values (2, 4, 8) to avoid fingerprinting.
try {
  var _realDM = navigator.deviceMemory || 8;
  var _commonDM = [2, 4, 8];
  var _normDM = _commonDM.reduce(function (prev, curr) {
    return Math.abs(curr - _realDM) < Math.abs(prev - _realDM) ? curr : prev;
  });
  var _ohDMGetter = function () { return _normDM; };
  Object.defineProperty(Navigator.prototype, 'deviceMemory', {
    get: _ohDMGetter,
    configurable: true,
  });
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(_ohDMGetter);
  }
} catch (e) {}

// ── 15. chrome.runtime.id fix ───────────────────────────────────────────
// The core patch sets id: undefined explicitly. Real extensionless Chrome
// does NOT have an 'id' property at all. Delete it so that
// 'id' in chrome.runtime === false, matching real browser behavior.
try {
  if (window.chrome && window.chrome.runtime &&
      window.chrome.runtime.hasOwnProperty('id') &&
      window.chrome.runtime.id === undefined) {
    delete window.chrome.runtime.id;
  }
} catch (e) {}

// ── 34. navigator.vendor ──────────────────────────────────────────────
// Real Chrome always reports "Google Inc." for navigator.vendor.
// Some CDP configurations lose this; absence is flagged by FingerprintJS
// and puppeteer-extra-stealth as a CDP automation signal.
try {
  if (navigator.vendor !== 'Google Inc.') {
    var _ohVendorGetter = function () { return 'Google Inc.'; };
    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: _ohVendorGetter,
      configurable: true,
      enumerable: true,
    });
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(_ohVendorGetter);
    }
  }
} catch (e) {}

// ── 35. navigator.language / navigator.languages consistency ──────────
// Real Chrome populates navigator.languages with at least 2 entries
// (['en-US', 'en']). CDP Chrome may leave the array empty or undefined,
// which FingerprintJS treats as a headless/automation signal.
// We use the real primary language if available and synthesise the array.
try {
  var _realLang = navigator.language || 'en-US';
  var _realLangs = navigator.languages;
  if (!_realLangs || _realLangs.length === 0) {
    var _baseLang = _realLang.indexOf('-') !== -1
      ? _realLang.split('-')[0]
      : _realLang;
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: function () { return Object.freeze([_realLang, _baseLang]); },
      configurable: true,
      enumerable: true,
    });
  }
} catch (e) {}

// ── 36. navigator.pdfViewerEnabled ───────────────────────────────────
// Chrome 94+ reports true; anti-bot scripts (e.g. DataDome, CreepJS)
// check for false as a headless/CDP automation indicator.
// Only override if the value is explicitly false — do not override
// undefined (which means the API is not exposed at all).
try {
  if (navigator.pdfViewerEnabled === false) {
    Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', {
      get: function () { return true; },
      configurable: true,
      enumerable: true,
    });
  }
} catch (e) {}

// ── 37. navigator.cookieEnabled ────────────────────────────────────────
// Real Chrome always returns true unless the user has cookies globally
// disabled (rare). Automated Chrome in restricted profiles can return false.
try {
  if (navigator.cookieEnabled === false) {
    Object.defineProperty(Navigator.prototype, 'cookieEnabled', {
      get: function () { return true; },
      configurable: true,
      enumerable: true,
    });
  }
} catch (e) {}

// ── 38. navigator.doNotTrack ─────────────────────────────────────────
// Real Chrome (no user preference set) returns null, not "1" or "0".
// Some automation frameworks inadvertently set "1", which is detectable.
try {
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === '0') {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', {
      get: function () { return null; },
      configurable: true,
      enumerable: true,
    });
  }
} catch (e) {}
