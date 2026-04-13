// ── 21. WebGPU fingerprinting defense ──────────────────────────────────────
// WebGPU is emerging as the next high-entropy fingerprinting source.
// Override GPUAdapter.requestAdapterInfo() and related properties to return
// canonical vendor/driver strings matching the platform profile.
try {
  if (typeof navigator.gpu !== 'undefined' && navigator.gpu.requestAdapter) {
    var _origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = function (options) {
      return _origRequestAdapter(options).then(function (adapter) {
        if (adapter && typeof adapter.requestAdapterInfo === 'function') {
          var _origRequestAdapterInfo = adapter.requestAdapterInfo.bind(adapter);
          adapter.requestAdapterInfo = function () {
            return _origRequestAdapterInfo().then(function (info) {
              // Return canonical vendor/driver strings.
              // Prevents fingerprinting via WebGPU device capabilities.
              info.vendor = 'google'; // Canonical vendor
              info.architecture = 'arm64'; // Normalized to common architecture
              info.driver = 'Dawn'; // WebGPU reference implementation
              info.driverVersion = '1.0'; // Normalized version
              return info;
            });
          };
          adapter.requestAdapterInfo.toString = _origRequestAdapterInfo.toString.bind(_origRequestAdapterInfo);
        }
        return adapter;
      });
    };
    navigator.gpu.requestAdapter.toString = _origRequestAdapter.toString.bind(_origRequestAdapter);
  }
} catch (e) {}

// ── 22. Geolocation mock ──────────────────────────────────────────────────
// Return default geolocation coordinates (Mountain View, CA).
// Many bot-detection systems flag requests from datacenter IPs;
// a consistent geolocation mock improves believability.
try {
  if (typeof navigator.geolocation !== 'undefined') {
    var _origGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(
      navigator.geolocation
    );
    navigator.geolocation.getCurrentPosition = function (success, error, options) {
      // Mountain View, CA (Google HQ) — common human location
      var fakePosition = {
        coords: {
          latitude: 37.4220,
          longitude: -122.0841,
          altitude: null,
          accuracy: 30,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };
      try {
        success(fakePosition);
      } catch (e) {}
    };
    navigator.geolocation.getCurrentPosition.toString = _origGetCurrentPosition.toString.bind(_origGetCurrentPosition);

    var _origWatchPosition = navigator.geolocation.watchPosition.bind(
      navigator.geolocation
    );
    navigator.geolocation.watchPosition = function (success, error, options) {
      var fakePosition = {
        coords: {
          latitude: 37.4220,
          longitude: -122.0841,
          altitude: null,
          accuracy: 30,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };
      try {
        success(fakePosition);
      } catch (e) {}
      return 1; // Return a dummy watch ID
    };
    navigator.geolocation.watchPosition.toString = _origWatchPosition.toString.bind(_origWatchPosition);

    var _origClearWatch = navigator.geolocation.clearWatch.bind(
      navigator.geolocation
    );
    navigator.geolocation.clearWatch = function (id) {
      // Silently succeed
      return undefined;
    };
    navigator.geolocation.clearWatch.toString = _origClearWatch.toString.bind(_origClearWatch);
  }
} catch (e) {}

// ── 23. Font enumeration randomization ─────────────────────────────────────
// Patch document.fonts to return a randomized subset of available fonts.
// This prevents fingerprinting via exact font list enumeration.
try {
  if (typeof document.fonts !== 'undefined' && typeof FontFaceSet !== 'undefined') {
    var _origCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function (font) {
      // Return true for common fonts (assume they exist)
      var commonFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
      var fontName = String(font).toLowerCase();
      for (var i = 0; i < commonFonts.length; i++) {
        if (fontName.indexOf(commonFonts[i].toLowerCase()) !== -1) {
          return true;
        }
      }
      // Randomize answer for non-standard fonts (~60% true)
      return Math.random() > 0.4;
    };
    document.fonts.check.toString = _origCheck.toString.bind(_origCheck);
  }
} catch (e) {}

// ── 24. requestIdleCallback presence ───────────────────────────────────────
// Some CDP Chrome configurations don't expose requestIdleCallback.
// Provide a mock if missing to pass behavioral checks.
try {
  if (typeof requestIdleCallback === 'undefined') {
    window.requestIdleCallback = function (callback, options) {
      var timeout = (options && options.timeout) || 1000;
      return setTimeout(function () {
        callback({
          didTimeout: false,
          timeRemaining: function () {
            return Math.max(0, timeout - (Date.now() % timeout));
          },
        });
      }, 1);
    };
    window.requestIdleCallback.toString = function () {
      return 'function requestIdleCallback() { [native code] }';
    };

    window.cancelIdleCallback = function (id) {
      clearTimeout(id);
    };
    window.cancelIdleCallback.toString = function () {
      return 'function cancelIdleCallback() { [native code] }';
    };
  }
} catch (e) {}

// ── 25. UserAgent Client Hints — deferred to Patch 8 ───────────────────────
// Round 11 (2026-04-13): This patch used to inject a brand list with a
// hardcoded Chrome major version '136', which mismatched the HTTP
// Sec-CH-UA-* headers set by stealth.py and created a Franken-fingerprint.
// Patch 8 in stealth_core.js now handles userAgentData.brands using the
// templated __OH_BRAND_LIST__ and runs strictly earlier (stealth_core.js
// loads before stealth_webgpu.js in alphabetical order). We intentionally
// leave this patch as a no-op so there's no conflicting override.
// The file numbering is preserved for historical traceability.
