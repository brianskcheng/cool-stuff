import { Renderer, mat4 } from './gl.js';
import { AudioEngine, MATERIALS, voiceModel, normaliseVoice, strikeAmps, noteName } from './audio.js';
import * as G from './geom.js';
import { PRESETS, twins } from './shapes.js';

const $ = (s) => document.querySelector(s);
const coarse = matchMedia('(pointer: coarse)').matches;
const CELLS = coarse ? 50 : 60;
const K_TARGET = 96;
const WAVE = 1.35;          // visual wave speed, world units / s (roughly real time ÷ 100)
const VIS_STRIKE = 0.0105;  // visual strike strength
const VIS_HOLD = 0.035;     // visual amplitude of a held mode
const DUST_N = coarse ? 2400 : 4200;
const TWIN_SIZE = 1.5, TWIN_GAP = 0.98;

// ---------------------------------------------------------------- solver workers
class SolverPool {
  constructor(n) {
    this.jobs = new Map();
    this.next = 0;
    this.workers = Array.from({ length: n }, () => {
      const w = new Worker(new URL('./solver.js', import.meta.url));
      w.onmessage = (e) => {
        const job = this.jobs.get(e.data.id);
        if (!job) return;
        if (e.data.progress !== undefined) job.progress(e.data.progress);
        else if (e.data.error) { this.jobs.delete(e.data.id); job.reject(new Error(e.data.error)); }
        else if (e.data.done) { this.jobs.delete(e.data.id); job.resolve(e.data.result); }
      };
      return w;
    });
  }
  solve(grid, K, progress = () => {}) {
    const id = ++this.next;
    const worker = this.workers[id % this.workers.length];
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, progress });
      worker.postMessage({ id, nx: grid.nx, ny: grid.ny, mask: grid.mask.slice(), K });
    });
  }
}

// ---------------------------------------------------------------- a drum
class Drum {
  constructor(poly, spec, offset = [0, 0], name = '') {
    this.poly = poly;
    this.offset = offset;
    this.name = name;
    this.grid = G.rasterise(poly, spec);
    const b = G.bbox(poly);
    this.size = Math.max(b.w, b.h);
    const side = this.size * 1.12;
    this.rect = { x: b.cx - side / 2, y: b.cy - side / 2, w: side, h: side };
    this.sdfRes = 224;
    this.sdf = G.sdfTexture(poly, this.rect, this.sdfRes);
    this.wire = this.size * 0.0052;
    this.seed = Math.random() * 40;
    this.area = Math.abs(G.signedArea(poly));
    this.perim = G.perimeter(poly);
    this.pieces = G.components(this.grid.mask, this.grid.nx, this.grid.ny);
    this.K = 0;
  }

  async solve(pool, progress) {
    const g = this.grid;
    const r = await pool.solve(g, K_TARGET, progress);
    const K = r.K, N = g.nx * g.ny, h2 = g.h * g.h;
    this.stats = { n: r.n, ms: r.ms, krylov: r.krylov, bandwidth: r.bandwidth };
    this.N = N;
    this.n = r.n;
    this.lamGrid = r.lambdas;
    // physical eigenvalues, with the five-point stencil's mean dispersion error removed
    this.lam = new Float64Array(K);
    for (let k = 0; k < K; k++) { const l = r.lambdas[k]; this.lam[k] = (l + (l * l) / 16) / h2; }
    const s = Math.sqrt(r.n);
    const modes = r.modes;
    for (let i = 0; i < modes.length; i++) modes[i] *= s; // RMS-normalised φ̂
    this.modes = modes;
    this.V = new Float32Array(K);
    this.maxAbs = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      let sum = 0, mx = 0;
      for (let t = k * N, e = t + N; t < e; t++) { sum += modes[t]; const a = Math.abs(modes[t]); if (a > mx) mx = a; }
      this.V[k] = sum / r.n;
      this.maxAbs[k] = mx;
    }
    this.interior = [];
    for (let t = 0; t < N; t++) if (g.mask[t]) this.interior.push(t);
    this.interior = Int32Array.from(this.interior);
    const b = G.bbox(this.poly);
    const ear = (side) => [[0.32, 0.1], [0.22, -0.22], [0.4, -0.12], [0.15, 0.3], [0.3, 0.38]]
      .map(([fx, fy]) => this.nearestInterior(b.cx + side * fx * b.w, b.cy + fy * b.h));
    this.pickups = [ear(-1), ear(1)];
    // the point where the fundamental moves most: a natural "centre" to strike
    let best = 0, bi = this.interior[0];
    for (const t of this.interior) if (Math.abs(modes[t]) > best) { best = Math.abs(modes[t]); bi = t; }
    this.antinodeNode = bi;
    this.antinode = this.nodeXY(bi);

