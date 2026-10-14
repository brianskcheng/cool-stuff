// What survives and what comes after: the yamen, the wires, the dust, the garden.

import * as THREE from 'three';
import { RNG, clamp, smoothstep } from './rng.js';
import { DEMO_START } from './history.js';
import { pointInPoly, YAMEN } from './city.js';

function prism(w, d, h, eave = 0.7) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2 - eave, 0); s.lineTo(d / 2 + eave, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w + eave * 2, bevelEnabled: false });
  g.translate(0, 0, -(w + eave * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export function buildYamen() {
  const grp = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.95 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.8 });
  const { x0, x1, z0, z1 } = YAMEN;
  const cz = (z0 + z1) / 2;
  const hallW = 6.2, gap = (x1 - x0 - hallW * 3) / 2;
  for (let i = 0; i < 3; i++) {
    const cx = x0 + hallW / 2 + i * (hallW + gap);
    const d = z1 - z0 - 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(hallW, 4.0, d), wall);
    body.position.set(cx, 2.0, cz);
    const r = new THREE.Mesh(prism(hallW, d, 2.6), roof);
    r.position.set(cx, 4.0, cz);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.1), red);
    door.position.set(cx, 1.3, cz + d / 2 + 0.05);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(hallW + 1.8, 0.35, 0.35), roof);
    ridge.position.set(cx, 6.6, cz);
    for (const m of [body, r, door, ridge]) { m.castShadow = m.receiveShadow = true; grp.add(m); }
  }
  const lowWall = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1, 2.2, 0.4), wall);
  lowWall.position.set((x0 + x1) / 2, 1.1, z1 + 0.6);
  lowWall.castShadow = true;
  grp.add(lowWall);
  return grp;
}

