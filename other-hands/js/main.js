import { L, apply, applyDir, compose, inverse, mirrored } from './group.js';
import { ROOMS, FREE, buildRoom } from './rooms.js';
import { MeshBuilder, C, drawDiagram, handPath, TETRO } from './mesh.js';
import { Renderer, M4 } from './render.js';
import { Sound } from './sound.js';

const $ = (s) => document.querySelector(s);
const coarse = matchMedia('(pointer: coarse)').matches;
const FOG = [0.945, 0.937, 0.918];
const EYE = 1.6, RADIUS = 0.26, REACH = 2.7;
const R_DRAW = coarse ? 3 : 4;
const flipShape = (s) => (s === 'L' ? 'J' : 'L');

let renderer;
try {
  renderer = new Renderer($('#view'));
  renderer.maxDpr = coarse ? 1.5 : 2;
} catch (err) {
  $('#intro .lede').textContent = 'This museum needs WebGL2, which this browser does not provide.';
  $('#enter').disabled = true;
  throw err;
}
const sound = new Sound();

// ---------------------------------------------------------------- the visitor
// body-local: facing +z, so the visitor's right hand is on −x
function buildAvatar() {
  const m = new MeshBuilder();
  m.cylinder([0, 0, 0], 0.19, 0.25, 0, 1.3, C.graphite, 20);
  m.sphere([0, 1.53, 0], 0.17, C.paper, 12);
  m.box([-0.1, 1.5, 0.11], [0.1, 1.6, 0.185], C.cobalt, { lines: false });
  m.tube([[-0.24, 1.22, 0], [-0.33, 1.36, 0.1], [-0.36, 1.6, 0.16]], 0.05, C.graphite, 8);
  m.tube([[0.24, 1.22, 0], [0.31, 0.98, 0.04], [0.31, 0.76, 0.06]], 0.05, C.graphite, 8);
  const str = [];
  for (let k = 0; k <= 12; k++) { const t = k / 12; str.push([-0.36 - 0.15 * t, 1.6 + 0.98 * t, 0.16 + 0.05 * Math.sin(t * 3)]); }
  m.tube(str, 0.006, C.ink, 5);
  m.sphere([-0.51, 2.86, 0.21], 0.24, C.red, 16, 0.29);
  return m.data();
}
function buildBlob(uv) {
  const m = new MeshBuilder();
  const r = 0.62;
  m.quad([-r, 0.004, r], [r, 0.004, r], [r, 0.004, -r], [-r, 0.004, -r], [0, 1, 0], [1, 1, 1], uv, false);
  return m.data();
}
const avatarMesh = renderer.mesh(buildAvatar());

// ---------------------------------------------------------------- state
const S = {
  index: 0, free: false, freeGlue: { gx: 'twisted', gz: 'straight' },
  room: null, gpu: null,
  x: 0, z: 0, yaw: 0, pitch: -0.04,
  carrying: null, playing: false, busy: false,
  cellKey: '', h: null, mirror: false, boxes: [], boxesDirty: true,
  walked: 0, bob: 0, time: 0, look: null, solved: new Set(),
};
const keys = new Set();
const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };

async function loadRoom(which, keepPlace = false) {
  S.busy = true;
  const def = which === 'free' ? FREE : ROOMS[which];
  const glue = which === 'free' ? S.freeGlue : def;
  const room = buildRoom(def, glue.gx, glue.gz);
  for (const p of room.portals) if (p.open) p.panelCollider.off = true;
  const old = S.gpu;
  if (old) { renderer.free(old.stat); old.panels.forEach((m) => renderer.free(m)); old.glows.forEach((m) => renderer.free(m)); old.keys.forEach((m) => renderer.free(m)); renderer.free(old.blob); }
  renderer.setAtlas(room.atlas.canvas);
  S.gpu = {
    stat: renderer.mesh(room.mesh),
    panels: room.portals.map((p) => renderer.mesh(p.panel)),
    glows: room.portals.map((p) => renderer.mesh(p.glow)),
    keys: room.keys.map((k) => renderer.mesh(k.mesh)),
    blob: renderer.mesh(buildBlob(room.blobUV)),
  };
  S.room = room;
  S.free = which === 'free';
  if (!S.free) S.index = which;
  if (keepPlace) {
    const r = room.space.reduce(S.x, S.z);
    S.x = r.x; S.z = r.z;
  } else {
    S.x = def.start.x; S.z = def.start.z; S.yaw = def.start.yaw; S.pitch = -0.04;
  }
  S.carrying = null;
  S.cellKey = '';
  S.boxesDirty = true;
  instCache.key = ''; // copies belong to the old room's deck group until rebuilt
  const red = room.space.reduce(S.x, S.z);
  S.mirror = mirrored(red.g);
  updateRoomHUD();
  drawHand();
  S.busy = false;
}