    this.K = K;
    this.Omega = new Float32Array(K);
    this.tauV = new Float32Array(K);
    this.visF = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      this.Omega[k] = WAVE * Math.sqrt(this.lam[k]);
      this.tauV[k] = 3.4 * Math.pow(this.lam[0] / this.lam[k], 0.2);
      this.visF[k] = Math.exp(-3 * (k / K) ** 2);
    }
    this.zr = new Float64Array(K); this.zi = new Float64Array(K);
    this.hold = new Float32Array(K); this.holdT = new Float32Array(K); this.micT = new Float32Array(K);
    this.holdPh = Float32Array.from({ length: K }, () => Math.random() * 6.283);
    this.env = new Float32Array(K); this.envRate = new Float32Array(K);
    this.u = new Float32Array(N);
    this.amp2 = new Float32Array(N);
    this.weyl = weylFit(this.lam, this.constantTerm());
    return this;
  }

  // Kac's constant term: Σ (π² − θ²)/(24πθ) over corners — 1/6 for any smooth simple loop
  constantTerm() {
    if (this.pieces !== 1) return this.pieces / 6;
    const P = this.poly, n = P.length, ccw = G.signedArea(P) > 0 ? 1 : -1;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const a = P[(i + n - 1) % n], b = P[i], d = P[(i + 1) % n];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e2x = d[0] - b[0], e2y = d[1] - b[1];
      const turn = Math.atan2(e1x * e2y - e1y * e2x, e1x * e2x + e1y * e2y) * ccw;
      const th = Math.PI - turn;
      if (th > 1e-6) c += (Math.PI * Math.PI - th * th) / (24 * Math.PI * th);
    }
    return Number.isFinite(c) ? c : 1 / 6;
  }

  nodeXY(t) { const g = this.grid, i = t % g.nx; return [g.x0 + i * g.h, g.y0 + ((t - i) / g.nx) * g.h]; }
  nearestInterior(x, y) {
    let best = Infinity, bt = this.interior[0];
    for (const t of this.interior) { const [px, py] = this.nodeXY(t); const d = (px - x) ** 2 + (py - y) ** 2; if (d < best) { best = d; bt = t; } }
    return bt;
  }
  phiAtNode(k, t) { return this.modes[k * this.N + t]; }

  // bilinear sample of a node field at local (x, y)
  sample(field, off, x, y) {
    const g = this.grid;
    const fx = (x - g.x0) / g.h, fy = (y - g.y0) / g.h;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return 0;
    const tx = fx - i, ty = fy - j, o = off + j * g.nx + i;
    return (field[o] * (1 - tx) + field[o + 1] * tx) * (1 - ty) + (field[o + g.nx] * (1 - tx) + field[o + g.nx + 1] * tx) * ty;
  }
  mode(k, x, y) { return this.sample(this.modes, k * this.N, x, y); }
  inMask(x, y) {
    const g = this.grid;
    const i = Math.round((x - g.x0) / g.h), j = Math.round((y - g.y0) / g.h);
    return i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.mask[j * g.nx + i] === 1;
  }
  contains(wx, wy) { return G.inside(this.poly, wx - this.offset[0], wy - this.offset[1]); }
}

// N(λ) ≈ Aλ/4π − P√λ/4π + c, least squares on the staircase mid-points
function weylFit(lam, c0) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let k = 0; k < lam.length; k++) {
    const x1 = lam[k] / (4 * Math.PI), x2 = -Math.sqrt(lam[k]) / (4 * Math.PI), y = k + 0.5 - c0;
    a11 += x1 * x1; a12 += x1 * x2; a22 += x2 * x2; b1 += x1 * y; b2 += x2 * y;
  }
  const D = a11 * a22 - a12 * a12;
  return { area: (b1 * a22 - b2 * a12) / D, perim: (a11 * b2 - a12 * b1) / D };
}

// ---------------------------------------------------------------- app state
const app = {
  drums: [],
  voices: [],
  scale: [],
  mode: 'single',
  lastSingle: null,
  material: 'skin',
  tension: 0,
  hardness: 0.45,
  dust: false,
  mic: false,
  drawMode: false,
  draw: null,
  strikes: [],
  time: 0,
  token: 0,
  played: false,
  held: new Set(),
  hoverMode: null,
  voiceHz: 0,
  cam: { tilt: 0.9, tiltT: 0.9, dist: 5, distT: 5, cx: 0, cy: 0, cxT: 0, cyT: 0, az: 0, azT: 0, sx: 0, sy: 0 },
  view: null,
};

let renderer;
try {
  renderer = new Renderer($('#gl'));
  renderer.maxDpr = coarse ? 1.25 : 1.5;
} catch (err) {
  document.body.innerHTML = `<p class="fallback">This instrument needs WebGL2, which this browser doesn't provide.<br>${err.message}</p>`;
  throw err;
}
const audio = new AudioEngine();
const pool = new SolverPool(2);
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
const spec = $('#spectrum');
const sctx = spec.getContext('2d');

// ---------------------------------------------------------------- loading drums
async function loadDrums(defs, mode) {
  const token = ++app.token;
  showSolving(0, defs.length > 1 ? 'Solving two drums…' : 'Listening to your outline…');
  const drums = defs.map((d) => new Drum(d.poly, d.spec, d.offset || [0, 0], d.name || ''));
  const total = drums.reduce((s, d) => s + d.grid.n, 0);
  $('#solvingText').textContent = `Solving ${total.toLocaleString()} unknowns…`;
  const prog = drums.map(() => 0);
  try {
    await Promise.all(drums.map((d, i) => d.solve(pool, (f) => {
      prog[i] = f;
      if (token === app.token) showSolving(prog.reduce((a, b) => a + b, 0) / drums.length);
    })));
  } catch (err) {
    if (token === app.token) { hideSolving(); toast('That outline could not be solved. Try a simpler loop.'); }
    return;
  }
  if (token !== app.token) return;
  hideSolving();
  if (drums.some((d) => d.K < 4)) { toast('Too thin to ring. Draw a rounder loop.'); return; }

  audio.hush(true);
  for (let s = 0; s < 2; s++) { renderer.clearSlot(s); if (audio.node) audio.drop(s); }
  app.held.clear();
  app.drums = drums;
  app.mode = mode;
  if (mode === 'single') app.lastSingle = defs[0];
  document.body.classList.toggle('twins', mode === 'twins');
  $('#twinBtn').classList.toggle('on', mode === 'twins');
  drums.forEach((d, i) => renderer.setDrum(i, d));
  if (app.dust) drums.forEach(spawnDust);
  updateVoices();
  fitCamera(false);
  buildReadout();
  buildAtlas();
  // a silent ripple so the film announces itself
  drums.forEach((d, i) => setTimeout(() => strike(i, d.antinode[0] * 0.6, d.antinode[1] * 0.6 + d.size * 0.12, 0.8, true), 140 + i * 260));
}

function updateVoices() {
  const ref = app.drums[0] ? app.drums[0].lam[0] : undefined;
  app.voices = app.drums.map((d) => normaliseVoice(d, voiceModel(d, app.material, app.tension, ref), d.antinodeNode));
  app.drums.forEach((d, i) => {
    const v = app.voices[i];
    for (let k = 0; k < d.K; k++) d.envRate[k] = 1 / v.decays[k];
  });
  if (audio.node) app.voices.forEach((v, i) => audio.setVoice(i, v));
  for (const key of app.held) { const [s, k] = key.split(':').map(Number); holdAudio(s, k, true); }
  buildReadout();
}

