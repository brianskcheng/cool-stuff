import { Renderer } from './gl.js';
import { AudioEngine } from './audio.js';
import {
  PRESETS, GWW_A, GWW_B, randomBlob, strokeToLoop, pointInLoops, loopsBBox,
  translate, encodeLoops, decodeLoops,
} from './shapes.js';
import { Spectrum, noteName, centsFromHarmonic } from './spectrum.js';

const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const SOLVER_URL = new URL('./solver.js', import.meta.url);

// ------------------------------------------------------------------ settings

const S = {
  c: 72,          // wave speed sqrt(T/sigma), m/s: the drum's tension
  hard: 0.45,     // mallet hardness 0..1
  sustain: 1,     // decay-time multiplier
  reverb: 0.22,
  slow: 0.85,     // visual frequency of the fundamental, Hz (slow motion)
};

const QUALITY = {
  quick: { targetN: 1500, K: 48, tol: 1e-6, krylov: 2.0 },
  full: { targetN: 7000, K: 64, tol: 1e-7, krylov: 2.2 },
  mass: { targetN: 7000, K: 64, tol: 1e-7, krylov: 2.2 },
  opt: { targetN: 2600, K: 12, tol: 1e-8, krylov: 3.0 },
};
const ISO_UNIT = 0.11;               // leg of the half-square, metres
const ISO_M = { quick: 14, full: 36, mass: 36, opt: 20 };

const audio = new AudioEngine();
let renderer;
let spectrum;

const app = {
  mode: 'single',          // 'single' | 'iso'
  tool: 'play',            // 'play' | 'draw' | 'mass'
  drums: [],
  singleLoops: null,
  singleMeta: null,
  explore: null,           // { k }
  started: false,
  time: 0,
  rings: [],
  stroke: null,
  hover: null,
  erase: false,
  harmonizing: false,
  blind: null,
};

const view = { cssW: 0, cssH: 0, dpr: 1, cx: 0, cy: 0, s: 1, specH: 118, topH: 56 };

// --------------------------------------------------------------------- drums

let drumVersion = 0;

class Drum {
  constructor(id, loops, opts = {}) {
    this.id = id;
    this.loops = loops;
    this.version = ++drumVersion;
    this.label = opts.label || '';
    this.lattice = opts.lattice || null;
    this.pan = opts.pan || 0;
    this.bbox = loopsBBox(loops);
    this.sol = null;
    this.freqs = null;
    this.taus = null;
    this.energy = null;
    this.cr = new Float64Array(0);
    this.ci = new Float64Array(0);
    this.uRef = 0;
    this.uPeak = 0;
    this.holder = {};
    this.mass = null;
    this.massDirty = false;
    this.lockLambda = null;
    this.worker = null;
    this.busy = false;
    this.queued = null;
    this.reqId = 0;
    this.pending = null;
    this.progress = 0;
    this.solvedAt = 0;
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    const gl = renderer && renderer.gl;
    if (gl) for (const t of Object.values(this.holder)) gl.deleteTexture(t);
    this.holder = {};
  }

  contains(x, y) {
    const b = this.bbox;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
    return pointInLoops(x, y, this.loops);
  }

  // Run a solve of the given quality. Resolves with the raw result.
  solve(kind) {
    if (this.busy) {
      if (kind === 'mass' || kind === 'opt') {
        if (this.queued) this.queued.rej(new Error('cancelled'));
        return new Promise((res, rej) => { this.queued = { kind, res, rej }; });
      }
      this.worker.terminate();
      this.worker = null;
      if (this.pending) this.pending.rej(new Error('cancelled'));
      if (this.queued) { this.queued.rej(new Error('cancelled')); this.queued = null; }
      this.busy = false;
    }
    return new Promise((res, rej) => this.post(kind, res, rej));
  }

  post(kind, res, rej) {
    if (!this.worker) {
      this.worker = new Worker(SOLVER_URL);
      this.worker.onmessage = (e) => this.onWorker(e.data);
      this.worker.onerror = (e) => {
        this.busy = false;
        if (this.pending) this.pending.rej(new Error(e.message || 'worker error'));
      };
    }
    const q = QUALITY[kind];
    const req = {
      id: ++this.reqId,
      loops: this.loops,
      K: q.K, tol: q.tol, krylov: q.krylov,
      factorKey: this.version + ':' + kind.replace('mass', 'full'),
    };
    if (this.lattice) {
      req.h = ISO_UNIT / ISO_M[kind];
      req.tol = kind === 'full' ? 1e-12 : q.tol;
      req.krylov = kind === 'full' ? 3 : q.krylov;
    } else {
      req.targetN = q.targetN * (view.cssW < 700 ? 0.7 : 1);
    }
    if (this.mass && kind !== 'quick') {
      req.density = this.mass.data.slice();
      req.densityGrid = this.mass.grid;
    }
    this.busy = true;
    this.progress = 0;
    this.pending = { kind, res, rej, t0: performance.now() };
    this.worker.postMessage(req);
  }

