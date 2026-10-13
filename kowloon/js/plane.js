// Kai Tak traffic on the runway 13 approach: east along the beam towards the
// checkerboard, a 45 degree right turn, then low over Kowloon City to the threshold.

import * as THREE from 'three';
import { smoothstep, lerp } from './rng.js';
import { THRESHOLD, RWY_DIR } from './environment.js';

const R = 650;
const LEG_Z = -700.8;
const TURN_X = -1000;
const C = { x: TURN_X, z: LEG_Z + R };
const TURN = Math.PI / 4;
const LEG0 = -4400;
const S1 = TURN_X - LEG0;
const S2 = S1 + R * TURN;
const E = { x: C.x + R * Math.sin(TURN), z: C.z - R * Math.cos(TURN) };
const FINAL = Math.hypot(THRESHOLD.x - E.x, THRESHOLD.z - E.z);
const S3 = S2 + FINAL;
const S4 = S3 + 420;
const S5 = S4 + 1900;
export const PATH_END = S5;

const ALT = { leg0: 340, turn0: 215, turn1: 112, thr: 16 };

export function pathAt(s) {
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  let bank = 0, pitch = -0.045, speed;
  if (s < S1) {
    const f = s / S1;
    p.set(LEG0 + s, lerp(ALT.leg0, ALT.turn0, f), LEG_Z);
    d.set(1, 0, 0); speed = 86;
    bank = 0.42 * smoothstep(S1 - 140, S1, s);
  } else if (s < S2) {
    const th = (s - S1) / R;
    p.set(C.x + R * Math.sin(th), lerp(ALT.turn0, ALT.turn1, th / TURN), C.z - R * Math.cos(th));
    d.set(Math.cos(th), 0, Math.sin(th)); speed = 80;
    bank = 0.42 * (1 - smoothstep(S2 - 140, S2, s));
  } else if (s < S3) {
    const f = (s - S2) / FINAL;
    p.set(lerp(E.x, THRESHOLD.x, f), lerp(ALT.turn1, ALT.thr, f), lerp(E.z, THRESHOLD.z, f));
    d.copy(RWY_DIR); speed = 72;
    bank = Math.sin(s * 0.013) * 0.035; // crosswind wobble
  } else if (s < S4) {
    const f = (s - S3) / (S4 - S3);
    p.copy(THRESHOLD).addScaledVector(RWY_DIR, s - S3);
    p.y = ALT.thr * (1 - smoothstep(0, 1, f)) + 3.2 * smoothstep(0.6, 1, f);
    d.copy(RWY_DIR); speed = 68; pitch = -0.08;
  } else {
    const f = (s - S4) / (S5 - S4);
    p.copy(THRESHOLD).addScaledVector(RWY_DIR, s - S3);
    p.y = 3.2;
    d.copy(RWY_DIR); speed = lerp(66, 12, Math.sqrt(f)); pitch = 0;
  }
  return { p, d, bank, pitch, speed };
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.35, metalness: 0.2 });
const GREY = new THREE.MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.45, metalness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 });

