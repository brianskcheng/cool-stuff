// Materials. Facades are drawn procedurally per fragment: windows, shopfronts,
// grime and cages, with alley darkness computed from the building across the gap.

import * as THREE from 'three';
import { SIGN_WORDS } from './history.js';

export const U = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  uWet: { value: 0 },
  uFlash: { value: 0 },
};

const GLSL_LIB = /* glsl */`
float kHash(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float kNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = kHash(vec3(i,1.0)), b = kHash(vec3(i+vec2(1,0),1.0)), c = kHash(vec3(i+vec2(0,1),1.0)), d = kHash(vec3(i+vec2(1,1),1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
`;

export function makeBuildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aColor; attribute vec4 aP0; attribute vec4 aP1; attribute vec4 aNH; attribute vec4 aNG;
        varying vec3 vColorK; varying vec4 vP0; varying vec4 vP1; varying vec4 vNH; varying vec4 vNG;
        varying vec3 vLocal; varying vec3 vScale; varying vec3 vLN; varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vColorK = aColor; vP0 = aP0; vP1 = aP1; vNH = aNH; vNG = aNG;
        vLocal = position; vLN = normal;
        vec4 kwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          kwp = instanceMatrix * kwp;
        #else
          vScale = vec3(1.0);
        #endif
        vWP = (modelMatrix * kwp).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uTime; uniform float uWet;
        varying vec3 vColorK; varying vec4 vP0; varying vec4 vP1; varying vec4 vNH; varying vec4 vNG;
        varying vec3 vLocal; varying vec3 vScale; varying vec3 vLN; varying vec3 vWP;
        ${GLSL_LIB}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        const float FH = 2.8;
        float seed = vP0.x, spacing = vP0.y, style = vP0.z, kind = vP0.w;
        float grime = vP1.x, occ = vP1.y, alleyGlow = vP1.z;
        vec3 col = vColorK;
        vec3 kEmis = vec3(0.0);
        float kRough = 0.88;
        float kVis = 1.0;
        vec3 ln = normalize(vLN);
        if (ln.y > 0.5) {
          float n = kNoise(vWP.xz * 0.45 + seed) * 0.6 + kNoise(vWP.xz * 2.1) * 0.4;
          if (kind > 2.5) n = 0.55 + 0.25 * kNoise(vWP.xz * 1.7);
          if (kind < 0.5) {
            float rib = smoothstep(0.35, 0.5, abs(fract(vWP.x * 1.6 + seed) - 0.5));
            col = mix(vec3(0.33, 0.25, 0.19), vec3(0.47, 0.43, 0.39), n) * (0.85 + 0.15 * rib);
          } else {
            col = mix(vec3(0.46, 0.45, 0.42), vec3(0.27, 0.27, 0.26), n);
            col = mix(col, vec3(0.2, 0.2, 0.21), smoothstep(0.6, 0.75, kNoise(vWP.xz * 0.9 + seed)) * 0.5);
            if (kind > 2.5) col *= 0.7;
          }
          kRough = mix(0.92, 0.3, uWet);
        } else if (ln.y < -0.5) {
          col *= 0.35;
        } else {
          float side, u, halfW;
          if (abs(ln.x) > 0.5) { side = ln.x > 0.0 ? 0.0 : 1.0; u = vLocal.z * vScale.z * sign(ln.x); halfW = vScale.z * 0.5; }
          else { side = ln.z > 0.0 ? 2.0 : 3.0; u = -vLocal.x * vScale.x * sign(ln.z); halfW = vScale.x * 0.5; }
          float nh = side < 0.5 ? vNH.x : side < 1.5 ? vNH.y : side < 2.5 ? vNH.z : vNH.w;
          float ng = side < 0.5 ? vNG.x : side < 1.5 ? vNG.y : side < 2.5 ? vNG.z : vNG.w;
          float ang = atan(max(nh - vWP.y, 0.0), max(ng, 0.25));
          kVis = clamp(1.0 - ang / 1.5708, 0.0, 1.0);
          kVis = mix(kVis, 1.0, step(20.0, ng));
          kVis = min(kVis, mix(0.35, 1.0, smoothstep(0.0, 6.0, vWP.y)));
          float fy = vWP.y / FH;
          float fl = floor(fy), vy = fract(fy);
          float cu = u / spacing + 0.5;
          float ci = floor(cu), vx = fract(cu);
          float aa = 1.0 - smoothstep(0.4, 1.1, max(fwidth(cu), fwidth(fy)));
          vec3 wallCol = col;
          float h1 = kHash(vec3(seed, fl * 1.7 + side * 31.0, ci));
          float h2 = kHash(vec3(ci * 3.3 + side, seed * 0.37, fl));
          float h3 = kHash(vec3(fl, ci + 17.0, seed + side * 5.0));
          float streak = kNoise(vec2(u * 1.3 + seed, vWP.y * 0.06));
          float drip = kNoise(vec2(u * 4.0, vWP.y * 0.4 + seed));
          col *= 1.0 - grime * (0.38 * streak + 0.18 * drip + 0.2 * (1.0 - vy));
          if (kind < 0.5) col *= 0.88 + 0.12 * step(0.12, fract(vWP.y * 3.0 + seed));
          float tileAA = 1.0 - smoothstep(0.15, 0.4, max(fwidth(u * 6.5), fwidth(vWP.y * 6.5)));
          if (style > 1.5 && style < 2.5) col *= 1.0 - 0.1 * tileAA * (1.0 - step(0.1, fract(u * 6.5)) * step(0.1, fract(vWP.y * 6.5)));
          bool shop = fl < 0.5 && kind > 0.5 && kind < 2.5;
          float wx0 = 0.2, wx1 = 0.8, wy0 = 0.3, wy1 = 0.86;
          if (kind < 0.5) { wx0 = 0.3; wx1 = 0.7; wy0 = 0.35; wy1 = 0.75; }
          if (style > 2.5) { wx0 = 0.06; wx1 = 0.94; wy0 = 0.4; wy1 = 0.82; }
          if (kind > 2.5) { wx0 = 0.18; wx1 = 0.82; wy0 = 0.28; wy1 = 0.82; }
          if (shop) { wx0 = 0.05; wx1 = 0.95; wy0 = 0.0; wy1 = 0.8; }
          bool skip = h3 < 0.09 && !shop;
          float inW = step(wx0, vx) * step(vx, wx1) * step(wy0, vy) * step(vy, wy1);
          if (abs(u) > halfW - spacing * 0.3) inW = 0.0;
          if (inW > 0.5 && !skip) {
            float bx = min(vx - wx0, wx1 - vx) * spacing, by = min(vy - wy0, wy1 - vy) * FH;
            float frame = 1.0 - step(0.06, min(bx, by));
            float night = clamp(uNight + (1.0 - kVis) * 0.5, 0.0, 1.0);
            float litP = occ * night * (kind > 2.5 ? 0.22 : 0.7) * (0.5 + 0.5 * h2);
            vec3 glass = mix(vec3(0.05, 0.06, 0.07), vec3(0.30, 0.34, 0.38), kVis * (1.0 - uNight) * (0.45 + 0.4 * h3));
            vec3 lc = vec3(0.0);
            if (shop) {
              if (h1 < occ * 0.75) {
                lc = mix(vec3(1.0, 0.82, 0.58), vec3(0.8, 1.0, 0.88), step(0.5, h2));
                float gx = floor(vx * 16.0), gy = floor(vy * 6.0);
                vec3 goods = mix(vec3(0.85, 0.8, 0.7), vec3(kHash(vec3(gx, gy, seed)), kHash(vec3(gy, gx, 3.0 + ci)), kHash(vec3(gx + gy, 7.0, seed))), 0.65);
                float shelf = step(0.82, fract(vy * 6.0));
                vec3 interior = mix(goods, vec3(0.12), shelf);
                interior = mix(interior, vec3(0.05), step(abs(vx - 0.5), 0.08) * step(vy, 0.62)); // the doorway
                col = interior * 0.25;
                kEmis = lc * interior * (0.05 + 0.42 * night);
              } else {
                col = vec3(0.42, 0.43, 0.43) * (0.75 + 0.25 * step(0.5, fract(vy * 22.0)));
                kRough = 0.5;
              }
            } else {
              col = glass; kRough = 0.18;
              if (h1 < litP) {
                float pick = h2;
                if (pick < 0.55) lc = vec3(0.80, 1.0, 0.88);
                else if (pick < 0.84) lc = vec3(1.0, 0.70, 0.40);
                else if (pick < 0.93) lc = vec3(0.45, 0.62, 1.0) * (0.6 + 0.4 * sin(uTime * 11.0 + h3 * 60.0) * sin(uTime * 4.3 + h1 * 20.0));
                else lc = vec3(1.0, 0.22, 0.12);
                float curtain = mix(1.0, 0.45, step(0.6, h3) * smoothstep(0.3, 0.7, abs(vx - 0.5) * 2.0));
                kEmis = lc * (kind > 2.5 ? 0.5 : 1.05) * curtain * (0.7 + 0.5 * h3) * mix(0.4, 1.0, kVis);
                col = lc * 0.12;
              }
              if (style > 0.5 && style < 1.5 && h3 > 0.25) {
                float bars = max(step(fract((vx - wx0) * 8.0), 0.16), step(fract((vy - wy0) * 6.0), 0.14));
                col = mix(col, vec3(0.30, 0.22, 0.17), bars); kEmis *= 1.0 - bars * 0.85;
              }
            }
            col = mix(col, vColorK * 0.55, frame * aa); kEmis *= 1.0 - frame * aa;
            col = mix(mix(wallCol, col, 0.45), col, aa);
            kEmis *= mix(0.2, 1.0, aa);
          } else if (shop && vy > 0.8 && h2 > 0.35) {
            vec3 board = h3 < 0.33 ? vec3(0.7, 0.08, 0.06) : h3 < 0.66 ? vec3(0.85, 0.65, 0.1) : vec3(0.08, 0.3, 0.55);
            col = board; kEmis = board * 0.5 * uNight * occ;
          } else if (kind > 0.5 && kind < 2.5 && vy > 0.08 && vy < 0.16 && h2 > 0.5) {
            col *= 0.6;
          }
          // the alleys: fluorescent spill near the ground
          float spill = alleyGlow * (1.0 - kVis) * exp(-vWP.y * 0.45);
          kEmis += vec3(0.55, 0.85, 0.7) * spill * 0.14;
          kRough = mix(kRough, 0.25, uWet * 0.5);
        }
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = kRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += kEmis;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.12, 1.0, kVis);
        reflectedLight.indirectSpecular *= kVis;
        reflectedLight.directDiffuse *= mix(0.3, 1.0, kVis);`);
  };
  m.customProgramCacheKey = () => 'kwc-building';
  return m;
}

// Bamboo scaffolding: a lattice cut out of a box.
export function makeScaffoldMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xc8a463, roughness: 0.8, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP2;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 sw = vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        sw = instanceMatrix * sw;
        #endif
        vWP2 = (modelMatrix * sw).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP2;\n${GLSL_LIB}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hz = abs(vNormal.y) > 0.5 ? 0.0 : 1.0;
        float a = vWP2.x + vWP2.z;
        float pv = step(fract(a / 1.25), 0.06);
        float ph = step(fract(vWP2.y / 1.4), 0.05);
        float pd = step(fract((a + vWP2.y) / 4.0), 0.025);
        float net = step(0.5, kNoise(floor(vec2(a, vWP2.y) / 2.2) + 3.0));
        float mesh = net * step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.5));
        if (max(max(pv, ph), pd) < 0.5 && mesh < 0.5) discard;
        if (max(max(pv, ph), pd) < 0.5) diffuseColor.rgb = vec3(0.12, 0.32, 0.16);`);
  };
  m.customProgramCacheKey = () => 'kwc-scaffold';
  return m;
}

