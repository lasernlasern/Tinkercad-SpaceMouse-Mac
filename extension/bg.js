// Hintergrund: Verbindung zum 3Dconnexion-Treiber (3DxNLServer, WAMP v1 über WSS).
// Der Treiber berechnet die Kamerabewegung selbst (mit seinen Empfindlichkeits-
// Einstellungen). Wir melden ihm eine virtuelle Kamera, lesen die Änderungen
// pro Frame aus und schicken sie als Orbit/Pan/Zoom-Deltas an den Tinkercad-Tab.

const HOST = '127.51.68.120';
const HTTP_PORT = 8181;
const CALL = 2, CALL_RESULT = 3, CALL_ERROR = 4, SUBSCRIBE = 5, EVENT = 8, WELCOME = 0, PREFIX = 1;

// ---------- Ports zu den Tinkercad-Tabs ----------
const ports = new Map(); // port -> { focused }
let status = { text: 'Verbinde mit 3Dconnexion-Treiber…', kind: 'warn' };

function broadcast(msg) { for (const p of ports.keys()) { try { p.postMessage(msg); } catch (_) {} } }
function toFocused(msg) {
  for (const [p, s] of ports) if (s.focused) { try { p.postMessage(msg); } catch (_) {} }
}
function setStatus(text, kind) { status = { text, kind }; broadcast({ type: 'status', ...status }); }
const anyFocused = () => [...ports.values()].some((s) => s.focused);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'smtc') return;
  ports.set(port, { focused: false });
  port.postMessage({ type: 'status', ...status });
  port.onMessage.addListener((m) => {
    if (m.type === 'focus') {
      ports.get(port).focused = !!m.focused;
      updateFocus();
    } else if (m.type === 'wheel') {
      const tabId = port.sender && port.sender.tab && port.sender.tab.id;
      if (tabId != null && port.sender.frameId === 0) realWheel(tabId, m.x, m.y, m.dir);
    } else if (m.type === 'reconnect') {
      closeWs();
      ensureConnected();
    }
  });
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId != null && attached.has(tabId) && port.sender.frameId === 0) {
      attached.delete(tabId);
      chrome.debugger.detach({ tabId }, () => void chrome.runtime.lastError);
    }
    updateFocus();
    if (!ports.size) closeWs();
  });
  ensureConnected();
});

// ---------- WAMP-Verbindung ----------
let ws = null, ctrl = null, connecting = false, callNo = 0, frameTimer = null, retryTimer = null;
const pending = new Map();

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function rpc(proc, ...args) {
  const id = 'c' + (++callNo);
  send([CALL, id, proc, ...args]);
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error('Zeitüberschreitung')); }, 5000);
  });
}
function fire(proc, ...args) { send([CALL, 'f' + (++callNo), proc, ...args]); } // ohne Warten

function closeWs() {
  clearInterval(frameTimer); frameTimer = null;
  clearTimeout(retryTimer); retryTimer = null;
  if (ws) { try { ws.close(); } catch (_) {} }
  ws = null; ctrl = null; connecting = false;
  pending.clear();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (ports.size) retryTimer = setTimeout(ensureConnected, 3000);
}

async function ensureConnected() {
  if (ws || connecting || !ports.size) return;
  connecting = true;
  try {
    const r = await fetch(`https://${HOST}:${HTTP_PORT}/3dconnexion/nlproxy`, { headers: { Accept: 'application/json' } });
    const info = await r.json();
    await openWs(info.port);
  } catch (err) {
    console.warn('[SpaceMouse]', err);
    connecting = false;
    ws = null;
    setStatus('Treiber nicht erreichbar – läuft 3DxWare?', 'err');
    scheduleRetry();
  }
}

function openWs(port) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`wss://${HOST}:${port}`, ['wamp']);
    ws = sock;
    sock.onmessage = (ev) => onMessage(JSON.parse(ev.data), resolve, reject);
    sock.onerror = () => reject(new Error('WebSocket-Fehler'));
    sock.onclose = () => {
      if (ws === sock) {
        closeWs();
        setStatus('Verbindung zum Treiber getrennt', 'warn');
        scheduleRetry();
      }
    };
  });
}