function wing(span, root, tip, sweep, thick, mat) {
  const s = new THREE.Shape();
  s.moveTo(0, root / 2);
  s.lineTo(span, root / 2 - sweep);
  s.lineTo(span, root / 2 - sweep - tip);
  s.lineTo(0, -root / 2);
  s.lineTo(-span, root / 2 - sweep - tip);
  s.lineTo(-span, root / 2 - sweep);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

export function buildAircraft(type, livery) {
  const P = {
    prop: { L: 32, r: 1.7, span: 18, root: 5, tip: 2.2, sweep: 1.0, eng: 4, engR: 0.6, hump: false, finH: 7 },
    jet: { L: 46, r: 1.9, span: 21, root: 9, tip: 2.6, sweep: 9, eng: 4, engR: 0.65, hump: false, finH: 10 },
    jumbo: { L: 70, r: 3.2, span: 32, root: 14, tip: 4, sweep: 15, eng: 4, engR: 1.25, hump: true, finH: 14 },
  }[type];
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: livery, roughness: 0.4 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(P.r, P.r, P.L * 0.78, 18).rotateX(Math.PI / 2), WHITE);
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(P.r, 18, 12), WHITE);
  nose.scale.set(1, 1, 2.2); nose.position.z = P.L * 0.39; g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(P.r, P.L * 0.22, 18).rotateX(-Math.PI / 2), WHITE);
  tail.position.set(0, P.r * 0.3, -P.L * 0.39 - P.L * 0.11 + P.L * 0.0); tail.scale.y = 0.75; g.add(tail);
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(P.r * 1.01, P.r * 1.01, P.L * 0.78, 18, 1, true, -Math.PI * 0.38, Math.PI * 0.76).rotateX(Math.PI / 2), GREY);
  g.add(belly);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(P.r * 1.015, P.r * 1.015, P.L * 0.76, 18, 1, true, -0.25, 0.5).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), accent);
  const stripe2 = stripe.clone(); stripe2.rotation.z = Math.PI;
  stripe.position.y = 0; g.add(stripe, stripe2);
  if (P.hump) {
    const hump = new THREE.Mesh(new THREE.SphereGeometry(P.r * 0.85, 16, 10), WHITE);
    hump.scale.set(1, 0.9, 5.2); hump.position.set(0, P.r * 0.75, P.L * 0.22); g.add(hump);
  }
  const w = wing(P.span, P.root, P.tip, P.sweep, 0.7, GREY);
  w.position.set(0, -P.r * 0.45, P.L * 0.05); g.add(w);
  const hs = wing(P.span * 0.33, P.root * 0.45, P.tip * 0.6, P.sweep * 0.6, 0.4, GREY);
  hs.position.set(0, P.r * 0.3, -P.L * 0.43); g.add(hs);
  const fs = new THREE.Shape();
  fs.moveTo(0, 0); fs.lineTo(P.root * 0.55, 0); fs.lineTo(P.root * 0.15 - P.sweep * 0.5 + P.root * 0.4, P.finH); fs.lineTo(-P.sweep * 0.55 + P.root * 0.15, P.finH); fs.closePath();
  const finMat = accent.clone();
  finMat.emissive = new THREE.Color(livery); finMat.emissiveIntensity = 0;
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25).rotateY(-Math.PI / 2), finMat);
  fin.position.set(0, P.r * 0.6, -P.L * 0.48 + P.root * 0.1); g.add(fin);
  // engines
  const engines = [];
  const eng = new THREE.CylinderGeometry(P.engR, P.engR * 0.85, P.engR * 4.2, 14).rotateX(Math.PI / 2);
  const offs = [0.33, 0.62];
  for (const side of [-1, 1]) {
    for (const o of offs) {
      const x = side * P.span * o;
      const zBack = P.root / 2 - P.sweep * o;
      const e = new THREE.Mesh(eng, type === 'prop' ? DARK : GREY);
      e.position.set(x, -P.r * 0.45 - (type === 'prop' ? 0 : P.engR * 1.1), P.L * 0.05 + zBack + P.engR * (type === 'prop' ? 0.5 : 1.2));
      g.add(e);
      engines.push(e);
      if (type === 'prop') {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(P.engR * 3.4, 20), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
        disc.position.copy(e.position); disc.position.z += P.engR * 2.3; g.add(disc);
      }
    }
  }
  // gear
  for (const [x, z] of [[0, P.L * 0.33], [-P.r * 0.9, -P.L * 0.02], [P.r * 0.9, -P.L * 0.02]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), DARK);
    leg.position.set(x, -P.r - 1.0, z); g.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10).rotateZ(Math.PI / 2), DARK);
    wheel.position.set(x, -P.r - 2.0, z); g.add(wheel);
  }
  // lights
  const lamp = (c, size) => new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
  const navL = lamp(new THREE.Color(4, 0.2, 0.2), 0.35); navL.position.set(P.span, -P.r * 0.45, P.L * 0.05 + P.root / 2 - P.sweep - P.tip / 2);
  const navR = lamp(new THREE.Color(0.2, 4, 0.5), 0.35); navR.position.set(-P.span, navL.position.y, navL.position.z);
  const beacon = lamp(new THREE.Color(6, 0.3, 0.2), 0.45); beacon.position.set(0, P.r + 0.3, 0);
  const strobeL = lamp(new THREE.Color(8, 8, 8), 0.4); strobeL.position.copy(navL.position); strobeL.position.z -= 0.6;
  const strobeR = lamp(new THREE.Color(8, 8, 8), 0.4); strobeR.position.copy(navR.position); strobeR.position.z -= 0.6;
  const land1 = lamp(new THREE.Color(10, 9.5, 8.5), 0.5); land1.position.set(P.r * 1.6, -P.r * 0.45, P.L * 0.05 + P.root / 2);
  const land2 = land1.clone(); land2.position.x *= -1;
  g.add(navL, navR, beacon, strobeL, strobeR, land1, land2);
  const spot = new THREE.SpotLight(0xfff2dd, 0, 700, 0.32, 0.5, 1.15);
  spot.position.set(0, -P.r, P.L * 0.4);
  const tgt = new THREE.Object3D(); tgt.position.set(0, -60, 260); g.add(tgt);
  spot.target = tgt;
  g.add(spot);
  g.traverse((o) => { if (o.isMesh && !(o.material instanceof THREE.MeshBasicMaterial)) o.castShadow = true; });
  return { group: g, lights: { beacon, strobeL, strobeR, land1, land2, spot }, P, engines, finMat };
}

