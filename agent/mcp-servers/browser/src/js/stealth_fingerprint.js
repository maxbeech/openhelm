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