// ---------------------------------------------------------------- striking
function strike(slot, lx, ly, vel = 1, silent = false) {
  const d = app.drums[slot];
  if (!d || !d.K) return;
  const K = d.K, O1 = d.Omega[0];
  const v = app.voices[slot];
  const phis = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    phis[k] = d.mode(k, lx, ly);
    d.zi[k] += VIS_STRIKE * vel * phis[k] * d.visF[k] * (O1 / d.Omega[k]);
  }
  const amps = strikeAmps(v, phis, app.hardness, vel);
  if (!silent) for (let k = 0; k < K; k++) d.env[k] = Math.min(1.4, d.env[k] + Math.abs(amps[k]) * 0.55);
  app.strikes.push({ x: lx + d.offset[0], y: ly + d.offset[1], t: app.time, s: silent ? 0.35 : vel });
  if (app.strikes.length > 4) app.strikes.shift();
  if (silent) return;
  if (!app.played) { app.played = true; document.body.classList.add('played'); fadeHint(); }
  audio.ensure().then(() => {
    if (!app.voicesSent) { app.voicesSent = true; app.voices.forEach((vv, i) => audio.setVoice(i, vv)); }
    audio.strike(slot, amps, app.hardness);
  }).catch(() => toast('Audio could not start in this browser.'));
}

function holdAudio(slot, k, on) {
  const v = app.voices[slot];
  if (!v || !audio.node) return;
  const g = Math.max(Math.abs(v.gainL[k]), Math.abs(v.gainR[k]), 0.04);
  audio.sustain(slot, k, on ? 0.075 / g : 0);
}

function toggleHold(slot, k) {
  const d = app.drums[slot];
  if (!d || k >= d.K) return;
  const key = `${slot}:${k}`;
  const on = !app.held.has(key);
  if (on) app.held.add(key); else app.held.delete(key);
  d.holdT[k] = on ? VIS_HOLD : 0;
  if (!app.played) { app.played = true; document.body.classList.add('played'); fadeHint(); }
  audio.ensure().then(() => {
    if (!app.voicesSent) { app.voicesSent = true; app.voices.forEach((vv, i) => audio.setVoice(i, vv)); }
    holdAudio(slot, k, on);
  });
  if (on && !app.dust && app.held.size === 1 && !app.hintedDust) {
    app.hintedDust = true;
    toast('Try Dust: grains settle on the lines that stay still');
  }
  refreshAtlasHeld();
}

function releaseAll() {
  for (const key of app.held) { const [s, k] = key.split(':').map(Number); if (app.drums[s]) app.drums[s].holdT[k] = 0; holdAudio(s, k, false); }
  app.held.clear();
  refreshAtlasHeld();
}

// ---------------------------------------------------------------- dust
function spawnDust(d) {
  const n = app.drums.length > 1 ? Math.round(DUST_N * 0.6) : DUST_N;
  d.dust = new Float32Array(n * 2);
  d.dustXYZ = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  const g = d.grid;
  for (let i = 0; i < n; i++) {
    let x, y, tries = 0;
    do {
      const t = d.interior[(Math.random() * d.interior.length) | 0];
      [x, y] = d.nodeXY(t);
      x += (Math.random() - 0.5) * g.h; y += (Math.random() - 0.5) * g.h;
    } while (!d.inMask(x, y) && ++tries < 8);
    d.dust[i * 2] = x; d.dust[i * 2 + 1] = y;
    seeds[i] = Math.random();
  }
  d.dustN = n;
  d.dustSeeds = seeds;
  renderer.setDust(app.drums.indexOf(d), d.dustXYZ, seeds, n);
}

function gauss() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * Math.random());
}

function stepDust(d, slot, dt, active) {
  const N = d.N, a2 = d.amp2;
  a2.fill(0);
  for (const k of active) {
    const w = d.zr[k] * d.zr[k] + d.zi[k] * d.zi[k] + d.hold[k] * d.hold[k];
    if (w < 1e-12) continue;
    const off = k * N;
    for (const t of d.interior) { const p = d.modes[off + t]; a2[t] += w * p * p; }
  }
  const kick = 0.95 * Math.sqrt(dt * 60);
  const pos = d.dust, xyz = d.dustXYZ;
  for (let i = 0; i < d.dustN; i++) {
    let x = pos[i * 2], y = pos[i * 2 + 1];
    const a = Math.sqrt(Math.max(0, d.sample(a2, 0, x, y)));
    if (a > 2e-5) {
      const step = Math.min(0.06, kick * a);
      const nx = x + step * gauss(), ny = y + step * gauss();
      if (d.inMask(nx, ny)) { x = nx; y = ny; pos[i * 2] = x; pos[i * 2 + 1] = y; }
    }
    xyz[i * 3] = x + d.offset[0];
    xyz[i * 3 + 1] = y + d.offset[1];
    xyz[i * 3 + 2] = 0.16 * Math.tanh(d.sample(d.u, 0, x, y) / 0.16) + 0.004;
  }
  renderer.setDust(slot, xyz, null, d.dustN);
}

