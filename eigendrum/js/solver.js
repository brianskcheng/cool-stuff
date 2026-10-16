/*
 * Eigendrum solver.
 *
 * Finds the lowest K vibration modes of a membrane of any shape:
 *     -div grad u = lambda * rho * u   inside the shape,   u = 0 on the rim.
 *
 * The shape (any set of closed loops, even-odd filled) is sampled on a square
 * grid, the Laplacian is the 5-point stencil, and the generalised eigenproblem
 * K phi = lambda M phi (M = diag(rho)) is solved by shift-invert block Lanczos:
 *   - K is factored once with an envelope (skyline) Cholesky in row-major order.
 *   - The symmetric operator S K^-1 S  (S = sqrt(M)) is expanded into a Krylov
 *     basis that starts from a block of random vectors, so repeated eigenvalues
 *     (circles, squares) come out with their full multiplicity.
 *   - Rayleigh-Ritz on the projected banded matrix gives the modes.
 *
 * Runs as a Web Worker, and can also be require()d from Node for testing.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- geometry

  function loopArea(l) {
    let a = 0;
    for (let i = 0, n = l.length / 2; i < n; i++) {
      const j = (i + 1) % n;
      a += l[2 * i] * l[2 * j + 1] - l[2 * j] * l[2 * i + 1];
    }
    return a / 2;
  }

  function pointInLoop(x, y, l) {
    let inside = false;
    for (let i = 0, n = l.length / 2, j = n - 1; i < n; j = i++) {
      const xi = l[2 * i], yi = l[2 * i + 1], xj = l[2 * j], yj = l[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Area and perimeter of an even-odd set of non-crossing loops.
  function measure(loops) {
    let area = 0, perim = 0;
    for (let i = 0; i < loops.length; i++) {
      const l = loops[i];
      let depth = 0;
      for (let k = 0; k < loops.length; k++) {
        if (k !== i && pointInLoop(l[0], l[1], loops[k])) depth++;
      }
      area += (depth % 2 ? -1 : 1) * Math.abs(loopArea(l));
      for (let a = 0, n = l.length / 2; a < n; a++) {
        const b = (a + 1) % n;
        perim += Math.hypot(l[2 * b] - l[2 * a], l[2 * b + 1] - l[2 * a + 1]);
      }
    }
    return { area: Math.abs(area), perimeter: perim };
  }

  function bbox(loops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of loops) {
      for (let i = 0; i < l.length; i += 2) {
        if (l[i] < x0) x0 = l[i];
        if (l[i] > x1) x1 = l[i];
        if (l[i + 1] < y0) y0 = l[i + 1];
        if (l[i + 1] > y1) y1 = l[i + 1];
      }
    }
    return { x0, y0, x1, y1 };
  }

  // Grid nodes strictly inside the shape (even-odd rule). Nodes lying on the
  // rim are excluded, so lattice-aligned shapes discretise exactly.
  function buildGrid(loops, h) {
    const bb = bbox(loops);
    const gx0 = (Math.floor(bb.x0 / h + 1e-9) - 1) * h;
    const gy0 = (Math.floor(bb.y0 / h + 1e-9) - 1) * h;
    const W = Math.ceil((bb.x1 - gx0) / h - 1e-9) + 2;
    const H = Math.ceil((bb.y1 - gy0) / h - 1e-9) + 2;
    const inside = new Uint8Array(W * H);
    const xs = [];
    for (let j = 0; j < H; j++) {
      const y = gy0 + j * h;
      xs.length = 0;
      for (const l of loops) {
        for (let a = 0, n = l.length / 2; a < n; a++) {
          const b = (a + 1) % n;
          const ax = l[2 * a], ay = l[2 * a + 1], bx = l[2 * b], by = l[2 * b + 1];
          if ((ay <= y && by > y) || (by <= y && ay > y)) {
            xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - gx0) / h));
        const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - gx0) / h));
        for (let i = i0; i <= i1; i++) inside[j * W + i] ^= 1;
      }
    }
    // Knock out nodes on (or within a hair of) the rim.
    const tol = 1e-7 * h;
    for (const l of loops) {
      for (let a = 0, n = l.length / 2; a < n; a++) {
        const b = (a + 1) % n;
        const ax = l[2 * a], ay = l[2 * a + 1], bx = l[2 * b], by = l[2 * b + 1];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-30;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - gx0) / h) - 1);
        const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) - gx0) / h) + 1);
        const j0 = Math.max(0, Math.floor((Math.min(ay, by) - gy0) / h) - 1);
        const j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) - gy0) / h) + 1);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const idx = j * W + i;
            if (!inside[idx]) continue;
            const px = gx0 + i * h - ax, py = gy0 + j * h - ay;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
            if (Math.hypot(px - t * dx, py - t * dy) < tol) inside[idx] = 0;
          }
        }
      }
    }
    const index = new Int32Array(W * H).fill(-1);
    let n = 0;
    for (let k = 0; k < W * H; k++) if (inside[k]) index[k] = n++;

    // Fractional distance (in units of h) from each node to the rim along the
    // four stencil arms; 1 where the neighbour is an interior node. Used to put
    // the Dirichlet condition where the rim really is, not on the next node.
    const theta = new Float32Array(4 * n).fill(1); // +x, -x, +y, -y
    const cross = (fixed, horizontal, out) => {
      out.length = 0;
      for (const l of loops) {
        for (let a = 0, m = l.length / 2; a < m; a++) {
          const b = (a + 1) % m;
          const ax = horizontal ? l[2 * a] : l[2 * a + 1], ay = horizontal ? l[2 * a + 1] : l[2 * a];
          const bx = horizontal ? l[2 * b] : l[2 * b + 1], by = horizontal ? l[2 * b + 1] : l[2 * b];
          if ((ay <= fixed && by > fixed) || (by <= fixed && ay > fixed)) {
            out.push(ax + (fixed - ay) * (bx - ax) / (by - ay));
          }
        }
      }
      out.sort((p, q) => p - q);
      return out;
    };
    const near = (list, v, dir) => {
      let best = Infinity;
      for (const c of list) {
        const d = (c - v) * dir;
        if (d >= -1e-12 && d < best) best = d;
      }
      return best;
    };
    for (let j = 0; j < H; j++) {
      const y = gy0 + j * h;
      let row = null;
      for (let i = 0; i < W; i++) {
        const p = index[j * W + i];
        if (p < 0) continue;
        const x = gx0 + i * h;
        if (i + 1 >= W || index[j * W + i + 1] < 0) {
          row = row || cross(y, true, []);
          theta[4 * p] = Math.min(1, Math.max(0.02, near(row, x, 1) / h));
        }
        if (i === 0 || index[j * W + i - 1] < 0) {
          row = row || cross(y, true, []);
          theta[4 * p + 1] = Math.min(1, Math.max(0.02, near(row, x, -1) / h));
        }
      }
    }
    for (let i = 0; i < W; i++) {
      const x = gx0 + i * h;
      let col = null;
      for (let j = 0; j < H; j++) {
        const p = index[j * W + i];
        if (p < 0) continue;
        const y = gy0 + j * h;
        if (j + 1 >= H || index[(j + 1) * W + i] < 0) {
          col = col || cross(x, false, []);
          theta[4 * p + 2] = Math.min(1, Math.max(0.02, near(col, y, 1) / h));
        }
        if (j === 0 || index[(j - 1) * W + i] < 0) {
          col = col || cross(x, false, []);
          theta[4 * p + 3] = Math.min(1, Math.max(0.02, near(col, y, -1) / h));
        }
      }
    }
    return { x0: gx0, y0: gy0, h, W, H, index, n, theta };
  }

  // ------------------------------------------------- envelope Cholesky (K*h^2)

  function factor(grid) {
    const { W, H, index, n } = grid;
    const first = new Int32Array(n), down = new Int32Array(n), left = new Int32Array(n);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = index[j * W + i];
        if (p < 0) continue;
        const d = j > 0 ? index[(j - 1) * W + i] : -1;
        const l = i > 0 ? index[j * W + i - 1] : -1;
        down[p] = d; left[p] = l;
        first[p] = d >= 0 ? d : (l >= 0 ? l : p);
      }
    }
    const off = new Int32Array(n + 1);
    for (let p = 0; p < n; p++) off[p + 1] = off[p] + (p - first[p] + 1);
    const L = new Float64Array(off[n]);
    for (let p = 0; p < n; p++) {
      const o = off[p] - first[p];
      const th = grid.theta;
      L[o + p] = th ? 1 / th[4 * p] + 1 / th[4 * p + 1] + 1 / th[4 * p + 2] + 1 / th[4 * p + 3] : 4;
      if (down[p] >= 0) L[o + down[p]] = -1;
      if (left[p] >= 0) L[o + left[p]] = -1;
    }
    for (let p = 0; p < n; p++) {
      const fp = first[p], op = off[p] - fp;
      for (let q = fp; q < p; q++) {
        const fq = first[q], oq = off[q] - fq;
        let s = L[op + q];
        for (let k = fp > fq ? fp : fq; k < q; k++) s -= L[op + k] * L[oq + k];
        L[op + q] = s / L[oq + q];
      }
      let s = L[op + p];
      for (let k = fp; k < p; k++) s -= L[op + k] * L[op + k];
      if (!(s > 0)) throw new Error('matrix not positive definite');
      L[op + p] = Math.sqrt(s);
    }
    return { n, first, off, L };
  }

  function cholSolve(F, x) {
    const { n, first, off, L } = F;
    for (let p = 0; p < n; p++) {
      const fp = first[p], op = off[p] - fp;
      let s = x[p];
      for (let k = fp; k < p; k++) s -= L[op + k] * x[k];
      x[p] = s / L[op + p];
    }
    for (let p = n - 1; p >= 0; p--) {
      const fp = first[p], op = off[p] - fp;
      const xp = (x[p] /= L[op + p]);
      for (let k = fp; k < p; k++) x[k] -= L[op + k] * xp;
    }
  }

  // ------------------------------------------- dense symmetric eigen (JAMA)

  function symEig(A, n) {
    // A: array of Float64Array rows (destroyed). Returns {d, V} ascending.
    const V = A, d = new Float64Array(n), e = new Float64Array(n);
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = scale * g;
        h -= f * g;
        d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j];
          V[j][i] = f;
          g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[k][j] -= f * e[k] + g * d[k];
          d[j] = V[i - 1][j];
          V[i][j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i];
      V[i][i] = 1;
      const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0;
          for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
          for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
    V[n - 1][n - 1] = 1;
    e[0] = 0;

    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0;
    const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l;
      while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 60) break;
          let g = d[l];
          let p = (d[l + 1] - g) / (2 * e[l]);
          let r = Math.hypot(p, 1);
          if (p < 0) r = -r;
          d[l] = e[l] / (p + r);
          d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1];
          let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m];
          let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
          const el1 = e[l + 1];
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = s;
            g = c * e[i];
            h = c * p;
            r = Math.hypot(p, e[i]);
            e[i + 1] = s * r;
            s = e[i] / r;
            c = p / r;
            p = c * d[i] - s * g;
            d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) {
              const Vk = V[k];
              h = Vk[i + 1];
              Vk[i + 1] = s * Vk[i] + c * h;
              Vk[i] = c * Vk[i] - s * h;
            }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1;
          e[l] = s * p;
          d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] += f;
      e[l] = 0;
    }
    for (let i = 0; i < n - 1; i++) {
      let k = i, p = d[i];
      for (let j = i + 1; j < n; j++) if (d[j] < p) { k = j; p = d[j]; }
      if (k !== i) {
        d[k] = d[i]; d[i] = p;
        for (let j = 0; j < n; j++) { const t = V[j][i]; V[j][i] = V[j][k]; V[j][k] = t; }
      }
    }
    return { d, V };
  }

  // ---------------------------------------------------- block Lanczos driver

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296 - 0.5;
    };
  }

  function dot(a, b, n) {
    let s0 = 0, s1 = 0, i = 0;
    for (; i + 1 < n; i += 2) { s0 += a[i] * b[i]; s1 += a[i + 1] * b[i + 1]; }
    if (i < n) s0 += a[i] * b[i];
    return s0 + s1;
  }

  function eigs(F, sqrtRho, K, opts) {
    const n = F.n;
    const block = 4;
    K = Math.min(K, n);
    const mMax = Math.min(n, Math.max(K + 3 * block, Math.ceil(K * (opts.krylov || 2.6)) + 3 * block));
    const tol = opts.tol || 1e-10;
    const rand = rng(opts.seed || 12345);
    const basis = [];
    const Hcols = []; // Hcols[j][i] = b_i . Op b_j
    const tmp = new Float64Array(n);

    function orthonormalise(w, col) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < basis.length; i++) {
          const c = dot(basis[i], w, n);
          if (col) col[i] = (col[i] || 0) + c;
          const b = basis[i];
          for (let k = 0; k < n; k++) w[k] -= c * b[k];
        }
      }
      return Math.sqrt(dot(w, w, n));
    }

    function addRandom() {
      for (let tries = 0; tries < 5; tries++) {
        const v = new Float64Array(n);
        for (let k = 0; k < n; k++) v[k] = rand();
        const nr = orthonormalise(v, null);
        if (nr > 1e-8) {
          for (let k = 0; k < n; k++) v[k] /= nr;
          basis.push(v);
          return true;
        }
      }
      return false;
    }

    for (let b = 0; b < Math.min(block, n); b++) addRandom();

    let prev = null, jc = 0, ritz = null;
    const check = opts.checkEvery || 12;
    while (jc < basis.length && jc < mMax) {
      const bj = basis[jc];
      for (let k = 0; k < n; k++) tmp[k] = bj[k] * sqrtRho[k];
      cholSolve(F, tmp);
      const w = new Float64Array(n);
      for (let k = 0; k < n; k++) w[k] = tmp[k] * sqrtRho[k];
      const col = [];
      const nr = orthonormalise(w, col);
      Hcols[jc] = col;
      if (basis.length < mMax) {
        if (nr > 1e-12 * Math.abs(col[jc] || 1)) {
          for (let k = 0; k < n; k++) w[k] /= nr;
          basis.push(w);
        } else if (basis.length < n) {
          addRandom();
        }
      }
      jc++;
      const last = jc >= basis.length || jc >= mMax;
      if (jc >= K + block && (jc % check === 0 || last)) {
        // Rayleigh-Ritz on span(b_0..b_{jc-1}); upper triangle of H is exact.
        const m = jc;
        const T = [];
        for (let i = 0; i < m; i++) T.push(new Float64Array(m));
        for (let j = 0; j < m; j++) {
          const c = Hcols[j];
          for (let i = 0; i <= j; i++) { const v = c[i] || 0; T[i][j] = v; T[j][i] = v; }
        }
        ritz = symEig(T, m);
        const top = [];
        for (let k = 0; k < Math.min(K, m); k++) top.push(ritz.d[m - 1 - k]);
        let conv = !!prev && prev.length === top.length;
        if (conv) {
          for (let k = 0; k < top.length; k++) {
            if (Math.abs(top[k] - prev[k]) > tol * Math.abs(top[k])) { conv = false; break; }
          }
        }
        prev = top;
        if (opts.progress) opts.progress(Math.min(1, m / mMax));
        if ((conv && m >= K + 2 * block) || last) break;
      }
    }
    if (!ritz) {
      const m = jc;
      const T = [];
      for (let i = 0; i < m; i++) T.push(new Float64Array(m));
      for (let j = 0; j < m; j++) {
        const c = Hcols[j];
        for (let i = 0; i <= j; i++) { const v = c[i] || 0; T[i][j] = v; T[j][i] = v; }
      }
      ritz = symEig(T, m);
    }

    const m = jc;
    const Keff = Math.min(K, m);
    const lambdas = new Float64Array(Keff);
    const vecs = [];
    for (let k = 0; k < Keff; k++) {
      const col = m - 1 - k;
      lambdas[k] = 1 / ritz.d[col];
      const v = new Float64Array(n);
      for (let i = 0; i < m; i++) {
        const y = ritz.V[i][col];
        if (y === 0) continue;
        const b = basis[i];
        for (let q = 0; q < n; q++) v[q] += y * b[q];
      }
      vecs.push(v);
    }
    return { lambdas, vecs, krylov: m };
  }

  // ------------------------------------------------------------- top level

  function solve(req) {
    const t0 = Date.now();
    const loops = req.loops.map((l) => Float64Array.from(l));
    const meas = measure(loops);
    const h = req.h || Math.sqrt(meas.area / (req.targetN || 6000));
    const grid = buildGrid(loops, h);
    if (grid.n < 3) throw new Error('shape too small');
    const n = grid.n;
    const rho = new Float64Array(n).fill(1);
    if (req.density && req.densityGrid) {
      // density supplied on a (possibly different) grid: sample bilinearly
      const dg = req.densityGrid, D = req.density;
      for (let j = 0; j < grid.H; j++) {
        for (let i = 0; i < grid.W; i++) {
          const p = grid.index[j * grid.W + i];
          if (p < 0) continue;
          const fx = (grid.x0 + i * h - dg.x0) / dg.h, fy = (grid.y0 + j * h - dg.y0) / dg.h;
          const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
          const at = (a, b) => (a >= 0 && b >= 0 && a < dg.W && b < dg.H) ? D[b * dg.W + a] : 1;
          rho[p] = (1 - ty) * ((1 - tx) * at(ix, iy) + tx * at(ix + 1, iy)) +
                   ty * ((1 - tx) * at(ix, iy + 1) + tx * at(ix + 1, iy + 1));
        }
      }
    }
    const sq = new Float64Array(n);
    for (let p = 0; p < n; p++) sq[p] = Math.sqrt(rho[p]);
    const t1 = Date.now();
    const F = req.factor && req.factor.n === n ? req.factor : factor(grid);
    const t2 = Date.now();
    const K = Math.min(req.K || 64, n);
    const r = eigs(F, sq, K, { tol: req.tol, krylov: req.krylov, progress: req.progress, seed: req.seed });
    const t3 = Date.now();
    const Keff = r.lambdas.length;
    const modes = new Float32Array(Keff * n);
    const lambdas = new Float64Array(Keff);
    for (let k = 0; k < Keff; k++) {
      lambdas[k] = r.lambdas[k] / (h * h);
      const v = r.vecs[k];
      let big = 0;
      for (let p = 0; p < n; p++) if (Math.abs(v[p]) > Math.abs(big)) big = v[p];
      const s = (big < 0 ? -1 : 1) / h;
      for (let p = 0; p < n; p++) modes[k * n + p] = s * v[p] / sq[p];
    }
    return {
      grid: { x0: grid.x0, y0: grid.y0, h, W: grid.W, H: grid.H, n },
      index: grid.index,
      lambdas,
      modes,
      rho: Float32Array.from(rho),
      area: meas.area,
      perimeter: meas.perimeter,
      krylov: r.krylov,
      timing: { grid: t1 - t0, factor: t2 - t1, eigs: t3 - t2 },
      _factor: F,
    };
  }

  const api = { solve, measure, buildGrid, factor, cholSolve, symEig };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
    // Worker: cache the factorisation per shape so mass edits only re-run Lanczos.
    let cache = null;
    self.onmessage = (ev) => {
      const req = ev.data;
      try {
        if (req.factorKey && cache && cache.key === req.factorKey) req.factor = cache.F;
        req.progress = (f) => self.postMessage({ id: req.id, progress: f });
        const res = solve(req);
        if (req.factorKey) cache = { key: req.factorKey, F: res._factor };
        delete res._factor;
        self.postMessage({ id: req.id, result: res },
          [res.index.buffer, res.lambdas.buffer, res.modes.buffer, res.rho.buffer]);
      } catch (err) {
        self.postMessage({ id: req.id, error: String(err && err.message || err) });
      }
    };
  } else {
    root.EigenSolver = api;
  }
})(typeof self !== 'undefined' ? self : this);