// --- signs -----------------------------------------------------------------

export const SIGN_COLS = 10, SIGN_ROWS = 6;

export function makeSignAtlas(fontFamily) {
  const cw = 128, ch = 384;
  const c = document.createElement('canvas');
  c.width = cw * SIGN_COLS; c.height = ch * SIGN_ROWS;
  const g = c.getContext('2d');
  const neon = ['#ff2a4d', '#ff4fd8', '#3cf2ff', '#ffe23d', '#54ff7a', '#ff8a1f', '#ffffff'];
  const boxBg = ['#f4efe2', '#d8241f', '#ffd400', '#1b6fd1', '#14824b', '#111111'];
  const kinds = [];
  for (let i = 0; i < SIGN_COLS * SIGN_ROWS; i++) {
    const [word, kind] = SIGN_WORDS[i % SIGN_WORDS.length];
    const x = (i % SIGN_COLS) * cw, y = Math.floor(i / SIGN_COLS) * ch;
    const isNeon = kind === 'neon' ? i % 4 !== 3 : i % 5 === 0;
    kinds.push(isNeon ? 1 : 0);
    g.save();
    g.translate(x, y);
    const n = word.length;
    const fs = Math.min(100, (ch - 60) / n);
    if (isNeon) {
      const hue = neon[(i * 7) % neon.length];
      g.fillStyle = '#0b0b0e'; g.fillRect(6, 6, cw - 12, ch - 12);
      g.strokeStyle = neon[(i * 3 + 2) % neon.length]; g.lineWidth = 5;
      g.shadowColor = g.strokeStyle; g.shadowBlur = 14;
      g.strokeRect(14, 14, cw - 28, ch - 28);
      g.font = `900 ${fs}px ${fontFamily}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < n; k++) {
        const ty = ch / 2 + (k - (n - 1) / 2) * fs * 1.04;
        g.shadowColor = hue; g.shadowBlur = 22; g.strokeStyle = hue; g.lineWidth = 4;
        g.strokeText(word[k], cw / 2, ty);
        g.shadowBlur = 6; g.fillStyle = '#ffffff'; g.globalAlpha = 0.85;
        g.fillText(word[k], cw / 2, ty); g.globalAlpha = 1;
      }
    } else {
      const bg = boxBg[(i * 5) % boxBg.length];
      g.fillStyle = bg; g.fillRect(4, 4, cw - 8, ch - 8);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 6; g.strokeRect(10, 10, cw - 20, ch - 20);
      g.font = `900 ${fs}px ${fontFamily}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = bg === '#f4efe2' || bg === '#ffd400' ? '#c8102e' : '#ffffff';
      for (let k = 0; k < n; k++) g.fillText(word[k], cw / 2, ch / 2 + (k - (n - 1) / 2) * fs * 1.04);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, kinds };
}

export function makeSignMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, ...U, ...THREE.UniformsLib.fog, uDay: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 aSign; // atlas cell, neon flag, flicker seed, on (0..1)
      varying vec2 vUv; varying vec3 vS;
      #include <fog_pars_vertex>
      void main(){
        float cell = aSign.x;
        vec2 cr = vec2(mod(cell, ${SIGN_COLS}.0), floor(cell / ${SIGN_COLS}.0));
        vUv = (cr + vec2(uv.x, 1.0 - uv.y)) / vec2(${SIGN_COLS}.0, ${SIGN_ROWS}.0);
        vUv.y = 1.0 - vUv.y;
        vS = aSign.yzw;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float uNight; uniform float uTime; uniform float uDay;
      varying vec2 vUv; varying vec3 vS;
      #include <fog_pars_fragment>
      void main(){
        vec4 t = texture2D(map, vUv);
        float neon = vS.x, seed = vS.y, on = vS.z;
        float fl = 1.0;
        if (seed > 0.85) fl = step(0.25, fract(sin(floor(uTime * 9.0 + seed * 40.0)) * 43758.5));
        float glow = on * fl;
        vec3 c;
        if (neon > 0.5) {
          c = t.rgb * mix(0.35, 3.2 * glow, uNight) * mix(0.6, 1.0, glow) + t.rgb * uDay * 0.25;
        } else {
          c = t.rgb * (uDay * 0.9 + 0.08) + t.rgb * uNight * 1.2 * glow;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    side: THREE.DoubleSide,
  });
}
