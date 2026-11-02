// SpaceMouse für Tinkercad – Version mit 3Dconnexion-Treiber.
// Der Hintergrund-Teil (bg.js) holt die Bewegungen vom Treiber; hier werden sie
// in Maus-Gesten übersetzt, die Tinkercad versteht:
//   Orbit = Rechtsklick-Ziehen, Pan = Mittelklick-Ziehen (oder Shift+Rechts), Zoom = Mausrad.
(() => {
  if (window.__smtcLoaded) return;
  window.__smtcLoaded = true;

  // ---------- Einstellungen ----------
  const STORE_KEY = 'smtc-settings-v7';
  const DEFAULTS = {
    rotSpeed: 1.0,
    panSpeed: 1.0,
    zoomSpeed: 1.0,
    panMethod: 'middle',
    zoomMethod: 'real',    // 'buttons' = Zoom-Knöpfe von Tinkercad, 'wheel' = Mausrad
    invOrbitX: false, invOrbitY: false,
    invPanX: false, invPanY: false,
    invZoom: false,
    collapsed: false,
  };
  let cfg = { ...DEFAULTS };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (_) {}
  cfg.zoomMethod = 'real'; // funktionierende Methode fest einstellen
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {} };

  // ---------- Verbindung zum Hintergrund ----------
  let port = null;
  let motionOn = false;
  function connectPort() {
    try { port = chrome.runtime.connect({ name: 'smtc' }); } catch (_) { port = null; return; }
    port.onMessage.addListener(onBgMessage);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connectPort, 1000); });
    sendFocus();
  }
  function sendFocus() {
    if (!port) return;
    const focused = document.visibilityState === 'visible' && document.hasFocus() && !!canvas;
    try { port.postMessage({ type: 'focus', focused }); } catch (_) {}
  }
  window.addEventListener('focus', sendFocus);
  window.addEventListener('blur', sendFocus);
  document.addEventListener('visibilitychange', sendFocus);

  // gesammelte Bewegung, wird pro Bildschirm-Frame abgearbeitet
  const acc = { ox: 0, oy: 0, px: 0, py: 0, zoom: 0 };
  let lastDelta = 0;

  function onBgMessage(m) {
    if (m.type === 'status') setStatus(m.text, m.kind);
    else if (m.type === 'debug') { dbg.props = m.props.join(', '); showDbg(); }
    else if (m.type === 'fit') { dbg.fit++; showDbg(); }
    else if (m.type === 'btn') { dbg.btn = m.what; showDbg(); }
    else if (m.type === 'motion') { if (m.on) resetLive(); motionOn = m.on; if (!m.on) endDragSoon(); }
    else if (m.type === 'delta') {
      const sg = (b) => (b ? -1 : 1);
      // Orbit: Pixel pro Radiant (Tinkercad dreht ca. 0,5° pro Pixel)
      const ORBIT_PX = 115;
      acc.ox += -m.wy * ORBIT_PX * cfg.rotSpeed * sg(cfg.invOrbitX);
      acc.oy += -m.wx * ORBIT_PX * cfg.rotSpeed * sg(cfg.invOrbitY);
      // Pan: Anteil der Bildhöhe → Pixel
      const h = canvas ? canvas.getBoundingClientRect().height : 600;
      acc.px += -m.px * h * cfg.panSpeed * sg(cfg.invPanX);
      acc.py += m.py * h * cfg.panSpeed * sg(cfg.invPanY);
      acc.zoom += m.zoom * cfg.zoomSpeed * sg(cfg.invZoom);
      if (m.zoom) { dbg.zoomSig += Math.abs(m.zoom); }
      live.n++; live.rot += Math.hypot(m.wx, m.wy); live.pan += Math.hypot(m.px, m.py); live.zoom += Math.abs(m.zoom);
      lastDelta = performance.now();
    }
  }

  // ---------- Ziel-Canvas ----------
  let canvas = null;
  function findCanvas() {
    let best = null, bestArea = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.width > 300 && r.height > 200 && area > bestArea) { best = c; bestArea = area; }
    }
    return best;
  }

  // ---------- Synthetische Eingaben ----------
  function fireMouse(type, x, y, button, buttons, extra = {}) {
    const init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y,
      screenX: x + window.screenX, screenY: y + window.screenY,
      button, buttons,
      shiftKey: !!extra.shiftKey,
      movementX: extra.mx || 0, movementY: extra.my || 0,
    };
    const ptype = { mousedown: 'pointerdown', mousemove: 'pointermove', mouseup: 'pointerup' }[type];
    canvas.dispatchEvent(new PointerEvent(ptype, {
      ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      pressure: buttons ? 0.5 : 0,
    }));
    canvas.dispatchEvent(new MouseEvent(type, init));
  }

  let drag = null;
  function dragParams(mode) {
    if (mode === 'orbit') return { button: 2, buttons: 2, shift: false };
    if (cfg.panMethod === 'shift') return { button: 2, buttons: 2, shift: true };
    return { button: 1, buttons: 4, shift: false };
  }
  function startDrag(mode) {
    const r = canvas.getBoundingClientRect();
    const p = dragParams(mode);
    drag = { mode, x: r.left + r.width / 2, y: r.top + r.height / 2, ...p };
    fireMouse('mousemove', drag.x, drag.y, 0, 0, { shiftKey: p.shift });
    fireMouse('mousedown', drag.x, drag.y, p.button, p.buttons, { shiftKey: p.shift });
  }
  function endDrag() {
    if (!drag) return;
    if (canvas && canvas.isConnected) fireMouse('mouseup', drag.x, drag.y, drag.button, 0, { shiftKey: drag.shift });
    drag = null;
  }
  let endTimer = null;
  function endDragSoon() { clearTimeout(endTimer); endTimer = setTimeout(endDrag, 120); }
  function moveDrag(dx, dy) {
    clearTimeout(endTimer);
    drag.x += dx; drag.y += dy;
    fireMouse('mousemove', drag.x, drag.y, 0, drag.buttons, { shiftKey: drag.shift, mx: dx, my: dy });
    const r = canvas.getBoundingClientRect();
    const lim = Math.min(r.width, r.height) * 0.4;
    if (Math.abs(drag.x - (r.left + r.width / 2)) > lim || Math.abs(drag.y - (r.top + r.height / 2)) > lim) {
      const mode = drag.mode;
      endDrag();
      startDrag(mode);
    }
  }

  let zoomAcc = 0, lastZoomT = 0;
  let zoomVel = 0, zoomHeld = 0;
  let smZ = 0, smD = 0, zoomMode = false;
  // zoomVel > 0 = hineinzoomen → "+" halten (dir -1), < 0 → "-" halten (dir +1)
  function setZoomHold(sign) {
    const dir = sign > 0 ? -1 : sign < 0 ? 1 : 0;
    if (dir === zoomHeld) return;
    zoomHeld = dir;
    document.dispatchEvent(new CustomEvent('smtc-zoom-hold', { detail: dir }));
  }
  window.addEventListener('blur', () => setZoomHold(0));

  // Zoom-Knöpfe von Tinkercad suchen (deutsch/englisch, Titel/Tooltip/Klassen)
  const RX_IN = /zoom[\s_-]*in|vergr(ö|oe)ßer|vergroesser|hineinzoom|heranzoom/i;
  const RX_OUT = /zoom[\s_-]*out|verkleiner|herauszoom|wegzoom/i;
  let zoomBtns = { in: null, out: null, t: 0 };
  function findZoomButtons() {
    const now = performance.now();
    if (zoomBtns.in && zoomBtns.in.isConnected && zoomBtns.out && zoomBtns.out.isConnected) return zoomBtns;
    if (now - zoomBtns.t < 2000) return zoomBtns;
    zoomBtns = { in: null, out: null, t: now };
    for (const el of document.querySelectorAll('[title],[aria-label],[data-tooltip],[data-title],[class*="zoom" i],[id*="zoom" i]')) {
      if (panel && panel.contains(el)) continue;
      const txt = [el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('data-tooltip'),
        el.getAttribute('data-title'), typeof el.className === 'string' ? el.className : '', el.id].join(' ');
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (!zoomBtns.in && RX_IN.test(txt)) zoomBtns.in = el;
      else if (!zoomBtns.out && RX_OUT.test(txt)) zoomBtns.out = el;
    }
    dbg.btns = zoomBtns.in && zoomBtns.out ? 'gefunden' : 'nicht gefunden';
    showDbg();
    return zoomBtns;
  }

  function clickEl(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  }

  function wheelAt(dir, type) {
    const r = canvas.getBoundingClientRect();
    // während eines Ziehvorgangs an dessen Position, sonst Bildmitte
    const x = drag ? drag.x : r.left + r.width / 2, y = drag ? drag.y : r.top + r.height / 2;
    let target = document.elementFromPoint(x, y);
    if (!target || (panel && panel.contains(target))) target = canvas;
    target.dispatchEvent(new WheelEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
      screenX: x + window.screenX, screenY: y + window.screenY,
      buttons: drag ? drag.buttons : 0,
      deltaY: dir * 100, deltaMode: 0, wheelDeltaY: -dir * 120, wheelDelta: -dir * 120,
    }));
  }

  // Tinkercad-Tastenkürzel: + = hineinzoomen, - = herauszoomen
  function zoomKey(dir) {
    const k = dir < 0
      ? { key: '+', code: 'BracketRight', keyCode: 187 }   // "+" auf deutscher Mac-Tastatur
      : { key: '-', code: 'Slash', keyCode: 189 };         // "-" auf deutscher Mac-Tastatur
    const ae = document.activeElement;
    // Ziel muss ein echtes Element sein (wie bei echten Tastendrücken: meist <body>),
    // sonst stürzt Tinkercads Tasten-Auswertung ab (target.tagName fehlt beim document).
    const target = ae && ae.tagName && !(panel && panel.contains(ae)) ? ae : document.body;
    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, { ...k, which: k.keyCode, charCode: type === 'keypress' ? k.key.charCodeAt(0) : 0,
        bubbles: true, cancelable: true, composed: true, view: window });
      target.dispatchEvent(ev);
    }
  }

  // dir: -1 = hineinzoomen, +1 = herauszoomen
  function zoomStep(dir) {
    if (cfg.zoomMethod === 'real') {
      const r = canvas.getBoundingClientRect();
      const x = drag ? drag.x : r.left + r.width / 2, y = drag ? drag.y : r.top + r.height / 2;
      if (port) try { port.postMessage({ type: 'wheel', dir, x, y }); } catch (_) {}
    } else if (cfg.zoomMethod === 'keys') {
      // an main.js in der Seite übergeben (dort lässt sich der Tastencode setzen)
      document.dispatchEvent(new CustomEvent('smtc-zoom', { detail: dir }));
    } else if (cfg.zoomMethod === 'buttons') {
      const b = findZoomButtons();
      const el = dir < 0 ? b.in : b.out;
      if (el) clickEl(el);
    } else if (cfg.zoomMethod === 'mousewheel') {
      wheelAt(dir, 'mousewheel');
    } else {
      wheelAt(dir, 'wheel');
    }
  }

  // ---------- Hauptschleife ----------
  const ZOOM_STEP = Math.log(1.12); // angenommene Zoomstufe pro Mausrad-Raste
  function tick(t) {
    requestAnimationFrame(tick);
    if (!canvas || !canvas.isConnected) { endDrag(); setZoomHold(0); acc.ox = acc.oy = acc.px = acc.py = acc.zoom = 0; return; }

    const oM = Math.hypot(acc.ox, acc.oy), pM = Math.hypot(acc.px, acc.py);
    // Tinkercad ignoriert das Mausrad, solange eine Maustaste gedrückt ist.
    // Deshalb: Überwiegt der Zoom, wird nicht gedreht/geschoben (und umgekehrt).
    const k = 0.8;
    smZ = smZ * k + Math.abs(acc.zoom) * 400 * (1 - k);
    smD = smD * k + Math.max(oM, pM) * (1 - k);
    if (zoomMode) { if (smD > smZ * 3 && smD > 1) zoomMode = false; }
    else if (smZ > smD * 1.5 && smZ > 0.3) zoomMode = true;
    if (!motionOn && t - lastDelta > 300) { zoomMode = false; smZ = smD = 0; }
    if (zoomMode) {
      live.fZoom++;
      if (drag) endDrag();
      acc.ox = acc.oy = acc.px = acc.py = 0;
    } else {
      acc.zoom = 0;
    }
    if (!zoomMode && (oM > 0.05 || pM > 0.05)) {
      let want;
      const cur = drag && drag.mode;
      if (!cur) want = oM >= pM ? 'orbit' : 'pan';
      else {
        const curM = cur === 'orbit' ? oM : pM, othM = cur === 'orbit' ? pM : oM;
        want = othM > curM * 2 + 0.5 ? (cur === 'orbit' ? 'pan' : 'orbit') : cur;
      }
      if (!drag || drag.mode !== want) { endDrag(); startDrag(want); }
      if (want === 'orbit') { moveDrag(acc.ox, acc.oy); live.fOrbit++; }
      else { moveDrag(acc.px, acc.py); live.fPan++; }
    } else if (drag && !motionOn && t - lastDelta > 150) {
      endDrag();
    }
    acc.ox = acc.oy = acc.px = acc.py = 0;

    if (cfg.zoomMethod === 'keys') {
      // Glätten der Zoom-Geschwindigkeit (pro Frame)
      zoomVel = zoomVel * 0.75 + acc.zoom * 0.25;
      acc.zoom = 0;
      if (!motionOn && t - lastDelta > 150) zoomVel = 0;
      // Pulsbreite: Anteil der Zeit, in der die Taste gehalten wird
      const duty = Math.min(1, Math.abs(zoomVel) * cfg.zoomSpeed / 0.02);
      const phase = (t % 150) / 150;
      const want = duty > 0.05 && phase < duty ? Math.sign(zoomVel) : 0;
      setZoomHold(want);
      if (want) { dbg.steps++; if (dbg.steps % 10 === 0) showDbg(); }
    } else {
      setZoomHold(0);
      zoomAcc += acc.zoom / (cfg.zoomMethod === 'buttons' ? ZOOM_STEP * 2 : ZOOM_STEP);
      acc.zoom = 0;
      if (Math.abs(zoomAcc) >= 1 && t - lastZoomT >= 60) {
        lastZoomT = t;
        const s = Math.sign(zoomAcc);
        zoomStep(-s); // hineinzoomen = Mausrad nach oben (deltaY negativ)
        dbg.steps++; showDbg();
        zoomAcc -= s;
      }
      zoomAcc = Math.max(-3, Math.min(3, zoomAcc));
      if (!motionOn && t - lastDelta > 300) zoomAcc = 0;
    }
  }

  // ---------- UI ----------
  let panel, hd;
  const dbg = { props: '–', zoomSig: 0, steps: 0, btns: '?', fit: 0, btn: '–' };
  const live = { n: 0, rot: 0, pan: 0, zoom: 0, fOrbit: 0, fPan: 0, fZoom: 0 };
  function resetLive() { for (const k in live) live[k] = 0; }
  setInterval(() => {
    const el = panel && panel.querySelector('.live');
    if (el) el.textContent = `Signale: ${live.n} | Drehen ${live.rot.toFixed(3)} | Schieben ${live.pan.toFixed(3)} | Zoom ${live.zoom.toFixed(3)}  →  Frames: Drehen ${live.fOrbit} | Schieben ${live.fPan} | Zoom ${live.fZoom}`;
  }, 250);
  function showDbg() {
    const el = panel && panel.querySelector('.dbg');
    if (el) el.textContent = `Treiber: ${dbg.props} | Zoom-Signal: ${dbg.zoomSig.toFixed(2)} | Zoom aktiv: ${dbg.steps} | Fit ausgelöst: ${dbg.fit} | Knopf: ${dbg.btn}`;
  }
  let curStatus = { text: 'Verbinde…', kind: 'warn' };
  function setStatus(text, kind) {
    curStatus = { text, kind };
    if (!hd) return;
    hd.querySelector('.st').textContent = text;
    hd.dataset.kind = kind;
  }
  function togglePanel() {
    cfg.collapsed = !cfg.collapsed; save();
    if (panel) panel.classList.toggle('smtc-collapsed', cfg.collapsed);
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #smtc{position:fixed;left:12px;bottom:12px;z-index:2147483647;width:250px;
        font:12px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;color:#1d1d1f;
        background:rgba(255,255,255,.96);border:1px solid #ccd;border-radius:10px;
        box-shadow:0 4px 18px rgba(0,0,0,.18);padding:8px 10px;user-select:none}
      #smtc *{box-sizing:border-box}
      #smtc .hd{display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600}
      #smtc .dot{width:8px;height:8px;border-radius:50%;background:#bbb;flex:none}
      #smtc .hd[data-kind=ok] .dot{background:#2a9d4b}
      #smtc .hd[data-kind=warn] .dot{background:#e0a020}
      #smtc .hd[data-kind=err] .dot{background:#d33}
      #smtc .st{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #smtc .body{margin-top:8px}
      #smtc.smtc-collapsed .body{display:none}
      #smtc button{font:inherit;padding:4px 8px;border:1px solid #99a;border-radius:6px;background:#f4f5f8;cursor:pointer}
      #smtc .row{display:flex;align-items:center;gap:6px;margin:3px 0}
      #smtc .row label{flex:1}
      #smtc input[type=range]{width:110px}
      #smtc .hint{color:#666;font-size:11px;margin:4px 0}
    `;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'smtc';
    if (cfg.collapsed) panel.classList.add('smtc-collapsed');
    panel.innerHTML = `
      <div class="hd"><span class="dot"></span><span class="st"></span><span>▾</span></div>
      <div class="body">
        <div class="hint">Empfindlichkeit & Achsen-Feintuning: 3Dconnexion-Einstellungen am Mac.</div>
        <div class="sets"></div>
      </div>`;
    document.body.appendChild(panel);
    hd = panel.querySelector('.hd');
    setStatus(curStatus.text, curStatus.kind);
    showDbg();
    hd.addEventListener('click', togglePanel);

    const sets = panel.querySelector('.sets');
    const slider = (key, label, min, max, step) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${cfg[key]}">`;
      row.querySelector('input').addEventListener('input', (e) => { cfg[key] = +e.target.value; save(); });
      sets.appendChild(row);
    };
    const check = (key, label) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<label>${label}</label><input type="checkbox" ${cfg[key] ? 'checked' : ''}>`;
      row.querySelector('input').addEventListener('change', (e) => { cfg[key] = e.target.checked; save(); });
      sets.appendChild(row);
    };
    slider('rotSpeed', 'Dreh-Tempo', 0.1, 4, 0.1);
    slider('panSpeed', 'Schiebe-Tempo', 0.1, 4, 0.1);
    slider('zoomSpeed', 'Zoom-Tempo', 0.1, 4, 0.1);
    check('invOrbitX', 'Drehen links/rechts umkehren');
    check('invOrbitY', 'Drehen hoch/runter umkehren');
    check('invPanX', 'Schieben links/rechts umkehren');
    check('invPanY', 'Schieben hoch/runter umkehren');
    check('invZoom', 'Zoom umkehren');
    const btns = document.createElement('div');
    btns.className = 'row';
    btns.innerHTML = `<button data-a="re">Neu verbinden</button><button data-a="reset">Zurücksetzen</button>`;
    btns.querySelector('[data-a=re]').addEventListener('click', () => { if (port) port.postMessage({ type: 'reconnect' }); });
    btns.querySelector('[data-a=reset]').addEventListener('click', () => {
      cfg = { ...DEFAULTS }; save(); panel.remove(); style.remove(); panel = null; buildPanel();
    });
    sets.appendChild(btns);

    for (const ev of ['mousedown', 'pointerdown', 'wheel', 'keydown', 'contextmenu']) {
      panel.addEventListener(ev, (e) => e.stopPropagation());
    }
  }

  // ---------- Start ----------
  setInterval(() => {
    const c = findCanvas();
    if (c !== canvas) { endDrag(); canvas = c; sendFocus(); }
    if (canvas && !panel) buildPanel();
    if (canvas && panel) findZoomButtons();
    if (canvas && !port) connectPort();
    sendFocus();
  }, 1000);

  requestAnimationFrame(tick);
})();