  onWorker(msg) {
    if (msg.id !== this.reqId) return;
    if (msg.progress !== undefined) { this.progress = msg.progress; return; }
    const p = this.pending;
    this.busy = false;
    this.pending = null;
    if (msg.error) {
      p && p.rej(new Error(msg.error));
    } else {
      msg.result.wall = performance.now() - p.t0;
      p && p.res(msg.result);
    }
    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this.post(q.kind, q.res, q.rej);
    }
  }

  apply(r, kind) {
    const n = r.grid.n, K = r.lambdas.length, { W, H, h } = r.grid;
    const nodeTex = new Int32Array(n);
    for (let t = 0; t < W * H; t++) { const p = r.index[t]; if (p >= 0) nodeTex[p] = t; }
    const integ = new Float32Array(K), maxAbs = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      let s = 0, m = 0;
      const off = k * n;
      for (let p = 0; p < n; p++) {
        const v = r.modes[off + p];
        s += v * r.rho[p];
        if (Math.abs(v) > m) m = Math.abs(v);
      }
      integ[k] = s * h * h;
      maxAbs[k] = m || 1;
    }
    this.sol = Object.assign(r, { n, K, nodeTex, integ, maxAbs, kind });
    this.u = new Float32Array(n);
    this.env = new Float32Array(W * H);
    this.texData = new Float32Array(W * H * 2);
    this.lastNorm = this.lastNorm || 1;
    const grow = (a) => { const b = new Float64Array(K); b.set(a.subarray(0, Math.min(K, a.length))); return b; };
    this.cr = grow(this.cr);
    this.ci = grow(this.ci);
    this.energy = this.energy ? Float32Array.from({ length: K }, (_, k) => this.energy[k] || 0) : new Float32Array(K);
    this.solvedAt = app.time;
    this.idle = false;
    this.cRef = 0;
    this.updatePhysics();
  }

  updatePhysics() {
    const s = this.sol;
    if (!s) return;
    const K = s.K;
    this.freqs = new Float32Array(K);
    this.taus = new Float32Array(K);
    this.wv = new Float32Array(K);
    this.tv = new Float32Array(K);
    const tune = this.lockLambda ? Math.sqrt(this.lockLambda / s.lambdas[0]) : 1;
    for (let k = 0; k < K; k++) {
      const f = tune * S.c * Math.sqrt(s.lambdas[k]) / TAU;
      this.freqs[k] = f;
      this.taus[k] = S.sustain / (0.5 + 0.0034 * f);
    }
    const f1 = this.freqs[0];
    let imax = 0;
    for (let k = 0; k < K; k++) imax = Math.max(imax, Math.abs(s.integ[k]));
    this.rad = new Float32Array(K);
    this.mallet = new Float32Array(K);
    const fc = 300 * Math.pow(20, S.hard);
    for (let k = 0; k < K; k++) {
      this.wv[k] = TAU * S.slow * this.freqs[k] / f1;
      this.tv[k] = 0.35 + 1.4 * this.taus[k] / S.sustain;
      this.rad[k] = 0.35 + 0.65 * Math.abs(s.integ[k]) / (imax || 1);
      this.mallet[k] = 1 / Math.sqrt(1 + Math.pow(this.freqs[k] / fc, 4));
    }
    // loudness normalisation: the loudest point of the drum hits at ~0.5
    let best = 0;
    const step = Math.max(1, Math.floor(s.n / 400));
    for (let p = 0; p < s.n; p += step) {
      let e = 0;
      for (let k = 0; k < K; k++) {
        const v = s.modes[k * s.n + p] * this.rad[k] * this.mallet[k];
        e += v * v;
      }
      best = Math.max(best, e);
    }
    this.gainNorm = 0.5 / Math.sqrt(best || 1);
    this.buildTail(tune, fc);
    this.pushBank();
  }

  // Above the computed modes, continue the spectrum statistically: Weyl's law
  // fixes the density of modes (one per 4pi/area in lambda), and at a generic
  // point the mode heights behave like Gaussian noise of variance 1/area. The
  // tail is seeded from the spectrum itself, so isospectral drums get the same.
  buildTail(tune, fc) {
    const s = this.sol, K = s.K;
    let mass = 0;
    for (let p = 0; p < s.n; p++) mass += s.rho[p];
    this.aEff = mass * s.grid.h * s.grid.h;
    const dl = 4 * Math.PI / this.aEff;
    let seed = Math.round(s.lambdas[K - 1] * 1000) >>> 0 || 1;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const f = [], t = [], sc = [], ml = [];
    let lam = s.lambdas[K - 1];
    for (let j = 0; j < 140; j++) {
      const stride = 1 + j / 10;
      lam += stride * dl * (0.6 + 0.8 * rand());
      const fr = tune * S.c * Math.sqrt(lam) / TAU;
      if (fr > 7000) break;
      f.push(fr);
      t.push(S.sustain / (0.5 + 0.0034 * fr));
      sc.push(Math.sqrt(stride));
      ml.push(1 / Math.sqrt(1 + Math.pow(fr / fc, 4)));
    }
    this.tailF = Float32Array.from(f);
    this.tailT = Float32Array.from(t);
    this.tailScale = Float32Array.from(sc);
    this.tailMallet = Float32Array.from(ml);
  }

  pushBank(pan) {
    if (!audio.ready || !this.freqs) return;
    const K = this.freqs.length, T = this.tailF.length;
    const f = new Float32Array(K + T), t = new Float32Array(K + T);
    f.set(this.freqs); f.set(this.tailF, K);
    t.set(this.taus); t.set(this.tailT, K);
    audio.setBank(this.id, f, t, { pan: pan === undefined ? this.pan : pan });
  }

  // Weights for the statistical tail: random heights for a point strike,
  // a fixed smooth profile for a "spectral" strike.
  tailWeights(scale, random) {
    const T = this.tailF.length, w = new Float32Array(T);
    const sd = Math.sqrt(1 / this.aEff);
    for (let j = 0; j < T; j++) {
      const g = random ? gauss() * sd * 0.35 : 1 / Math.sqrt(1 + (this.freqs.length + j) * 0.15);
      w[j] = scale * g * this.tailScale[j] * this.tailMallet[j];
    }
    return w;
  }

  withTail(w, tail) {
    const out = new Float32Array(w.length + tail.length);
    out.set(w); out.set(tail, w.length);
    return out;
  }

  phiAt(x, y) {
    const s = this.sol;
    const out = new Float32Array(s ? s.K : 0);
    if (!s) return out;
    const { x0, y0, h, W, H } = s.grid;
    const gx = (x - x0) / h, gy = (y - y0) / h;
    const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j;
    const corners = [[i, j, (1 - tx) * (1 - ty)], [i + 1, j, tx * (1 - ty)], [i, j + 1, (1 - tx) * ty], [i + 1, j + 1, tx * ty]];
    for (const [a, b, w] of corners) {
      if (a < 0 || b < 0 || a >= W || b >= H || w === 0) continue;
      const p = s.index[b * W + a];
      if (p < 0) continue;
      for (let k = 0; k < s.K; k++) out[k] += w * s.modes[k * s.n + p];
    }
    return out;
  }

  strike(x, y, strength) {
    if (!this.sol) return false;
    const phi = this.phiAt(x, y);
    const K = this.sol.K;
    const w = new Float32Array(K);
    let wmax = 0;
    for (let k = 0; k < K; k++) {
      w[k] = strength * this.gainNorm * phi[k] * this.mallet[k] * this.rad[k];
      wmax = Math.max(wmax, Math.abs(w[k]));
    }
    if (wmax === 0) return false;
    audio.strike(this.id, this.withTail(w, this.tailWeights(strength * this.gainNorm, true)), 0.05 * strength * (0.3 + S.hard), S.hard);
    const vis = this.visWeights();
    for (let k = 0; k < K; k++) {
      this.cr[k] += strength * phi[k] * this.mallet[k] * vis[k];
      this.energy[k] = Math.min(1, this.energy[k] + Math.abs(w[k]) / wmax);
    }
    return true;
  }

  // Strike every mode equally (a "spectral" strike) - used by the blind test.
  strikeSpectrum(strength) {
    if (!this.sol) return;
    const K = this.sol.K;
    const w = new Float32Array(K);
    for (let k = 0; k < K; k++) w[k] = strength * 0.07 * this.mallet[k] / Math.sqrt(1 + k * 0.15);
    audio.strike(this.id, this.withTail(w, this.tailWeights(strength * 0.07, false)), 0.02, S.hard);
    for (let k = 0; k < K; k++) {
      this.energy[k] = Math.min(1, this.energy[k] + w[k] / w[0]);
      this.cr[k] += (w[k] / w[0]) * this.sol.maxAbs[0] * 0.5 / Math.sqrt(1 + k);
    }
  }

  visWeights() {
    const K = this.sol.K, v = new Float32Array(K);
    for (let k = 0; k < K; k++) v[k] = Math.pow(this.freqs[0] / this.freqs[k], 0.75);
    return v;
  }

  rub(x, y, level) {
    if (!this.sol) return;
    const phi = this.phiAt(x, y);
    const K = this.sol.K;
    const w = new Float32Array(K);
    for (let k = 0; k < K; k++) w[k] = this.gainNorm * phi[k] * this.rad[k] * this.mallet[k];
    audio.drive(this.id, this.withTail(w, this.tailWeights(this.gainNorm, true)), level);
    const vis = this.visWeights();
    for (let k = 0; k < K; k++) {
      const a = (Math.random() - 0.5) * level * 6 * phi[k] * vis[k];
      this.cr[k] += a;
      this.energy[k] = Math.min(1, this.energy[k] + level * 3 * Math.abs(w[k]) / (this.gainNorm * this.sol.maxAbs[0] + 1e-9));
    }
  }

  step(dt) {
    const s = this.sol;
    if (!s) return;
    const K = s.K, n = s.n;
    const ex = app.explore && app.explore.k < K ? app.explore.k : -1;
    for (let k = 0; k < K; k++) {
      const dec = Math.exp(-dt / (k === ex ? 1e9 : ex >= 0 ? this.tv[k] * 0.2 : this.tv[k]));
      const a = this.wv[k] * dt, c = Math.cos(a), sn = Math.sin(a);
      const r = this.cr[k], i = this.ci[k];
      this.cr[k] = (r * c - i * sn) * dec;
      this.ci[k] = (r * sn + i * c) * dec;
      this.energy[k] *= Math.exp(-dt / this.taus[k]);
    }
    if (ex >= 0) {
      const amp = Math.hypot(this.cr[ex], this.ci[ex]);
      const target = 1 / s.maxAbs[ex];
      const g = amp > 1e-12 ? 1 + (target / amp - 1) * Math.min(1, dt * 4) : 0;
      if (amp > 1e-12) { this.cr[ex] *= g; this.ci[ex] *= g; } else { this.cr[ex] = target; }
      this.energy[ex] = 1;
    }
    const u = this.u;
    let cmax = 0;
    for (let k = 0; k < K; k++) cmax = Math.max(cmax, Math.abs(this.ci[k]), Math.abs(this.cr[k]));
    // once the head has rung down, stop recomputing and re-uploading it
    this.cRef = Math.max(cmax, (this.cRef || 0) * Math.exp(-dt / 8));
    if (ex < 0 && cmax <= this.cRef * 2e-4) {
      if (!this.idle) {
        this.cr.fill(0); this.ci.fill(0);
        this.texData.fill(0); this.env.fill(0);
        renderer.uploadField(this.holder, 'disp', this.texData, s.grid.W, s.grid.H, renderer.gl.NEAREST, 2);
        this.idle = true;
      }
      if (this.mass && this.massDirty) {
        renderer.uploadField(this.holder, 'mass', this.mass.data, this.mass.grid.W, this.mass.grid.H, renderer.gl.LINEAR);
        this.massDirty = false;
      }
      return;
    }
    this.idle = false;
    u.fill(0);
    for (let k = 0; k < K; k++) {
      const a = this.ci[k];
      if (Math.abs(a) < cmax * 1e-4) continue;
      const off = k * n;
      for (let p = 0; p < n; p++) u[p] += a * s.modes[off + p];
    }
    let peak = 0;
    for (let p = 0; p < n; p++) { const v = Math.abs(u[p]); if (v > peak) peak = v; }
    let norm;
    if (ex >= 0) {
      norm = 1;
    } else {
      this.uRef = Math.max(peak, this.uRef * Math.exp(-dt / 2.2));
      this.uPeak = Math.max(peak, this.uPeak * Math.exp(-dt / 10));
      norm = 1 / Math.max(this.uRef, this.uPeak * 0.18, 1e-9);
    }
    this.lastNorm = norm;
    const tex = this.texData, env = this.env, nt = s.nodeTex;
    const envDecay = Math.exp(-dt / 0.25);
    if (ex >= 0) {
      const off = ex * n, m = 1 / s.maxAbs[ex];
      for (let p = 0; p < n; p++) {
        const t = nt[p], phi = s.modes[off + p] * m, v = u[p] * norm;
        tex[2 * t] = v * 1.6 / (0.6 + Math.abs(v));
        tex[2 * t + 1] = phi;
        env[t] = Math.abs(phi);
      }
    } else {
      for (let p = 0; p < n; p++) {
        const t = nt[p], v = u[p] * norm;
        const c = v * 1.3 / (0.3 + Math.abs(v));
        tex[2 * t] = c;
        tex[2 * t + 1] = c;
        env[t] = Math.max(Math.abs(v), env[t] * envDecay);
      }
    }
    renderer.uploadField(this.holder, 'disp', tex, s.grid.W, s.grid.H, renderer.gl.NEAREST, 2);
    if (this.mass && this.massDirty) {
      renderer.uploadField(this.holder, 'mass', this.mass.data, this.mass.grid.W, this.mass.grid.H, renderer.gl.LINEAR);
      this.massDirty = false;
    }
  }

  envAt(x, y) {
    const s = this.sol;
    if (!s) return 0;
    const { x0, y0, h, W, H } = s.grid;
    const gx = (x - x0) / h, gy = (y - y0) / h;
    const i = Math.floor(gx), j = Math.floor(gy);
    if (i < 0 || j < 0 || i + 1 >= W || j + 1 >= H) return 0;
    const tx = gx - i, ty = gy - j, e = this.env;
    return (1 - ty) * ((1 - tx) * e[j * W + i] + tx * e[j * W + i + 1]) + ty * ((1 - tx) * e[(j + 1) * W + i] + tx * e[(j + 1) * W + i + 1]);
  }

  ensureMass() {
    if (this.mass) return this.mass;
    const b = this.bbox;
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const h = span / 120;
    const x0 = b.x0 - 3 * h, y0 = b.y0 - 3 * h;
    const W = Math.ceil((b.x1 - x0) / h) + 4, H = Math.ceil((b.y1 - y0) / h) + 4;
    this.mass = { grid: { x0, y0, h, W, H }, data: new Float32Array(W * H).fill(1) };
    this.massDirty = true;
    return this.mass;
  }

  paintMass(x, y, amount, radius) {
    const m = this.ensureMass();
    const { x0, y0, h, W, H } = m.grid;
    const r = radius / h;
    const ci = (x - x0) / h, cj = (y - y0) / h;
    for (let j = Math.max(0, Math.floor(cj - 2 * r)); j <= Math.min(H - 1, Math.ceil(cj + 2 * r)); j++) {
      for (let i = Math.max(0, Math.floor(ci - 2 * r)); i <= Math.min(W - 1, Math.ceil(ci + 2 * r)); i++) {
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (r * r);
        const g = Math.exp(-d2 * 1.5);
        if (g < 0.01) continue;
        const k = j * W + i;
        m.data[k] = Math.max(1, Math.min(40, m.data[k] + amount * g));
      }
    }
    this.massDirty = true;
  }

  clearMass() {
    this.lockLambda = null;
    this.mass = null;
    this.massDirty = false;
    if (this.holder.mass) { renderer.gl.deleteTexture(this.holder.mass); delete this.holder.mass; }
  }

  inharmonicity(count = HARM_COUNT) {
    if (!this.freqs) return 0;
    let s = 0, n = 0;
    for (let k = 1; k < Math.min(this.freqs.length, count + 1); k++) {
      s += Math.abs(centsFromHarmonic(this.freqs[k] / this.freqs[0]));
      n++;
    }
    return n ? s / n : 0;
  }
}

