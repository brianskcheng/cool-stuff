import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { RNG, clamp, smoothstep } from './rng.js';
import { FLOOR_H, YEAR_START, YEAR_END, CAPTIONS, ERAS, MODE_NOTES, OCCUPANTS, SITE_KM2, PARK_OPEN } from './history.js';
import { generateCity, lotState, cityStats, heightfield, sunHours, upperRect, occupancy } from './city.js';
import { U, makeSignAtlas } from './facade.js';
import { CityWorld } from './world.js';
import { buildYamen, buildWires, Dust, Park } from './park.js';
import { Environment } from './environment.js';
import { Traffic, APPROACH } from './plane.js';
import { Weather } from './weather.js';
import { Soundscape } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

// --- renderer --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.3, 24000);
camera.position.set(190, 95, 235);
const controls = new OrbitControls(camera, canvas);
controls.target.set(-5, 14, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 25;
controls.maxDistance = 2200;
controls.maxPolarAngle = 1.5;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.18;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.42, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(Math.floor(w / 2), Math.floor(h / 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- world -----------------------------------------------------------------
const env = new Environment(scene);
const weather = new Weather(scene);
const traffic = new Traffic(scene);
const sound = new Soundscape();
weather.onThunder = (d) => sound.thunder(d);
scene.add(buildYamen());
const dust = new Dust();
scene.add(dust.points);

const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", "WenQuanYi Zen Hei", sans-serif';
let atlas = null;
let city, world, wires, park, popCurve;

const S = {
  year: 1984.3, playing: false, speed: 1, hour: 19.1, lock: null, mode: 'orbit',
  seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e6), entered: false,
};

function build(seed) {
  if (world) {
    scene.remove(world.group, wires, park.group);
    world.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  S.seed = seed;
  city = generateCity(seed);
  world = new CityWorld(city, scene, atlas);
  wires = buildWires(city);
  scene.add(wires);
  park = new Park(city);
  scene.add(park.group);
  popCurve = [];
  for (let y = YEAR_START; y <= YEAR_END; y += 0.25) popCurve.push([y, cityStats(city, y).pop]);
  $('seed').textContent = `city #${seed}`;
  lastSun = -99;
  pickClear();
}

// --- captions & ui -----------------------------------------------------------
let capIdx = -1, capTimer = 0;
function showCaption(c, sticky = false) {
  $('cap-zh').textContent = c.zh;
  $('cap-text').textContent = c.text;
  $('caption').classList.add('on');
  capTimer = sticky ? 1e9 : 11;
}
function captionFor(y) { let k = -1; CAPTIONS.forEach((c, i) => { if (c.year <= y) k = i; }); return k; }

const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildTimeline() {
  const eras = $('eras');
  eras.innerHTML = '';
  for (const e of ERAS) {
    const d = document.createElement('div');
    d.className = 'era';
    d.style.flexGrow = String(e.to - e.from);
    d.innerHTML = `<span class="zh">${e.zh}</span><span>${e.name}</span>`;
    d.title = `${e.name} ${Math.floor(e.from)}–${Math.floor(e.to)}`;
    eras.appendChild(d);
  }
  const ticks = $('ticks');
  ticks.innerHTML = '';
  for (const c of CAPTIONS) {
    const t = document.createElement('i');
    t.style.left = `${((c.year - YEAR_START) / (YEAR_END - YEAR_START)) * 100}%`;
    ticks.appendChild(t);
  }
}

let lastSun = -99, sunStat = { ground: 0, dark: 0 }, hfBuf = null;
function computeSun() {
  hfBuf = heightfield(city, S.year, hfBuf);
  const doy = (S.year % 1) * 365;
  const rng = new RNG(Math.floor(S.year * 10));
  let n = 0, sumLow = 0, never = 0;
  for (let k = 0; k < 90; k++) {
    const L = city.lots[rng.int(0, city.lots.length - 1)];
    const st = lotState(L, S.year);
    if (!st.floors) continue;
    const side = rng.int(0, 3);
    const sd = L.sides[side];
    if (sd.gap < 0.9 && !sd.street && !sd.courtyard) continue;
    const fl = rng.int(0, st.floors - 1);
    const r = fl >= 2 ? upperRect(L, st.gen) : L;
    const nx = [1, -1, 0, 0][side], nz = [0, 0, 1, -1][side];
    const p = { x: side === 0 ? r.x1 + 0.3 : side === 1 ? r.x0 - 0.3 : rng.range(r.x0, r.x1), y: fl * FLOOR_H + 1.5, z: side === 2 ? r.z1 + 0.3 : side === 3 ? r.z0 - 0.3 : rng.range(r.z0, r.z1) };
    const h = sunHours(hfBuf, p, { x: nx, y: 0, z: nz }, doy);
    n++;
    if (h < 0.25) never++;
    if (fl < 4) sumLow += h;
  }
  sunStat = { dark: n ? never / n : 0, low: sumLow };
}

function drawSpark() {
  const c = $('spark'), g = c.getContext('2d');
  const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
  g.clearRect(0, 0, W, H);
  const max = 36000;
  const X = (y) => ((y - YEAR_START) / (YEAR_END - YEAR_START)) * W, Y = (p) => H - 2 - (p / max) * (H - 6);
  g.strokeStyle = 'rgba(236,230,218,0.12)'; g.lineWidth = 1;
  for (const v of [10000, 20000, 30000]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); }
  g.beginPath(); g.moveTo(0, H);
  for (const [y, p] of popCurve) g.lineTo(X(y), Y(p));
  g.lineTo(W, H); g.closePath();
  g.fillStyle = 'rgba(191,245,214,0.14)'; g.fill();
  g.beginPath();
  popCurve.forEach(([y, p], i) => (i ? g.lineTo(X(y), Y(p)) : g.moveTo(X(y), Y(p))));
  g.strokeStyle = 'rgba(191,245,214,0.8)'; g.lineWidth = 1.5 * devicePixelRatio; g.stroke();
  const st = cityStats(city, S.year);
  g.fillStyle = '#ff3b4e';
  g.beginPath(); g.arc(X(S.year), Y(st.pop), 3.5 * devicePixelRatio, 0, 7); g.fill();
}

let uiTimer = 0;
function updateUI(force) {
  const y = S.year;
  const yi = Math.floor(y), mo = MONTHS[Math.floor((y - yi) * 12)];
  $('year').textContent = yi;
  $('month').textContent = mo;
  $('scrub').value = String(((y - YEAR_START) / (YEAR_END - YEAR_START)) * 1000);
  const hh = Math.floor(S.hour), mm = Math.floor((S.hour - hh) * 60);
  $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  uiTimer -= 1;
  if (uiTimer > 0 && !force) return;
  uiTimer = 8;
  const st = cityStats(city, y);
  $('pop').textContent = fmt(st.pop);
  $('density').textContent = st.pop > 50 ? `${(st.pop / SITE_KM2 / 1e6).toFixed(2)}M` : '—';
  $('storeys').textContent = st.maxFloors ? `${st.maxFloors}` : '—';
  $('blocks').textContent = st.built ? fmt(st.built) : '—';
  $('dark').textContent = st.built ? `${Math.round(sunStat.dark * 100)}%` : '—';
  $('dark-row').classList.toggle('warn', sunStat.dark > 0.5);
  $('play').textContent = S.playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(S.playing));
  drawSpark();
}

// --- cameras ---------------------------------------------------------------
const look = { yaw: 0, pitch: 0, dyaw: 0, dpitch: 0 };
const walker = { seg: null, s: 0, dir: 1, pos: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), until: 0 };
let rideTarget = null, roofLot = null;