// ---------------------------------------------------------------- per-frame physics
function stepDrum(d, slot, dt) {
  const K = d.K, N = d.N, u = d.u, T = app.time;
  const active = [];
  const ease = 1 - Math.exp(-dt / 0.35);
  for (let k = 0; k < K; k++) {
    // transient: z ← z · e^{(−1/τ + iΩ) dt}
    let zr = d.zr[k], zi = d.zi[k];
    if (zr !== 0 || zi !== 0) {
      const e = Math.exp(-dt / d.tauV[k]), c = Math.cos(d.Omega[k] * dt) * e, s = Math.sin(d.Omega[k] * dt) * e;
      const nr = zr * c - zi * s; zi = zr * s + zi * c; zr = nr;
      if (Math.abs(zr) + Math.abs(zi) < 1e-7) { zr = 0; zi = 0; }
      d.zr[k] = zr; d.zi[k] = zi;
    }
    const target = Math.max(d.holdT[k], d.micT[k]);
    d.hold[k] += (target - d.hold[k]) * ease;
    if (d.hold[k] < 1e-6 && target === 0) d.hold[k] = 0;
    d.env[k] *= Math.exp(-dt * d.envRate[k]);
    if (zr !== 0 || zi !== 0 || d.hold[k] !== 0) active.push(k);
  }
  u.fill(0);
  for (const k of active) {
    const c = d.zr[k] + d.hold[k] * Math.cos(d.Omega[k] * T + d.holdPh[k]);
    if (Math.abs(c) < 1e-7) continue;
    const off = k * N, modes = d.modes;
    for (const t of d.interior) u[t] += c * modes[off + t];
  }
  renderer.setHeights(slot, u);
  if (app.dust && d.dust) stepDust(d, slot, dt, active);
}

function listen() {
  const db = audio.micSpectrum();
  app.voiceHz = 0;
  if (!db) return;
  const bin = audio.binHz;
  let best = -Infinity, bi = 0;
  for (let i = Math.floor(70 / bin); i < Math.floor(1400 / bin); i++) if (db[i] > best) { best = db[i]; bi = i; }
  if (best > -62) app.voiceHz = bi * bin;
  app.drums.forEach((d, s) => {
    const v = app.voices[s];
    for (let k = 0; k < d.K; k++) {
      const b = v.freqs[k] / bin, i = Math.round(b);
      if (i < 1 || i >= db.length - 1) { d.micT[k] = 0; continue; }
      const lvl = Math.max(db[i - 1], db[i], db[i + 1]);
      const x = Math.max(0, Math.min(1, (lvl + 78) / 40));
      d.micT[k] = VIS_HOLD * 1.25 * x * x * x;
    }
  });
}

// ---------------------------------------------------------------- camera
function layoutRect() {
  const W = innerWidth, H = innerHeight;
  const narrow = W <= 900;
  const panelW = narrow ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'));
  const dockH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h'));
  const mast = $('.masthead h1').getBoundingClientRect();
  const top = narrow ? mast.bottom + 12 : Math.max(56, mast.bottom + 6);
  return { x: 0, y: top, w: W - panelW, h: H - dockH - top - 34, W, H };
}

function worldBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of app.drums) {
    const b = G.bbox(d.poly);
    x0 = Math.min(x0, b.x0 + d.offset[0]); x1 = Math.max(x1, b.x1 + d.offset[0]);
    y0 = Math.min(y0, b.y0 + d.offset[1]); y1 = Math.max(y1, b.y1 + d.offset[1]);
  }
  if (!Number.isFinite(x0)) return { cx: 0, cy: 0, w: 2, h: 2 };
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

function fitCamera(drawing) {
  const L = layoutRect();
  const c = app.cam;
  const fov = 0.62, tanY = Math.tan(fov / 2), aspect = L.W / L.H, tanX = tanY * aspect;
  c.tiltT = drawing ? 0.0 : 0.9;
  const b = drawing ? { cx: 0, cy: 0, w: 2.8, h: 2.8 } : worldBounds();
  const fw = L.w / L.W, fh = L.h / L.H;
  const ch = Math.cos(c.tiltT) * 0.88 + 0.12;
  const fill = app.drums.length > 1 && !drawing ? 0.76 : 0.84;
  c.distT = Math.max(b.w / (2 * tanX * fw * fill), (b.h * ch) / (2 * tanY * fh * fill * 0.92), 2.2);
  c.cxT = b.cx;
  c.cyT = b.cy + (drawing ? 0 : 0.05 * b.h);
  c.sxT = ((L.x + L.w / 2) / L.W) * 2 - 1;
  c.syT = -(((L.y + L.h / 2) / L.H) * 2 - 1);
  if (c.sx === undefined || !app.view) { c.sx = c.sxT; c.sy = c.syT; }
}

function updateCamera(dt) {
  const c = app.cam, k = 1 - Math.exp(-dt * 4.5);
  c.tilt += (c.tiltT - c.tilt) * k;
  c.dist += (c.distT - c.dist) * k;
  c.cx += (c.cxT - c.cx) * k;
  c.cy += (c.cyT - c.cy) * k;
  c.az += (c.azT - c.az) * k;
  c.sx += (c.sxT - c.sx) * k;
  c.sy += (c.syT - c.sy) * k;
  const { w, h } = renderer.resize();
  const t = c.tilt, a = c.az;
  const fwd = [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), -Math.cos(t)];
  const eye = [c.cx - fwd[0] * c.dist, c.cy - fwd[1] * c.dist, -fwd[2] * c.dist];
  const right = [Math.cos(a), -Math.sin(a), 0];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const proj = mat4.perspective(0.62, w / h, 0.05, 60, -c.sx, -c.sy);
  const view = mat4.view(eye, right, up, fwd);
  const vp = mat4.mul(proj, view);
  app.view = { vp, inv: mat4.invert(vp), eye, w, h };
}

function toWorld(clientX, clientY) {
  if (!app.view) return null;
  const nx = (clientX / innerWidth) * 2 - 1, ny = 1 - (clientY / innerHeight) * 2;
  const a = mat4.apply(app.view.inv, [nx, ny, -1, 1]), b = mat4.apply(app.view.inv, [nx, ny, 1, 1]);
  const p = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], q = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const dz = q[2] - p[2];
  if (Math.abs(dz) < 1e-9) return null;
  const s = -p[2] / dz;
  return [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s];
}

function toScreen(x, y, z = 0) {
  const v = mat4.apply(app.view.vp, [x, y, z, 1]);
  return [((v[0] / v[3]) * 0.5 + 0.5) * innerWidth, (0.5 - (v[1] / v[3]) * 0.5) * innerHeight];
}

// ---------------------------------------------------------------- pointer
const gl = $('#gl');
let ptr = null;

