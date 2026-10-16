/*
 * Eigen-solver for the Dirichlet Laplacian on an arbitrary rasterised outline.
 *
 * Runs as a Web Worker in the page, and loads under Node for the test suite.
 *
 *   outline mask --> 5-point Laplacian A (sparse, SPD)
 *               --> banded Cholesky  A = L Lᵀ        (bandwidth ≈ grid width)
 *               --> band Lanczos on A⁻¹ with full re-orthogonalisation
 *                   (block size 3, so degenerate modes of symmetric drums
 *                    are all found, not just one per eigenspace)
 *               --> Rayleigh–Ritz, keep the converged lowest K modes.
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- dense symmetric eigen (JAMA tred2 + tql2)
  // V: Float64Array n*n row-major, holds A on entry, eigenvectors (columns) on exit.
  function symEig(V, n) {
    const d = new Float64Array(n), e = new Float64Array(n);
    for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; V[j * n + i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1];
        let g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = scale * g;
        h -= f * g;
        d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j];
          V[j * n + i] = f;
          g = e[j] + V[j * n + j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k * n + j] * d[k]; e[k] += V[k * n + j] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * d[k];
          d[j] = V[(i - 1) * n + j];
          V[i * n + j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[(n - 1) * n + i] = V[i * n + i];
      V[i * n + i] = 1;
      const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0;
          for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
          for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[(n - 1) * n + j]; V[(n - 1) * n + j] = 0; }
    V[(n - 1) * n + n - 1] = 1;
    e[0] = 0;

    // tql2
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
          let c = 1, c2 = c, c3 = c;
          const el1 = e[l + 1];
          let s = 0, s2 = 0;
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
              const row = k * n;
              h = V[row + i + 1];
              V[row + i + 1] = s * V[row + i] + c * h;
              V[row + i] = c * V[row + i] - s * h;
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
    // sort ascending
    for (let i = 0; i < n - 1; i++) {
      let k = i, p = d[i];
      for (let j = i + 1; j < n; j++) if (d[j] < p) { k = j; p = d[j]; }
      if (k !== i) {
        d[k] = d[i]; d[i] = p;
        for (let j = 0; j < n; j++) { const row = j * n; p = V[row + i]; V[row + i] = V[row + k]; V[row + k] = p; }
      }
    }
    return d;
  }

  // ---------------------------------------------------------------- the operator
  function indexMask(nx, ny, mask) {
    const idx = new Int32Array(nx * ny).fill(-1);
    let n = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (mask[j * nx + i]) idx[j * nx + i] = n++;
    const cell = new Int32Array(n);
    let b = 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = idx[j * nx + i];
      if (k < 0) continue;
      cell[k] = j * nx + i;
      if (j > 0 && idx[(j - 1) * nx + i] >= 0) b = Math.max(b, k - idx[(j - 1) * nx + i]);
    }
    return { idx, cell, n, b };
  }

  // A = 4I - (neighbours), Dirichlet outside the mask. Banded Cholesky, lower band of width b.
  function choleskyBand(nx, ny, op) {
    const { idx, cell, n, b } = op;
    const W = b + 1;
    const B = new Float64Array(n * W);
    for (let k = 0; k < n; k++) {
      const c = cell[k], i = c % nx, j = (c - i) / nx;
      B[k * W + b] = 4;
      if (i > 0 && idx[c - 1] >= 0) B[k * W + b - (k - idx[c - 1])] = -1;
      if (j > 0 && idx[c - nx] >= 0) B[k * W + b - (k - idx[c - nx])] = -1;
    }
    for (let k = 0; k < n; k++) {
      const jmin = Math.max(0, k - b);
      const rk = k * W - k + b; // B[rk + m] == L[k][m]
      for (let j = jmin; j <= k; j++) {
        const rj = j * W - j + b;
        let s = B[rk + j];
        for (let m = Math.max(jmin, j - b); m < j; m++) s -= B[rk + m] * B[rj + m];
        if (j === k) {
          if (!(s > 0)) throw new Error('matrix not positive definite');
          B[rk + k] = Math.sqrt(s);
        } else {
          B[rk + j] = s / B[rj + j];
        }
      }
    }
    return { B, W, n, b };
  }

  function solveBand(ch, rhs, out) {
    const { B, W, n, b } = ch;
    const y = out;
    for (let k = 0; k < n; k++) {
      const rk = k * W - k + b;
      let s = rhs[k];
      for (let m = Math.max(0, k - b); m < k; m++) s -= B[rk + m] * y[m];
      y[k] = s / B[rk + k];
    }
    for (let k = n - 1; k >= 0; k--) {
      const rk = k * W - k + b;
      const xk = y[k] / B[rk + k];
      y[k] = xk;
      for (let m = Math.max(0, k - b); m < k; m++) y[m] -= B[rk + m] * xk;
    }
    return y;
  }

  function dot(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }

  // ---------------------------------------------------------------- band Lanczos on A⁻¹
  function lowestModes(nx, ny, mask, opts) {
    const K = opts.K || 96;
    const p = opts.block || 3;
    const progress = opts.onProgress || function () {};
    const t0 = now();
    const op = indexMask(nx, ny, mask);
    const n = op.n;
    if (n < 2) return { n, lambdas: new Float64Array(0), modes: new Float32Array(0), K: 0, ms: 0, bandwidth: op.b };

    const ch = choleskyBand(nx, ny, op);
    progress(0.08);

    const M = Math.min(n - p, Math.max(K + 70, Math.ceil(K * 2.4)));
    const Mtot = M + p;
    const rand = mulberry32(opts.seed || 1234567);
    const Q = new Float64Array(Mtot * n); // basis vectors, contiguous: q_i = Q[i*n .. i*n+n)
    let len = 0;
    const H = new Float64Array(Mtot * Mtot); // H[i*Mtot + j] = q_iᵀ A⁻¹ q_j as recorded at column j
    const coef = new Float64Array(Mtot);

    // classical Gram–Schmidt, twice ("twice is enough"), against every basis vector
    function orthogonalise(w, col) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < len; i++) {
          const o = i * n;
          let s0 = 0, s1 = 0, t = 0;
          for (; t + 1 < n; t += 2) { s0 += Q[o + t] * w[t]; s1 += Q[o + t + 1] * w[t + 1]; }
          if (t < n) s0 += Q[o + t] * w[t];
          coef[i] = s0 + s1;
        }
        for (let i = 0; i < len; i++) {
          const c = coef[i], o = i * n;
          if (col >= 0) H[i * Mtot + col] += c;
          for (let t = 0; t < n; t++) w[t] -= c * Q[o + t];
        }
      }
      return Math.sqrt(dot(w, w, n));
    }
    function push(w, nr) {
      const o = len * n, inv = 1 / nr;
      for (let t = 0; t < n; t++) Q[o + t] = w[t] * inv;
      len++;
    }
    function pushRandom() {
      const v = new Float64Array(n);
      for (let tries = 0; tries < 4; tries++) {
        for (let t = 0; t < n; t++) v[t] = rand() - 0.5;
        const nr = orthogonalise(v, -1);
        if (nr > 1e-8) { push(v, nr); return; }
      }
      throw new Error('could not extend basis');
    }

    for (let i = 0; i < p; i++) pushRandom();

    let scale = 1;
    const w = new Float64Array(n);
    for (let j = 0; j < M; j++) {
      solveBand(ch, Q.subarray(j * n, j * n + n), w);
      const nr = orthogonalise(w, j);
      if (j === 0) scale = Math.abs(H[0]) || 1;
      if (len < Mtot) {
        if (nr > 1e-10 * scale) {
          H[len * Mtot + j] = nr;
          push(w, nr);
        } else {
          pushRandom(); // deflation: invariant subspace found, restart a fresh direction
        }
      }
      if ((j & 7) === 0) progress(0.08 + 0.72 * (j / M));
    }

    // symmetric projected matrix (leading M×M block)
    const T = new Float64Array(M * M);
    for (let i = 0; i < M; i++) for (let j = i; j < M; j++) {
      const a = H[i * Mtot + j]; // recorded (i <= p + j always for i <= j)
      const v = j <= p + i ? 0.5 * (a + H[j * Mtot + i]) : a;
      T[i * M + j] = v; T[j * M + i] = v;
    }
    progress(0.82);
    const theta = symEig(T, M); // ascending; largest θ ⇔ smallest λ
    progress(0.9);

    const keep = [];
    for (let r = M - 1; r >= 0 && keep.length < K; r--) {
      const th = theta[r];
      if (!(th > 0)) break;
      let res2 = 0;
      for (let i = M; i < Mtot; i++) {
        let s = 0;
        for (let j = Math.max(0, i - p); j < M; j++) s += H[i * Mtot + j] * T[j * M + r];
        res2 += s * s;
      }
      const rel = Math.sqrt(res2) / th;
      if (rel > (opts.tol || 1e-5)) break; // spectrum must be contiguous from the bottom
      keep.push(r);
    }

    const Kc = keep.length;
    const lambdas = new Float64Array(Kc);
    const modes = new Float32Array(Kc * nx * ny);
    const y = new Float64Array(n);
    for (let a = 0; a < Kc; a++) {
      const r = keep[a];
      lambdas[a] = 1 / theta[r];
      y.fill(0);
      for (let j = 0; j < M; j++) {
        const s = T[j * M + r], o = j * n;
        if (s === 0) continue;
        for (let t = 0; t < n; t++) y[t] += s * Q[o + t];
      }
      let nrm = Math.sqrt(dot(y, y, n)), vol = 0, big = 0;
      for (let t = 0; t < n; t++) { vol += y[t]; if (Math.abs(y[t]) > Math.abs(big)) big = y[t]; }
      let sgn = Math.abs(vol) > 1e-6 * Math.sqrt(n) ? Math.sign(vol) : Math.sign(big);
      const off = a * nx * ny, f = sgn / nrm;
      for (let t = 0; t < n; t++) modes[off + op.cell[t]] = y[t] * f;
    }
    progress(1);
    return { n, lambdas, modes, K: Kc, ms: now() - t0, bandwidth: op.b, krylov: M };
  }

  function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }

  const api = { lowestModes, symEig, mulberry32 };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HearShapeSolver = api;

  // Worker entry point
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (ev) {
      const { id, nx, ny, mask, K } = ev.data;
      try {
        const out = lowestModes(nx, ny, mask, {
          K,
          onProgress: (f) => root.postMessage({ id, progress: f }),
        });
        root.postMessage({ id, done: true, result: out }, [out.lambdas.buffer, out.modes.buffer]);
      } catch (err) {
        root.postMessage({ id, error: String(err && err.message || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