// Overhead wires across the lanes, hung as catenaries.
export function buildWires(city) {
  const rng = new RNG(city.seed * 13 + 5);
  const pos = [], life = [];
  const nearestDemo = (x, z) => {
    let best = null, bd = Infinity;
    for (const L of city.lots) { const d = (L.cx - x) ** 2 + (L.cz - z) ** 2; if (d < bd) { bd = d; best = L; } }
    return best;
  };
  for (const s of city.segs) {
    for (let a = s.s0 + 1; a < s.s1 - 1; a += rng.range(1.5, 4.5)) {
      const L = nearestDemo(s.axis === 'z' ? s.c : a, s.axis === 'z' ? a : s.c);
      const t0 = Math.max(1958, L.gens[L.gens.length - 1].start + 1) + rng.range(0, 6);
      const t1 = L.demoStart - 0.05;
      const n = rng.int(1, 5);
      for (let k = 0; k < n; k++) {
        const ya = rng.range(3, 14), yb = ya + rng.range(-2, 2);
        const w = s.w;
        const sag = rng.range(0.15, 0.6) + w * 0.12;
        const along = a + rng.range(-0.4, 0.4), drift = rng.range(-0.8, 0.8);
        const seg = 8;
        let prev = null;
        for (let i = 0; i <= seg; i++) {
          const f = i / seg;
          const across = s.c - w / 2 + 0.1 + f * (w - 0.2);
          const cat = Math.cosh((f - 0.5) * 2.2) - Math.cosh(1.1); // catenary, zero at both ends
          const y = ya + (yb - ya) * f + cat * sag / (1 - Math.cosh(1.1)) * -1;
          const al = along + drift * f;
          const p = s.axis === 'z' ? [across, y, al] : [al, y, across];
          if (prev) { pos.push(...prev, ...p); life.push(t0, t1, t0, t1); }
          prev = p;
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLife', new THREE.Float32BufferAttribute(life, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { uYear: { value: 1947 }, ...THREE.UniformsLib.fog },
    vertexShader: `attribute vec2 aLife; uniform float uYear; varying float vOn;
      #include <fog_pars_vertex>
      void main(){ vOn = step(aLife.x, uYear) * step(uYear, aLife.y);
        vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying float vOn;
      #include <fog_pars_fragment>
      void main(){ if (vOn < 0.5) discard; gl_FragColor = vec4(0.03,0.03,0.035,1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  return lines;
}

export class Dust {
  constructor(n = 2500) {
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.a = new Float32Array(n);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aA; varying float vA; uniform float uScale;
        void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (2.0 + (1.0 - aA) * 6.0) / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.62,0.58,0.52), vA * 0.35 * (1.0 - d * 2.0)); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  emit(x, y, z, spread) {
    const i = this.i = (this.i + 1) % this.n;
    this.p[i * 3] = x + (Math.random() - 0.5) * spread;
    this.p[i * 3 + 1] = y + Math.random() * 2;
    this.p[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    this.v[i * 3] = (Math.random() - 0.5) * 2; this.v[i * 3 + 1] = 1 + Math.random() * 2; this.v[i * 3 + 2] = (Math.random() - 0.5) * 2;
    this.life[i] = 1;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.a[i] = 0; continue; }
      this.life[i] -= dt * 0.25;
      this.p[i * 3] += this.v[i * 3] * dt + 1.2 * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.a[i] = Math.max(0, this.life[i]);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aA.needsUpdate = true;
  }
}

// --- the garden ------------------------------------------------------------

export class Park {
  constructor(city) {
    this.group = new THREE.Group();
    const rng = new RNG(city.seed * 31 + 9);
    const poly = city.poly;
    const B = { x0: -118, x1: 116, z0: -70, z1: 70 };
    const W = 1024, H = Math.round(1024 * (B.z1 - B.z0) / (B.x1 - B.x0));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const px = (x) => ((x - B.x0) / (B.x1 - B.x0)) * W, pz = (z) => ((z - B.z0) / (B.z1 - B.z0)) * H;
    const sc = W / (B.x1 - B.x0);
    g.fillStyle = '#4d6b3a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rng.int(40, 90)},${rng.int(80, 120)},${rng.int(40, 60)},0.25)`; g.beginPath(); g.arc(rng.range(0, W), rng.range(0, H), rng.range(2, 9), 0, 7); g.fill(); }
    // ponds
    this.ponds = [];
    for (let k = 0; k < 2; k++) {
      const cx = rng.range(-80, 70), cz = rng.range(-40, 35);
      if (Math.abs(cx - 1) < 30 && Math.abs(cz - 5) < 20) continue;
      g.fillStyle = '#2c4a50'; g.beginPath();
      for (let a = 0; a <= 24; a++) { const r = (9 + 4 * Math.sin(a * 1.7 + k)) * sc; const t = (a / 24) * Math.PI * 2; g.lineTo(px(cx) + Math.cos(t) * r * 1.5, pz(cz) + Math.sin(t) * r); }
      g.fill();
      this.ponds.push([cx, cz]);
    }
    // paths
    g.strokeStyle = '#b9b1a0'; g.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      g.lineWidth = rng.range(2.2, 3.6) * sc;
      g.beginPath();
      g.moveTo(px(rng.range(-110, 110)), pz(rng.pick([-65, 65])));
      g.bezierCurveTo(px(rng.range(-100, 100)), pz(rng.range(-50, 50)), px(rng.range(-100, 100)), pz(rng.range(-50, 50)), px(1), pz(5));
      g.stroke();
    }
    // plaza around the yamen and the south gate foundations
    g.fillStyle = '#a9a294';
    g.fillRect(px(YAMEN.x0 - 6), pz(YAMEN.z0 - 5), (YAMEN.x1 - YAMEN.x0 + 12) * sc, (YAMEN.z1 - YAMEN.z0 + 12) * sc);
    g.fillStyle = '#8a8478';
    g.fillRect(px(-14), pz(52), 28 * sc, 5 * sc);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const pa = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) - B.x0) / (B.x1 - B.x0), 1 - (pa.getZ(i) - B.z0) / (B.z1 - B.z0));
    this.lawnMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true, opacity: 0 });
    this.lawn = new THREE.Mesh(geo, this.lawnMat);
    this.lawn.position.y = 0.06;
    this.lawn.receiveShadow = true;
    this.group.add(this.lawn);
    this.rubbleMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, transparent: true, opacity: 0 });
    this.rubble = new THREE.Mesh(geo, this.rubbleMat);
    this.rubble.position.y = 0.04;
    this.rubble.receiveShadow = true;
    this.group.add(this.rubble);

    const lawnAt = (x, z) => {
      const d = g.getImageData(Math.floor(px(x)), Math.floor(pz(z)), 1, 1).data;
      return d[1] > d[0] + 15 && d[1] > d[2] + 15 && pointInPoly(x, z, poly);
    };
    // trees
    const trunks = [], crowns = [];
    for (let k = 0; k < 900 && crowns.length < 230; k++) {
      const x = rng.range(-112, 110), z = rng.range(-66, 66);
      if (!lawnAt(x, z) || !lawnAt(x + 2, z) || !lawnAt(x, z + 2)) continue;
      const h = rng.range(3, 7), r = rng.range(1.8, 3.8);
      trunks.push({ x, z, h });
      crowns.push({ x, z, y: h + r * 0.5, r, c: new THREE.Color().setHSL(rng.range(0.22, 0.33), rng.range(0.35, 0.55), rng.range(0.16, 0.3)), delay: rng.range(0, 0.6) });
    }
    this.trees = { trunks, crowns };
    this.trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 }), trunks.length);
    this.crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), crowns.length);
    crowns.forEach((cr, i) => this.crownMesh.setColorAt(i, cr.c));
    for (const m of [this.trunkMesh, this.crownMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }

    // pavilions
    const post = new THREE.MeshStandardMaterial({ color: 0x8c2a1e, roughness: 0.7 });
    const tile = new THREE.MeshStandardMaterial({ color: 0x2f4a3c, roughness: 0.6 });
    this.pavilions = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      let x, z, ok = false;
      for (let tries = 0; tries < 50 && !ok; tries++) { x = rng.range(-95, 95); z = rng.range(-50, 50); ok = lawnAt(x, z) && Math.abs(x - 1) > 25; }
      if (!ok) continue;
      const pv = new THREE.Group();
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 8), post);
        p.position.set(dx, 1.5, dz); pv.add(p);
      }
      const r = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 4), tile);
      r.position.y = 3.8; r.rotation.y = Math.PI / 4; pv.add(r);
      pv.position.set(x, 0, z);
      pv.traverse((o) => { o.castShadow = true; });
      this.pavilions.add(pv);
    }
    this.group.add(this.pavilions);

    // lanterns
    const lp = [];
    for (let k = 0; k < 400 && lp.length < 70; k++) {
      const x = rng.range(-112, 110), z = rng.range(-66, 66);
      const d = g.getImageData(Math.floor(px(x)), Math.floor(pz(z)), 1, 1).data;
      if (d[0] > 150 && pointInPoly(x, z, poly)) lp.push([x, z]);
    }
    this.lanternMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), this.lanternMat, lp.length);
    lp.forEach(([x, z], i) => this.lanterns.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 1.2, z)));
    this.group.add(this.lanterns);

    // rubble mounds, one per lot
    this.city = city;
    this.mounds = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x5d544a, roughness: 1, flatShading: true }), city.lots.length);
    this.mounds.castShadow = this.mounds.receiveShadow = true;
    this.mounds.frustumCulled = false;
    this.group.add(this.mounds);
    this.moundRot = city.lots.map(() => rng.range(0, Math.PI));
  }

  update(t, night) {
    const grow = smoothstep(1994.55, 1995.9, t);
    const vis = t > 1994.5;
    this.group.visible = t > DEMO_START;
    this.lawnMat.opacity = smoothstep(1994.5, 1995.1, t);
    this.lawn.visible = this.lawnMat.opacity > 0.001;
    this.rubbleMat.opacity = smoothstep(DEMO_START + 0.2, 1993.9, t) * (1 - smoothstep(1994.6, 1995.0, t));
    this.rubble.visible = this.rubbleMat.opacity > 0.001;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const { trunks, crowns } = this.trees;
    for (let i = 0; i < trunks.length; i++) {
      const g = vis ? clamp((grow - crowns[i].delay * 0.3) / 0.7, 0, 1) : 0;
      const k = g > 0 ? 0.35 + 0.65 * g : 0;
      m.compose(p.set(trunks[i].x, 0, trunks[i].z), q.identity(), s.set(k, trunks[i].h * k, k));
      this.trunkMesh.setMatrixAt(i, m);
      const c = crowns[i];
      m.compose(p.set(c.x, c.y * k, c.z), q.identity(), s.set(c.r * k, c.r * k * 0.85, c.r * k));
      this.crownMesh.setMatrixAt(i, m);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = this.crownMesh.instanceMatrix.needsUpdate = true;
    this.pavilions.visible = t > 1995.2;
    this.lanterns.visible = t > 1995.5;
    this.lanternMat.color.setRGB(0.3 + 2.6 * night, 0.15 + 1.4 * night, 0.05 + 0.4 * night);
    this.city.lots.forEach((L, i) => {
      const k = t > L.demoStart ? clamp((t - L.demoStart) / L.demoDur, 0, 1) * (1 - smoothstep(1994.45, 1994.75, t)) : 0;
      const w = (L.x1 - L.x0) * 0.55, d = (L.z1 - L.z0) * 0.55;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.moundRot[i]);
      m.compose(p.set(L.cx, 0, L.cz), q, s.set(w * k, Math.min(4, L.last.floors * 0.35) * k, d * k));
      this.mounds.setMatrixAt(i, m);
    });
    this.mounds.instanceMatrix.needsUpdate = true;
  }
}