gl.addEventListener('pointerdown', (e) => {
  gl.setPointerCapture(e.pointerId);
  closePops();
  audio.ensure().catch(() => {});
  const w = toWorld(e.clientX, e.clientY);
  if (!w) return;
  if (app.drawMode) { app.draw = { pts: [w], screen: [[e.clientX, e.clientY]] }; return; }
  const slot = app.drums.findIndex((d) => d.K && d.contains(w[0], w[1]));
  ptr = { x: e.clientX, y: e.clientY, slot, last: w, moved: 0, start: w };
  if (slot >= 0) {
    const d = app.drums[slot];
    strike(slot, w[0] - d.offset[0], w[1] - d.offset[1], 1);
  }
});

gl.addEventListener('pointermove', (e) => {
  const w = toWorld(e.clientX, e.clientY);
  app.pointer = [e.clientX, e.clientY];
  if (!w) return;
  if (app.draw) { app.draw.pts.push(w); app.draw.screen.push([e.clientX, e.clientY]); return; }
  if (!ptr) return;
  const dist = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
  if (ptr.slot < 0) {
    // dragging from outside the film draws a new drum
    if (dist > 24) { app.draw = { pts: [ptr.start, w], screen: [[ptr.x, ptr.y], [e.clientX, e.clientY]] }; ptr = null; }
    return;
  }
  // dragging across the film: a brush roll
  const d = app.drums[ptr.slot];
  const step = Math.hypot(w[0] - ptr.last[0], w[1] - ptr.last[1]);
  if (step > d.size * 0.07 && d.contains(w[0], w[1])) {
    strike(ptr.slot, w[0] - d.offset[0], w[1] - d.offset[1], 0.45);
    ptr.last = w;
  }
});

function endPointer() {
  if (app.draw) finishDraw();
  ptr = null;
}
gl.addEventListener('pointerup', endPointer);
gl.addEventListener('pointercancel', () => { app.draw = null; ptr = null; });
gl.addEventListener('pointerleave', () => { app.pointer = null; });

function setDrawMode(on) {
  app.drawMode = on;
  document.body.classList.toggle('drawing', on);
  $('#drawBtn').classList.toggle('on', on);
  renderer.slots.forEach((s) => { if (s) s.alphaT = on ? 0.22 : 1; });
  fitCamera(on);
  if (on) toast('Draw one closed loop. Lift to listen.');
}

function finishDraw() {
  const pts = app.draw.pts;
  app.draw = null;
  setDrawMode(false);
  if (pts.length < 6) return;
  let P = G.resample(pts, 200);
  P = G.resample(G.smooth(P, 2), 240);
  const b = G.bbox(P);
  const area = Math.abs(G.signedArea(P));
  if (area < 0.05 || Math.min(b.w, b.h) < 0.12) { toast('Too small to ring. Draw a bigger loop.'); return; }
  P = P.map(([x, y]) => [x - b.cx, y - b.cy]);
  loadDrums([{ poly: P, spec: { cells: CELLS } }], 'single');
}

// ---------------------------------------------------------------- overlay (drawing path, reticle, labels)
function drawOverlay() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  if (overlay.width !== Math.round(W * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  const show = !!(app.draw && app.draw.pts.length > 1);
  if (overlay.hidden === show) overlay.hidden = !show;
  if (show) {
    const pts = app.draw.pts.map(([x, y]) => toScreen(x, y));
    octx.lineJoin = 'round'; octx.lineCap = 'round';
    octx.strokeStyle = 'rgba(255, 90, 54, 0.25)'; octx.lineWidth = 9;
    octx.beginPath(); pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y))); octx.stroke();
    octx.strokeStyle = '#ffe9dc'; octx.lineWidth = 1.6;
    octx.stroke();
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    octx.setLineDash([3, 5]); octx.strokeStyle = 'rgba(236,230,218,0.45)'; octx.lineWidth = 1;
    octx.beginPath(); octx.moveTo(ex, ey); octx.lineTo(sx, sy); octx.stroke(); octx.setLineDash([]);
  }
  // twin labels under each drum
  if (app.mode === 'twins' && app.drums.length === 2) {
    ['#labelA', '#labelB'].forEach((sel, i) => {
      const d = app.drums[i];
      const b = G.bbox(d.poly);
      const [x, y] = toScreen(b.cx + d.offset[0], b.y0 + d.offset[1] - 0.1);
      const el = $(sel);
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
    });
  }
}

// ---------------------------------------------------------------- spectrum strip
const strip = { hover: null, x: [], range: [50, 2000] };

function stripLayout() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const r = spec.getBoundingClientRect();
  if (spec.width !== Math.round(r.width * dpr) || spec.height !== Math.round(r.height * dpr)) {
    spec.width = Math.round(r.width * dpr); spec.height = Math.round(r.height * dpr);
  }
  return { W: r.width, H: r.height, dpr };
}