// ---------------------------------------------------------------- collisions in the cover
function nearbyBoxes(space, ci, cj) {
  const out = [];
  for (const { g } of space.window(ci, cj, 1)) for (const c of S.room.colliders) {
    if (c.off) continue;
    const [ax, az] = apply(g, c.x0, c.z0), [bx, bz] = apply(g, c.x1, c.z1);
    out.push({ x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) });
  }
  return out;
}

function resolve(x, z, boxes) {
  for (let it = 0; it < 3; it++) for (const b of boxes) {
    const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;
    if (d2 > 1e-12) { const d = Math.sqrt(d2); x = cx + (dx / d) * RADIUS; z = cz + (dz / d) * RADIUS; }
    else {
      const p = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z], m = Math.min(...p);
      if (m === p[0]) x = b.x0 - RADIUS; else if (m === p[1]) x = b.x1 + RADIUS; else if (m === p[2]) z = b.z0 - RADIUS; else z = b.z1 + RADIUS;
    }
  }
  return [x, z];
}

// ---------------------------------------------------------------- movement
function move(dt) {
  let fwd = 0, str = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
  if (keys.has('KeyD')) str += 1;
  if (keys.has('KeyA')) str -= 1;
  if (keys.has('ArrowLeft')) S.yaw += dt * 2.0;
  if (keys.has('ArrowRight')) S.yaw -= dt * 2.0;
  fwd += -stick.y; str += stick.x;
  const mag = Math.hypot(fwd, str);
  if (mag > 1) { fwd /= mag; str /= mag; }
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.4 : 2.6;
  const s = Math.sin(S.yaw), c = Math.cos(S.yaw);
  let dx = (s * fwd - c * str) * speed * dt, dz = (c * fwd + s * str) * speed * dt;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const n = Math.ceil(len / 0.08);
  let x = S.x, z = S.z;
  for (let k = 0; k < n; k++) {
    x += dx / n; z += dz / n;
    const [ci, cj] = S.room.space.cellOf(x, z);
    const key = `${ci},${cj}`;
    if (S.boxesDirty || key !== S.boxKey) { S.boxes = nearbyBoxes(S.room.space, ci, cj); S.boxKey = key; S.boxesDirty = false; }
    [x, z] = resolve(x, z, S.boxes);
  }
  const moved = Math.hypot(x - S.x, z - S.z);
  S.walked += moved;
  S.bob += moved;
  if (S.walked > 0.78) { S.walked = 0; sound.step(); }
  S.x = x; S.z = z;
}

// ---------------------------------------------------------------- looking at things
function forward() {
  const cp = Math.cos(S.pitch);
  return [Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp];
}