// ------------------------------------------------------------ layout & view

const bg = $('#bg'), glc = $('#gl'), fg = $('#fg');
const bgx = bg.getContext('2d'), fgx = fg.getContext('2d');
const maskCanvas = document.createElement('canvas');
const maskx = maskCanvas.getContext('2d');

function layout() {
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.cssW = window.innerWidth;
  view.cssH = window.innerHeight;
  const narrow = view.cssW < 760;
  view.specH = narrow ? 92 : 118;
  view.topH = narrow ? 52 : 60;
  const dockH = narrow ? 104 : 64;
  const panelW = !narrow && view.cssW > 1080 ? 330 : 0;
  const areaW = view.cssW - panelW;
  const areaH = view.cssH - view.topH - view.specH - dockH;
  const cx = areaW / 2;
  const cy = view.topH + areaH / 2 + 8;
  const sCss = Math.min(areaW * 0.95, areaH) / (app.mode === 'iso' && narrow ? 0.88 : 0.78);
  view.cx = cx * view.dpr;
  view.cy = cy * view.dpr;
  view.s = sCss * view.dpr;
  view.areaW = areaW; view.areaH = areaH; view.narrow = narrow;
  const W = Math.round(view.cssW * view.dpr), H = Math.round(view.cssH * view.dpr);
  for (const c of [bg, fg, maskCanvas]) { c.width = W; c.height = H; }
  renderer.resize(W, H);
  spectrum.resize(view.cssW, view.specH - 26, view.dpr);
  document.documentElement.style.setProperty('--spec-h', view.specH + 'px');
  shapeChanged();
}

const toScreen = (x, y) => [view.cx + x * view.s, view.cy - y * view.s];
const toWorld = (px, py) => [(px * view.dpr - view.cx) / view.s, -(py * view.dpr - view.cy) / view.s];

