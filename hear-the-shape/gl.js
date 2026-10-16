// WebGL2 renderer: the soap film (height field + thin-film interference), its wire, and dust.

const MEMBRANE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_uv;
uniform mat4 u_vp;
uniform vec4 u_rect;      // render rect in local units: x, y, w, h
uniform vec2 u_offset;    // local -> world
uniform vec4 u_grid;      // x0, y0, h, -
uniform vec2 u_gsize;     // nx, ny
uniform sampler2D u_height;
uniform sampler2D u_sdf;
uniform float u_hscale;
out vec3 v_world;
out vec3 v_normal;
out vec2 v_uv;
out vec2 v_local;
out float v_h;

// cubic B-spline through four bilinear taps (node i sits at texel centre i)
float bspline(vec2 p) {
  vec2 idx = floor(p);
  vec2 f = p - idx;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (idx - 1.0 + w1 / g0 + 0.5) / u_gsize;
  vec2 h1 = (idx + 1.0 + w3 / g1 + 0.5) / u_gsize;
  return g0.y * (g0.x * texture(u_height, h0).r + g1.x * texture(u_height, vec2(h1.x, h0.y)).r)
       + g1.y * (g0.x * texture(u_height, vec2(h0.x, h1.y)).r + g1.x * texture(u_height, h1).r);
}

float heightAt(vec2 local) {
  vec2 p = (local - u_grid.xy) / u_grid.z;
  vec2 suv = (local - u_rect.xy) / u_rect.zw;
  float sdf = texture(u_sdf, suv).r;
  float pin = clamp(-sdf / (1.4 * u_grid.z), 0.0, 1.0);
  float h = bspline(p) * u_hscale;
  return 0.16 * tanh(h / 0.16) * pin;
}

void main() {
  vec2 local = u_rect.xy + a_uv * u_rect.zw;
  float e = u_grid.z * 0.6;
  float h = heightAt(local);
  float hx = heightAt(local + vec2(e, 0.0)) - heightAt(local - vec2(e, 0.0));
  float hy = heightAt(local + vec2(0.0, e)) - heightAt(local - vec2(0.0, e));
  v_normal = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
  v_world = vec3(local + u_offset, h);
  v_uv = a_uv;
  v_local = local;
  v_h = h;
  gl_Position = u_vp * vec4(v_world, 1.0);
}`;

const MEMBRANE_FS = `#version 300 es
precision highp float;
in vec3 v_world;
in vec3 v_normal;
in vec2 v_uv;
in vec2 v_local;
in float v_h;
uniform sampler2D u_sdf;
uniform vec3 u_eye;
uniform float u_time;
uniform float u_wire;
uniform float u_alpha;
uniform float u_size;
uniform float u_seed;
uniform float u_wave;          // visual wave speed (world units / s)
uniform vec4 u_strikes[4];     // world x, y, start time, strength
uniform float u_dim;           // 0 normal, 1 = a dark plate so dust reads like sand
out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s / 0.875;
}

// reflectance of a soap film of thickness d (nm), integrated over 8 wavelengths
// (colour-matching weights precomputed and normalised so a flat spectrum is white)
const float LAMBDA[8] = float[8](418.8, 456.2, 493.8, 531.2, 568.8, 606.2, 643.8, 681.2);
const vec3 CMF[8] = vec3[8](
  vec3(0.02982, 0.00004, 0.20646),
  vec3(0.11130, 0.00382, 0.69121),
  vec3(0.00181, 0.07843, 0.10167),
  vec3(0.02531, 0.37660, 0.00066),
  vec3(0.23090, 0.42302, 0.00000),
  vec3(0.42772, 0.11115, 0.00000),
  vec3(0.16087, 0.00683, 0.00000),
  vec3(0.01228, 0.00010, 0.00000));
vec3 thinFilm(float d, float cosI) {
  float n = 1.33;
  float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / (n * n));
  float opd = 6.2831853 * 2.0 * n * d * cosT;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) acc += CMF[i] * (0.5 - 0.5 * cos(opd / LAMBDA[i]));
  return acc;
}

vec3 env(vec3 r) {
  // a dark studio: one big softbox the film mirrors, one small hard window for sparkle
  float dome = 0.02 + 0.06 * smoothstep(-0.05, 1.0, r.z);
  vec3 c = vec3(dome);
  vec3 S = normalize(vec3(-0.14, 0.74, 0.66));
  float soft = smoothstep(0.76, 0.99, dot(r, S));
  c += vec3(0.96, 0.94, 0.9) * soft * soft * 0.85;
  vec3 W = normalize(vec3(0.34, 0.78, 0.52));
  c += vec3(1.0, 0.97, 0.92) * smoothstep(0.9955, 0.9993, dot(r, W)) * 4.0;
  return c;
}

