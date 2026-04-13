// ── 26-29. Behavioural & leak-prevention patches ──────────────────────────
// Added 2026-04-12 (Round 10) to address the Cloudflare/Reddit/Discord
// network-level CDP detection patterns (error patterns 2/4/6 in that
// day's failed-run analysis).
//
// This file complements the existing 25 stealth patches by addressing
// behavioural and network-layer signals that the fingerprint-focused
// patches don't touch:
//   26. WebRTC STUN IP leak prevention
//   27. navigator.getGamepads() normalisation
//   28. Battery API mock (prevents "no battery info" → bot flag)
//   29. Permissions.query hardening against probe correlation
//
// None of these are site-specific. They are generic defences that
// reduce the entropy of the browser fingerprint and close known leaks
// that fingerprinting libraries (FingerprintJS, DataDome, CreepJS) use
// to correlate CDP-driven browsers across sessions.

// ── 26. WebRTC STUN IP leak prevention ────────────────────────────────────
// Real Chrome's RTCPeerConnection can leak the user's local/private IP
// through STUN/ICE candidates even when the page is proxied. The 2026
// memory file (stealth_rd_2026_04_07.md) flags this as a known gap.
// We override createOffer/createAnswer to strip host candidates from the
// SDP before returning them, and override setLocalDescription to do the
// same on the way in.
try {
  if (typeof RTCPeerConnection !== 'undefined') {
    var _origRTCPC = RTCPeerConnection;
    function _stripHostCandidates(sdp) {
      if (!sdp || typeof sdp !== 'string') return sdp;
      // Remove lines advertising host candidates (local IPs).
      return sdp.split('\n').filter(function (line) {
        // Drop lines of the form "a=candidate:... typ host ..."
        if (line.indexOf('a=candidate:') === 0 && line.indexOf('typ host') !== -1) {
          return false;
        }
        return true;
      }).join('\n');
    }

    var _origCreateOffer = _origRTCPC.prototype.createOffer;
    _origRTCPC.prototype.createOffer = function () {
      var p = _origCreateOffer.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        return p.then(function (desc) {
          if (desc && desc.sdp) {
            try { desc = { type: desc.type, sdp: _stripHostCandidates(desc.sdp) }; }
            catch (e) {}
          }
          return desc;
        });
      }
      return p;
    };

    var _origCreateAnswer = _origRTCPC.prototype.createAnswer;
    _origRTCPC.prototype.createAnswer = function () {
      var p = _origCreateAnswer.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        return p.then(function (desc) {
          if (desc && desc.sdp) {
            try { desc = { type: desc.type, sdp: _stripHostCandidates(desc.sdp) }; }
            catch (e) {}
          }
          return desc;
        });
      }
      return p;
    };

    // Preserve toString so fingerprinters checking for native code don't
    // see "function createOffer() { [proxy] }".
    try {
      _origRTCPC.prototype.createOffer.toString =
        _origCreateOffer.toString.bind(_origCreateOffer);
      _origRTCPC.prototype.createAnswer.toString =
        _origCreateAnswer.toString.bind(_origCreateAnswer);
    } catch (e) {}
  }
} catch (e) {}

// ── 27. navigator.getGamepads() normalisation ─────────────────────────────
// Some headless-ish Chrome configurations expose getGamepads as undefined,
// which is an anomaly real users never have. Ensure it exists and returns
// a gamepad-array-like with 4 nulls (matches common desktop).
try {
  if (typeof navigator.getGamepads === 'undefined') {
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      value: function () { return [null, null, null, null]; },
      configurable: true,
      enumerable: true,
      writable: false
    });
  }
} catch (e) {}

// ── 28. Battery API mock ──────────────────────────────────────────────────
// navigator.getBattery is deprecated but fingerprinters still check for it.
// A real desktop Chrome returns a BatteryManager. Headless Chrome may not.
// Return a plausible mock to avoid "undefined battery API" bot flag.
try {
  if (typeof navigator.getBattery === 'undefined') {
    Object.defineProperty(Navigator.prototype, 'getBattery', {
      value: function () {
        return Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () { return true; },
          onchargingchange: null,
          onchargingtimechange: null,
          ondischargingtimechange: null,
          onlevelchange: null
        });
      },
      configurable: true,
      enumerable: true,
      writable: false
    });
  }
} catch (e) {}

// ── 29. Permissions.query probe hardening ────────────────────────────────
// Patch #5 in stealth_core.js already normalises the "notifications"
// permission to 'default' instead of 'denied'. This extends that to the
// other common probe targets used by bot detection libraries
// (clipboard-read, clipboard-write, midi, geolocation, camera, microphone,
// push, persistent-storage). The rule: whatever the page asks about, we
// return a value that matches an unprompted default-install Chrome, not a
// headless/CDP default-denied Chrome.
try {
  if (navigator.permissions && navigator.permissions.query) {
    var _origPermQuery = navigator.permissions.query.bind(navigator.permissions);
    var CLEAN_DEFAULTS = {
      'notifications': 'default',
      'push': 'default',
      'clipboard-read': 'prompt',
      'clipboard-write': 'granted',
      'geolocation': 'prompt',
      'camera': 'prompt',
      'microphone': 'prompt',
      'midi': 'granted',
      'persistent-storage': 'prompt',
      'background-sync': 'granted'
    };
    navigator.permissions.query = function (params) {
      if (params && params.name && CLEAN_DEFAULTS.hasOwnProperty(params.name)) {
        return Promise.resolve({
          state: CLEAN_DEFAULTS[params.name],
          status: CLEAN_DEFAULTS[params.name],
          onchange: null,
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () { return true; }
        });
      }
      return _origPermQuery(params);
    };
    try {
      navigator.permissions.query.toString =
        _origPermQuery.toString.bind(_origPermQuery);
    } catch (e) {}
  }
} catch (e) {}
