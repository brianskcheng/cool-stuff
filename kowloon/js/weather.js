// Rain that follows the camera, and the typhoon-season storms.

import * as THREE from 'three';
import { U } from './facade.js';
import { lerp } from './rng.js';

const STATES = { clear: { cloud: 0.08, rain: 0 }, cloudy: { cloud: 0.6, rain: 0 }, rain: { cloud: 0.85, rain: 0.65 }, storm: { cloud: 1, rain: 1 } };

export class Weather {
  constructor(scene) {
    const N = 14000;
    const base = new Float32Array(N * 2 * 4);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const b = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) { base.set(b, (i * 2 + k) * 4); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.u = { uCam: { value: new THREE.Vector3() }, uRainK: { value: 0 }, uT: { value: 0 }, uNightK: { value: 0 }, uWind: { value: new THREE.Vector2(3, 1.5) } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: `attribute vec4 aBase; attribute float aEnd; uniform vec3 uCam; uniform float uRainK, uT; uniform vec2 uWind; varying float vA;
        void main(){
          vec3 B = vec3(120.0, 70.0, 120.0);
          vec3 p = aBase.xyz * B;
          p.y -= uT * 30.0; p.xz += uWind * uT;
          p = mod(p - uCam + B * 0.5, B) + uCam - B * 0.5;
          vec3 v = normalize(vec3(uWind.x, -30.0, uWind.y));
          p += v * aEnd * 1.1;
          vA = step(aBase.w, uRainK) * (0.35 + 0.65 * aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `varying float vA; uniform float uNightK; void main(){ if (vA < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.75,0.78,0.82), vec3(0.55,0.5,0.45), uNightK), vA * 0.32); }`,
      transparent: true, depthWrite: false,
    }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.mode = 'auto';
    this.state = 'clear';
    this.cloud = 0.1; this.rainK = 0; this.wet = 0;
    this.timer = 25;
    this.flash = 0;
    this.onThunder = null;
  }
  set(mode) { this.mode = mode; if (mode !== 'auto') this.state = mode; }
  update(dt, camPos, night) {
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer < 0) {
        const r = Math.random();
        this.state = r < 0.42 ? 'clear' : r < 0.67 ? 'cloudy' : r < 0.9 ? 'rain' : 'storm';
        this.timer = 25 + Math.random() * 35;
      }
    }
    const target = STATES[this.state];
    const k = 1 - Math.exp(-dt * 0.35);
    this.cloud = lerp(this.cloud, target.cloud, k);
    this.rainK = lerp(this.rainK, target.rain, k);
    this.wet = this.rainK > this.wet ? lerp(this.wet, this.rainK, 1 - Math.exp(-dt * 0.8)) : Math.max(this.rainK, this.wet - dt * 0.02);
    if (this.state === 'storm' && this.rainK > 0.6 && Math.random() < dt * 0.12) {
      this.flash = 1;
      if (this.onThunder) this.onThunder(0.6 + Math.random() * 2.5);
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const flicker = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(performance.now() * 0.05)) : 0;
    U.uFlash.value = flicker;
    U.uWet.value = this.wet;
    this.u.uCam.value.copy(camPos);
    this.u.uRainK.value = this.rainK;
    this.u.uT.value += dt;
    this.u.uNightK.value = night;
    this.rain.visible = this.rainK > 0.01;
  }
}