async function onMessage(msg, resolve, reject) {
  const t = msg[0];
  if (t === WELCOME) {
    try {
      send([PREFIX, '3dx_rpc', `wss://${HOST}/3dconnexion#`]);
      send([PREFIX, '3dconnexion', `wss://${HOST}/3dconnexion`]);
      send([PREFIX, 'self', 'tinkercad-spacemouse://local']);
      const { connexion } = await rpc('3dx_rpc:create', '3dconnexion:3dmouse', '0.8.1');
      const { instance } = await rpc('3dx_rpc:create', '3dconnexion:3dcontroller', connexion,
        { version: 0.8, name: 'Tinkercad', rowMajorOrder: false });
      ctrl = `3dconnexion:3dcontroller/${instance}`;
      send([SUBSCRIBE, ctrl]);
      await rpc('3dx_rpc:update', ctrl, { frame: { timingSource: 1 } });
      connecting = false;
      updateFocus(true);
      setStatus('Mit Treiber verbunden (v1.0)', 'ok');
      resolve();
    } catch (err) {
      reject(err);
    }
  } else if (t === CALL_RESULT || t === CALL_ERROR) {
    const p = pending.get(msg[1]);
    if (p) { pending.delete(msg[1]); t === CALL_RESULT ? p.res(msg[2]) : p.rej(new Error(msg[3] || 'RPC-Fehler')); }
  } else if (t === EVENT) {
    const c = msg[2];
    if (!Array.isArray(c) || c[0] !== CALL) return;
    const [, id, proc, , prop, value] = c;
    if (proc === 'self:read') {
      const v = readProp(prop);
      if (v === undefined) send([CALL_ERROR, id, proc + '#generic', prop + ' unknown']);
      else send([CALL_RESULT, id, v]);
    } else if (proc === 'self:update') {
      updateProp(prop, value);
      send([CALL_RESULT, id, null]);
    } else {
      send([CALL_ERROR, id, proc + '#generic', 'unknown procedure']);
    }
  }
}

let lastFocus = null;
function updateFocus(force) {
  const f = anyFocused();
  if (ctrl && (force || f !== lastFocus)) {
    lastFocus = f;
    fire('3dx_rpc:update', ctrl, { focus: f });
  }
  // Frame-Takt nur, solange ein Tinkercad-Tab im Vordergrund ist
  if (ctrl && f && !frameTimer) {
    frameTimer = setInterval(() => fire('3dx_rpc:update', ctrl, { frame: { time: Date.now() } }), 16);
  } else if ((!f || !ctrl) && frameTimer) {
    clearInterval(frameTimer); frameTimer = null;
  }
}

// ---------- Virtuelle Kamera ----------
const D0 = 100, FOV = 0.8, NEAR = 0.05, FAR = 1e6; // viel Abstand: Treiber soll nie an eine Zoom-Grenze stoßen
let cam, pivot, fov = FOV, ext = [-20, -20, -FAR, 20, 20, -NEAR];
function resetCam() {
  fov = FOV; ext = [-20, -20, -FAR, 20, 20, -NEAR];
  cam = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, D0, 1]; // Kamera bei (0,0,D0), Blick nach -z
  pivot = [0, 0, 0];
}
resetCam();

function readProp(p) {
  const h = NEAR * Math.tan(fov / 2);
  switch (p) {
    case 'view.affine': return cam;
    case 'view.perspective': return true;
    case 'view.fov': return fov;
    case 'view.frustum': return [-h, h, -h, h, NEAR, FAR];
    case 'view.extents': return ext;
    case 'view.target': return pivot;
    case 'view.rotatable': return true;
    case 'view.constructionPlane': return null;
    case 'model.extents': return [-1, -1, -1, 1, 1, 1];
    case 'model.floorPlane': return null; // keine Bodenebene – sonst blockiert der Treiber Bewegungen
    case 'model.unitsToMeters': return 0.001;
    case 'pivot.position': return pivot;
    case 'selection.empty': return true;
    case 'selection.extents': return [-1, -1, -1, 1, 1, 1];
    case 'selection.affine': return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    case 'pointer.position': return [0, 0, 0];
    case 'coordinateSystem': return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    case 'views.front': return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, D0, 1];
    case 'hit.lookat': return [0, 0, 0];
    case 'frame.timingSource': return 1;
    case 'frame.time': return Date.now();
  }
  return undefined;
}