function setMode(m) {
  S.mode = m;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  controls.enabled = m === 'orbit';
  look.dyaw = look.dpitch = 0;
  if (MODE_NOTES[m]) showCaption({ zh: { rooftop: '天台', alley: '暗巷', ride: '十三號跑道' }[m], text: MODE_NOTES[m] });
  if (m === 'orbit') {
    camera.position.set(190, 95, 235);
    controls.target.set(-5, 14, 0);
    controls.update();
  }
  if (m === 'rooftop') pickRoof();
  if (m === 'alley') startWalk();
  if (m === 'ride') {
    rideTarget = traffic.planes.find((p) => p.s < APPROACH.S1 - 600) || traffic.spawn(S.year, APPROACH.S1 - 1700);
  }
  pickClear();
}

function pickRoof() {
  let best = null, bs = -Infinity;
  for (const L of city.lots) {
    const st = lotState(L, S.year);
    if (!st.floors || st.building) continue;
    const off = Math.abs(L.cz - L.cx - 30) / Math.SQRT2; // distance to the final approach track
    const score = st.floors * 3 - off * 0.6;
    if (score > bs) { bs = score; best = L; }
  }
  roofLot = best;
  if (!best) return setMode('orbit');
  look.yaw = Math.atan2(-(APPROACH.E.x - best.cx), -(APPROACH.E.z - best.cz));
  look.pitch = 0.1;
}