function rayBox(o, d, min, max) {
  let t0 = 0, t1 = REACH;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / d[a];
    let ta = (min[a] - o[a]) * inv, tb = (max[a] - o[a]) * inv;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

function lookingAt() {
  const room = S.room;
  const o = [S.x, EYE, S.z], d = forward();
  const [ci, cj] = room.space.cellOf(S.x, S.z);
  let best = null, bt = REACH;
  const test = (kind, obj, box) => {
    for (const { g } of room.space.window(ci, cj, 1)) {
      const [ax, az] = apply(g, box.min[0], box.min[2]), [bx, bz] = apply(g, box.max[0], box.max[2]);
      const t = rayBox(o, d, [Math.min(ax, bx), box.min[1], Math.min(az, bz)], [Math.max(ax, bx), box.max[1], Math.max(az, bz)]);
      if (t < bt) { bt = t; best = { kind, obj, g }; }
    }
  };
  for (const k of room.keys) if (!k.taken) test('key', k, k.pick);
  for (const l of room.locks) if (!l.portal.open) test('lock', l, l.pick);
  for (const p of room.portals) if (!p.open) test('door', p, p.pick);
  return best;
}

function promptFor(t) {
  if (!t) return '';
  const use = coarse ? 'Tap Use' : 'E';
  if (t.kind === 'key') return `${use} · take the key`;
  if (t.kind === 'lock') return t.obj.kind === 'hand' ? `${use} · place your hand` : `${use} · try the key`;
  if (t.kind === 'door') return 'Locked';
  return '';
}

function use() {
  if (!S.playing || S.busy) return;
  const t = lookingAt();
  if (!t) return;
  const m = mirrored(t.g);
  if (t.kind === 'key') {
    const shape = m ? flipShape(t.obj.shape) : t.obj.shape;
    t.obj.taken = true;
    S.carrying = { shape };
    sound.take();
    toast(`You take the key. Seen from here it is an ${shape}.`);
    drawHand();
    return;
  }
  if (t.kind === 'door') {
    sound.fail();
    toast(t.obj.lock === 'hand' ? 'It opens for a hand. Try the plate beside it.' : 'It opens with a key. The lock is beside it.');
    return;
  }
  const lock = t.obj;
  if (lock.kind === 'hand') {
    // the print's thumb side as seen in this copy: +1 = thumb right = a left hand
    const seen = m ? -lock.thumb : lock.thumb;
    if (seen < 0) { openPortal(lock.portal, 'The print fits your right hand. In this copy of the room, it is a right hand.'); }
    else { sound.fail(); toast('That print is a left hand. Both of yours are right hands.'); }
  } else {
    const seen = m ? flipShape(lock.shape) : lock.shape;
    if (!S.carrying) { sound.fail(); toast(`The keyhole is shaped like a ${seen}.`); return; }
    if (S.carrying.shape === seen) {
      S.carrying = null;
      drawHand();
      openPortal(lock.portal, `From this copy of the room the keyhole is an ${seen}, like your key. It turns.`);
    } else { sound.fail(); toast(`Your key is an ${S.carrying.shape}. This keyhole is a ${seen}.`); }
  }
}

function openPortal(p, msg) {
  p.open = true;
  p.panelCollider.off = true;
  S.boxesDirty = true;
  sound.success();
  toast(msg, 4200);
  S.solved.add(S.room.def.id);
}

// ---------------------------------------------------------------- rendering
const view = { vp: null, eye: null, fog: FOG, fogDist: 27, time: 0 };
const instCache = { room: 0, key: '' };

function render() {
  const { w, h } = renderer.resize();
  const f = forward();
  const bob = Math.sin(S.bob * 4.1) * 0.022;
  const eye = [S.x, EYE + bob, S.z];
  const proj = M4.perspective(coarse ? 1.25 : 1.15, w / h, 0.05, 220);
  view.vp = M4.mul(proj, M4.lookDir(eye, f));
  view.eye = eye;
  view.time = S.time;

  const space = S.room.space;
  const red = space.reduce(S.x, S.z);
  const key = `${red.i},${red.j}`;
  if (key !== instCache.key) {
    instCache.list = space.window(red.i, red.j, R_DRAW);
    instCache.room = renderer.setInstances(renderer.instRoom, instCache.list.map((c) => c.g));
    instCache.key = key;
  }
  // the visitor is drawn in every copy but the one you are standing in
  const hinv = inverse(red.g);
  const others = [], all = [];
  for (const c of instCache.list) {
    const e = compose(c.g, hinv);
    all.push(e);
    if (c.i !== red.i || c.j !== red.j) others.push(e);
  }
  renderer.setInstances(renderer.instAvatar, others);
  if (!renderer.instBlob) renderer.instBlob = renderer.gl.createBuffer();
  renderer.setInstances(renderer.instBlob, all);

  renderer.begin(view);
  const I = M4.identity();
  renderer.draw(S.gpu.stat, renderer.instRoom, instCache.room, I);
  S.room.portals.forEach((p, k) => {
    if (p.anim < 1) renderer.draw(S.gpu.panels[k], renderer.instRoom, instCache.room, M4.translate(0, -p.anim * 2.54, 0));
    if (p.anim > 0.02) renderer.draw(S.gpu.glows[k], renderer.instRoom, instCache.room, I, 1);
  });
  S.room.keys.forEach((k, i) => {
    if (!k.taken) renderer.draw(S.gpu.keys[i], renderer.instRoom, instCache.room, M4.translate(0, 0.025 * Math.sin(S.time * 1.7), 0));
  });
  const B = M4.placeY(S.x, 0, S.z, S.yaw);
  renderer.draw(avatarMesh, renderer.instAvatar, others.length, B);
  renderer.draw(S.gpu.blob, renderer.instBlob, all.length, B, 2);

  // crossing into another copy
  const mir = mirrored(red.g);
  if (key !== S.cellKey) {
    if (S.cellKey) {
      sound.seam(mir !== S.mirror);
      if (mir !== S.mirror) flash(mir ? 'You are now the mirror image of the room' : 'Back the right way round');
    }
    S.cellKey = key;
    S.mirror = mir;
  }
  drawMap(red);
}

// ---------------------------------------------------------------- HUD
const mapCanvas = $('#map');
const mctx = mapCanvas.getContext('2d');
function drawMap(red) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = mapCanvas.clientWidth, H = mapCanvas.clientHeight;
  if (mapCanvas.width !== Math.round(W * dpr)) { mapCanvas.width = Math.round(W * dpr); mapCanvas.height = Math.round(H * dpr); }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, W, H);
  const s = Math.min(W, H) - 24, x0 = (W - s) / 2, y0 = 12;
  mctx.fillStyle = 'rgba(30,30,35,0.04)';
  mctx.fillRect(x0, y0, s, s);
  drawDiagram(mctx, x0, y0, s, S.room.def.gx, S.room.def.gz);
  // the visitor, as the room sees them
  const px = x0 + ((red.x + L / 2) / L) * s, py = y0 + ((L / 2 - red.z) / L) * s;
  const f = forward();
  const [fx, fz] = applyDir(inverse(red.g), f[0], f[2]);
  const a = Math.atan2(-fz, fx);
  mctx.save();
  mctx.translate(px, py);
  mctx.fillStyle = 'rgba(43,69,255,0.16)';
  mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, s * 0.2, a - 0.5, a + 0.5); mctx.closePath(); mctx.fill();
  mctx.fillStyle = '#ff4533';
  mctx.beginPath(); mctx.arc(0, 0, 4.5, 0, Math.PI * 2); mctx.fill();
  mctx.restore();
  // a hand glyph: which hand the room would say you are
  const gy = y0 + s + 14;
  mctx.save();
  mctx.fillStyle = S.mirror ? '#2b45ff' : '#1e1e23';
  handPath(mctx, x0 + 9, gy + 7, W < 140 ? 16 : 20, S.mirror ? 1 : -1);
  mctx.font = '10px "Fragment Mono", monospace';
  mctx.textBaseline = 'middle';
  mctx.fillText(W < 140 ? (S.mirror ? 'mirrored' : 'original') : S.mirror ? 'you: mirrored' : 'you: as you were', x0 + 24, gy + 4);
  mctx.restore();
}