void main() {
  float sdf = texture(u_sdf, v_uv).r;
  float aa = fwidth(sdf) * 1.2 + 1e-5;
  float ww = max(u_wire, aa * 0.75);   // never thinner than about a pixel
  float outer = 1.0 - smoothstep(ww - aa, ww + aa, sdf);
  if (outer <= 0.001) discard;

  vec3 V = normalize(u_eye - v_world);
  vec3 N = normalize(v_normal);
  if (dot(N, V) < 0.0) N = -N;
  float cosI = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N);

  // film thickness: slow marbled swirls, drained thinner towards the top, nudged by the motion
  vec2 q = v_local / u_size;
  vec2 warp = vec2(fbm3(q * 2.2 + vec2(u_seed, u_time * 0.018)), fbm3(q * 2.2 + vec2(-u_time * 0.015, u_seed + 3.1)));
  float swirl = fbm(q * 4.6 + 2.4 * warp + vec2(0.0, u_time * 0.03));
  // drainage bands (thin far side, thick near side) marbled by slow convection
  float d = 700.0 - 980.0 * q.y + 560.0 * (swirl - 0.5) + 2600.0 * v_h;
  d = max(d, 150.0);
  vec3 film = thinFilm(d, cosI);
  film = mix(vec3(dot(film, vec3(0.3, 0.45, 0.25))), film, 0.74);
  float fres = 0.2 + 0.8 * pow(1.0 - cosI, 5.0);
  vec3 col = film * env(R) * (0.7 + 1.3 * fres);
  col = mix(col, vec3(dot(col, vec3(0.33))) * 0.55 + vec3(0.012, 0.011, 0.013), u_dim * 0.82);

  // strike wavefronts, travelling at the film's (slowed) wave speed
  for (int i = 0; i < 4; i++) {
    vec4 s = u_strikes[i];
    float age = u_time - s.z;
    if (s.w <= 0.0 || age < 0.0 || age > 2.5) continue;
    float r = u_wave * age;
    float dist = length(v_world.xy - s.xy);
    float ring = exp(-pow((dist - r) / (0.018 + 0.02 * age), 2.0)) * exp(-age * 2.2);
    float core = exp(-pow(dist / 0.03, 2.0)) * exp(-age * 9.0);
    col += vec3(1.0, 0.38, 0.2) * (ring * 0.55 + core * 1.4) * s.w;
  }

  // the wire
  float wire = smoothstep(-ww - aa, -ww + aa, sdf);
  float across = clamp(sdf / ww, -1.0, 1.0);
  float glint = pow(1.0 - abs(across), 3.0);
  vec3 wireCol = vec3(0.62, 0.58, 0.52) * (0.35 + 0.65 * glint) + vec3(1.0, 0.92, 0.8) * pow(glint, 12.0) * 0.6;
  col = mix(col, wireCol, wire);

  o = vec4(col * outer * u_alpha, outer * u_alpha);
}`;

const DUST_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in float a_seed;
uniform mat4 u_vp;
uniform float u_px;
out float v_seed;
void main() {
  gl_Position = u_vp * vec4(a_pos, 1.0);
  gl_PointSize = u_px * (0.75 + 0.6 * a_seed);
  v_seed = a_seed;
}`;