function startWalk() {
  const segs = city.segs.filter((s) => s.s1 - s.s0 > 20);
  walker.seg = segs[Math.floor(Math.random() * segs.length)] || city.segs[0];
  walker.s = walker.seg.s0 + 2;
  walker.dir = 1;
  const p = segPoint(walker.seg, walker.s);
  walker.pos.set(p.x, 1.65, p.z);
  look.yaw = 0; look.pitch = 0;
}
const segPoint = (g, s) => (g.axis === 'z' ? { x: g.c, z: s } : { x: s, z: g.c });

function stepWalk(dt) {
  const g = walker.seg;
  const speed = 1.9;
  const prevS = walker.s;
  walker.s += walker.dir * speed * dt;
  // junctions with crossing lanes
  for (const o of city.segs) {
    if (o === g || o.axis === g.axis) continue;
    if (o.c > Math.min(prevS, walker.s) && o.c <= Math.max(prevS, walker.s)) {
      const here = g.c;
      if (here > o.s0 + 2 && here < o.s1 - 2 && performance.now() > walker.until && Math.random() < 0.45) {
        walker.seg = o; walker.s = here;
        walker.dir = (o.s1 - here) > (here - o.s0) ? 1 : -1;
        if (Math.random() < 0.3) walker.dir *= -1;
        if (walker.dir > 0 && o.s1 - here < 6) walker.dir = -1;
        if (walker.dir < 0 && here - o.s0 < 6) walker.dir = 1;
        walker.until = performance.now() + 4000;
        break;
      }
    }
  }
  const G = walker.seg;
  if (walker.s > G.s1 - 1 || walker.s < G.s0 + 1) { walker.dir *= -1; walker.s = clamp(walker.s, G.s0 + 1, G.s1 - 1); }
  const p = segPoint(G, walker.s);
  const target = new THREE.Vector3(p.x, 1.65 + Math.sin(performance.now() * 0.006) * 0.03, p.z);
  walker.pos.lerp(target, 1 - Math.exp(-dt * 4));
  const d = G.axis === 'z' ? new THREE.Vector3(0, 0, walker.dir) : new THREE.Vector3(walker.dir, 0, 0);
  walker.heading.lerp(d, 1 - Math.exp(-dt * 2.2)).normalize();
}

function applyLookCamera(pos, baseYaw, basePitch) {
  camera.position.copy(pos);
  const yaw = baseYaw + look.dyaw, pitch = clamp(basePitch + look.dpitch, -1.2, 1.3);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function updateCamera(dt) {
  if (S.mode === 'orbit') { controls.update(); return; }
  if (S.mode === 'rooftop') {
    const st = roofLot && lotState(roofLot, S.year);
    if (!st || !st.floors) return setMode('orbit');
    applyLookCamera(new THREE.Vector3(roofLot.cx, st.floors * FLOOR_H + 1.7, roofLot.cz), look.yaw, look.pitch);
  }
  if (S.mode === 'alley') {
    stepWalk(dt);
    const yaw = Math.atan2(-walker.heading.x, -walker.heading.z);
    applyLookCamera(walker.pos, yaw, 0.12);
  }
  if (S.mode === 'ride') {
    if (!rideTarget || !traffic.planes.includes(rideTarget) || rideTarget.s > APPROACH.S4 + 700) {
      rideTarget = traffic.spawn(S.year, APPROACH.S1 - 1700);
    }
    const g = rideTarget.ac.group;
    const yaw = Math.atan2(rideTarget.dir.x, rideTarget.dir.z);
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const span = rideTarget.ac.P.L;
    const want = g.position.clone().addScaledVector(back, span * 1.4).addScaledVector(right, span * 0.55).add(new THREE.Vector3(0, span * 0.32, 0));
    if (camera.position.distanceTo(want) > 400) camera.position.copy(want);
    camera.position.lerp(want, 1 - Math.exp(-dt * 3));
    const ahead = g.position.clone().addScaledVector(rideTarget.dir, span * 2.2);
    camera.lookAt(ahead);
    camera.rotateY(look.dyaw);
    camera.rotateX(look.dpitch);
  }
}

// drag-to-look for the first-person modes
let drag = null;
canvas.addEventListener('pointerdown', (e) => { if (!world) return; drag = { x: e.clientX, y: e.clientY, moved: 0 }; controls.autoRotate = false; });
window.addEventListener('pointermove', (e) => {
  if (!world) return;
  if (!drag) return hover(e);
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  if (S.mode !== 'orbit') { look.dyaw -= dx * 0.004; look.dpitch -= dy * 0.004; }
});
window.addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 5 && e.target === canvas) pick(e);
  drag = null;
});

