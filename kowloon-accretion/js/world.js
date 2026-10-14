// Turns the plan into geometry. Everything is instanced; each frame only flips
// instances on and off as lots are built, rebuilt, emptied and torn down.

import * as THREE from 'three';
import { RNG, clamp } from './rng.js';
import { FLOOR_H, SIGN_WORDS } from './history.js';
import { lotState, occupancy, upperRect, heightfield, hfAt } from './city.js';
import { makeBuildingMaterial, makeScaffoldMaterial, makeSignMaterial } from './facade.js';

const NORMALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

class Pool {
  constructor(geo, mat, specs, opts = {}) {
    const n = Math.max(1, specs.length);
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.castShadow = !!opts.cast;
    this.mesh.receiveShadow = !!opts.receive;
    this.mesh.frustumCulled = false;
    this.specs = specs;
    this.mats = new Float32Array(n * 16);
    this.vis = new Uint8Array(n);
    const arr = this.mesh.instanceMatrix.array;
    arr.fill(0);
    specs.forEach((s, i) => {
      s.m.toArray(this.mats, i * 16);
      if (s.color) this.mesh.setColorAt(i, s.color);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dirty = true;
  }
  set(i, v) {
    if (this.vis[i] === v) return;
    this.vis[i] = v;
    const a = this.mesh.instanceMatrix.array;
    if (v) a.set(this.mats.subarray(i * 16, i * 16 + 16), i * 16);
    else a.fill(0, i * 16, i * 16 + 16);
    this.dirty = true;
  }
  flush() { if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; } }
}

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function mat(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Face frame for a lot side: point on the face at along-face offset u, outward normal.
function facePoint(rect, side, u, out = 0) {
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  switch (side) {
    case 0: return { x: rect.x1 + out, z: cz + u };
    case 1: return { x: rect.x0 - out, z: cz - u };
    case 2: return { x: cx - u, z: rect.z1 + out };
    default: return { x: cx + u, z: rect.z0 - out };
  }
}
const faceLen = (r, side) => (side < 2 ? r.z1 - r.z0 : r.x1 - r.x0);
const faceYaw = (side) => [Math.PI / 2, -Math.PI / 2, 0, Math.PI][side]; // object +z -> outward normal

export class CityWorld {
  constructor(city, scene, signAtlas) {
    this.city = city;
    this.group = new THREE.Group();
    scene.add(this.group);
    const rng = new RNG(city.seed * 7 + 3);
    const lots = city.lots;

    // --- building masses: 3 slots per lot (podium, tower, roof shack)
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const n = lots.length * 3;
    const bgeo = box.clone();
    this.attr = {
      aColor: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      aP0: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
      aP1: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
      aNH: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
      aNG: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
    };
    for (const k in this.attr) { this.attr[k].setUsage(THREE.DynamicDrawUsage); bgeo.setAttribute(k, this.attr[k]); }
    this.buildings = new THREE.InstancedMesh(bgeo, makeBuildingMaterial(), n);
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.instanceMatrix.array.fill(0);
    this.buildings.castShadow = this.buildings.receiveShadow = true;
    this.buildings.frustumCulled = false;
    // Fixed bounds for raycasting. three computes this once, on the first raycast; if
    // instance 0 is an unbuilt (zeroed) lot at that moment the centre becomes NaN for good.
    this.buildings.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 200);
    this.group.add(this.buildings);

    this.scaffold = new THREE.InstancedMesh(box, makeScaffoldMaterial(), lots.length);
    this.scaffold.instanceMatrix.array.fill(0);
    this.scaffold.frustumCulled = false;
    this.scaffold.castShadow = true;
    this.group.add(this.scaffold);

    // --- details, collected as specs then pooled
    const S = { ac: [], cage: [], pipe: [], rod: [], cloth: [], tank: [], tube: [], sign: [] };
    const col = (r, g, b) => new THREE.Color(r, g, b);
    lots.forEach((L, li) => {
      L.gens.forEach((g) => {
        const done = g.start + g.build;
        const base = { lot: li, gen: g };
        if (g.kind === 0) return;
        const up = upperRect(L, g);
        for (let side = 0; side < 4; side++) {
          const sd = L.sides[side];
          if (!sd.street && !sd.courtyard && sd.gap < 0.9) continue;
          for (let fl = 1; fl < g.floors; fl++) {
            const rect = fl >= 2 ? up : L;
            const len = faceLen(rect, side), half = len / 2;
            const nc = Math.floor((half - g.spacing * 0.3) / g.spacing);
            for (let ci = -nc; ci <= nc; ci++) {
              const u = ci * g.spacing;
              const r = rng.next();
              const yaw = faceYaw(side);
              if (r < 0.16) {
                const p = facePoint(rect, side, u + g.spacing * 0.15, 0.24);
                S.ac.push({ ...base, minF: fl + 1, year: Math.max(done, 1968 + rng.range(0, 16)),
                  m: mat(p.x, fl * FLOOR_H + 0.55, p.z, 0.78, 0.5, 0.46, yaw), color: col(0.78, 0.77, 0.72).multiplyScalar(rng.range(0.75, 1.05)) });
              } else if (r < 0.34 && g.style === 1) {
                const p = facePoint(rect, side, u, 0.24);
                S.cage.push({ ...base, minF: fl + 1, year: done + rng.range(0, 6),
                  m: mat(p.x, fl * FLOOR_H + 0.75, p.z, g.spacing * 0.66, FLOOR_H * 0.62, 0.5, yaw) });
              } else if (r < 0.43) {
                const p = facePoint(rect, side, u, 0.9);
                const yy = fl * FLOOR_H + 2.35;
                S.rod.push({ ...base, minF: fl + 1, year: done, occ: true, m: mat(p.x, yy, p.z, 0.05, 0.05, 1.9, yaw), color: col(0.62, 0.52, 0.32) });
                const nCl = rng.int(2, 4);
                for (let k = 0; k < nCl; k++) {
                  const q = facePoint(rect, side, u + rng.range(-0.15, 0.15), 0.25 + (k + 0.5) * (1.6 / nCl));
                  const c = new THREE.Color().setHSL(rng.next(), rng.range(0.2, 0.75), rng.range(0.35, 0.75));
                  S.cloth.push({ ...base, minF: fl + 1, year: done, occ: true, m: mat(q.x, yy - 0.35, q.z, 0.5, rng.range(0.45, 0.8), 1, yaw + Math.PI / 2), color: c });
                }
              }
            }
          }
          // pipes running the full height
          const rect = g.floors > 2 ? up : L;
          const len = faceLen(rect, side);
          const nP = rng.int(0, 2);
          for (let k = 0; k < nP; k++) {
            const p = facePoint(rect, side, rng.range(-0.45, 0.45) * len, 0.08);
            const h = g.floors * FLOOR_H;
            S.pipe.push({ ...base, minF: g.floors, year: done, m: mat(p.x, h / 2, p.z, 0.13, h, 0.13), color: col(0.30, 0.31, 0.30) });
          }
          // fluorescent tubes in the alleys
          if (!sd.street && sd.gap < 6) {
            const p = facePoint(L, side, rng.range(-0.3, 0.3) * faceLen(L, side), 0.06);
            S.tube.push({ ...base, minF: 1, year: done, occ: true, m: mat(p.x, 2.7, p.z, 1.2, 0.07, 0.07, faceYaw(side)) });
          }
          // signs: street frontage and main lanes
          const mainLane = sd.street || (sd.gap >= 2.4);
          if (mainLane && g.start > 1957) {
            const len0 = faceLen(L, side);
            const count = Math.floor(len0 / (sd.street ? 3.0 : 5.5));
            for (let k = 0; k < count; k++) {
              if (!rng.chance(sd.street ? 0.75 : 0.45)) continue;
              const u = (k - (count - 1) / 2) * (len0 / Math.max(count, 1)) + rng.range(-0.3, 0.3);
              const fl = rng.int(1, Math.min(4, g.floors - 1));
              const dentistry = sd.street && rng.chance(0.5);
              let cell;
              if (dentistry) cell = rng.pick([0, 1, 2, 3]) + 30 * rng.int(0, 1);
              else cell = rng.int(0, 59);
              const word = SIGN_WORDS[cell % SIGN_WORDS.length];
              const tall = 0.75 + word[0].length * 0.65;
              const yaw = faceYaw(side);
              const perpendicular = rng.chance(0.7);
              const ovh = fl >= 2 ? g.ovh[side] : 0;
              const p = facePoint(L, side, u, ovh + (perpendicular ? 0.75 : 0.05));
              S.sign.push({ ...base, minF: fl + 2, year: done + rng.range(0, 8), cell, neon: 0, seed: rng.next(),
                m: mat(p.x, fl * FLOOR_H + tall / 2 + 0.6, p.z, 1.0, tall, 1, yaw + (perpendicular ? Math.PI / 2 : 0)) });
            }
          }
        }
        // roof: water tanks and antennas
        const roof = g.floors * FLOOR_H;
        const rr = g.floors > 2 ? up : L;
        const area = (rr.x1 - rr.x0) * (rr.z1 - rr.z0);
        const nt = rng.int(1, 3);
        for (let k = 0; k < nt; k++) {
          const x = rng.range(rr.x0 + 1, rr.x1 - 1), z = rng.range(rr.z0 + 1, rr.z1 - 1);
          const r = rng.range(0.6, 1.1), h = rng.range(1.2, 2.2);
          S.tank.push({ ...base, minF: g.floors, roof: true, year: done, m: mat(x, roof + h / 2 + 0.3, z, r, h, r), color: rng.chance(0.5) ? col(0.55, 0.57, 0.6) : col(0.25, 0.42, 0.62) });
        }
        const na = Math.round(area / 16 * rng.range(0.6, 1.4));
        for (let k = 0; k < na; k++) {
          const x = rng.range(rr.x0 + 0.4, rr.x1 - 0.4), z = rng.range(rr.z0 + 0.4, rr.z1 - 0.4);
          const h = rng.range(2.0, 5.5), year = Math.max(done, 1967.9 + rng.range(0, 4));
          const dark = col(0.18, 0.18, 0.2);
          S.rod.push({ ...base, minF: g.floors, roof: true, year, m: mat(x, roof + h / 2, z, 0.05, h, 0.05), color: dark });
          const yaw = rng.range(0, Math.PI);
          const nb = rng.int(2, 4);
          for (let b = 0; b < nb; b++) {
            const w = rng.range(0.6, 1.7) * (1 - b * 0.18);
            S.rod.push({ ...base, minF: g.floors, roof: true, year, m: mat(x, roof + h - 0.25 - b * 0.38, z, w, 0.035, 0.035, yaw), color: dark });
          }
        }
      });
    });

    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, ...o });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
    const plane = new THREE.PlaneGeometry(1, 1);
    const cageTex = makeCageTexture();
    this.pools = {
      ac: new Pool(new THREE.BoxGeometry(1, 1, 1), std({ roughness: 0.6 }), S.ac),
      cage: new Pool(new THREE.BoxGeometry(1, 1, 1), std({ color: 0x5a4334, map: cageTex, alphaTest: 0.5, side: THREE.DoubleSide }), S.cage),
      pipe: new Pool(new THREE.BoxGeometry(1, 1, 1), std({}), S.pipe),
      rod: new Pool(new THREE.BoxGeometry(1, 1, 1), std({ roughness: 0.5, metalness: 0.4 }), S.rod),
      cloth: new Pool(plane, std({ side: THREE.DoubleSide, roughness: 0.95 }), S.cloth),
      tank: new Pool(cyl, std({ roughness: 0.5, metalness: 0.3 }), S.tank, { cast: true, receive: true }),
      tube: new Pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.8, 1.55) }), S.tube),
    };
    // signs carry a per-instance attribute
    const sgeo = plane.clone();
    this.signAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, S.sign.length) * 4), 4);
    this.signAttr.setUsage(THREE.DynamicDrawUsage);
    sgeo.setAttribute('aSign', this.signAttr);
    S.sign.forEach((s, i) => { s.neon = signAtlas.kinds[s.cell]; this.signAttr.setXYZW(i, s.cell, s.neon, s.seed, 0); });
    this.signMat = makeSignMaterial(signAtlas.tex);
    this.pools.sign = new Pool(sgeo, this.signMat, S.sign);
    for (const k in this.pools) this.group.add(this.pools[k].mesh);

    this.lastT = -1;
    this.states = lots.map(() => ({ gen: null, floors: -1 }));
  }

  // What each face looks out on: sample the face, march outward through the
  // height field and keep the median obstruction (height, distance).
  computeOpenness(states, t) {
    this.hf = heightfield(this.city, t, this.hf);
    const H = this.hf, A = this.attr;
    this.city.lots.forEach((L, i) => {
      const st = states[i];
      if (!st.gen || !st.floors) return;
      for (let s = 0; s < 2; s++) {
        if (s === 1 && st.floors <= 2) continue;
        const r = s === 0 ? L : upperRect(L, st.gen);
        const yRef = s === 0 ? 1.5 : 2 * FLOOR_H + 1.5;
        const nh = [], ng = [];
        for (let side = 0; side < 4; side++) {
          const [nx, nz] = NORMALS[side];
          const len = faceLen(r, side);
          const hits = [];
          let open = 0;
          for (let k = 0; k < 5; k++) {
            const p = facePoint(r, side, (k / 4 - 0.5) * len * 0.8, 0.3);
            let hit = null;
            for (let d = 0.9; d < 18; d += 0.5) {
              const h = hfAt(H, p.x + nx * d, p.z + nz * d);
              if (h > yRef) { hit = [h, d + 0.3]; break; }
            }
            if (hit) hits.push(hit); else open++;
          }
          if (open >= 3) { nh.push(0); ng.push(40); continue; }
          hits.sort((a, b) => a[0] - b[0]);
          const m = hits[Math.floor(hits.length / 2)];
          nh.push(m[0]); ng.push(Math.max(m[1], 0.25));
        }
        A.aNH.setXYZW(i * 3 + s, ...nh);
        A.aNG.setXYZW(i * 3 + s, ...ng);
      }
    });
  }

  // Lot under a building instance id.
  lotOf(instanceId) { return this.city.lots[Math.floor(instanceId / 3)]; }

  update(t) {
    const lots = this.city.lots;
    const bm = this.buildings.instanceMatrix.array;
    const A = this.attr;
    let changed = false;
    const states = lots.map((L) => lotState(L, t));
    lots.forEach((L, i) => {
      const st = states[i], prev = this.states[i];
      const g = st.gen;
      const occ = occupancy(L, t);
      const shackOn = g && g.shack && t >= g.shack.year && !st.building && !st.demolishing && st.floors === g.floors;
      const key = (g ? g.start : 0) * 100 + st.floors + (shackOn ? 0.5 : 0);
      if (prev.key !== key) {
        changed = true;
        prev.key = key;
        const write = (slot, r, y0, y1) => {
          const o = (i * 3 + slot) * 16;
          if (!r || y1 <= y0) { bm.fill(0, o, o + 16); return; }
          mat((r.x0 + r.x1) / 2, y0, (r.z0 + r.z1) / 2, r.x1 - r.x0 - 0.04, y1 - y0, r.z1 - r.z0 - 0.04).toArray(bm, o);
        };
        const f = st.floors;
        write(0, f ? L : null, 0, Math.min(f, 2) * FLOOR_H);
        write(1, f > 2 ? upperRect(L, g) : null, 2 * FLOOR_H, f * FLOOR_H);
        write(2, null, 0, 0);
        for (let s = 0; s < 2; s++) {
          if (!g) continue;
          const j = i * 3 + s;
          A.aColor.setXYZ(j, ...g.color);
          A.aP0.setXYZW(j, g.seed, g.spacing, g.style, g.kind);
        }
        // scaffold while rising
        const so = i * 16;
        if (st.building && g.kind > 0) {
          const r = f > 2 ? upperRect(L, g) : L;
          mat((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2, r.x1 - r.x0 + 1.2, (f + 1) * FLOOR_H, r.z1 - r.z0 + 1.2).toArray(this.scaffold.instanceMatrix.array, so);
        } else this.scaffold.instanceMatrix.array.fill(0, so, so + 16);
        this.scaffold.instanceMatrix.needsUpdate = true;
      }
      this.states[i] = prev;
      prev.st = st;
      prev.occ = occ;
      prev.shackOn = shackOn;
      // light and grime change continuously
      for (let s = 0; s < 2; s++) {
        const j = i * 3 + s;
        if (!g) continue;
        const age = Math.max(0, t - g.start);
        A.aP1.setXYZW(j, clamp((0.12 + age / 22) * g.grimeRate, 0, 1), occ, occ * (g.kind > 0 ? 1 : 0.35), 0);
      }
    });
    if (changed) this.openDirty = true;
    const now = performance.now();
    if (!this.hf || (this.openDirty && now - (this.openAt || 0) > 120)) {
      this.computeOpenness(states, t);
      this.openDirty = false;
      this.openAt = now;
    }
    for (const k in A) A[k].needsUpdate = true;
    if (changed) this.buildings.instanceMatrix.needsUpdate = true;

    // details
    for (const k in this.pools) {
      const P = this.pools[k];
      P.specs.forEach((s, idx) => {
        const ls = this.states[s.lot];
        const st = ls.st;
        let v = st.gen === s.gen && st.floors >= s.minF && t >= s.year;
        if (v && s.roof) v = !st.building && !st.demolishing && st.floors === s.gen.floors;
        if (v && s.occ) v = ls.occ > 0.15;
        P.set(idx, v ? 1 : 0);
      });
      P.flush();
    }
    const sp = this.pools.sign.specs;
    for (let i = 0; i < sp.length; i++) this.signAttr.setW(i, this.states[sp[i].lot].occ);
    this.signAttr.needsUpdate = true;

    // shacks on roofs sit in the third building slot so they pick up the facade shader
    lots.forEach((L, i) => {
      const ls = this.states[i];
      const o = (i * 3 + 2) * 16;
      const g = ls.st.gen;
      if (ls.shackOn) {
        const sh = g.shack;
        mat((sh.x0 + sh.x1) / 2, g.floors * FLOOR_H, (sh.z0 + sh.z1) / 2, sh.x1 - sh.x0, FLOOR_H, sh.z1 - sh.z0).toArray(bm, o);
        const j = i * 3 + 2;
        A.aColor.setXYZ(j, 0.62, 0.58, 0.52);
        A.aP0.setXYZW(j, g.seed + 11, 2.2, 0, 1);
        A.aP1.setXYZW(j, 0.6, ls.occ, 0, 0);
        A.aNH.setXYZW(j, 0, 0, 0, 0);
        A.aNG.setXYZW(j, 40, 40, 40, 40);
      } else bm.fill(0, o, o + 16);
    });
    this.buildings.instanceMatrix.needsUpdate = true;
    this.lastT = t;
    return states;
  }
}

function makeCageTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 2, 64);
  for (let j = 0; j < 64; j += 16) g.fillRect(0, j, 64, 2);
  g.fillRect(0, 0, 64, 3); g.fillRect(0, 61, 64, 3); g.fillRect(0, 0, 3, 64); g.fillRect(61, 0, 3, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