function drawSpectrum() {
  const { W, H, dpr } = stripLayout();
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.clearRect(0, 0, W, H);
  if (!app.voices.length || !app.drums[0] || !app.drums[0].K) return;
  let fmin = Infinity, fmax = 0;
  for (const v of app.voices) for (const f of v.freqs) { if (f > 0) { fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); } }
  fmin /= 1.35; fmax = Math.min(fmax * 1.1, 22000);
  strip.range = [fmin, fmax];
  const padL = 6, padR = 6, top = 26, bottom = H - 16;
  const X = (f) => padL + (Math.log(f / fmin) / Math.log(fmax / fmin)) * (W - padL - padR);
  // octave grid
  sctx.font = '9.5px "DM Mono", monospace';
  sctx.textBaseline = 'alphabetic';
  for (let m = 12; m < 132; m += 12) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    if (f < fmin || f > fmax) continue;
    const x = X(f);
    sctx.fillStyle = 'rgba(236,230,218,0.08)';
    sctx.fillRect(Math.round(x), top, 1, bottom - top);
    sctx.fillStyle = 'rgba(236,230,218,0.34)';
    sctx.fillText(`C${m / 12 - 1}`, x + 3, H - 4);
  }
  const twinsMode = app.mode === 'twins' && app.drums.length === 2;
  const mid = twinsMode ? (top + bottom) / 2 : bottom;
  const rowH = twinsMode ? (bottom - top) / 2 - 3 : bottom - top;
  strip.x = [];
  app.drums.forEach((d, s) => {
    const v = app.voices[s];
    const dir = twinsMode && s === 1 ? 1 : -1;
    for (let k = 0; k < d.K; k++) {
      const f = v.freqs[k];
      if (!(f > 0)) continue;
      const x = Math.round(X(f)) + 0.5;
      strip.x.push({ x, slot: s, k, y0: dir < 0 ? mid - rowH : mid, y1: dir < 0 ? mid : mid + rowH });
      const held = app.held.has(`${s}:${k}`);
      const e = Math.min(1, Math.sqrt(d.env[k] * 1.8) + d.hold[k] / VIS_HOLD);
      const hov = strip.hover && strip.hover.slot === s && strip.hover.k === k;
      const base = 0.3 + 0.14 * Math.max(0, 1 - k / 40);
      const len = rowH * (base + (1 - base) * e);
      sctx.fillStyle = held ? '#ff5a36' : hov ? '#ffffff' : `rgba(236,230,218,${0.26 + 0.74 * e})`;
      sctx.fillRect(x - 0.5, dir < 0 ? mid - len : mid, held || hov || k === 0 ? 2 : 1, len);
    }
  });
  if (twinsMode) {
    sctx.fillStyle = 'rgba(236,230,218,0.2)';
    sctx.fillRect(padL, Math.round(mid), W - padL - padR, 1);
    sctx.fillStyle = 'rgba(236,230,218,0.45)';
    sctx.fillText('A', W - 14, top + 9);
    sctx.fillText('B', W - 14, bottom - 2);
  }
  if (app.voiceHz > 0 && app.voiceHz > fmin && app.voiceHz < fmax) {
    const x = X(app.voiceHz);
    sctx.fillStyle = 'rgba(255,90,54,0.9)';
    for (let y = top; y < bottom; y += 4) sctx.fillRect(Math.round(x), y, 1, 2);
    sctx.fillText('you', x + 4, top + 9);
  }
  if (strip.hover) {
    const { slot, k } = strip.hover;
    const v = app.voices[slot];
    if (v && k < v.freqs.length) {
      const f = v.freqs[k], nn = noteName(f);
      const txt = `${app.drums.length > 1 ? (slot ? 'B' : 'A') + ' · ' : ''}mode ${k + 1} · ${f.toFixed(1)} Hz · ${nn.name}${nn.cents >= 0 ? '+' : ''}${nn.cents}¢ · ×${(f / v.freqs[0]).toFixed(3)}`;
      const x = X(f);
      sctx.font = '10.5px "DM Mono", monospace';
      const tw = sctx.measureText(txt).width;
      const tx = Math.min(Math.max(x - tw / 2, 4), W - tw - 4);
      sctx.fillStyle = 'rgba(9,8,10,0.92)';
      sctx.fillRect(tx - 6, 4, tw + 12, 17);
      sctx.fillStyle = '#ece6da';
      sctx.fillText(txt, tx, 16);
    }
  }
}