// --- picking -----------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 0.6) }));
highlight.visible = false;
scene.add(highlight);
let picked = null;

function rayHit(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(world.buildings, false);
  return hits[0];
}
let hoverT = 0;
function hover(e) {
  if (S.mode !== 'orbit' || performance.now() - hoverT < 80 || e.target !== canvas) return;
  hoverT = performance.now();
  canvas.style.cursor = rayHit(e) ? 'pointer' : 'grab';
}

function pickClear() { picked = null; highlight.visible = false; $('card').hidden = true; }

function pick(e) {
  const h = rayHit(e);
  if (!h || h.instanceId == null) return pickClear();
  const L = world.lotOf(h.instanceId);
  const st = lotState(L, S.year);
  if (!st.floors) return pickClear();
  const fl = clamp(Math.floor(h.point.y / FLOOR_H), 0, st.floors - 1);
  picked = { L, fl, normal: h.face ? h.face.normal.clone() : new THREE.Vector3(1, 0, 0), point: h.point.clone() };
  renderCard();
}

function nearestStreet(L) {
  let best = null, bd = Infinity;
  for (const s of city.segs) {
    const d = s.axis === 'z' ? Math.abs(L.cx - s.c) + Math.max(0, s.s0 - L.cz, L.cz - s.s1) : Math.abs(L.cz - s.c) + Math.max(0, s.s0 - L.cx, L.cx - s.s1);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? best.name : ['城內', 'Inner lanes'];
}

function renderCard() {
  if (!picked) return;
  const { L, fl } = picked;
  const st = lotState(L, S.year);
  if (!st.floors || fl >= st.floors) return pickClear();
  const g = st.gen;
  const rng = new RNG((L.id + 1) * 7919 + fl * 31 + Math.floor(g.start * 10));
  const weights = OCCUPANTS.map((o) => {
    let w = o.w;
    if (fl === 0 && ['fishball', 'noodle', 'plastics', 'metal'].includes(o.k)) w *= 5;
    if (fl <= 3 && L.perimeter && ['dentist', 'doctor'].includes(o.k)) w *= 6;
    if (fl > 6 && ['fishball', 'noodle', 'metal'].includes(o.k)) w *= 0.3;
    if (g.kind === 0 && !['home', 'empty', 'mahjong', 'noodle'].includes(o.k)) w *= 0.2;
    return [o, w];
  });
  const occ = occupancy(L, S.year) < 0.2 ? OCCUPANTS.find((o) => o.k === 'empty') : rng.weighted(weights);
  const street = nearestStreet(L);
  const no = L.id * 2 + 1;
  const floorName = fl === 0 ? 'G/F' : `${fl}/F`;
  hfBuf = heightfield(city, S.year, hfBuf);
  const sides = [0, 1, 2, 3].filter((s) => L.sides[s].gap >= 0.9 || L.sides[s].street || L.sides[s].courtyard);
  const r = fl >= 2 ? upperRect(L, g) : L;
  const doy = (S.year % 1) * 365;
  let best = 0, bestSide = sides[0];
  for (const side of sides) {
    const nx = [1, -1, 0, 0][side], nz = [0, 0, 1, -1][side];
    const p = { x: side === 0 ? r.x1 + 0.3 : side === 1 ? r.x0 - 0.3 : (r.x0 + r.x1) / 2, y: fl * FLOOR_H + 1.5, z: side === 2 ? r.z1 + 0.3 : side === 3 ? r.z0 - 0.3 : (r.z0 + r.z1) / 2 };
    const hrs = sunHours(hfBuf, p, { x: nx, y: 0, z: nz }, doy);
    if (hrs >= best) { best = hrs; bestSide = side; }
  }
  const face = ['east', 'west', 'south', 'north'][bestSide] || '—';
  const kinds = ['timber hut', 'low-rise, concrete', 'tower, concrete frame'];
  $('card-zh').textContent = street[0];
  $('card-addr').textContent = `${no} ${street[1]}, ${floorName}`;
  $('card-occ').textContent = `${occ.zh} · ${occ.label(rng)}`;
  $('card-built').textContent = `${Math.floor(g.start)} · ${kinds[g.kind]}`;
  $('card-storeys').textContent = `${st.floors}${st.building ? ' (rising)' : ''}`;
  $('card-sun').textContent = sides.length ? `${best.toFixed(best < 1 ? 2 : 1)} h, best face ${face}` : 'none: party walls on all sides';
  $('card-sun-row').classList.toggle('warn', best < 0.5);
  $('card').hidden = false;
  const sh = st.floors > 2 && fl >= 2 ? upperRect(L, g) : L;
  highlight.position.set((sh.x0 + sh.x1) / 2, fl * FLOOR_H, (sh.z0 + sh.z1) / 2);
  highlight.scale.set(sh.x1 - sh.x0 + 0.3, FLOOR_H, sh.z1 - sh.z0 + 0.3);
  highlight.visible = true;
}

// --- controls ----------------------------------------------------------------
const SPEEDS = [0.5, 1, 2, 4];
const TIMES = [[null, 'Auto'], [6.4, 'Dawn'], [12.5, 'Noon'], [18.4, 'Dusk'], [22.5, 'Night']];
let timeIdx = 0;
const WEATHERS = ['auto', 'clear', 'rain', 'storm'];
let weatherIdx = 0;

function togglePlay(v = !S.playing) {
  S.playing = v;
  if (S.playing && S.year >= YEAR_END - 0.01) restart(false);
  updateUI(true);
}
function restart(newSeed) {
  if (newSeed) build(Math.floor(Math.random() * 1e6));
  S.year = YEAR_START;
  capIdx = -1;
  for (const p of [...traffic.planes]) p.s = 1e9;
  traffic.spawn(S.year, APPROACH.S1 - 900);
}
$('play').onclick = () => togglePlay();
$('speed').onclick = () => {
  S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
  $('speed').textContent = `${S.speed}×`;
};
$('tod').onclick = () => {
  timeIdx = (timeIdx + 1) % TIMES.length;
  S.lock = TIMES[timeIdx][0];
  $('tod').textContent = TIMES[timeIdx][1];
};
$('wx').onclick = () => {
  weatherIdx = (weatherIdx + 1) % WEATHERS.length;
  weather.set(WEATHERS[weatherIdx]);
  $('wx').textContent = WEATHERS[weatherIdx][0].toUpperCase() + WEATHERS[weatherIdx].slice(1);
};
$('snd').onclick = () => {
  if (sound.on) sound.stop(); else sound.start();
  $('snd').textContent = sound.on ? 'Sound on' : 'Sound off';
  $('snd').setAttribute('aria-pressed', String(sound.on));
};
$('regrow').onclick = () => { restart(true); togglePlay(true); };
$('card-close').onclick = pickClear;
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$('scrub').addEventListener('input', (e) => {
  S.year = YEAR_START + (Number(e.target.value) / 1000) * (YEAR_END - YEAR_START);
  const k = captionFor(S.year);
  if (k >= 0 && k !== capIdx) { capIdx = k; showCaption(CAPTIONS[k]); }
  updateUI(true);
});
window.addEventListener('keydown', (e) => {
  if (!world) return; // still laying out the lots
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright') { S.year = Math.min(YEAR_END, S.year + 1); updateUI(true); }
  else if (k === 'arrowleft') { S.year = Math.max(YEAR_START, S.year - 1); updateUI(true); }
  else if ('1234'.includes(k) && k.length === 1) setMode(['orbit', 'rooftop', 'alley', 'ride'][Number(k) - 1]);
  else if (k === 'n') $('tod').click();
  else if (k === 'r') $('wx').click();
  else if (k === 'm') $('snd').click();
  else if (k === 'g') $('regrow').click();
  else if (k === 'escape') pickClear();
});

function enter(grow) {
  S.entered = true;
  document.body.classList.add('entered');
  $('intro').classList.add('gone');
  setTimeout(() => ($('intro').hidden = true), 900);
  sound.start();
  $('snd').textContent = 'Sound on';
  $('snd').setAttribute('aria-pressed', 'true');
  if (grow) { restart(false); S.hour = 17.6; }
  togglePlay(grow);
  if (!grow) { capIdx = captionFor(S.year); showCaption(CAPTIONS[capIdx]); }
}
$('enter-grow').onclick = () => world && enter(true);
$('enter-peak').onclick = () => world && enter(false);

// --- loop --------------------------------------------------------------------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), upv = new THREE.Vector3();
let simT = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  simT += dt;
  U.uTime.value = simT;

  if (S.playing) {
    S.year += dt * 0.3 * S.speed;
    if (S.year >= YEAR_END) {
      S.year = YEAR_END;
      S.playing = false;
      showCaption({ zh: '完', text: 'The city is gone; the garden stays. Press Regrow to grow a different one from a new seed.' }, true);
      updateUI(true);
    }
    const k = captionFor(S.year);
    if (k !== capIdx && k >= 0) { capIdx = k; showCaption(CAPTIONS[k]); }
  }
  // time of day
  const hourRate = S.playing ? 0.42 * Math.sqrt(S.speed) : 0.25;
  if (S.lock == null) S.hour = (S.hour + dt * hourRate) % 24;
  else {
    let d = S.lock - S.hour; if (d > 12) d -= 24; if (d < -12) d += 24;
    S.hour = (S.hour + d * (1 - Math.exp(-dt * 1.5)) + 24) % 24;
  }
  const doy = (S.year % 1) * 365;
  weather.update(dt, camera.position, U.uNight.value);
  const sky = env.set(doy, S.hour, weather.cloud, weather.rainK, renderer, camera);
  U.uNight.value = sky.night;
  bloom.strength = (0.22 + 0.5 * sky.night) * (S.mode === 'alley' ? 0.35 : 1);

  const states = world.update(S.year);
  wires.material.uniforms.uYear.value = S.year;
  park.update(S.year, sky.night);
  env.update(S.year, sky.night);
  world.signMat.uniforms.uDay.value = sky.day;

  let building = 0, demolishing = 0;
  states.forEach((st, i) => {
    if (st.building) building++;
    if (st.demolishing) {
      demolishing++;
      const L = city.lots[i];
      if (Math.random() < dt * 25) dust.emit(L.cx, st.floors * FLOOR_H, L.cz, Math.max(L.x1 - L.x0, L.z1 - L.z0));
    }
  });
  dust.update(dt);

  traffic.update(dt, S.year, sky.night, S.entered || TEST);
  updateCamera(dt);

  if (capTimer > 0) { capTimer -= dt; if (capTimer <= 0) $('caption').classList.remove('on'); }
  if (simT - lastSun > 1.6 || Math.abs(S.year - (computeSun.y ?? -99)) > 1.2) { computeSun(); computeSun.y = S.year; lastSun = simT; }
  if (picked && Math.floor(simT * 2) !== Math.floor((simT - dt) * 2)) renderCard();
  updateUI(false);

  camera.getWorldDirection(fwd);
  upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const st = cityStats.cache && cityStats.cache.y === Math.floor(S.year * 4) ? cityStats.cache.v : (cityStats.cache = { y: Math.floor(S.year * 4), v: cityStats(city, S.year) }).v;
  sound.update({
    dt, rain: weather.rainK, night: sky.night, density: clamp(st.pop / 33000, 0, 1),
    building: clamp(building / 12, 0, 1), demolishing: clamp(demolishing / 6, 0, 1),
    park: smoothstep(1994.8, PARK_OPEN, S.year), mode: S.mode,
    camPos: camera.position, camFwd: fwd, camUp: upv, planes: traffic.planes,
  });

  composer.render();
  requestAnimationFrame(frame);
}

