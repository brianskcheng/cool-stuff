// Enumerate every shape made of seven half-squares (polyaboloes), solve each drum on a
// grid, and report which pairs share a spectrum.  Run: node tests/heptaboloes.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { symEig } = require('../solver.js');

// tile = [x, y, c]: the half of unit square (x, y) whose right angle sits at corner c
// (0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left)
const LEG_SIDES = [[0, 3], [0, 1], [1, 2], [2, 3]]; // sides: 0 bottom, 1 right, 2 top, 3 left
const SIDE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]];
const SIDE_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const QUARTERS = [[0, 3], [0, 1], [1, 2], [2, 3]];   // each half-square covers two quarter-triangles
const key = (t) => t.join(',');

function neighbours([x, y, c]) {
  const out = [[x, y, (c + 2) % 4]];
  for (const side of LEG_SIDES[c]) {
    const [dx, dy] = SIDE_DIR[side];
    for (const cc of SIDE_CORNERS[(side + 2) % 4]) out.push([x + dx, y + dy, cc]);
  }
  return out;
}
const overlaps = (set, [x, y, c]) => [0, 1, 2, 3].some((cc) => cc !== (c + 2) % 4 && set.has(key([x, y, cc])));

function transform(tiles, s) {
  return tiles.map(([x, y, c]) => {
    const C = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const pts = [C[c], C[(c + 1) % 4], C[(c + 3) % 4]].map(([X, Y]) => {
      if (s & 4) X = -X;
      for (let r = 0; r < (s & 3); r++) [X, Y] = [-Y, X];
      return [X, Y];
    });
    const sx = Math.min(...pts.map((p) => p[0])), sy = Math.min(...pts.map((p) => p[1]));
    const [rx, ry] = pts[0];
    return [sx, sy, rx === sx ? (ry === sy ? 0 : 3) : ry === sy ? 1 : 2];
  });
}
// shapes are compared by the region they cover, not by how they happen to be cut
function regionKey(tiles) {
  const q = tiles.flatMap(([x, y, c]) => QUARTERS[c].map((z) => [x, y, z]));
  const mx = Math.min(...q.map((t) => t[0])), my = Math.min(...q.map((t) => t[1]));
  return JSON.stringify(q.map(([x, y, z]) => [x - mx, y - my, z]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]));
}
const canon = (tiles) => [0, 1, 2, 3, 4, 5, 6, 7].map((s) => regionKey(transform(tiles, s))).sort()[0];

function enumerate(N) {
  let level = new Map([[canon([[0, 0, 0]]), [[0, 0, 0]]]]);
  for (let size = 2; size <= N; size++) {
    const next = new Map();
    for (const tiles of level.values()) {
      const set = new Set(tiles.map(key));
      for (const t of tiles) for (const nb of neighbours(t)) {
        if (set.has(key(nb)) || overlaps(set, nb)) continue;
        const grown = [...tiles, nb];
        const k = canon(grown);
        if (!next.has(k)) next.set(k, grown);
      }
    }
    level = next;
  }
  return [...level.values()];
}

function inside(tiles, px, py) {
  const sx = Math.floor(px), sy = Math.floor(py), u = px - sx, v = py - sy;
  return tiles.some(([x, y, c]) => x === sx && y === sy && [u + v < 1, v < u, u + v > 1, v > u][c]);
}

function spectrum(tiles, L, K) {
  const mnx = Math.min(...tiles.map((t) => t[0])), mny = Math.min(...tiles.map((t) => t[1]));
  const W = Math.max(...tiles.map((t) => t[0])) - mnx + 1, H = Math.max(...tiles.map((t) => t[1])) - mny + 1;
  const nx = W * L + 1, ny = H * L + 1, idx = new Int32Array(nx * ny).fill(-1);
  let n = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let all = true;
    for (let k = 0; k < 8 && all; k++) {
      const a = ((22.5 + 45 * k) * Math.PI) / 180;
      all = inside(tiles, mnx + i / L + 1e-4 * Math.cos(a), mny + j / L + 1e-4 * Math.sin(a));
    }
    if (all) idx[j * nx + i] = n++;
  }
  const A = new Float64Array(n * n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = idx[j * nx + i];
    if (k < 0) continue;
    A[k * n + k] = 4;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = idx[(j + dj) * nx + i + di];
      if (m >= 0) A[k * n + m] = -1;
    }
  }
  return Array.from(symEig(A, n).slice(0, K));
}

const shapes = enumerate(7);
console.log(`${shapes.length} heptaboloes`);
const groups = new Map();
for (const t of shapes) {
  const k = spectrum(t, 4, 8).map((v) => v.toFixed(7)).join('|');
  groups.set(k, [...(groups.get(k) || []), t]);
}
const iso = [...groups.values()].filter((g) => g.length > 1);
console.log(`${iso.length} isospectral group(s)`);
for (const g of iso) {
  g.forEach((t) => console.log('  ', JSON.stringify(t)));
  for (const L of [6, 8]) {
    const a = spectrum(g[0], L, 12), b = spectrum(g[1], L, 12);
    console.log(`   L=${L}: max rel gap over 12 modes ${Math.max(...a.map((v, i) => Math.abs(v - b[i]) / v)).toExponential(1)}`);
  }
}
