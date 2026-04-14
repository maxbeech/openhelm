// ── 19. navigator.connection mock ───────────────────────────────────────
// Network Information API is checked by many anti-bot systems. CDP Chrome
// may not expose it. Return realistic 4G/WiFi values.
try {
  if (!navigator.connection) {
    var _connProto = {
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
      type: 'wifi',
      onchange: null,
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
    var _ohConnGetter = function () { return _connProto; };
    Object.defineProperty(Navigator.prototype, 'connection', {
      get: _ohConnGetter,
      configurable: true,
      enumerable: true,
    });
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(_ohConnGetter);
    }
  }
} catch (e) {}

// ── 20. Notification.permission consistency ─────────────────────────────
// Ensure Notification.permission matches what permissions.query returns
// (patch #5 returns 'default'). Some anti-bots cross-check these.
try {
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    var _ohNotifGetter = function () { return 'default'; };
    Object.defineProperty(Notification, 'permission', {
      get: _ohNotifGetter,
      configurable: true,
    });
    if (typeof window.__oh_register === 'function') {
      window.__oh_register(_ohNotifGetter);
    }
  }
} catch (e) {}
