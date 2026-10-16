// Plane geometry for outlines: polygons are arrays of [x, y] in drum-local units.

export function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function signedArea(P) {
  let s = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  return s / 2;
}

export function perimeter(P) {
  let s = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
  return s;
}

// even–odd rule, so a self-crossing scribble still makes a valid (multi-piece) drum
export function inside(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

export function onEdge(P, x, y, eps) {
  const e2 = eps * eps;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (segDist2(x, y, P[j][0], P[j][1], P[i][0], P[i][1]) <= e2) return true;
  }
  return false;
}

// uniform arc-length resampling of a closed loop
export function resample(P, n) {
  const L = [0];
  for (let i = 1; i <= P.length; i++) {
    const a = P[i - 1], b = P[i % P.length];
    L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = L[L.length - 1];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (seg < P.length - 1 && L[seg + 1] < s) seg++;
    const a = P[seg], b = P[(seg + 1) % P.length];
    const span = L[seg + 1] - L[seg] || 1;
    const t = (s - L[seg]) / span;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Chaikin corner cutting on a closed loop
export function smooth(P, iters = 1) {
  let Q = P;
  for (let it = 0; it < iters; it++) {
    const R = [];
    for (let i = 0; i < Q.length; i++) {
      const a = Q[i], b = Q[(i + 1) % Q.length];
      R.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      R.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    Q = R;
  }
  return Q;
}

// centre the bounding box on the origin and scale its longest side to `size`
export function fit(P, size) {
  const b = bbox(P);
  const s = size / Math.max(b.w, b.h);
  return P.map(([x, y]) => [(x - b.cx) * s, (y - b.cy) * s]);
}

/*
 * Rasterise an outline onto the solver grid. Nodes strictly inside are unknowns;
 * everything else is the wire (Dirichlet, u = 0).
 *   spec.cells   — grid cells across the longest side (free-form shapes)
 *   spec.lattice — { ox, oy, h } aligns nodes to a lattice, so polygons with
 *                  lattice vertices are discretised exactly (squares, the twins)
 */
export function rasterise(P, spec) {
  const b = bbox(P);
  let h, x0, y0;
  if (spec.lattice) {
    ({ h } = spec.lattice);
    x0 = spec.lattice.ox + h * (Math.floor((b.x0 - spec.lattice.ox) / h + 1e-9) - 1);
    y0 = spec.lattice.oy + h * (Math.floor((b.y0 - spec.lattice.oy) / h + 1e-9) - 1);
  } else {
    h = Math.max(b.w, b.h) / spec.cells;
    x0 = b.x0 - h;
    y0 = b.y0 - h;
  }
  const nx = Math.ceil((b.x1 - x0) / h + 1e-9) + 2;
  const ny = Math.ceil((b.y1 - y0) / h + 1e-9) + 2;
  const mask = new Uint8Array(nx * ny);
  const eps = h * 1e-6;
  let n = 0;
  for (let j = 1; j < ny - 1; j++) {
    const y = y0 + j * h;
    for (let i = 1; i < nx - 1; i++) {
      const x = x0 + i * h;
      if (inside(P, x, y) && !onEdge(P, x, y, eps)) { mask[j * nx + i] = 1; n++; }
    }
  }
  return { h, x0, y0, nx, ny, mask, n };
}

export function components(mask, nx, ny) {
  const seen = new Uint8Array(mask.length);
  const stack = [];
  let count = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    count++;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(), i = c % nx;
      const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx];
      for (const t of nb) if (t >= 0 && t < mask.length && mask[t] && !seen[t]) { seen[t] = 1; stack.push(t); }
    }
  }
  return count;
}

// signed distance (negative inside) sampled on a res×res texture covering `rect`
export function sdfTexture(P, rect, res) {
  const out = new Float32Array(res * res);
  const n = P.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  for (let i = 0, j = n - 1; i < n; j = i++) { ax[i] = P[j][0]; ay[i] = P[j][1]; bx[i] = P[i][0]; by[i] = P[i][1]; }
  for (let v = 0; v < res; v++) {
    const y = rect.y + (v + 0.5) / res * rect.h;
    for (let u = 0; u < res; u++) {
      const x = rect.x + (u + 0.5) / res * rect.w;
      let best = Infinity;
      let c = false;
      for (let i = 0; i < n; i++) {
        const d = segDist2(x, y, ax[i], ay[i], bx[i], by[i]);
        if (d < best) best = d;
        if ((by[i] > y) !== (ay[i] > y) && x < (ax[i] - bx[i]) * (y - by[i]) / (ay[i] - by[i]) + bx[i]) c = !c;
      }
      out[v * res + u] = c ? -Math.sqrt(best) : Math.sqrt(best);
    }
  }
  return out;
}