const LIVERIES = [0x1f6f5c, 0xb22030, 0x1c4c9a, 0x0f7a7a, 0xc05a12, 0x5a2a7a];

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.planes = [];
    this.timer = 4;
    this.count = 0;
  }
  type(year) { return year < 1960 ? 'prop' : year < 1971 ? 'jet' : 'jumbo'; }
  spawn(year, s = 0) {
    const ac = buildAircraft(this.type(year), LIVERIES[this.count++ % LIVERIES.length]);
    this.scene.add(ac.group);
    const p = { ac, s, age: 0, id: this.count, pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.planes.push(p);
    this.place(p);
    return p;
  }
  place(p) {
    const st = pathAt(p.s);
    const g = p.ac.group;
    const prev = g.position.clone();
    g.position.copy(st.p);
    const yaw = Math.atan2(st.d.x, st.d.z);
    g.rotation.set(st.pitch, yaw, st.bank, 'YXZ');
    p.pos.copy(st.p);
    p.speed = st.speed;
    p.dir = st.d;
    p.vel.copy(st.d).multiplyScalar(st.speed);
    return prev;
  }
  update(dt, year, night, active) {
    if (active && year < 1998) {
      this.timer -= dt;
      if (this.timer <= 0 && this.planes.length < 3) {
        this.spawn(year);
        this.timer = 38 + Math.random() * 40;
      }
    }
    const t = performance.now() / 1000;
    for (const p of this.planes) {
      const st = pathAt(p.s);
      p.s += st.speed * dt;
      p.age += dt;
      this.place(p);
      const L = p.ac.lights;
      L.beacon.visible = Math.sin(t * 6.0 + p.id) > 0.75;
      const sb = (t + p.id * 0.37) % 1.3;
      L.strobeL.visible = L.strobeR.visible = sb < 0.05 || (sb > 0.15 && sb < 0.2);
      const landOn = p.s > S1 - 3000 && p.s < S4 + 300;
      L.land1.visible = L.land2.visible = landOn;
      L.spot.intensity = landOn ? 1200 * (0.25 + 0.75 * night) : 0;
      p.ac.finMat.emissiveIntensity = 1.4 * night; // tail-logo floodlights
    }
    this.planes = this.planes.filter((p) => {
      if (p.s < PATH_END) return true;
      this.scene.remove(p.ac.group);
      p.ac.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      return false;
    });
  }
  clear() {
    for (const p of this.planes) this.scene.remove(p.ac.group);
    this.planes = [];
  }
}

export const APPROACH = { S1, S2, S3, S4, E, C, LEG_Z };
