// Session-stable seed injected by Python loader at spawn time.
// Consistent within session, different across sessions.
var __stealthSeed = __STEALTH_SEED__;

// Simple hash helper — turns seed + index into a small deterministic int
function __stealthHash(seed, idx) {
  var h = seed ^ (idx * 2654435761);
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return (h >>> 16) ^ h;
}

// ── 16. Canvas fingerprint noise ────────────────────────────────────────
// Intercept toDataURL and toBlob to add 1-3 pixel noise per session.
// This prevents canvas fingerprint matching across sessions while
// remaining consistent within a single session.
try {
  var _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    try {
      var ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        var w = Math.min(this.width, 16);
        var imgData = ctx.getImageData(0, 0, w, 1);
        for (var i = 0; i < Math.min(imgData.data.length, 16); i += 4) {
          var noise = __stealthHash(__stealthSeed, i) & 1;
          imgData.data[i] = imgData.data[i] ^ noise;
        }
        ctx.putImageData(imgData, 0, 0);
      }
    } catch (ex) {} // CORS canvas will throw — that's fine
    return _origToDataURL.apply(this, arguments);
  };
  HTMLCanvasElement.prototype.toDataURL.toString = function () {
    return 'function toDataURL() { [native code] }';
  };

  // Also patch toBlob for completeness
  var _origToBlob = HTMLCanvasElement.prototype.toBlob;
  if (_origToBlob) {
    HTMLCanvasElement.prototype.toBlob = function () {
      try {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          var w = Math.min(this.width, 16);
          var imgData = ctx.getImageData(0, 0, w, 1);
          for (var i = 0; i < Math.min(imgData.data.length, 16); i += 4) {
            var noise = __stealthHash(__stealthSeed, i) & 1;
            imgData.data[i] = imgData.data[i] ^ noise;
          }
          ctx.putImageData(imgData, 0, 0);
        }
      } catch (ex) {}
      return _origToBlob.apply(this, arguments);
    };
    HTMLCanvasElement.prototype.toBlob.toString = function () {
      return 'function toBlob() { [native code] }';
    };
  }
} catch (e) {}

// ── 33. Canvas getImageData noise (Round 11, 2026-04-13) ────────────────
// Patch 16 above noises toDataURL and toBlob, but Cloudflare Turnstile and
// modern FingerprintJS versions read canvas pixels directly via
// CanvasRenderingContext2D.getImageData(), which was NOT covered. Pure
// toDataURL noise is ignored by anyone who does:
//
//   const img = ctx.getImageData(0, 0, w, h);
//   const hash = sha256(img.data);
//
// Patch 33 covers that path. We apply the same per-session deterministic
// jitter (±1 in the low bit) to the first ~16 pixels returned. Pixels
// beyond that offset are untouched to keep the patch cheap on large
// images. The noise is session-stable (seeded from __STEALTH_SEED__) so
// within one run the canvas hash is consistent but different sessions
// produce different hashes.
try {
  var _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function () {
    var imgData = _origGetImageData.apply(this, arguments);
    try {
      // Only noise up to 64 bytes (16 pixels) — enough to perturb any
      // hash that reads the buffer from the start, cheap on large images.
      var nBytes = Math.min(imgData.data.length, 64);
      for (var i = 0; i < nBytes; i += 4) {
        // XOR the low bit with a session-deterministic value. 0 or 1.
        var noise = __stealthHash(__stealthSeed, i + 5000) & 1;
        imgData.data[i] = imgData.data[i] ^ noise;
      }
    } catch (ex) {} // CORS / detached canvas — fine
    return imgData;
  };
  if (typeof window.__oh_register === 'function') {
    window.__oh_register(CanvasRenderingContext2D.prototype.getImageData);
  } else {
    CanvasRenderingContext2D.prototype.getImageData.toString = function () {
      return 'function getImageData() { [native code] }';
    };
  }
} catch (e) {}

// ── 17. WebGL fingerprint consistency ───────────────────────────────────
// Override getParameter for UNMASKED_VENDOR/RENDERER to return
// platform-appropriate strings (injected by Python loader).
try {
  var __webglVendor = '__STEALTH_WEBGL_VENDOR__';
  var __webglRenderer = '__STEALTH_WEBGL_RENDERER__';

  var _patchWebGL = function (proto) {
    var _origGetParam = proto.getParameter;
    proto.getParameter = function (param) {
      // UNMASKED_VENDOR_WEBGL = 0x9245, UNMASKED_RENDERER_WEBGL = 0x9246
      if (param === 0x9245) return __webglVendor;
      if (param === 0x9246) return __webglRenderer;
      return _origGetParam.call(this, param);
    };
    proto.getParameter.toString = function () {
      return 'function getParameter() { [native code] }';
    };
  };

  _patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') {
    _patchWebGL(WebGL2RenderingContext.prototype);
  }
} catch (e) {}

// ── 18. AudioContext fingerprint noise ───────────────────────────────────
// Add subtle per-session noise to frequency analysis data so audio
// fingerprints differ across sessions but remain stable within one.
try {
  var _origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
  AnalyserNode.prototype.getFloatFrequencyData = function (array) {
    _origGetFloat.call(this, array);
    for (var i = 0; i < Math.min(array.length, 10); i++) {
      array[i] += ((__stealthHash(__stealthSeed, i + 1000) & 3) - 1) * 0.001;
    }
  };
  AnalyserNode.prototype.getFloatFrequencyData.toString = function () {
    return 'function getFloatFrequencyData() { [native code] }';
  };
} catch (e) {}
