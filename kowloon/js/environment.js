// Kowloon around the city: sky and sun over Hong Kong, the harbour, Lion Rock,
// the island skyline, Kai Tak and the checkerboard.

import * as THREE from 'three';
import { RNG, smoothstep, lerp } from './rng.js';
import { sunDir } from './city.js';
import { makeBuildingMaterial, U } from './facade.js';

export const THRESHOLD = new THREE.Vector3(650, 0, 680);
export const RWY_DIR = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
export const CHECKER = new THREE.Vector3(-430, 0, -820);

export function isWater(x, z) {
  if (onRunway(x, z, 140)) return false;
  if (z > 3900 + 180 * Math.sin(x * 0.0013) + 90 * Math.sin(x * 0.0041)) return false; // the island
  return x + z > 1650 + 140 * Math.sin(x * 0.0021) + 60 * Math.sin(z * 0.006);
}
export function onRunway(x, z, halfW = 30) {
  const dx = x - THRESHOLD.x, dz = z - THRESHOLD.z;
  const along = dx * RWY_DIR.x + dz * RWY_DIR.z;
  const across = -dx * RWY_DIR.z + dz * RWY_DIR.x;
  return along > -60 && along < 3100 && Math.abs(across) < halfW;
}

function skyColors(sunY, cloud) {
  const day = smoothstep(-0.08, 0.3, sunY);
  const dusk = smoothstep(-0.18, 0.02, sunY) * (1 - smoothstep(0.02, 0.3, sunY));
  const zen = new THREE.Color(0.012, 0.016, 0.04).lerp(new THREE.Color(0.18, 0.36, 0.68), day);
  const hor = new THREE.Color(0.07, 0.06, 0.085).lerp(new THREE.Color(0.66, 0.74, 0.8), day);
  hor.lerp(new THREE.Color(0.98, 0.5, 0.28), dusk * 0.8);
  zen.lerp(new THREE.Color(0.26, 0.24, 0.42), dusk * 0.5);
  const grey = new THREE.Color(0.42, 0.44, 0.46).multiplyScalar(0.12 + 0.88 * day);
  zen.lerp(grey, cloud * 0.85); hor.lerp(grey, cloud * 0.75);
  return { zen, hor, day, dusk };
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    scene.fog = new THREE.FogExp2(0x8899aa, 0.00024);

    // sky dome
    this.skyU = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) },
      uNightK: { value: 0 }, uCloud: { value: 0 }, uT: { value: 0 }, uFlashK: U.uFlash };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: `uniform vec3 uZen, uHor, uSun; uniform float uNightK, uCloud, uT, uFlashK; varying vec3 vD;
        float h(vec3 p){ p = fract(p*0.3183+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 d = normalize(vD);
          float y = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(y, 0.55));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          float vis = smoothstep(-0.1, 0.05, uSun.y) * (1.0 - uCloud * 0.85);
          c += vec3(1.0, 0.75, 0.5) * pow(sd, 6.0) * 0.35 * vis;
          c += vec3(1.0, 0.9, 0.75) * smoothstep(0.9993, 0.9997, sd) * 6.0 * vis;
          // stars
          vec3 q = floor(d * 900.0);
          float s = step(0.9992, h(q)) * smoothstep(0.6, 1.0, uNightK) * (1.0 - uCloud) * smoothstep(0.08, 0.35, d.y);
          c += vec3(s) * (0.6 + 0.4 * sin(uT * 3.0 + h(q + 1.0) * 40.0));
          // clouds
          vec2 p = d.xz / max(d.y, 0.06) * 1.3 + vec2(uT * 0.01, uT * 0.004);
          float cl = n3(vec3(p, 1.0)) * 0.55 + n3(vec3(p * 2.3, 2.0)) * 0.3 + n3(vec3(p * 5.1, 3.0)) * 0.15;
          float cov = smoothstep(0.62 - uCloud * 0.5, 0.92 - uCloud * 0.4, cl) * smoothstep(0.0, 0.15, d.y);
          vec3 cc = mix(uHor * 1.05, vec3(0.95, 0.93, 0.9) * (1.0 - uNightK * 0.92), 0.5 - uCloud * 0.3);
          cc += vec3(0.25, 0.12, 0.05) * uNightK * 0.5; // city glow on the cloud base
          c = mix(c, cc, cov * 0.85);
          c += vec3(0.20, 0.10, 0.06) * uNightK * pow(1.0 - y, 6.0);
          c += vec3(0.7, 0.75, 1.0) * uFlashK * (0.4 + cov);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8899cc, 0.0);
    this.moon.position.set(-300, 400, 200);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2622, 0.6);
    scene.add(this.hemi);

    this.buildGround();
    this.buildMountains();
    this.buildAirport();
    this.buildContext();
    this.buildIsland();
  }

  buildGround() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vGW; uniform float uWet; uniform float uNight; uniform float uTime;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }
        bool water(vec2 p){
          vec2 d = p - vec2(${THRESHOLD.x.toFixed(1)}, ${THRESHOLD.z.toFixed(1)});
          float along = d.x * 0.70710678 + d.y * 0.70710678, across = -d.x * 0.70710678 + d.y * 0.70710678;
          if (along > -60.0 && along < 3100.0 && abs(across) < 140.0) return false;
          if (p.y > 3900.0 + 180.0 * sin(p.x * 0.0013) + 90.0 * sin(p.x * 0.0041)) return false;
          return p.x + p.y > 1650.0 + 140.0 * sin(p.x * 0.0021) + 60.0 * sin(p.y * 0.006);
        }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 p = vGW.xz;
          float gRough = 0.92;
          vec3 gc;
          vec3 gEm = vec3(0.0);
          if (water(p)) {
            float w = gn(p * 0.05 + uTime * 0.05) * 0.5 + gn(p * 0.2 - uTime * 0.1) * 0.5;
            gc = mix(vec3(0.03, 0.07, 0.08), vec3(0.05, 0.10, 0.11), w);
            gRough = 0.12 + 0.12 * w;
          } else {
            vec2 d = p - vec2(${THRESHOLD.x.toFixed(1)}, ${THRESHOLD.z.toFixed(1)});
            float along = d.x * 0.70710678 + d.y * 0.70710678, across = -d.x * 0.70710678 + d.y * 0.70710678;
            float n = gn(p * 0.02) * 0.6 + gn(p * 0.3) * 0.4;
            gc = mix(vec3(0.11, 0.11, 0.105), vec3(0.17, 0.165, 0.155), n);
            vec2 blk = abs(fract(vec2(p.x * 0.9 + p.y * 0.15, p.y - p.x * 0.12) / vec2(78.0, 54.0)) - 0.5);
            float road = step(0.43, max(blk.x, blk.y));
            gc = mix(gc, vec3(0.07, 0.07, 0.075), road * step(140.0, length(p * vec2(0.9, 1.4))));
            if (along > -60.0 && along < 3100.0 && abs(across) < 140.0) {
              gc = vec3(0.2, 0.21, 0.2) * (0.9 + 0.1 * n);
              if (abs(across) < 30.0) {
                gc = vec3(0.16, 0.16, 0.17) * (0.85 + 0.3 * gn(p * 0.5));
                float cl = step(abs(across), 0.5) * step(0.5, fract(along / 50.0));
                float th = step(along, 40.0) * step(0.0, along) * step(0.5, fract(across / 3.5)) * step(abs(across), 25.0);
                gc = mix(gc, vec3(0.85), max(cl, th));
              }
            }
            float k = length(p * vec2(0.85, 1.5));
            gc = mix(vec3(0.13, 0.12, 0.115) * (0.8 + 0.4 * gn(p * 0.6)), gc, smoothstep(85.0, 130.0, k));
            gRough = mix(0.92, 0.18, uWet * (0.6 + 0.4 * gn(p * 0.15)));
          }
          diffuseColor.rgb = gc;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
    };
    m.customProgramCacheKey = () => 'kwc-ground';
    const g = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2), m);
    g.receiveShadow = true;
    this.group.add(g);
  }

  buildMountains() {
    const ridge = (fn, x0, x1, z, depth, seg = 220) => {
      const geo = new THREE.PlaneGeometry(x1 - x0, depth, seg, 40).rotateX(-Math.PI / 2);
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i) + (x0 + x1) / 2, lz = pa.getZ(i) / (depth / 2);
        const prof = fn(x);
        const fall = Math.exp(-lz * lz * 2.6);
        const n = Math.sin(x * 0.011 + lz * 4) * 12 + Math.sin(x * 0.031 + lz * 9) * 6;
        pa.setY(i, Math.max(0, prof * fall + n * fall));
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2c3a2c, roughness: 1 }));
      mesh.position.z = z;
      this.group.add(mesh);
      return mesh;
    };
    // Lion Rock and the Kowloon ridges
    ridge((x) => {
      const base = 230 + 70 * Math.sin(x * 0.0009) + 60 * Math.sin(x * 0.0023 + 1);
      const head = 190 * Math.exp(-(((x + 380) / 340) ** 4)) * (x > -300 ? Math.exp(-(((x + 300) / 160) ** 2)) : 1);
      const back = 120 * Math.exp(-(((x + 900) / 420) ** 2));
      return base + head + back;
    }, -7000, 7000, -3400, 2200);
    // Hong Kong Island
    ridge((x) => 300 + 230 * Math.exp(-(((x + 2600) / 1200) ** 2)) + 120 * Math.sin(x * 0.0017), -9000, 6000, 5400, 2400);
  }

  buildAirport() {
    // runway lights
    const pts = [], cols = [], kinds = [];
    const perp = new THREE.Vector3(-RWY_DIR.z, 0, RWY_DIR.x);
    for (let s = 0; s <= 3000; s += 60) {
      for (const side of [-1, 1]) {
        const p = THRESHOLD.clone().addScaledVector(RWY_DIR, s).addScaledVector(perp, side * 30);
        pts.push(p.x, 1, p.z); cols.push(1, 0.85, 0.6); kinds.push(0);
      }
    }
    for (let a = -25; a <= 25; a += 5) {
      const p = THRESHOLD.clone().addScaledVector(perp, a);
      pts.push(p.x, 1, p.z); cols.push(0.2, 1, 0.4); kinds.push(0);
      const e = THRESHOLD.clone().addScaledVector(RWY_DIR, 3000).addScaledVector(perp, a);
      pts.push(e.x, 1, e.z); cols.push(1, 0.15, 0.1); kinds.push(0);
    }
    // the lead-in lights along the final turn, chasing towards the runway
    for (let i = 0; i < 28; i++) {
      const s = -900 + i * 32;
      const p = THRESHOLD.clone().addScaledVector(RWY_DIR, s);
      pts.push(p.x, 22, p.z); cols.push(1, 1, 1); kinds.push(1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(kinds, 1));
    this.rwyLights = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uTime: U.uTime },
      vertexShader: `attribute float aK; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uNight; uniform float uTime;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float a = 0.15 + 0.85 * uNight;
          if (aK > 0.5) { float ph = fract(uTime * 0.5 - aK / 28.0); a = step(ph, 0.06) * (0.4 + 2.5 * uNight); }
          vA = a; gl_PointSize = clamp(9000.0 / -mv.z, 1.5, 9.0) * (aK > 0.5 ? 1.8 : 1.0); }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if (d>0.5) discard;
        gl_FragColor = vec4(vC * vA * 3.0 * (1.0 - d*2.0), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.rwyLights.frustumCulled = false;
    this.group.add(this.rwyLights);

    // checkerboard hill
    const hg = new THREE.PlaneGeometry(640, 640, 56, 56).rotateX(-Math.PI / 2);
    const hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i);
      const r2 = (x * x + z * z) / (150 * 150);
      hp.setY(i, 52 * Math.exp(-r2 * 0.8) * (1 + 0.12 * Math.sin(x * 0.04) * Math.cos(z * 0.035)) - 0.5);
    }
    hg.computeVertexNormals();
    const hill = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0x33452f, roughness: 1 }));
    hill.position.copy(CHECKER);
    hill.receiveShadow = true;
    this.group.add(hill);
    const c = document.createElement('canvas'); c.width = 280; c.height = 180;
    const g2 = c.getContext('2d');
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) { g2.fillStyle = (i + j) % 2 ? '#f2f0ea' : '#ef6a12'; g2.fillRect(i * 40, j * 36, 40, 36); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.boardMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(56, 36), this.boardMat);
    board.position.set(CHECKER.x - 70, 46, CHECKER.z + 6);
    board.rotation.y = -Math.PI / 2 + 0.15;
    board.rotation.x = 0;
    this.group.add(board);
    this.board = board;
  }

  buildContext() {
    const rng = new RNG(1997);
    const specs = [];
    for (let gx = -1700; gx < 1700; gx += 72) {
      for (let gz = -1500; gz < 1700; gz += 52) {
        const ox = gx + rng.range(-6, 6), oz = gz + rng.range(-6, 6);
        const nb = rng.int(2, 4);
        for (let k = 0; k < nb; k++) {
          const w = rng.range(14, 30), d = rng.range(12, 22);
          const x = ox + rng.range(-16, 16), z = oz + rng.range(-10, 10);
          if (Math.abs(x) < 150 && Math.abs(z) < 105) continue;
          if (isWater(x, z) || isWater(x + 20, z + 20) || onRunway(x, z, 170)) continue;
          if (x * x + z * z > 2400 * 2400) continue;
          if ((x - CHECKER.x) ** 2 + (z - CHECKER.z) ** 2 < 180 * 180) continue;
          const dist = Math.hypot(x, z);
          const fl = dist < 500 ? rng.int(3, 9) : rng.int(4, dist > 1100 ? 22 : 12);
          const born = fl > 9 ? rng.range(1962, 1988) : rng.range(1947, 1978);
          specs.push({ x, z, w, d, fl, low: rng.int(2, 4), born, rot: rng.range(-0.06, 0.06) + 0.13 });
        }
      }
    }
    this.context = this.makeBoxes(specs, 0.42, 3);
  }

  makeBoxes(specs, grime, kind) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const n = specs.length;
    const rng = new RNG(n);
    const at = (k, s) => new THREE.InstancedBufferAttribute(new Float32Array(n * s), s);
    const A = { aColor: at(0, 3), aP0: at(0, 4), aP1: at(0, 4), aNH: at(0, 4), aNG: at(0, 4) };
    specs.forEach((s, i) => {
      const v = rng.range(0.34, 0.6);
      const tint = [[1, 0.98, 0.92], [0.92, 1, 0.95], [0.95, 0.97, 1.02], [1.04, 0.95, 0.9], [1, 1, 1]][rng.int(0, 4)];
      A.aColor.setXYZ(i, v * tint[0], v * tint[1], v * tint[2]);
      A.aP0.setXYZW(i, rng.int(0, 9999), rng.range(2.4, 3.6), 0, kind);
      A.aP1.setXYZW(i, grime, 1, 0, 0);
      A.aNG.setXYZW(i, 40, 40, 40, 40);
    });
    for (const k in A) geo.setAttribute(k, A[k]);
    const mesh = new THREE.InstancedMesh(geo, makeBuildingMaterial(), n);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const out = { mesh, specs, lastYear: -1 };
    return out;
  }

  updateBoxes(B, year) {
    if (Math.abs(year - B.lastYear) < 0.2) return;
    B.lastYear = year;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    B.specs.forEach((b, i) => {
      if (b.until && year < b.from) { B.mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); return; }
      const f = year < b.born ? Math.min(b.fl, b.low || 3) : b.fl;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot || 0);
      m.compose(p.set(b.x, 0, b.z), q, s.set(b.w, f * 2.8, b.d));
      B.mesh.setMatrixAt(i, m);
    });
    B.mesh.instanceMatrix.needsUpdate = true;
  }

  buildIsland() {
    const rng = new RNG(1842);
    const specs = [];
    for (let i = 0; i < 260; i++) {
      const x = rng.range(-5200, 900);
      const shore = 3900 + 180 * Math.sin(x * 0.0013) + 90 * Math.sin(x * 0.0041);
      const z = shore + rng.range(30, 380);
      const central = Math.exp(-(((x + 2300) / 900) ** 2));
      const fl = Math.round(rng.range(8, 22) + central * rng.range(10, 30));
      specs.push({ x, z, w: rng.range(25, 45), d: rng.range(25, 45), fl, born: rng.range(1950, 1992), rot: 0 });
    }
    // landmarks of the island skyline, by completion year
    const LM = [
      { x: -2450, z: 4010, w: 46, d: 46, fl: 64, from: 1973 }, // a square tower with round windows
      { x: -1700, z: 4120, w: 40, d: 40, fl: 77, from: 1980, round: true },
      { x: -2300, z: 4060, w: 70, d: 55, fl: 64, from: 1985 },
      { x: -2150, z: 4080, w: 52, d: 52, fl: 112, from: 1990, boc: true },
      { x: -1500, z: 3990, w: 50, d: 50, fl: 133, from: 1992, tri: true },
    ];
    this.island = this.makeBoxes(specs, 0.3, 3);
    this.landmarks = [];
    for (const L of LM) {
      let geo;
      if (L.round) geo = new THREE.CylinderGeometry(L.w / 2, L.w / 2, 1, 24).translate(0, 0.5, 0);
      else if (L.tri) geo = new THREE.CylinderGeometry(L.w / 2, L.w / 2, 1, 3).translate(0, 0.5, 0);
      else if (L.boc) geo = bocGeometry(L.w);
      else geo = new THREE.BoxGeometry(L.w, 1, L.d).translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: L.boc ? 0x6f8aa0 : 0x9aa2a8, roughness: L.boc ? 0.25 : 0.6, metalness: L.boc ? 0.5 : 0.1, emissive: 0xffffff, emissiveIntensity: 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(L.x, 0, L.z);
      m.scale.y = L.boc ? 1 : L.fl * 2.8;
      if (L.boc) m.scale.setScalar(1);
      m.userData = L;
      this.group.add(m);
      this.landmarks.push(m);
      if (L.boc) { // white edge lights of the bracing
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0xffffff }));
        edges.position.copy(m.position);
        m.userData.edges = edges;
        this.group.add(edges);
      }
    }
  }

  // Sun, sky, fog and exposure for a moment in a year.
  set(doy, hour, cloud, rain, renderer, camera) {
    const s = sunDir(doy, hour);
    const sv = new THREE.Vector3(s.x, s.y, s.z);
    const { zen, hor, day, dusk } = skyColors(s.y, cloud);
    const night = 1 - smoothstep(-0.14, 0.06, s.y);
    this.skyU.uZen.value.copy(zen); this.skyU.uHor.value.copy(hor);
    this.skyU.uSun.value.copy(sv); this.skyU.uNightK.value = night; this.skyU.uCloud.value = cloud;
    this.sky.position.copy(camera.position);
    this.scene.fog.color.copy(hor).lerp(zen, 0.15);
    this.scene.fog.density = lerp(0.00022, 0.00095, rain) + cloud * 0.00012;
    const up = Math.max(s.y, 0);
    this.sun.position.set(s.x * 500, Math.max(s.y, 0.02) * 500, s.z * 500);
    this.sun.intensity = 3.2 * smoothstep(-0.02, 0.12, s.y) * (1 - 0.8 * cloud);
    this.sun.color.setRGB(1, lerp(0.62, 0.96, smoothstep(0.0, 0.35, up)), lerp(0.42, 0.9, smoothstep(0.0, 0.4, up)));
    this.moon.intensity = 0.35 * night * (1 - cloud * 0.6);
    this.hemi.color.copy(zen).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.hemi.groundColor.setRGB(0.16, 0.14, 0.12).lerp(new THREE.Color(0.2, 0.11, 0.06), night);
    this.hemi.intensity = lerp(0.9, 2.5, day) * (1 - 0.25 * cloud * day) + 6 * U.uFlash.value;
    renderer.toneMappingExposure = lerp(1.1, 0.88, day) + dusk * 0.08;
    this.boardMat.emissiveIntensity = 0.35 * night;
    return { night, day, dusk, sun: sv };
  }

  update(year, night) {
    this.updateBoxes(this.context, year);
    this.updateBoxes(this.island, year);
    for (const m of this.landmarks) {
      const L = m.userData;
      const on = year >= L.from;
      m.visible = on;
      if (L.edges) { L.edges.visible = on; L.edges.material.color.setScalar(0.2 + 2.2 * night); }
      m.material.emissiveIntensity = L.tri ? 0 : 0.0;
      if (L.tri) { m.material.emissive.setHSL((Math.floor(U.uTime.value / 15) % 4) / 4, 0.8, 0.5); m.material.emissiveIntensity = 0.5 * night; }
    }
  }
}

// Four triangular shafts stepping down, like the bank tower on the island.
function bocGeometry(w) {
  const h = w / 2;
  const geos = [];
  const tops = [315, 260, 205, 150];
  const quads = [[[-h, -h], [h, -h], [0, 0]], [[h, -h], [h, h], [0, 0]], [[h, h], [-h, h], [0, 0]], [[-h, h], [-h, -h], [0, 0]]];
  quads.forEach((tri, i) => {
    const s = new THREE.Shape(tri.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: tops[i], bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    geos.push(g);
  });
  const merged = mergeGeos(geos);
  return merged;
}

function mergeGeos(geos) {
  const pos = [], nor = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
