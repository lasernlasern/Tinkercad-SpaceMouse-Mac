// Läuft direkt in der Tinkercad-Seite ("MAIN world").
// Tinkercad zoomt, solange "+" bzw. "-" GEHALTEN wird. Daher wird die Taste hier
// gedrückt gehalten, bis content.js "loslassen" meldet.
// Der Tastencode wird von Hand gesetzt, weil Chrome ihn bei nachgebauten Tasten leer lässt.
(() => {
  if (window.__smtcMainLoaded) return;
  window.__smtcMainLoaded = true;

  const KEYS = {
    '-1': { key: '+', code: 'BracketRight', keyCode: 187 },
    '1': { key: '-', code: 'Slash', keyCode: 189 },
  };
  let held = 0, repeatTimer = null;

  function fire(type, k, repeat) {
    const ae = document.activeElement;
    const target = ae && ae.tagName && !ae.closest('#smtc') ? ae : document.body;
    const ev = new KeyboardEvent(type, { key: k.key, code: k.code, repeat: !!repeat, bubbles: true, cancelable: true, composed: true, view: window });
    Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
    Object.defineProperty(ev, 'which', { get: () => k.keyCode });
    Object.defineProperty(ev, 'charCode', { get: () => 0 });
    target.dispatchEvent(ev);
  }

  function setHold(dir) {
    if (dir === held) return;
    clearInterval(repeatTimer); repeatTimer = null;
    if (held) fire('keyup', KEYS[String(held)]);
    held = dir;
    if (held) {
      const k = KEYS[String(held)];
      fire('keydown', k, false);
      // wie eine echte gehaltene Taste: wiederholte keydown-Meldungen
      repeatTimer = setInterval(() => fire('keydown', k, true), 80);
    }
  }

  document.addEventListener('smtc-zoom-hold', (e) => setHold(e.detail | 0));
  window.addEventListener('blur', () => setHold(0));
  document.addEventListener('visibilitychange', () => setHold(0));
})();