// Spaltenweise 4x4: Element (Zeile r, Spalte c) = m[c*4 + r]
const R = (m, r, c) => m[c * 4 + r];

const seen = new Set();
let motionFlag = false;
function updateProp(p, v) {
  if (!seen.has(p)) { seen.add(p); toFocused({ type: 'debug', props: [...seen] }); }
  if (p === 'view.affine' && Array.isArray(v) && v.length >= 16) {
    if (!motionFlag && isJump(cam, v)) {
      // großer Sprung ohne Kappenbewegung → Taste der SpaceMouse (Fit)
      triggerFit();
      resetCam();
      return;
    }
    emitDelta(cam, v);
    cam = v.slice(0, 16);
  } else if (p === 'view.fov' && typeof v === 'number' && v > 0) {
    // Zoom über den Blickwinkel
    const z = Math.log(Math.tan(fov / 2) / Math.tan(v / 2));
    if (Math.abs(z) < 0.4) toFocused({ type: 'delta', wx: 0, wy: 0, px: 0, py: 0, zoom: z });
    fov = v;
  } else if (p === 'view.extents' && Array.isArray(v) && v.length >= 6) {
    // Zoom über die Bildausschnitt-Größe (orthografisch)
    const wA = ext[3] - ext[0], wB = v[3] - v[0];
    if (wA > 0 && wB > 0) {
      const z = Math.log(wA / wB);
      if (Math.abs(z) < 0.4) toFocused({ type: 'delta', wx: 0, wy: 0, px: 0, py: 0, zoom: z });
    }
    ext = v.slice(0, 6);
  } else if (p === 'events.keyPress' || p === 'commands.activeCommand') {
    // Taste der SpaceMouse → einpassen
    toFocused({ type: 'btn', what: p + '=' + JSON.stringify(v) });
    triggerFit();
  } else if (p === 'pivot.position' && Array.isArray(v) && v.length >= 3) {
    pivot = v.slice(0, 3);
  } else if (p === 'motion') {
    motionFlag = !!v;
    toFocused({ type: 'motion', on: !!v });
    if (!v) resetCam(); // nach jeder Bewegung zurück in die Ausgangslage
  }
}