// --- boot --------------------------------------------------------------------
async function boot() {
  try {
    await Promise.race([document.fonts.load(`900 64px "Noto Sans TC"`, '牙科診所魚蛋麵家'), new Promise((r) => setTimeout(r, 2500))]);
  } catch { /* fall back to system fonts */ }
  atlas = makeSignAtlas(FONT);
  build(S.seed);
  buildTimeline();
  if (params.has('year')) S.year = Number(params.get('year'));
  if (params.has('hour')) { S.hour = Number(params.get('hour')); S.lock = S.hour; }
  if (WEATHERS.includes(params.get('wx'))) weather.set(params.get('wx'));
  traffic.spawn(S.year, APPROACH.S1 - 600);
  if (['orbit', 'rooftop', 'alley', 'ride'].includes(params.get('mode'))) setMode(params.get('mode'));
  if (params.has('enter')) enter(params.get('enter') === 'grow');
  updateUI(true);
  document.body.classList.add('ready');
  $('enter-grow').disabled = $('enter-peak').disabled = false;
  requestAnimationFrame(frame);
  window.__kwc = { S, camera, traffic, setMode, controls, get city() { return city; }, get world() { return world; } };
}
boot().catch((err) => {
  console.error(err);
  $('loading').textContent = `The city could not be built: ${err.message}`;
});