const DUST_FS = `#version 300 es
precision highp float;
in float v_seed;
uniform float u_alpha;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = (1.0 - r) * u_alpha * (0.55 + 0.45 * v_seed);
  vec3 col = mix(vec3(0.93, 0.89, 0.8), vec3(1.0, 0.98, 0.93), v_seed);
  o = vec4(col * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.membrane = program(gl, MEMBRANE_VS, MEMBRANE_FS);
    this.dust = program(gl, DUST_VS, DUST_FS);
    this.slots = [];

    // shared mesh: a fine grid over the unit square
    const R = 200;
    const uv = new Float32Array((R + 1) * (R + 1) * 2);
    for (let j = 0, o = 0; j <= R; j++) for (let i = 0; i <= R; i++) { uv[o++] = i / R; uv[o++] = j / R; }
    const idx = new Uint32Array(R * R * 6);
    for (let j = 0, o = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const a = j * (R + 1) + i, b = a + 1, c = a + R + 1, d = c + 1;
      idx.set([a, b, d, a, d, c], o); o += 6;
    }
    this.meshCount = idx.length;
    this.meshVao = gl.createVertexArray();
    gl.bindVertexArray(this.meshVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  texture(w, h, data) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // drum: { grid:{x0,y0,h,nx,ny}, rect:{x,y,w,h}, sdf, sdfRes, offset, size }
  setDrum(slot, drum) {
    this.clearSlot(slot);
    const gl = this.gl;
    const g = drum.grid;
    const s = {
      drum,
      height: this.texture(g.nx, g.ny, new Float32Array(g.nx * g.ny)),
      sdf: this.texture(drum.sdfRes, drum.sdfRes, drum.sdf),
      dustVao: gl.createVertexArray(),
      dustBuf: gl.createBuffer(),
      dustSeed: gl.createBuffer(),
      dustCount: 0,
      alpha: 1,
    };
    this.slots[slot] = s;
  }

  clearSlot(slot) {
    const s = this.slots[slot];
    if (!s) return;
    const gl = this.gl;
    gl.deleteTexture(s.height); gl.deleteTexture(s.sdf);
    gl.deleteBuffer(s.dustBuf); gl.deleteBuffer(s.dustSeed); gl.deleteVertexArray(s.dustVao);
    this.slots[slot] = null;
  }

  setHeights(slot, u) {
    const s = this.slots[slot];
    if (!s) return;
    const gl = this.gl, g = s.drum.grid;
    gl.bindTexture(gl.TEXTURE_2D, s.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, g.ny, gl.RED, gl.FLOAT, u);
  }

  setDust(slot, xyz, seeds, count) {
    const s = this.slots[slot];
    if (!s) return;
    const gl = this.gl;
    gl.bindVertexArray(s.dustVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, xyz, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (seeds) {
      gl.bindBuffer(gl.ARRAY_BUFFER, s.dustSeed);
      gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
    s.dustCount = count;
  }

  // render scale adapts to frame time, so weaker GPUs trade sharpness for smoothness
  adapt(dt) {
    this.ft = (this.ft || 16) * 0.95 + dt * 1000 * 0.05;
    this.adaptN = (this.adaptN || 0) + 1;
    if (this.adaptN < 45) return;
    this.adaptN = 0;
    const s = this.scale || 1;
    if (this.ft > 24) this.scale = Math.max(0.55, s * 0.85);
    else if (this.ft < 15) this.scale = Math.min(1, s * 1.06);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 1.5) * (this.scale || 1);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr;
    return { w, h, dpr };
  }

  render(view) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const m = this.membrane;
    gl.useProgram(m.p);
    gl.uniformMatrix4fv(m.u.u_vp, false, view.vp);
    gl.uniform3fv(m.u.u_eye, view.eye);
    gl.uniform1f(m.u.u_time, view.time);
    gl.uniform1f(m.u.u_wave, view.wave);
    gl.uniform4fv(m.u.u_strikes, view.strikes);
    gl.uniform1f(m.u.u_dim, view.dim || 0);
    gl.bindVertexArray(this.meshVao);
    for (const s of this.slots) {
      if (!s) continue;
      const d = s.drum, g = d.grid;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.height);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.sdf);
      gl.uniform1i(m.u.u_height, 0);
      gl.uniform1i(m.u.u_sdf, 1);
      gl.uniform4f(m.u.u_rect, d.rect.x, d.rect.y, d.rect.w, d.rect.h);
      gl.uniform2f(m.u.u_offset, d.offset[0], d.offset[1]);
      gl.uniform4f(m.u.u_grid, g.x0, g.y0, g.h, 0);
      gl.uniform2f(m.u.u_gsize, g.nx, g.ny);
      gl.uniform1f(m.u.u_hscale, 1);
      gl.uniform1f(m.u.u_wire, d.wire);
      gl.uniform1f(m.u.u_alpha, s.alpha);
      gl.uniform1f(m.u.u_size, d.size);
      gl.uniform1f(m.u.u_seed, d.seed);
      gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_INT, 0);
    }

    gl.disable(gl.DEPTH_TEST);
    const p = this.dust;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.u_vp, false, view.vp);
    gl.uniform1f(p.u.u_px, view.dustPx);
    for (const s of this.slots) {
      if (!s || !s.dustCount) continue;
      gl.uniform1f(p.u.u_alpha, s.alpha * view.dustAlpha);
      gl.bindVertexArray(s.dustVao);
      gl.drawArrays(gl.POINTS, 0, s.dustCount);
    }
    gl.bindVertexArray(null);
  }
}

// ---------------------------------------------------------------- tiny mat4 (column-major)
export const mat4 = {
  perspective(fovy, aspect, near, far, sx = 0, sy = 0) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, sx, sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  view(eye, right, up, fwd) {
    const z = [-fwd[0], -fwd[1], -fwd[2]];
    return new Float32Array([
      right[0], up[0], z[0], 0,
      right[1], up[1], z[1], 0,
      right[2], up[2], z[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  invert(m) {
    const inv = new Float32Array(16);
    const a = m;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = 1 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
  apply(m, v) {
    const [x, y, z, w = 1] = v;
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w,
      m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    ];
  },
};