function updateRoomHUD() {
  const d = S.room.def;
  $('#roomNum').textContent = d.numeral;
  $('#roomTitle').textContent = d.title;
  $('#roomGoal').textContent = d.goal;
  $('#roomSpace').textContent = S.room.space.name;
  $('#freePanel').hidden = !S.free;
  document.querySelectorAll('#roomList button').forEach((b) => b.classList.toggle('on', b.dataset.room === String(S.free ? 'free' : S.index)));
}

function drawHand() {
  const c = $('#hand');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = c.clientWidth, H = c.clientHeight;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // the balloon string, rising out of frame
  g.strokeStyle = '#1e1e23'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(W * 0.42, H * 0.5); g.bezierCurveTo(W * 0.38, H * 0.3, W * 0.5, H * 0.15, W * 0.44, -4); g.stroke();
  // the back of a right hand: thumb on the left
  g.fillStyle = '#26262b';
  g.save(); g.translate(W * 0.5, H * 0.86); g.rotate(-0.12);
  handPath(g, 0, 0, H * 0.62, -1);
  g.restore();
  if (S.carrying) {
    const u = H * 0.085, ox = W * 0.12, oy = H * 0.86;
    g.fillStyle = '#2b45ff';
    for (const [cx, cy] of TETRO[S.carrying.shape]) g.fillRect(ox + cx * u, oy - (cy + 1) * u, u - 1.5, u - 1.5);
    g.fillStyle = '#1e1e23';
    g.font = '600 11px "Fragment Mono", monospace';
    g.fillText(`key · ${S.carrying.shape}`, ox, oy + 16);
  }
}

