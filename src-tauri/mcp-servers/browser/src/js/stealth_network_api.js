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
    Object.defineProperty(Navigator.prototype, 'connection', {
      get: function () { return _connProto; },
      configurable: true,
      enumerable: true,
    });
  }
} catch (e) {}

// ── 20. Notification.permission consistency ─────────────────────────────
// Ensure Notification.permission matches what permissions.query returns
// (patch #5 returns 'default'). Some anti-bots cross-check these.
try {
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    Object.defineProperty(Notification, 'permission', {
      get: function () { return 'default'; },
      configurable: true,
    });
  }
} catch (e) {}
