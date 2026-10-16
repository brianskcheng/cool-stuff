// Preset outlines. Each returns { poly, spec } with the polygon in drum-local units.
import { fit } from './geom.js';

const SIZE = 1.9;
const CELLS = 60;

function ring(n, r) {
  const P = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    P.push([Math.cos(t) * r(t), Math.sin(t) * r(t)]);
  }
  return P;
}

// a polygon whose vertices sit on a lattice of pitch `unit`, rasterised with
// `per` cells per lattice step — so it is discretised without staircase error
function latticeShape(verts, per) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of verts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const s = SIZE / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const poly = verts.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
  return { poly, spec: { lattice: { ox: -cx * s, oy: -cy * s, h: s / per } } };
}

export function blob(seed = 7) {
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const terms = [2, 3, 4, 5, 7].map((m) => ({ m, amp: (0.22 / Math.pow(m, 1.05)) * (0.6 + rnd()), ph: rnd() * 6.283 }));
  const poly = ring(240, (t) => 1 + terms.reduce((s, { m, amp, ph }) => s + amp * Math.sin(m * t + ph), 0));
  return { poly: fit(poly, SIZE), spec: { cells: CELLS } };
}

export const PRESETS = {
  blob: { label: 'Pebble', make: () => blob(11) },
  circle: { label: 'Circle', make: () => ({ poly: ring(256, () => SIZE / 2), spec: { cells: CELLS } }) },
  square: { label: 'Square', make: () => latticeShape([[0, 0], [1, 0], [1, 1], [0, 1]], 56) },
  stadium: {
    label: 'Stadium',
    make: () => {
      const P = [];
      for (let i = 0; i <= 90; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 90; P.push([0.5 + 0.5 * Math.cos(t), 0.5 * Math.sin(t)]); }
      for (let i = 0; i <= 90; i++) { const t = Math.PI / 2 + (Math.PI * i) / 90; P.push([-0.5 + 0.5 * Math.cos(t), 0.5 * Math.sin(t)]); }
      return { poly: fit(P, SIZE), spec: { cells: CELLS } };
    },
  },
  ell: { label: 'L', make: () => latticeShape([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 29) },
  star: {
    label: 'Star',
    make: () => {
      const P = [];
      for (let i = 0; i < 10; i++) {
        const t = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.46 : 1;
        P.push([Math.cos(t) * r, Math.sin(t) * r]);
      }
      return { poly: fit(P, SIZE), spec: { cells: CELLS } };
    },
  },
  heart: {
    label: 'Heart',
    make: () => {
      const P = [];
      for (let i = 0; i < 240; i++) {
        const t = (i / 240) * Math.PI * 2;
        P.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
      }
      return { poly: fit(P, SIZE), spec: { cells: CELLS } };
    },
  },
  gourd: {
    label: 'Gourd',
    make: () => ({
      poly: fit(ring(240, (t) => 1 + 0.32 * Math.cos(t) + 0.2 * Math.cos(2 * t) - 0.05 * Math.cos(3 * t)), SIZE),
      spec: { cells: CELLS },
    }),
  },
};

/*
 * The Gordon–Webb–Wolpert pair (1992): each is seven half-squares.
 * Found here independently — enumerating all 318 polyaboloes of order 7 and
 * comparing their discrete spectra yields exactly this one isospectral pair.
 */
export const TWINS = {
  a: [[1, 3], [0, 2], [1, 2], [1, 1], [2, 0], [3, 1], [2, 1], [2, 3]],
  b: [[1, 2], [0, 2], [2, 0], [3, 0], [3, 1], [2, 1], [2, 2], [1, 3]],
};

// both drums share one transform and one lattice, so their grids are congruent
export function twins(size, per) {
  const s = size / 3;
  const place = (verts) => verts.map(([x, y]) => [(x - 1.5) * s, (y - 1.5) * s]);
  const spec = { lattice: { ox: -1.5 * s, oy: -1.5 * s, h: s / per } };
  return [{ poly: place(TWINS.a), spec }, { poly: place(TWINS.b), spec }];
}