let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
let flashTimer = 0;
function flash(msg) {
  const f = $('#flash');
  f.textContent = msg;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- moving between rooms
async function nextRoom() {
  if (S.busy) return;
  S.busy = true;
  sound.portal();
  const leftMirrored = S.mirror;
  document.body.classList.add('whiteout');
  await wait(650);
  if (S.index < ROOMS.length - 1) {
    await loadRoom(S.index + 1);
    await wait(80);
    document.body.classList.remove('whiteout');
  } else {
    S.playing = false;
    document.exitPointerLock?.();
    document.body.classList.remove('playing');
    $('#endNote').textContent = leftMirrored
      ? 'You walked out mirror-reversed: your heart, as far as these rooms are concerned, is on your right. From the inside there is no test that could tell you so.'
      : 'You walked out the right way round. Twice reflected is not reflected at all. Try again and leave by a different copy of the door.';
    $('#end').hidden = false;
    document.body.classList.remove('whiteout');
    S.busy = false;
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function checkPortals() {
  const red = S.room.space.reduce(S.x, S.z);
  for (const p of S.room.portals) {
    if (!p.open || p.anim < 0.9) continue;
    const t = p.trigger;
    if (red.x > t.x0 && red.x < t.x1 && red.z > t.z0 && red.z < t.z1) { nextRoom(); return; }
  }
}

// ---------------------------------------------------------------- input
const canvas = $('#view');
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('dialog')) return;
  keys.add(e.code);
  if (!S.playing) return;
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); use(); }
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function turn(dx, dy, k) {
  S.yaw -= dx * k;
  S.pitch = Math.max(-1.35, Math.min(1.35, S.pitch - dy * k));
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!S.playing) return;
  sound.ensure();
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* drag to look instead */ }
    }
    if (document.pointerLockElement === canvas) use();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: true };
    return;
  }
  // touch: the left third steers, the rest looks
  if (e.clientX < innerWidth * 0.38 && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY;
    $('#stick').style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    $('#stick').classList.add('on');
  } else drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) { turn(e.movementX, e.movementY, 0.0022); return; }
  if (e.pointerId === stick.id) {
    const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, m = Math.hypot(dx, dy), r = 46;
    const k = m > r ? r / m : 1;
    stick.x = (dx * k) / r; stick.y = (dy * k) / r;
    $('#knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    return;
  }
  if (drag && drag.id === e.pointerId) {
    turn(e.clientX - drag.x, e.clientY - drag.y, drag.mouse ? 0.004 : 0.006);
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
const endPtr = (e) => {
  if (e.pointerId === stick.id) {
    stick.id = null; stick.x = 0; stick.y = 0;
    $('#knob').style.transform = '';
    $('#stick').classList.remove('on');
  }
  if (drag && drag.id === e.pointerId) drag = null;
};
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
$('#useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); sound.ensure(); use(); });

// ---------------------------------------------------------------- menus
$('#enter').onclick = async () => {
  sound.ensure();
  $('#intro').hidden = true;
  document.body.classList.add('playing');
  S.yaw = (S.free ? FREE : ROOMS[S.index]).start.yaw; // undo the intro's slow look-around
  S.playing = true;
  if (!coarse && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  toast(coarse ? 'Left thumb walks. Right thumb looks.' : 'WASD to walk, mouse to look, E to use.', 3800);
};
$('#again').onclick = async () => {
  $('#end').hidden = true;
  S.solved.clear();
  await loadRoom(0);
  document.body.classList.add('playing');
  S.playing = true;
};
$('#toFree').onclick = async () => {
  $('#end').hidden = true;
  await loadRoom('free');
  document.body.classList.add('playing');
  S.playing = true;
};
ROOMS.forEach((r, i) => {
  const b = document.createElement('button');
  b.dataset.room = String(i);
  b.innerHTML = `<span>${r.numeral}</span>${r.title}`;
  b.onclick = async () => { closeMenu(); $('#end').hidden = true; $('#intro').hidden = true; document.body.classList.add('playing'); await loadRoom(i); S.playing = true; };
  $('#roomList').appendChild(b);
});
{
  const b = document.createElement('button');
  b.dataset.room = 'free';
  b.innerHTML = '<span>∞</span>Free walk';
  b.onclick = async () => { closeMenu(); $('#end').hidden = true; $('#intro').hidden = true; document.body.classList.add('playing'); await loadRoom('free'); S.playing = true; };
  $('#roomList').appendChild(b);
}
function closeMenu() { $('#menu').classList.remove('open'); }
$('#menuBtn').onclick = (e) => { e.stopPropagation(); document.exitPointerLock?.(); $('#menu').classList.toggle('open'); };
document.addEventListener('pointerdown', (e) => { if (!$('#menu').contains(e.target) && e.target !== $('#menuBtn')) closeMenu(); });
$('#soundBtn').onclick = () => { sound.on = !sound.on; $('#soundBtn').classList.toggle('off', !sound.on); $('#soundBtn').textContent = sound.on ? 'Sound on' : 'Sound off'; };
$('#aboutBtn').onclick = () => { document.exitPointerLock?.(); $('#about').showModal(); };

document.querySelectorAll('#freePanel [data-axis]').forEach((group) => {
  group.querySelectorAll('button').forEach((b) => {
    b.onclick = async () => {
      const axis = group.dataset.axis, other = axis === 'gx' ? 'gz' : 'gx';
      if (b.dataset.v === 'twisted' && S.freeGlue[other] === 'twisted') S.freeGlue[other] = 'straight';
      S.freeGlue[axis] = b.dataset.v;
      syncFreePanel();
      await loadRoom('free', true);
    };
  });
});
function syncFreePanel() {
  document.querySelectorAll('#freePanel [data-axis]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', S.freeGlue[group.dataset.axis] === b.dataset.v));
  });
}
syncFreePanel();

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  S.time += dt;
  renderer.adapt(dt);
  if (S.room && !S.busy) {
    if (S.playing) move(dt);
    else S.yaw += dt * 0.05; // the intro slowly looks around
    for (const p of S.room.portals) if (p.open && p.anim < 1) p.anim = Math.min(1, p.anim + dt / 1.1);
    render();
    if (S.playing) {
      checkPortals();
      const t = lookingAt();
      const msg = promptFor(t);
      const pr = $('#prompt');
      if (pr.textContent !== msg) pr.textContent = msg;
      pr.classList.toggle('show', !!msg);
      $('#useBtn').classList.toggle('ready', !!t);
    }
  }
  requestAnimationFrame(frame);
}

(async () => {
  try {
    await Promise.race([
      Promise.all(['700 40px "Familjen Grotesk"', '400 20px "Familjen Grotesk"', '500 14px "Fragment Mono"'].map((f) => document.fonts.load(f))),
      wait(2500),
    ]);
  } catch { /* fall back to system fonts */ }
  await loadRoom(0);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
})();

window.museum = { S, loadRoom, use, lookingAt, ROOMS, view, forward };