function emitDelta(a, b) {
  // Rotation lokal: Rd = Ra^T * Rb
  const Rd = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += R(a, k, i) * R(b, k, j);
    Rd[i][j] = s;
  }
  const wx = (Rd[2][1] - Rd[1][2]) / 2; // um lokale Rechts-Achse (Nicken)
  const wy = (Rd[0][2] - Rd[2][0]) / 2; // um lokale Hoch-Achse (Gieren)

  // Translation ohne den Anteil, der durch Drehen um den Pivot entsteht
  const pa = [a[12], a[13], a[14]], pb = [b[12], b[13], b[14]];
  const rel = [pa[0] - pivot[0], pa[1] - pivot[1], pa[2] - pivot[2]];
  // Rw = Rb * Ra^T
  const rw = (i, j) => { let s = 0; for (let k = 0; k < 3; k++) s += R(b, i, k) * R(a, j, k); return s; };
  const pred = [0, 1, 2].map((i) => pivot[i] + rw(i, 0) * rel[0] + rw(i, 1) * rel[1] + rw(i, 2) * rel[2]);
  const t = [pb[0] - pred[0], pb[1] - pred[1], pb[2] - pred[2]];
  const lx = R(b, 0, 0) * t[0] + R(b, 1, 0) * t[1] + R(b, 2, 0) * t[2];
  const ly = R(b, 0, 1) * t[0] + R(b, 1, 1) * t[1] + R(b, 2, 1) * t[2];

  const lz = R(b, 0, 2) * t[0] + R(b, 1, 2) * t[1] + R(b, 2, 2) * t[2];
  // Abstand zum Drehpunkt (nach unten begrenzt, damit nahe am Pivot nichts explodiert)
  const dA = Math.max(1, Math.hypot(...rel));
  const viewH = 2 * dA * Math.tan(FOV / 2);
  // Zoom aus der Fahrtrichtung (Kamera schaut entlang -z): vorwärts = hineinzoomen.
  // Bleibt auch richtig, wenn die virtuelle Kamera durch den Drehpunkt fährt.
  // Stärke aus der Abstandsänderung zum Drehpunkt (unempfindlich gegen Drehen),
  // Richtung aus der Fahrtrichtung (kippt nicht, wenn die Kamera den Drehpunkt passiert).
  const dB = Math.max(1, Math.hypot(pb[0] - pivot[0], pb[1] - pivot[1], pb[2] - pivot[2]));
  const mag = Math.abs(Math.log(dA / dB));
  const zoom = Math.abs(lz) > 1e-9 ? Math.min(0.2, mag) * Math.sign(-lz) : 0;

  // Sprünge (z. B. "Fit"-Taste des Treibers) ignorieren
  if (Math.abs(wx) > 0.3 || Math.abs(wy) > 0.3 ||
      Math.abs(lx) > viewH || Math.abs(ly) > viewH) return;

  toFocused({ type: 'delta', wx, wy, px: lx / viewH, py: ly / viewH, zoom });
}

// ---------- Echte Mausrad-Signale über die Chrome-Debugger-Schnittstelle ----------
// Tinkercad ignoriert nachgebaute Mausrad-/Tasten-Ereignisse beim Zoomen.
// Über chrome.debugger erzeugte Eingaben gelten als echt.
const attached = new Set();
const attaching = new Map();

function ensureAttached(tabId) {
  if (attached.has(tabId)) return Promise.resolve();
  if (attaching.has(tabId)) return attaching.get(tabId);
  const p = new Promise((res, rej) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      attaching.delete(tabId);
      if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); return; }
      attached.add(tabId);
      res();
    });
  });
  attaching.set(tabId, p);
  return p;
}

chrome.debugger.onDetach.addListener((src) => { attached.delete(src.tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { attached.delete(tabId); });

async function realWheel(tabId, x, y, dir) {
  try {
    await ensureAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY: dir * 100,
    });
  } catch (err) {
    console.warn('[SpaceMouse] Zoom per Debugger fehlgeschlagen:', err);
    broadcast({ type: 'status', text: 'Zoom: ' + (err.message || err), kind: 'warn' });
  }
}

// ---------- Fit-Taste → Tinkercad "F" (einpassen: Auswahl oder ganzes Modell) ----------
let lastFit = 0;
function focusedTabId() {
  for (const [p, st] of ports) {
    if (st.focused && p.sender && p.sender.tab && p.sender.frameId === 0) return p.sender.tab.id;
  }
  return null;
}
async function triggerFit() {
  const now = Date.now();
  if (now - lastFit < 600) return;
  lastFit = now;
  toFocused({ type: 'fit' });
  const tabId = focusedTabId();
  if (tabId == null) return;
  try {
    await ensureAttached(tabId);
    const k = { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 };
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', text: 'f', unmodifiedText: 'f', ...k });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  } catch (err) {
    console.warn('[SpaceMouse] Fit fehlgeschlagen:', err);
  }
}

// Großer Sprung der Kamera (z. B. durch die Fit-Taste des Treibers)?
function isJump(a, b) {
  const pa = [a[12], a[13], a[14]], pb = [b[12], b[13], b[14]];
  const d = Math.max(1, Math.hypot(pa[0] - pivot[0], pa[1] - pivot[1], pa[2] - pivot[2]));
  const move = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) / d;
  let tr = 0; // Spur von Ra^T * Rb → Drehwinkel
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += R(a, k, i) * R(b, k, i);
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  return move > 0.3 || ang > 0.3;
}