function tracePath(ctx, loops) {
  ctx.beginPath();
  for (const l of loops) {
    for (let i = 0; i < l.length; i += 2) {
      const [x, y] = toScreen(l[i], l[i + 1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

// Redraw everything that only changes with the shape or the window.
function shapeChanged() {
  const W = bg.width, H = bg.height;
  // background
  const g = bgx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#15161a');
  g.addColorStop(0.55, '#0b0c0f');
  g.addColorStop(1, '#060708');
  bgx.fillStyle = g;
  bgx.fillRect(0, 0, W, H);
  for (const d of app.drums) {
    bgx.save();
    tracePath(bgx, d.loops);
    bgx.shadowColor = 'rgba(0,0,0,0.85)';
    bgx.shadowBlur = 50 * view.dpr;
    bgx.shadowOffsetY = 22 * view.dpr;
    bgx.fillStyle = '#0d0d0f';
    bgx.fill('evenodd');
    bgx.restore();
    bgx.save();
    tracePath(bgx, d.loops);
    bgx.shadowColor = 'rgba(255,190,110,0.10)';
    bgx.shadowBlur = 90 * view.dpr;
    bgx.strokeStyle = 'rgba(255,190,110,0.05)';
    bgx.lineWidth = 2;
    bgx.stroke();
    bgx.restore();
  }
  // mask
  maskx.clearRect(0, 0, W, H);
  maskx.fillStyle = '#fff';
  for (const d of app.drums) {
    tracePath(maskx, d.loops);
    maskx.fill('evenodd');
  }
  renderer.uploadMask(maskCanvas);
  for (const d of app.drums) {
    const b = d.bbox;
    const [x0, y0] = toScreen(b.x0, b.y1);
    const [x1, y1] = toScreen(b.x1, b.y0);
    const pad = 6;
    d.scissor = [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 - x0 + 2 * pad), Math.ceil(y1 - y0 + 2 * pad)];
  }
}

// -------------------------------------------------------------- shape setup

function setSingle(loops, meta = {}) {
  app.mode = 'single';
  for (const d of app.drums) d.dispose();
  if (audio.ready) audio.mute();
  stopExplore(true);
  app.singleLoops = loops;
  app.singleMeta = meta;
  const d = new Drum(0, loops, {});
  app.drums = [d];
  document.body.classList.remove('iso');
  layout();
  runSolves(d);
  updateHash();
  renderPanel();
}

function enterIso() {
  if (app.mode === 'iso') return;
  for (const d of app.drums) d.dispose();
  if (audio.ready) audio.mute();
  stopExplore(true);
  app.mode = 'iso';
  document.body.classList.add('iso');
  const u = ISO_UNIT;
  const h = u / ISO_M.full;
  const snap = (v) => Math.round(v / h) * h;
  const portrait = window.innerWidth < window.innerHeight * 0.9;
  const sep = portrait ? 0.215 : 0.27;
  const scaleLoop = (l) => l.map((v) => v * u);
  // centre of each drum's bounding box, in units
  const ca = portrait ? [-1.5 * u, sep - 1.5 * u] : [-sep - 1.5 * u, -1.5 * u];
  const cb = portrait ? [0.5 * u, -sep + 0.5 * u] : [sep + 0.5 * u, 0.5 * u];
  const A = translate([scaleLoop(GWW_A)], snap(ca[0]), snap(ca[1]));
  const B = translate([scaleLoop(GWW_B)], snap(cb[0]), snap(cb[1]));
  app.drums = [
    new Drum(0, A, { label: 'A', lattice: true, pan: -0.35 }),
    new Drum(1, B, { label: 'B', lattice: true, pan: 0.35 }),
  ];
  layout();
  for (const d of app.drums) runSolves(d);
  updateHash();
  renderPanel();
}

function exitIso() {
  if (app.mode !== 'iso') return;
  setSingle(app.singleLoops || PRESETS.circle.make(), app.singleMeta || { preset: 'circle' });
}

async function runSolves(d) {
  try {
    const q = await d.solve('quick');
    if (!app.drums.includes(d)) return;
    d.apply(q, 'quick');
    onSolved(d);
    const f = await d.solve(d.mass ? 'mass' : 'full');
    if (!app.drums.includes(d)) return;
    d.apply(f, 'full');
    onSolved(d);
  } catch (e) {
    if (e.message !== 'cancelled') { console.error(e); toast('Could not solve that shape: ' + e.message); }
  }
}

function onSolved(d) {
  renderPanel();
  if (app.explore) startExplore(app.explore.k);
  if (app.pendingIntroStrike && app.drums.every((x) => x.sol)) {
    app.pendingIntroStrike = false;
    demoStrike();
  }
}

function updateHash() {
  let hash = '';
  if (app.mode === 'iso') hash = '#iso';
  else if (app.singleMeta && app.singleMeta.preset) hash = '#p=' + app.singleMeta.preset;
  else if (app.singleLoops) hash = '#d=' + encodeLoops(app.singleLoops);
  history.replaceState(null, '', location.pathname + location.search + hash);
}

function parseHash() {
  const h = location.hash.slice(1);
  if (h === 'iso') return { iso: true };
  if (h.startsWith('p=') && PRESETS[h.slice(2)]) return { preset: h.slice(2) };
  if (h.startsWith('d=')) {
    const loops = decodeLoops(h.slice(2));
    if (loops) return { loops };
  }
  return null;
}

// ----------------------------------------------------------------- explore

function startExplore(k) {
  const d0 = app.drums.find((d) => d.sol);
  if (!d0) return;
  k = Math.max(0, Math.min(d0.sol.K - 1, k));
  const prev = app.explore;
  app.explore = { k };
  if (!prev) {
    // switch the modal state into display units so the hand-over is seamless
    for (const d of app.drums) {
      if (!d.sol) continue;
      for (let j = 0; j < d.sol.K; j++) { d.cr[j] *= d.lastNorm; d.ci[j] *= d.lastNorm; }
    }
  }
  if (audio.ready) {
    audio.tone(app.drums[0].id, k, 0.14);
    if (app.drums[1]) audio.tone(app.drums[1].id, -1, 0);
  }
  renderHint();
}

function stopExplore(silent) {
  if (!app.explore) return;
  const k = app.explore.k;
  app.explore = null;
  for (const d of app.drums) {
    if (d.sol && k < d.sol.K) {
      // let the mode ring down naturally from here
      d.energy[k] = 0.6;
    }
  }
  if (audio.ready) for (const d of app.drums) audio.tone(d.id, -1, 0);
  if (!silent) renderHint();
}

// ------------------------------------------------------------------ input

const pointers = new Map();

function drumAt(x, y) {
  for (const d of app.drums) if (d.contains(x, y)) return d;
  return null;
}

fg.addEventListener('contextmenu', (e) => e.preventDefault());

fg.addEventListener('pointerdown', (e) => {
  if (!app.started) return;
  fg.setPointerCapture(e.pointerId);
  audio.resume();
  const [x, y] = toWorld(e.offsetX, e.offsetY);
  const d = drumAt(x, y);
  const strength = e.pointerType === 'mouse' ? 0.9 + Math.random() * 0.15 : 0.55 + 0.8 * (e.pressure || 0.5);
  const ptr = { id: e.pointerId, x, y, sx: e.offsetX, sy: e.offsetY, drum: d, kind: null, t: performance.now(), moved: 0 };
  pointers.set(e.pointerId, ptr);

  if (app.tool === 'mass' && d && app.mode === 'single') {
    ptr.kind = 'mass';
    stopExplore();
    d.paintMass(x, y, (e.button === 2 || e.shiftKey || app.erase) ? -2 : 2, massRadius());
    return;
  }
  if (app.tool === 'draw' || (!d && app.tool !== 'mass')) {
    if (app.mode === 'iso') {
      if (!d) toast('Leave two-drum mode to draw your own');
      return;
    }
    ptr.kind = 'draw';
    app.stroke = { pts: [[x, y]], add: app.tool === 'draw' };
    return;
  }
  if (d) {
    ptr.kind = 'strike';
    if (app.explore) stopExplore();
    if (d.strike(x, y, strength)) addRing(e.offsetX, e.offsetY, strength);
  }
});

fg.addEventListener('pointermove', (e) => {
  const [x, y] = toWorld(e.offsetX, e.offsetY);
  app.hover = { x, y, sx: e.offsetX, sy: e.offsetY };
  const ptr = pointers.get(e.pointerId);
  if (!ptr) return;
  const dist = Math.hypot(x - ptr.x, y - ptr.y);
  ptr.moved += Math.hypot(e.offsetX - ptr.sx, e.offsetY - ptr.sy);
  const now = performance.now();
  const dt = Math.max(1, now - ptr.t) / 1000;
  if (ptr.kind === 'draw') {
    const last = app.stroke.pts[app.stroke.pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) * view.s / view.dpr > 2.5) app.stroke.pts.push([x, y]);
  } else if (ptr.kind === 'mass' && ptr.drum) {
    if (ptr.drum.contains(x, y)) {
      ptr.drum.paintMass(x, y, ((e.buttons & 2) || e.shiftKey || app.erase ? -1 : 1) * Math.min(3, dist * 60), massRadius());
    }
  } else if ((ptr.kind === 'strike' || ptr.kind === 'rub') && ptr.moved > 8) {
    ptr.kind = 'rub';
    const d = drumAt(x, y);
    if (d && d.sol) {
      const speed = dist / dt;
      const level = Math.min(1, speed / 0.8) * 0.25;
      d.rub(x, y, level);
      if (ptr.drum && ptr.drum !== d) audio.drive(ptr.drum.id, null, 0);
      ptr.drum = d;
    } else if (ptr.drum) {
      audio.drive(ptr.drum.id, null, 0);
    }
  }
  ptr.x = x; ptr.y = y; ptr.t = now; ptr.sx = e.offsetX; ptr.sy = e.offsetY;
});

function endPointer(e) {
  const ptr = pointers.get(e.pointerId);
  if (!ptr) return;
  pointers.delete(e.pointerId);
  if (ptr.kind === 'draw' && app.stroke) {
    const add = app.stroke.add;
    const loop = strokeToLoop(app.stroke.pts, 0.0025);
    app.stroke = null;
    if (!loop) {
      if (ptr.moved > 20) toast('Draw a bigger closed shape');
      return;
    }
    const loops = add && app.drums[0] ? [...app.drums[0].loops, loop] : [loop];
    setSingle(loops, { drawn: true });
    if (app.tool === 'draw' && !add) setTool('play');
  } else if (ptr.kind === 'rub' && ptr.drum) {
    audio.drive(ptr.drum.id, null, 0);
  } else if (ptr.kind === 'mass' && ptr.drum) {
    remass(ptr.drum);
  }
}
fg.addEventListener('pointerup', endPointer);
fg.addEventListener('pointercancel', endPointer);
fg.addEventListener('pointerleave', () => { app.hover = null; });

function massRadius() { return 0.022; }

async function remass(d) {
  try {
    const r = await d.solve('mass');
    if (!app.drums.includes(d)) return;
    d.apply(r, 'mass');
    onSolved(d);
  } catch (e) {
    if (e.message !== 'cancelled') console.error(e);
  }
}

function addRing(sx, sy, strength) {
  app.rings.push({ x: sx, y: sy, t: app.time, s: strength });
  if (app.rings.length > 24) app.rings.shift();
}

function demoStrike() {
  const d = app.drums[0];
  if (!d || !d.sol) return;
  const b = d.bbox;
  let x = (b.x0 + b.x1) / 2 + (b.x1 - b.x0) * 0.12, y = (b.y0 + b.y1) / 2 + (b.y1 - b.y0) * 0.08;
  if (!d.contains(x, y)) { x = (b.x0 + b.x1) / 2; y = (b.y0 + b.y1) / 2; }
  if (d.strike(x, y, 1)) {
    const [sx, sy] = toScreen(x, y);
    addRing(sx / view.dpr, sy / view.dpr, 1);
  }
}

window.addEventListener('keydown', (e) => {
  if (!app.started || e.target.tagName === 'INPUT') return;
  const d0 = app.drums.find((d) => d.sol);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (!d0) return;
    const k = app.explore ? app.explore.k + (e.key === 'ArrowRight' ? 1 : -1) : 0;
    startExplore((k + d0.sol.K) % d0.sol.K);
    e.preventDefault();
  } else if (e.key === 'Escape') {
    stopExplore();
  } else if (e.key === ' ') {
    demoStrike();
    e.preventDefault();
  } else if (e.key >= '1' && e.key <= '9') {
    const keys = Object.keys(PRESETS);
    const k = keys[+e.key - 1];
    if (k) loadPreset(k);
  } else if (e.key === '0') {
    setSingle(randomBlob(), { surprise: true });
  } else if (e.key === 'd' || e.key === 'D') setTool('draw');
  else if (e.key === 'p' || e.key === 'P') setTool('play');
  else if (e.key === 'm' || e.key === 'M') setTool('mass');
  else if (e.key === 's' || e.key === 'S') toggleSand();
  else if (e.key === 'i' || e.key === 'I') (app.mode === 'iso' ? exitIso() : enterIso());
});

// -------------------------------------------------------------------- sand

const SAND_MAX = 16000;
const sand = { on: false, pos: new Float32Array(SAND_MAX * 2), drum: new Uint8Array(SAND_MAX), count: 0 };

function toggleSand(force) {
  sand.on = force !== undefined ? force : !sand.on;
  $('#btn-sand').classList.toggle('on', sand.on);
  if (sand.on) sprinkle(); else sand.count = 0;
}

function sprinkle() {
  const total = view.narrow ? 7000 : SAND_MAX;
  let c = 0, guard = 0;
  while (c < total && guard++ < total * 20) {
    const d = app.drums[Math.floor(Math.random() * app.drums.length)];
    const b = d.bbox;
    const x = b.x0 + Math.random() * (b.x1 - b.x0), y = b.y0 + Math.random() * (b.y1 - b.y0);
    if (!d.contains(x, y)) continue;
    sand.pos[2 * c] = x; sand.pos[2 * c + 1] = y; sand.drum[c] = app.drums.indexOf(d);
    c++;
  }
  sand.count = c;
}

let gaussSpare = null;
function gauss() {
  if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  gaussSpare = v * m;
  return u * m;
}

function stepSand(dt) {
  if (!sand.on || !sand.count) return;
  const sigma = 0.09 * Math.sqrt(dt);
  for (let i = 0; i < sand.count; i++) {
    const d = app.drums[sand.drum[i]];
    if (!d || !d.sol) continue;
    const x = sand.pos[2 * i], y = sand.pos[2 * i + 1];
    const a = d.envAt(x, y);
    if (a < 0.004) continue;
    const st = sigma * Math.min(1.5, a);
    const nx = x + st * gauss(), ny = y + st * gauss();
    if (d.contains(nx, ny)) { sand.pos[2 * i] = nx; sand.pos[2 * i + 1] = ny; }
  }
}

// ------------------------------------------------------------------ frame

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  app.time += dt;
  for (const d of app.drums) d.step(dt);
  stepSand(dt);
  renderer.render({
    view,
    time: app.time,
    drums: app.drums.filter((d) => d.sol).map((d) => ({
      tex: d.holder.disp,
      massTex: d.mass ? d.holder.mass : null,
      massGrid: d.mass ? d.mass.grid : null,
      grid: d.sol.grid,
      scissor: d.scissor,
      nodal: app.explore ? 1 : 0.12,
      tint: app.explore ? 0.5 : 0.16,
      relief: 3.2 * Math.sqrt(d.sol.n / 7000),
    })),
    sand: sand.pos,
    sandCount: sand.on ? sand.count : 0,
    sandSize: 1.6 * view.dpr,
    sandAlpha: 0.85,
  });
  drawOverlay();
  spectrum.draw(app.drums, app.explore ? { k: app.explore.k, drum: -1 } : null);
  updateReadout();
  requestAnimationFrame(frame);
}

function drawOverlay() {
  const ctx = fgx, dpr = view.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, fg.width, fg.height);
  for (const d of app.drums) {
    // rim
    tracePath(ctx, d.loops);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 6 * dpr;
    ctx.stroke();
    const b = d.bbox;
    const [gx0, gy0] = toScreen(b.x0, b.y1), [gx1, gy1] = toScreen(b.x1, b.y0);
    const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    grad.addColorStop(0, '#f1e0bd');
    grad.addColorStop(0.45, '#8c7b5f');
    grad.addColorStop(0.7, '#d9c49b');
    grad.addColorStop(1, '#5d523f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2 * dpr;
    ctx.stroke();
    if (!d.sol || d.busy && d.pending && d.pending.kind === 'quick') {
      ctx.save();
      ctx.setLineDash([6 * dpr, 10 * dpr]);
      ctx.lineDashOffset = -app.time * 60 * dpr;
      ctx.strokeStyle = 'rgba(255,214,140,0.8)';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.restore();
    }
    if (d.label) {
      ctx.font = `italic ${30 * dpr}px "Instrument Serif", Georgia, serif`;
      ctx.fillStyle = 'rgba(243,231,211,0.75)';
      const [lx, ly] = toScreen(b.x0, b.y1);
      ctx.fillText(d.label, lx - 26 * dpr, ly + 6 * dpr);
    }
  }
  // strike rings
  for (let i = app.rings.length - 1; i >= 0; i--) {
    const r = app.rings[i];
    const age = app.time - r.t;
    if (age > 0.7) { app.rings.splice(i, 1); continue; }
    const a = (1 - age / 0.7);
    ctx.beginPath();
    ctx.arc(r.x * dpr, r.y * dpr, (5 + age * 110) * dpr, 0, TAU);
    ctx.strokeStyle = `rgba(255,220,160,${0.55 * a * a})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }
  // live stroke
  if (app.stroke && app.stroke.pts.length > 1) {
    ctx.save();
    ctx.beginPath();
    app.stroke.pts.forEach(([x, y], i) => {
      const [sx, sy] = toScreen(x, y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,200,120,0.9)';
    ctx.shadowBlur = 14 * dpr;
    ctx.strokeStyle = '#ffe3b0';
    ctx.lineWidth = 2.5 * dpr;
    ctx.stroke();
    const [ax, ay] = toScreen(...app.stroke.pts[0]);
    ctx.beginPath();
    ctx.arc(ax, ay, 5 * dpr, 0, TAU);
    ctx.fillStyle = 'rgba(255,227,176,0.7)';
    ctx.fill();
    ctx.restore();
  }
  // mass brush
  if (app.tool === 'mass' && app.hover && app.mode === 'single') {
    ctx.beginPath();
    ctx.arc(app.hover.sx * dpr, app.hover.sy * dpr, massRadius() * view.s, 0, TAU);
    ctx.strokeStyle = app.erase ? 'rgba(140,200,255,0.7)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- readouts

function weylFit(lambdas) {
  // N(lambda) - 1/6 ~ A lambda / 4pi - P sqrt(lambda) / 4pi, fitted at the jumps
  let s11 = 0, s12 = 0, s22 = 0, v1 = 0, v2 = 0;
  for (let k = 0; k < lambdas.length; k++) {
    const y = k + 0.5 - 1 / 6, x1 = lambdas[k], x2 = -Math.sqrt(lambdas[k]);
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; v1 += x1 * y; v2 += x2 * y;
  }
  const det = s11 * s22 - s12 * s12;
  const a = (v1 * s22 - v2 * s12) / det, b = (s11 * v2 - s12 * v1) / det;
  return { area: a * 4 * Math.PI, perimeter: b * 4 * Math.PI };
}

let lastReadout = '';
function updateReadout() {
  const d = app.drums[0];
  let txt = '';
  if (d && d.freqs) {
    const nn = noteName(d.freqs[0]);
    txt = `<b>f₁ ${d.freqs[0].toFixed(1)} Hz</b><span>${nn.name} ${nn.cents >= 0 ? '+' : '−'}${Math.abs(nn.cents)}¢</span>` +
      `<span class="dim">${d.freqs.length} modes · overtones off the harmonic series by ${d.inharmonicity().toFixed(0)}¢ on average</span>`;
  } else {
    txt = '<span class="dim">listening to the shape…</span>';
  }
  if (txt !== lastReadout) { $('#readout').innerHTML = txt; lastReadout = txt; }
}

function fmtArea(a) { return a < 0.1 ? (a * 1e4).toFixed(0) + ' cm²' : a.toFixed(3) + ' m²'; }
function fmtLen(l) { return l < 1 ? (l * 100).toFixed(1) + ' cm' : l.toFixed(2) + ' m'; }

function renderPanel() {
  const el = $('#panel');
  if (app.mode === 'iso') { renderIsoPanel(el); renderHint(); return; }
  const d = app.drums[0];
  const meta = app.singleMeta || {};
  const preset = meta.preset ? PRESETS[meta.preset] : null;
  let html = '';
  if (app.tool === 'mass') {
    const ih = d ? d.inharmonicity() : 0;
    html += `<section class="card accent"><h3>Tune it like a tabla</h3>
      <p>Paint weight onto the head. In the 1920s C. V. Raman showed that the black paste on an Indian tabla pulls its overtones onto a harmonic series. That is why a tabla rings with a clear pitch where other drums thud.</p>
      <div class="stat"><span>Inharmonicity</span><b>${ih.toFixed(1)}¢</b><i>mean distance of overtones 2–9 from the nearest harmonic</i></div>
      <div class="row"><button id="btn-harm" class="primary">${app.harmonizing ? 'Stop' : 'Harmonize'}</button>
      <button id="btn-erase" class="${app.erase ? 'on' : ''}">Erase</button><button id="btn-clearmass">Clear</button></div>
      <p class="small">Harmonize is an optimiser. It uses the exact derivative of every frequency with respect to the mass at every point (∂λ/∂ρ = −λφ²) to decide where to add weight, then re-tensions the head so the pitch stays put.</p></section>`;
  }
  html += `<section class="card"><h3>${preset ? preset.label : meta.surprise ? 'A random drum' : 'Your drum'}</h3>`;
  html += `<p>${preset ? preset.note : 'Every closed curve has its own fixed set of resonant frequencies. These are yours, worked out by solving the wave equation on your shape.'}</p></section>`;
  if (d && d.sol) {
    const fit = weylFit(Array.from(d.sol.lambdas));
    const sp = d.sol;
    let massArea = 0;
    for (let p = 0; p < sp.n; p++) massArea += sp.rho[p];
    massArea *= sp.grid.h * sp.grid.h;
    const loaded = !!d.mass && massArea > sp.area * 1.01;
    const trueArea = loaded ? massArea : sp.area;
    const ea = Math.abs(fit.area / trueArea - 1) * 100, ep = Math.abs(fit.perimeter / sp.perimeter - 1) * 100;
    html += `<section class="card"><h3>Heard from the spectrum alone</h3>
      <div class="stat"><span>${loaded ? 'Area × weight' : 'Area'}</span><b>${fmtArea(fit.area)}</b><i>true ${fmtArea(trueArea)} · ${ea.toFixed(0)}% off</i></div>
      <div class="stat"><span>Rim length</span><b>${fmtLen(fit.perimeter)}</b><i>true ${fmtLen(sp.perimeter)} · ${ep.toFixed(0)}% off</i></div>
      <canvas class="weyl" id="weyl"></canvas>
      <p class="small">${loaded
        ? 'With weight on the head, Weyl\u2019s law hears the mass-weighted area, \u222B\u03C1 dA, rather than the bare area.'
        : `Weyl\u2019s law (1911): count how many notes a drum has below any pitch and you can read off its area. The next term gives the length of its rim. Both come from these ${sp.K} frequencies alone.`}</p></section>`;
    html += `<section class="card mono"><div class="kv"><span>grid points</span><b>${sp.grid.n.toLocaleString()}</b></div>
      <div class="kv"><span>modes</span><b>${sp.K}</b></div>
      <div class="kv"><span>solve time</span><b>${(sp.wall / 1000).toFixed(2)} s${sp.kind === 'quick' ? ' (preview)' : sp.kind === 'opt' ? ' (optimising)' : ''}</b></div></section>`;
  }
  el.innerHTML = html;
  if (d && d.sol) drawWeyl($('#weyl'), d);
  const hb = $('#btn-harm');
  if (hb) hb.onclick = () => (app.harmonizing ? (app.harmonizing = false) : harmonize());
  const eb = $('#btn-erase');
  if (eb) eb.onclick = () => { app.erase = !app.erase; renderPanel(); };
  const cb = $('#btn-clearmass');
  if (cb) cb.onclick = () => { app.harmonizing = false; const d = app.drums[0]; d.clearMass(); remass(d); };
  renderHint();
}

// Weyl staircase: the number of modes below each frequency (steps) against the
// two-term Weyl curve fitted to them.
function drawWeyl(cv, d) {
  if (!cv) return;
  const dpr = view.dpr;
  const w = cv.clientWidth || 280, h = cv.clientHeight || 92;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const l = Array.from(d.sol.lambdas), K = l.length;
  const fit = weylFit(l);
  const xmax = Math.sqrt(l[K - 1]) * 1.04, ymax = K + 2;
  const X = (sq) => 28 + (sq / xmax) * (w - 34);
  const Y = (n) => h - 16 - (n / ymax) * (h - 24);
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(241,232,216,0.32)';
  ctx.fillText('N', 4, 12);
  ctx.fillText(String(K), X(xmax) - 18, Y(K) - 5);
  ctx.fillText('frequency \u2192', w - 84, h - 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(xmax), Y(0)); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(ymax)); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,214,140,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const sq = (i / 80) * xmax, lam = sq * sq;
    const n = Math.max(0, (fit.area * lam - fit.perimeter * sq) / (4 * Math.PI) + 1 / 6);
    if (i === 0) ctx.moveTo(X(sq), Y(n)); else ctx.lineTo(X(sq), Y(n));
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(140,190,255,0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let k = 0; k < K; k++) {
    const sq = Math.sqrt(l[k]);
    ctx.lineTo(X(sq), Y(k));
    ctx.lineTo(X(sq), Y(k + 1));
  }
  ctx.lineTo(X(xmax), Y(K));
  ctx.stroke();
}

function renderIsoPanel(el) {
  const [a, b] = app.drums;
  let html = `<section class="card accent"><h3>Two drums, one voice</h3>
    <p>In 1992 Gordon, Webb and Wolpert answered Kac. Each of these shapes is built from seven identical half-squares, glued together according to the structure of the Fano plane. The two drums are different shapes with exactly the same frequencies.</p>
    <p>So no: you can’t always hear the shape of a drum.</p></section>`;
  if (a.sol && b.sol && a.sol.kind !== 'quick' && b.sol.kind !== 'quick') {
    let md = 0;
    const K = Math.min(a.sol.K, b.sol.K);
    for (let k = 0; k < K; k++) md = Math.max(md, Math.abs(a.sol.lambdas[k] - b.sol.lambdas[k]) / a.sol.lambdas[k]);
    html += `<section class="card mono"><table><tr><th>mode</th><th>drum A</th><th>drum B</th></tr>`;
    for (let k = 0; k < 8; k++) html += `<tr><td>${k + 1}</td><td>${a.freqs[k].toFixed(7)}</td><td>${b.freqs[k].toFixed(7)}</td></tr>`;
    html += `</table><p class="small">Frequencies in Hz. Across all ${K} computed modes the largest relative difference is <b>${md.toExponential(1)}</b>, which is floating-point round-off. The two grids are different, but the discrete problems are exactly isospectral too.</p></section>`;
  } else {
    html += `<section class="card mono"><p class="small">Solving both drums…</p></section>`;
  }
  html += `<section class="card"><h3>Listen</h3>
    <div class="row"><button id="iso-a">Ring A</button><button id="iso-b">Ring B</button><button id="iso-blind" class="primary">Blind test</button></div>
    <div id="blind-ui" class="row hidden"><button id="guess-a">It was A</button><button id="guess-b">It was B</button></div>
    <p class="small" id="blind-msg">“Ring” excites every mode of a drum equally, so you hear its whole spectrum. Tap a line in the spectrum and both drums show that mode: completely different patterns at exactly the same pitch.</p></section>`;
  el.innerHTML = html;
  $('#iso-a').onclick = () => isoRing(0);
  $('#iso-b').onclick = () => isoRing(1);
  $('#iso-blind').onclick = blindTest;
  $('#guess-a').onclick = () => blindGuess(0);
  $('#guess-b').onclick = () => blindGuess(1);
}

function isoRing(i) {
  stopExplore();
  const d = app.drums[i];
  if (!d || !d.sol) return;
  d.strikeSpectrum(1);
}

function blindTest() {
  stopExplore();
  const pick = Math.random() < 0.5 ? 0 : 1;
  app.blind = pick;
  // same pan for both so position gives nothing away
  const d = app.drums[pick];
  if (!d || !d.sol) return;
  d.pushBank(0);
  const w = new Float32Array(d.sol.K);
  for (let k = 0; k < d.sol.K; k++) w[k] = 0.07 * d.mallet[k] / Math.sqrt(1 + k * 0.15);
  audio.strike(d.id, d.withTail(w, d.tailWeights(0.07, false)), 0.02, S.hard);
  $('#blind-ui').classList.remove('hidden');
  $('#blind-msg').textContent = 'One of the two drums just rang (no visuals, no panning). Which one?';
  setTimeout(() => d.pushBank(), 2500);
}

function blindGuess(g) {
  if (app.blind === null) return;
  const right = g === app.blind;
  $('#blind-msg').innerHTML = `It was <b>${app.blind ? 'B' : 'A'}</b>. ${right ? 'You were right, but only by chance:' : 'No shame in that:'} the two sounds are the same numbers, sample for sample. Try again and you’ll be right half the time.`;
  $('#blind-ui').classList.add('hidden');
  app.blind = null;
}

function renderHint() {
  let t;
  if (app.explore) {
    const d = app.drums[0];
    const k = app.explore.k;
    if (d && d.freqs) {
      const nn = noteName(d.freqs[k]);
      t = `<b>Mode ${k + 1} of ${d.freqs.length}</b> · ${d.freqs[k].toFixed(1)} Hz · ×${(d.freqs[k] / d.freqs[0]).toFixed(3)} · ${nn.name}` +
        `<br><span class="dim">bright lines are nodes, where the head never moves · ← → step · Esc release</span>`;
    }
  } else if (app.mode === 'iso') {
    t = 'Tap either drum to strike it · tap a line in the spectrum to compare modes · <span class="dim">press I to go back</span>';
  } else if (app.tool === 'draw') {
    t = 'Draw a closed loop. <b>Inside</b> the drum it cuts a hole, <b>outside</b> it adds another membrane.';
  } else if (app.tool === 'mass') {
    t = 'Paint weight onto the drumhead · Shift or right-drag to erase · the spectrum shifts as you lift the brush';
  } else {
    t = 'Tap the drum to strike it · drag across it to rub · <b>draw outside it to make a new drum</b>';
  }
  $('#hint').innerHTML = t;
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// -------------------------------------------------------------- harmonize

// Pick harmonic targets for overtones 1..count: non-decreasing integers >= 2,
// each integer shared by at most `cap` modes (degenerate pairs and the like),
// minimising the weighted squared log-distance. Small dynamic programme.
function assignTargets(rat, count, cap) {
  const T = Math.ceil(rat[count] * 1.6) + 2;
  let best = new Map([['1,0', { c: 0, path: [] }]]);
  for (let k = 1; k <= count; k++) {
    const next = new Map();
    const w = 1 / (1 + 0.15 * k);
    for (const [key, v] of best) {
      const [lt, used] = key.split(',').map(Number);
      for (let t = Math.max(2, lt); t <= T; t++) {
        const u = t === lt ? used + 1 : 1;
        if (u > cap) continue;
        const c = v.c + w * Math.log(rat[k] / t) ** 2;
        const nk = t + ',' + u;
        const cur = next.get(nk);
        if (!cur || c < cur.c) next.set(nk, { c, path: v.path.concat(t) });
      }
    }
    best = next;
  }
  let b = null;
  for (const v of best.values()) if (!b || v.c < b.c) b = v;
  return [0, ...b.path];
}

function solveSmall(G, e) {
  const m = e.length;
  const A = G.map((row, i) => [...row, e[i]]);
  for (let i = 0; i < m; i++) {
    let pv = i;
    for (let j = i + 1; j < m; j++) if (Math.abs(A[j][i]) > Math.abs(A[pv][i])) pv = j;
    [A[i], A[pv]] = [A[pv], A[i]];
    for (let j = i + 1; j < m; j++) {
      const f = A[j][i] / A[i][i];
      for (let c = i; c <= m; c++) A[j][c] -= f * A[i][c];
    }
  }
  const x = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let s = A[i][m];
    for (let c = i + 1; c < m; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// Gauss-Newton on the mass distribution: residuals are log(f_k/f_1 / target_k),
// the Jacobian comes from d(lambda_k)/d(rho) = -lambda_k phi_k^2, smoothed, and
// the step is the minimum-norm one that respects 1 <= rho <= RHO_MAX.
const HARM_COUNT = 8, RHO_MAX = 40;
async function harmonize() {
  const d = app.drums[0];
  if (!d || !d.sol || app.mode !== 'single') return;
  stopExplore();
  app.harmonizing = true;
  app.harmStart = d.inharmonicity();
  if (!d.lockLambda) d.lockLambda = d.sol.lambdas[0];
  renderPanel();
  const m = d.ensureMass();
  const { x0, y0, h: mh, W, H } = m.grid;
  const N = W * H;
  let tgt = null, ih = Infinity;
  for (let iter = 0; iter < 45 && app.harmonizing; iter++) {
    let r;
    try { r = await d.solve('opt'); } catch (e) { break; }
    if (!app.drums.includes(d) || !app.harmonizing) return;
    const n = r.grid.n, K = r.lambdas.length, gh = r.grid.h;
    const count = Math.min(HARM_COUNT, K - 1);
    const rat = Array.from(r.lambdas, (l) => Math.sqrt(l / r.lambdas[0]));
    if (iter % 8 === 0) tgt = assignTargets(rat, count, 3);
    ih = 0;
    for (let k = 1; k <= count; k++) ih += Math.abs(centsFromHarmonic(rat[k])) / count;
    d.apply(r, 'opt');
    renderPanel();
    if (ih < 6) break;
    const e = [], J = [];
    for (let k = 1; k <= count; k++) {
      const wk = Math.sqrt(1 / (1 + 0.15 * k));
      e.push(wk * Math.log(rat[k] / tgt[k]));
      const row = new Float64Array(N);
      for (let j = 0; j < r.grid.H; j++) {
        for (let i = 0; i < r.grid.W; i++) {
          const p = r.index[j * r.grid.W + i];
          if (p < 0) continue;
          const a = r.modes[p], b = r.modes[k * n + p];
          const val = wk * -0.5 * gh * gh * (b * b - a * a);
          const fx = (r.grid.x0 + i * gh - x0) / mh, fy = (r.grid.y0 + j * gh - y0) / mh;
          const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
          if (ix < 0 || iy < 0 || ix + 1 >= W || iy + 1 >= H) continue;
          row[iy * W + ix] += val * (1 - tx) * (1 - ty);
          row[iy * W + ix + 1] += val * tx * (1 - ty);
          row[(iy + 1) * W + ix] += val * (1 - tx) * ty;
          row[(iy + 1) * W + ix + 1] += val * tx * ty;
        }
      }
      blur(row, W, H, 2);
      J.push(row);
    }
    const free = new Uint8Array(N).fill(1);
    let step = null, smax = 0;
    for (let pass = 0; pass < 3; pass++) {
      const G = J.map(() => new Float64Array(count));
      let tr = 0;
      for (let a = 0; a < count; a++) {
        for (let b = a; b < count; b++) {
          let s = 0;
          const A = J[a], B = J[b];
          for (let q = 0; q < N; q++) if (free[q]) s += A[q] * B[q];
          G[a][b] = G[b][a] = s;
        }
        tr += G[a][a];
      }
      for (let a = 0; a < count; a++) G[a][a] += (tr / count) * 1e-3;
      const x = solveSmall(G, e);
      step = new Float64Array(N);
      for (let k = 0; k < count; k++) {
        const row = J[k], xk = x[k];
        for (let q = 0; q < N; q++) if (free[q]) step[q] -= xk * row[q];
      }
      let changed = 0;
      smax = 0;
      for (let q = 0; q < N; q++) {
        if (free[q] && ((m.data[q] <= 1.0001 && step[q] < 0) || (m.data[q] >= RHO_MAX - 1e-3 && step[q] > 0))) {
          free[q] = 0; step[q] = 0; changed++;
        }
        smax = Math.max(smax, Math.abs(step[q]));
      }
      if (!changed) break;
    }
    if (!(smax > 0)) break;
    const alpha = Math.min(1, 4 / smax);
    for (let q = 0; q < N; q++) m.data[q] = Math.max(1, Math.min(RHO_MAX, m.data[q] + alpha * step[q]));
    d.massDirty = true;
  }
  const wasRunning = app.harmonizing;
  app.harmonizing = false;
  await remass(d);
  renderPanel();
  if (wasRunning) toast(`Overtones pulled from ${app.harmStart.toFixed(0)}\u00A2 to ${d.inharmonicity().toFixed(0)}\u00A2 off the harmonic series`);
}

function blur(a, W, H, r) {
  const tmp = new Float32Array(W * H);
  const k = [];
  let s = 0;
  for (let i = -2 * r; i <= 2 * r; i++) { const v = Math.exp(-(i * i) / (2 * r * r)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const R = 2 * r;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -R; i <= R; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)); acc += a[y * W + xx] * k[i + R]; }
    tmp[y * W + x] = acc;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -R; i <= R; i++) { const yy = Math.min(H - 1, Math.max(0, y + i)); acc += tmp[yy * W + x] * k[i + R]; }
    a[y * W + x] = acc;
  }
}

// --------------------------------------------------------------------- UI

function setTool(t) {
  if (app.mode === 'iso' && t !== 'play') { toast('Leave two-drum mode first'); return; }
  app.tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'mass') app.harmonizing = false;
  renderPanel();
}

function loadPreset(key) {
  if (key === 'gww') { enterIso(); return; }
  setSingle(PRESETS[key].make(), { preset: key });
}

function buildUI() {
  const chips = $('#presets');
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.onclick = () => loadPreset(key);
    chips.appendChild(b);
  }
  const sur = document.createElement('button');
  sur.textContent = 'Surprise me';
  sur.className = 'ghost';
  sur.onclick = () => setSingle(randomBlob(), { surprise: true });
  chips.appendChild(sur);

  document.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#btn-sand').onclick = () => toggleSand();
  $('#btn-iso').onclick = () => (app.mode === 'iso' ? exitIso() : enterIso());
  $('#btn-share').onclick = async () => {
    updateHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied. Whoever opens it gets this exact drum.');
    } catch (e) {
      toast(location.href);
    }
  };
  $('#btn-about').onclick = () => $('#about').classList.toggle('open');
  $('#btn-notes').onclick = () => document.body.classList.toggle('panel-open');
  $('#about-close').onclick = () => $('#about').classList.remove('open');

  const bind = (id, key, fmt, apply) => {
    const el = $(id), out = $(id + '-v');
    const upd = () => {
      S[key] = parseFloat(el.value);
      if (out) out.textContent = fmt(S[key]);
      apply && apply();
    };
    el.addEventListener('input', upd);
    upd();
  };
  bind('#s-tension', 'c', (v) => Math.round(v) + ' m/s', () => app.drums.forEach((d) => d.updatePhysics()));
  bind('#s-hard', 'hard', (v) => (v < 0.3 ? 'felt' : v < 0.65 ? 'wood' : 'steel'), () => app.drums.forEach((d) => d.updatePhysics()));
  bind('#s-sustain', 'sustain', (v) => v.toFixed(1) + '×', () => app.drums.forEach((d) => d.updatePhysics()));
  bind('#s-reverb', 'reverb', (v) => Math.round(v * 100) + '%', () => audio.setReverb(S.reverb));

  $('#begin').onclick = start;
}

async function start() {
  $('#intro').classList.add('gone');
  app.started = true;
  const ok = await audio.init();
  if (!ok) toast('Audio is unavailable in this browser; visuals only.');
  audio.setReverb(S.reverb);
  for (const d of app.drums) d.updatePhysics();
  if (app.drums.every((d) => d.sol)) demoStrike(); else app.pendingIntroStrike = true;
}

function boot() {
  try {
    renderer = new Renderer(glc);
  } catch (e) {
    $('#intro .lead').textContent = 'This needs WebGL2, which this browser does not offer.';
    $('#begin').disabled = true;
    return;
  }
  spectrum = new Spectrum($('#spectrum'), (drumIdx, k) => {
    if (app.explore && app.explore.k === k) stopExplore(); else startExplore(k);
  });
  buildUI();
  window.addEventListener('resize', () => { layout(); });
  const h = parseHash();
  if (h && h.iso) enterIso();
  else if (h && h.preset) setSingle(PRESETS[h.preset].make(), { preset: h.preset });
  else if (h && h.loops) setSingle(h.loops, { drawn: true });
  else setSingle(PRESETS.circle.make(), { preset: 'circle' });
  requestAnimationFrame(frame);
  window.__eigendrum = { app, S, audio, view, startExplore, stopExplore, enterIso, exitIso, setSingle, toggleSand, setTool, harmonize, demoStrike };
}

boot();
