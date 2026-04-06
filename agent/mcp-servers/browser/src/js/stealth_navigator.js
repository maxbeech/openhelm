// ── 12. navigator.maxTouchPoints normalisation ─────────────────────────
// Desktop Chrome should report 0 touch points. Some VMs or containers
// report non-zero values which is an anomaly signal.
try {
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
    get: function () { return 0; },
    configurable: true,
    enumerable: true,
  });
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
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
    get: function () { return _normHC; },
    configurable: true,
  });
} catch (e) {}

// ── 14. navigator.deviceMemory normalisation ────────────────────────────
// Clamp to standard values (2, 4, 8) to avoid fingerprinting.
try {
  var _realDM = navigator.deviceMemory || 8;
  var _commonDM = [2, 4, 8];
  var _normDM = _commonDM.reduce(function (prev, curr) {
    return Math.abs(curr - _realDM) < Math.abs(prev - _realDM) ? curr : prev;
  });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', {
    get: function () { return _normDM; },
    configurable: true,
  });
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