function stripHit(e) {
  const r = spec.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = 9;
  for (const m of strip.x) {
    const d = Math.abs(m.x - x) + (y < m.y0 - 4 || y > m.y1 + 4 ? 6 : 0);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
spec.addEventListener('pointermove', (e) => { strip.hover = stripHit(e); $('#specLabel').style.opacity = strip.hover ? 0 : 1; });
spec.addEventListener('pointerleave', () => { strip.hover = null; $('#specLabel').style.opacity = 1; });
spec.addEventListener('pointerdown', (e) => {
  const m = stripHit(e);
  if (m) toggleHold(m.slot, m.k);
});

// ---------------------------------------------------------------- panel: readout + atlas
const fmt = (x, d = 2) => x.toFixed(d);

function buildReadout() {
  const el = $('#readout');
  const d = app.drums[0];
  if (!d || !d.K || !app.voices[0]) { el.innerHTML = '<p class="label">Fundamental</p><div class="status" id="status">Solving…</div>'; return; }
  const f1 = app.voices[0].freqs[0], nn = noteName(f1);
  const [n0, acc] = [nn.name.replace(/[♯\d-]+/g, ''), nn.name.includes('♯') ? '♯' : ''];
  const octave = nn.name.replace(/^[A-G]♯?/, '');
  const noteHTML = `${n0}${acc ? `<sup>${acc}</sup>` : ''}<span style="font-size:.5em;color:var(--paper-3)">${octave}</span>`;
  if (app.mode === 'twins' && app.drums.length === 2) {
    const [A, B] = app.drums;
    const K = Math.min(A.K, B.K);
    let md = 0;
    for (let k = 0; k < K; k++) md = Math.max(md, Math.abs(A.lamGrid[k] - B.lamGrid[k]) / A.lamGrid[k]);
    const [m, ex] = md.toExponential(1).split('e');
    el.innerHTML = `
      <p class="label">Gordon · Webb · Wolpert, 1992</p>
      <div class="twin-copy">
        <p class="big">Two drums, one voice.</p>
        <p>Different shapes. Strike each one: the notes are the same, and only the colour of the sound changes with where you hit.</p>
        <p class="label gap">Largest gap across ${K} shared notes</p>
        <p class="delta">${m} × 10<sup>${Number(ex)}</sup></p>
        <p>Both have area ${fmt(A.area)} and perimeter ${fmt(A.perim)}, which is all Weyl's law can promise. So the answer to Kac is <i>no</i>.</p>
      </div>
      <button class="linkish" id="backBtn">← Back to your drum</button>`;
    $('#backBtn').onclick = exitTwins;
    return;
  }
  const W = d.weyl;
  const bar = (label, heard, drawn) => {
    const lo = Math.min(heard, drawn) * 0.8, hi = Math.max(heard, drawn) * 1.2;
    const p = (x) => (((x - lo) / (hi - lo)) * 100).toFixed(1);
    return `<div class="ear-row"><span class="label">${label}</span><div class="ear-bar"><div class="track"></div>
      <div class="tick drawn" style="left:${p(drawn)}%"></div><div class="tick heard" style="left:${p(heard)}%"></div>
      <div class="vals"><span>drawn ${fmt(drawn)}</span><i>heard ${fmt(heard)}</i></div></div></div>`;
  };
  el.innerHTML = `
    <p class="label">Fundamental</p>
    <div class="fund"><span class="note">${noteHTML}</span><span class="hz">${f1.toFixed(1)} Hz · ${MATERIALS[app.material].label.toLowerCase()}</span></div>
    <div class="stats">
      <div><span class="label">Modes</span><b>${d.K}</b></div>
      <div><span class="label">Unknowns</span><b>${d.n.toLocaleString()}</b></div>
      <div><span class="label">Solved</span><b>${Math.round(d.stats.ms)} ms</b></div>
    </div>
    <div class="ear">
      <p class="label">What the ear can tell</p>
      <h3>Area and perimeter, from sound alone</h3>
      ${bar('Area', W.area, d.area)}
      ${bar('Perimeter', W.perim, d.perim)}
      <button class="linkish" id="cantBtn">…but not the shape →</button>
    </div>`;
  $('#cantBtn').onclick = enterTwins;
}

function modeThumb(d, k, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = d.rect, inv = 1 / d.maxAbs[k];
  for (let j = 0; j < size; j++) {
    const y = r.y + (1 - (j + 0.5) / size) * r.h;
    const sj = Math.min(d.sdfRes - 1, Math.floor((1 - (j + 0.5) / size) * d.sdfRes));
    for (let i = 0; i < size; i++) {
      const x = r.x + ((i + 0.5) / size) * r.w;
      const si = Math.min(d.sdfRes - 1, Math.floor(((i + 0.5) / size) * d.sdfRes));
      const sd = d.sdf[sj * d.sdfRes + si];
      const o = (j * size + i) * 4;
      if (sd > 0) {
        if (sd < d.size * 0.008) { img.data[o] = 236; img.data[o + 1] = 230; img.data[o + 2] = 218; img.data[o + 3] = 70; }
        continue;
      }
      const v = d.mode(k, x, y) * inv;
      const line = Math.exp(-((v / 0.075) ** 2));
      const lobe = Math.abs(v) * 0.24;
      const warm = v > 0;
      const lr = warm ? 236 : 255, lg = warm ? 230 : 90, lb = warm ? 218 : 54;
      const a = lobe * (1 - line) + line * 0.95;
      img.data[o] = lr * (1 - line) + 255 * line;
      img.data[o + 1] = lg * (1 - line) + 250 * line;
      img.data[o + 2] = lb * (1 - line) + 240 * line;
      img.data[o + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function buildAtlas() {
  const grid = $('#atlas');
  grid.innerHTML = '';
  const twinsMode = app.mode === 'twins' && app.drums.length === 2;
  $('#atlasTitle').textContent = twinsMode ? 'Same note, different shape' : 'Its voices';
  $('#atlasNote').textContent = twinsMode ? 'A | B pairs · tap to hold' : 'mode shapes · tap to hold';
  const items = [];
  if (twinsMode) {
    const K = Math.min(14, app.drums[0].K, app.drums[1].K);
    for (let k = 0; k < K; k++) items.push([0, k], [1, k]);
  } else {
    const K = Math.min(28, app.drums[0].K);
    for (let k = 0; k < K; k++) items.push([0, k]);
  }
  const size = 112;
  // build thumbnails progressively so the panel never blocks a frame for long
  let i = 0;
  const batch = () => {
    const end = Math.min(items.length, i + 6);
    for (; i < end; i++) {
      const [s, k] = items[i];
      const d = app.drums[s];
      if (d !== app.drums[s] || !d.K) return;
      const b = document.createElement('button');
      b.className = 'mode';
      b.dataset.key = `${s}:${k}`;
      const f = app.voices[s].freqs[k], f1 = app.voices[s].freqs[0];
      b.title = `${twinsMode ? (s ? 'B' : 'A') + ' · ' : ''}mode ${k + 1} · ${f.toFixed(1)} Hz`;
      b.appendChild(modeThumb(d, k, size));
      const span = document.createElement('span');
      span.textContent = twinsMode ? `${s ? 'B' : 'A'}${k + 1}` : `×${(f / f1).toFixed(2)}`;
      b.appendChild(span);
      const glow = document.createElement('i');
      glow.className = 'glow';
      b.appendChild(glow);
      b.onclick = () => toggleHold(s, k);
      grid.appendChild(b);
    }
    if (i < items.length) requestAnimationFrame(batch);
    else refreshAtlasHeld();
  };
  requestAnimationFrame(batch);
}

function refreshAtlasHeld() {
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('held', app.held.has(b.dataset.key)));
}

function glowAtlas() {
  document.querySelectorAll('.mode').forEach((b) => {
    const [s, k] = b.dataset.key.split(':').map(Number);
    const d = app.drums[s];
    if (!d || !d.K) return;
    const e = Math.min(1, Math.sqrt(d.env[k] * 1.8) + d.hold[k] / VIS_HOLD);
    b.lastChild.style.opacity = (e * 0.8).toFixed(2);
  });
}

// ---------------------------------------------------------------- twins
function enterTwins() {
  if (app.mode === 'twins') return;
  releaseAll();
  const [A, B] = twins(TWIN_SIZE, 20);
  loadDrums([
    { ...A, offset: [-TWIN_GAP, 0], name: 'A' },
    { ...B, offset: [TWIN_GAP, 0], name: 'B' },
  ], 'twins');
}
function exitTwins() {
  releaseAll();
  loadDrums([app.lastSingle || PRESETS.blob.make()], 'single');
}

// ---------------------------------------------------------------- controls
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
function fadeHint() { $('#hint').classList.add('fade'); }
function showSolving(f, text) {
  const el = $('#solving');
  el.hidden = false;
  if (text) $('#solvingText').textContent = text;
  $('#solvingArc').style.strokeDashoffset = (106.8 * (1 - f)).toFixed(1);
}
function hideSolving() { $('#solving').hidden = true; }

$('#drawBtn').onclick = () => setDrawMode(!app.drawMode);
$('#twinBtn').onclick = () => (app.mode === 'twins' ? exitTwins() : enterTwins());

const pop = $('#shapesPop');
function closePops() { pop.classList.remove('open'); $('#shapesBtn').setAttribute('aria-expanded', 'false'); }
$('#shapesBtn').onclick = (e) => {
  e.stopPropagation();
  const open = !pop.classList.contains('open');
  if (open) {
    const r = $('#shapesBtn').getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 340))}px`;
    pop.style.bottom = `${innerHeight - r.top + 8}px`;
  }
  pop.classList.toggle('open', open);
  $('#shapesBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && e.target !== $('#shapesBtn')) closePops(); });
for (const [key, p] of Object.entries(PRESETS)) {
  const { poly } = p.make();
  const b = G.bbox(poly), s = 36 / Math.max(b.w, b.h);
  const dpath = poly.map(([x, y], i) => `${i ? 'L' : 'M'}${(20 + (x - b.cx) * s).toFixed(1)} ${(20 - (y - b.cy) * s).toFixed(1)}`).join('') + 'Z';
  const btn = document.createElement('button');
  btn.setAttribute('role', 'menuitem');
  btn.innerHTML = `<svg viewBox="0 0 40 40"><path d="${dpath}"/></svg>${p.label}`;
  btn.onclick = () => { closePops(); releaseAll(); loadDrums([p.make()], 'single'); };
  pop.appendChild(btn);
}

document.querySelectorAll('#material button').forEach((b) => {
  b.onclick = () => {
    app.material = b.dataset.m;
    document.querySelectorAll('#material button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    updateVoices();
  };
});
$('#tension').oninput = (e) => {
  app.tension = Number(e.target.value);
  $('#tensionOut').textContent = (app.tension > 0 ? '+' : '') + app.tension;
  clearTimeout(app.tensionTimer);
  app.tensionTimer = setTimeout(updateVoices, 60);
};
$('#mallet').oninput = (e) => {
  app.hardness = Number(e.target.value);
  $('#malletOut').textContent = app.hardness < 0.25 ? 'wool' : app.hardness < 0.6 ? 'felt' : app.hardness < 0.85 ? 'wood' : 'steel';
};
function setDust(on) {
  app.dust = on;
  $('#dustBtn').classList.toggle('on', on);
  if (on) app.drums.forEach(spawnDust);
  else app.drums.forEach((d, i) => { d.dust = null; renderer.setDust(i, new Float32Array(3), null, 0); });
}
$('#dustBtn').onclick = () => setDust(!app.dust);
$('#micBtn').onclick = async () => {
  if (app.mic) {
    audio.disableMic(); app.mic = false; $('#micBtn').classList.remove('on');
    app.drums.forEach((d) => d.micT.fill(0));
    return;
  }
  try {
    await audio.enableMic();
    app.mic = true;
    $('#micBtn').classList.add('on');
    if (!app.dust) setDust(true);
    toast('Hum or sing. Modes near your pitch will answer, and the dust will show you which.', 4200);
  } catch {
    toast('Microphone unavailable or blocked.');
  }
};
$('#voicesBtn').onclick = () => document.body.classList.toggle('sheet');
$('#panelClose').onclick = () => document.body.classList.remove('sheet');
$('#howBtn').onclick = () => $('#how').showModal();

addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, dialog')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'd') setDrawMode(!app.drawMode);
  else if (k === 't') (app.mode === 'twins' ? exitTwins() : enterTwins());
  else if (k === 's') setDust(!app.dust);
  else if (k === 'escape') { if (app.drawMode) setDrawMode(false); releaseAll(); closePops(); }
  else if (k === ' ') {
    e.preventDefault();
    const d = app.drums[0];
    if (d && d.K) strike(0, d.antinode[0], d.antinode[1], 1);
  } else if (/^[1-9]$/.test(k)) toggleHold(0, Number(k) - 1);
});

addEventListener('resize', () => fitCamera(app.drawMode));

// ---------------------------------------------------------------- main loop
let last = performance.now();
let frame = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  app.time += dt;
  frame++;
  // gentle parallax towards the pointer
  if (app.pointer && !app.drawMode) app.cam.azT = ((app.pointer[0] / innerWidth) - 0.5) * 0.12;
  else app.cam.azT = Math.sin(app.time * 0.11) * 0.035;
  renderer.adapt(dt);
  updateCamera(dt);
  if (app.mic) listen();
  app.drums.forEach((d, i) => { if (d.K) stepDrum(d, i, dt); });
  renderer.slots.forEach((s) => { if (s) { s.alphaT = s.alphaT ?? 1; s.alpha += (s.alphaT - s.alpha) * (1 - Math.exp(-dt * 6)); } });
  const strikes = new Float32Array(16);
  app.strikes.forEach((s, i) => strikes.set([s.x, s.y, s.t, s.s], i * 4));
  app.dim = (app.dim || 0) + ((app.dust ? 1 : 0) - (app.dim || 0)) * (1 - Math.exp(-dt * 3));
  renderer.render({
    vp: app.view.vp, eye: app.view.eye, time: app.time, wave: WAVE, strikes, dim: app.dim,
    dustPx: (coarse ? 2.4 : 2.0) * renderer.dpr, dustAlpha: 0.95,
  });
  drawOverlay();
  drawSpectrum();
  if (frame % 3 === 0) glowAtlas();
  requestAnimationFrame(loop);
}

fitCamera(false);
updateCamera(0);
requestAnimationFrame(loop);
loadDrums([PRESETS.blob.make()], 'single');

// for tests and the curious
window.hearTheShape = { app, strike, toggleHold, enterTwins, exitTwins, setDust, loadDrums, stepDrum, PRESETS, renderer, drawOverlay, drawSpectrum };
