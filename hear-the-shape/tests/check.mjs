// Numerical checks behind the claims on the page.  Run: node tests/check.mjs
import fs from 'fs';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Solver = require('../solver.js');
const G = await import('../geom.js');
const { PRESETS, twins } = await import('../shapes.js');
const { voiceModel, normaliseVoice, strikeAmps, MATERIALS } = await import('../audio.js');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

// 1. square drum: the discrete spectrum is known in closed form, degeneracies included
{
  const a = 40, nx = a + 2, mask = new Uint8Array(nx * nx);
  for (let j = 1; j <= a; j++) for (let i = 1; i <= a; i++) mask[j * nx + i] = 1;
  const r = Solver.lowestModes(nx, nx, mask, { K: 60 });
  const exact = [];
  for (let p = 1; p <= a; p++) for (let q = 1; q <= a; q++)
    exact.push(4 * Math.sin((Math.PI * p) / (2 * (a + 1))) ** 2 + 4 * Math.sin((Math.PI * q) / (2 * (a + 1))) ** 2);
  exact.sort((x, y) => x - y);
  let err = 0;
  for (let k = 0; k < r.K; k++) err = Math.max(err, Math.abs(r.lambdas[k] - exact[k]) / exact[k]);
  check('square: every eigenvalue matches the closed form', r.K >= 50 && err < 1e-8, `${r.K} modes, max rel err ${err.toExponential(1)}`);
}

// 2. the Gordon–Webb–Wolpert pair is isospectral on the grid
const solveDef = (def) => {
  const g = G.rasterise(def.poly, def.spec);
  return { g, r: Solver.lowestModes(g.nx, g.ny, g.mask, { K: 80 }) };
};
{
  const [A, B] = twins(1.5, 16).map(solveDef);
  const K = Math.min(A.r.K, B.r.K);
  let d = 0;
  for (let k = 0; k < K; k++) d = Math.max(d, Math.abs(A.r.lambdas[k] - B.r.lambdas[k]) / A.r.lambdas[k]);
  check('twins: identical spectra', A.g.n === B.g.n && d < 1e-9, `${K} shared modes, max rel gap ${d.toExponential(1)}`);
}

// 3. Weyl's law recovers the area of a circle from its spectrum
{
  const def = PRESETS.circle.make();
  const { g, r } = solveDef(def);
  const lam = Array.from(r.lambdas, (l) => (l + (l * l) / 16) / (g.h * g.h));
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  lam.forEach((l, k) => {
    const x1 = l / (4 * Math.PI), x2 = -Math.sqrt(l) / (4 * Math.PI), y = k + 0.5 - 1 / 6;
    a11 += x1 * x1; a12 += x1 * x2; a22 += x2 * x2; b1 += x1 * y; b2 += x2 * y;
  });
  const D = a11 * a22 - a12 * a12, area = (b1 * a22 - b2 * a12) / D, perim = (a11 * b2 - a12 * b1) / D;
  const A0 = Math.abs(G.signedArea(def.poly)), P0 = G.perimeter(def.poly);
  check('weyl: circle area heard within 3%', Math.abs(area / A0 - 1) < 0.03, `heard ${area.toFixed(3)}, drawn ${A0.toFixed(3)}`);
  check('weyl: circle perimeter heard within 8%', Math.abs(perim / P0 - 1) < 0.08, `heard ${perim.toFixed(3)}, drawn ${P0.toFixed(3)}`);
}

// 4. the worklet: every material rings, nothing clips before the compressor
{
  let Proc;
  const SR = 48000;
  vm.runInNewContext(fs.readFileSync(new URL('../bank.js', import.meta.url), 'utf8'), {
    sampleRate: SR, Math, Float32Array, Float64Array,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (n, c) => { Proc = c; },
  });
  const def = PRESETS.blob.make();
  const { g, r } = solveDef(def);
  const N = g.nx * g.ny, s = Math.sqrt(r.n);
  const modes = r.modes.map((v) => v * s);
  const interior = []; for (let t = 0; t < N; t++) if (g.mask[t]) interior.push(t);
  const drum = {
    K: r.K, lam: Array.from(r.lambdas, (l) => (l + (l * l) / 16) / (g.h * g.h)),
    V: Array.from({ length: r.K }, (_, k) => interior.reduce((a, t) => a + modes[k * N + t], 0) / r.n),
    pickups: [interior.slice(0, 5), interior.slice(-5)],
    phiAtNode: (k, t) => modes[k * N + t],
  };
  const centre = interior.reduce((b, t) => (Math.abs(modes[t]) > Math.abs(modes[b]) ? t : b), interior[0]);
  for (const m of Object.keys(MATERIALS)) {
    const v = normaliseVoice(drum, voiceModel(drum, m, 0), centre);
    const p = new Proc();
    p.onMessage({ type: 'modes', slot: 0, freqs: v.freqs, decays: v.decays, gainL: v.gainL, gainR: v.gainR });
    const phis = Float32Array.from({ length: drum.K }, (_, k) => drum.phiAtNode(k, centre));
    p.onMessage({ type: 'strike', slot: 0, amps: strikeAmps(v, phis, 0.95), noise: 0.06 });
    const L = new Float32Array(128), R = new Float32Array(128);
    let peak = 0, e = 0;
    for (let b = 0; b < (SR / 128) * 1.5; b++) {
      p.process([], [[L, R]]);
      for (let i = 0; i < 128; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); e += L[i] * L[i]; }
    }
    const rms = Math.sqrt(e / (SR * 1.5));
    check(`audio: ${m} rings without clipping`, peak < 0.95 && rms > 0.03, `peak ${peak.toFixed(2)}, rms ${rms.toFixed(3)}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
