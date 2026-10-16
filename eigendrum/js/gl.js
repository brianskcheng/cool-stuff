// WebGL2 renderer for the membranes and Chladni sand.

const VS_QUAD = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_MEMBRANE = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDisp;
uniform sampler2D uMass;
uniform sampler2D uMask;
uniform vec2 uRes;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec3 uGrid;      // x0, y0, h
uniform ivec2 uSize;     // W, H
uniform vec3 uMassGrid;  // x0, y0, h
uniform vec2 uMassSize;
uniform float uHasMass;
uniform float uNodal;
uniform float uRelief;
uniform float uTime;
uniform float uGlow;
uniform vec3 uTint;
uniform float uTintAmt;
out vec4 outColor;

vec2 fetchU(ivec2 p) {
  ivec2 q = clamp(p, ivec2(0), uSize - 1);
  float inside = (p == q) ? 1.0 : 0.0;
  return texelFetch(uDisp, q, 0).rg * inside;
}

void bspline(float t, out vec4 w, out vec4 dw) {
  float s = 1.0 - t;
  float t2 = t * t, t3 = t2 * t;
  w = vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
  dw = vec4(-3.0 * s * s, 9.0 * t2 - 12.0 * t, -9.0 * t2 + 6.0 * t + 3.0, 3.0 * t2) / 6.0;
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float mask = texture(uMask, frag / uRes).r;
  if (mask < 0.002) discard;
  vec2 world = (frag - uOrigin) / uScale;
  vec2 g = (world - uGrid.xy) / uGrid.z;
  vec2 gi = floor(g);
  vec2 f = g - gi;
  vec4 wx, dwx, wy, dwy;
  bspline(f.x, wx, dwx);
  bspline(f.y, wy, dwy);
  ivec2 b = ivec2(gi) - 1;
  float u = 0.0, ux = 0.0, uy = 0.0;
  float m = 0.0, mx = 0.0, my = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 v = fetchU(b + ivec2(i, j));
      float w0 = wx[i] * wy[j], w1 = dwx[i] * wy[j], w2 = wx[i] * dwy[j];
      u += v.x * w0; ux += v.x * w1; uy += v.x * w2;
      m += v.y * w0; mx += v.y * w1; my += v.y * w2;
    }
  }
  // relief lighting: a black lacquered head under two soft studio lights
  vec3 n = normalize(vec3(-ux * uRelief, -uy * uRelief, 1.0));
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
  float grain = hash(floor(world * 900.0)) * 0.5 + hash(floor(world * 260.0 + 3.1)) * 0.5;
  float diff = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  vec3 base = vec3(0.046, 0.047, 0.053) * (0.6 + 0.5 * diff) + (grain - 0.5) * 0.010;
  float tilt = length(R.xy);
  float sky = smoothstep(-0.9, 0.9, R.y * 0.8 - R.x * 0.5);
  vec3 env = mix(vec3(0.015, 0.02, 0.03), vec3(0.17, 0.14, 0.11), sky) * smoothstep(0.0, 0.55, tilt);
  float key = smoothstep(0.36, 0.10, length((R.xy - vec2(-0.32, 0.42)) * vec2(1.0, 1.3)));
  float fill = smoothstep(0.26, 0.06, length(R.xy - vec2(0.48, -0.28)));
  float a = clamp(abs(u), 0.0, 2.0);
  vec3 warm = vec3(1.00, 0.60, 0.26);
  vec3 cool = vec3(0.20, 0.62, 0.98);
  vec3 tint = (u > 0.0 ? warm : cool) * (1.0 - exp(-a * 1.6)) * uTintAmt;
  vec3 col = base + env + tint + vec3(1.0, 0.88, 0.70) * key * 0.7 + vec3(0.6, 0.78, 1.0) * fill * 0.26;

  // nodal lines: distance to the zero set ~ |u| / |grad u|
  float gm = length(vec2(mx, my));
  float d = abs(m) / (gm + 1e-5);
  float line = exp(-d * d * 6.0) * smoothstep(0.004, 0.03, gm);
  col += uNodal * line * vec3(1.0, 0.86, 0.55) * 1.4;
  col += uGlow * uTint * 0.05;

  if (uHasMass > 0.5) {
    vec2 mg = (world - uMassGrid.xy) / uMassGrid.z;
    float extra = texture(uMass, (mg + 0.5) / uMassSize).r - 1.0;
    float k = 1.0 - exp(-max(extra, 0.0) * 0.55);
    vec3 ink = vec3(0.012, 0.011, 0.013) + vec3(1.0, 0.9, 0.8) * key * 0.35;
    float edge = clamp(length(vec2(dFdx(k), dFdy(k))) * 5.0, 0.0, 1.0);
    col = mix(col, ink, k * 0.93) + edge * vec3(1.0, 0.8, 0.5) * 0.12;
  }
  col = col / (1.0 + col * 0.25);
  outColor = vec4(col * mask, mask);
}`;

const VS_SAND = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uSize;
void main() {
  vec2 frag = aPos * uScale + uOrigin;
  gl_Position = vec4(frag / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const FS_SAND = `#version 300 es
precision mediump float;
uniform float uAlpha;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c)) * uAlpha;
  outColor = vec4(vec3(0.98, 0.9, 0.74) * a, a);
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.mem = program(gl, VS_QUAD, FS_MEMBRANE);
    this.sand = program(gl, VS_SAND, FS_SAND);
    this.vao = gl.createVertexArray();
    this.sandVao = gl.createVertexArray();
    this.sandBuf = gl.createBuffer();
    gl.bindVertexArray(this.sandVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sandBuf);
    const loc = gl.getAttribLocation(this.sand.p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.maskTex = this.makeTex(gl.LINEAR);
    this.blank = this.makeTex(gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1]));
  }

  makeTex(filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  uploadMask(canvas2d) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // Float field (W*H) -> R16F texture. Allocates on first use / size change.
  uploadField(holder, key, data, W, H, filter, channels = 1) {
    const gl = this.gl;
    const ifmt = channels === 2 ? gl.RG16F : gl.R16F, fmt = channels === 2 ? gl.RG : gl.RED;
    let t = holder[key];
    if (!t || t._w !== W || t._h !== H || t._c !== channels) {
      if (t) gl.deleteTexture(t);
      t = this.makeTex(filter);
      t._w = W; t._h = H; t._c = channels;
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, W, H, 0, fmt, gl.FLOAT, data);
      holder[key] = t;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, fmt, gl.FLOAT, data);
    }
    return t;
  }

  render(frame) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ox = frame.view.cx, oy = H - frame.view.cy, s = frame.view.s;

    const m = this.mem;
    gl.useProgram(m.p);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(m.u.uRes, W, H);
    gl.uniform2f(m.u.uOrigin, ox, oy);
    gl.uniform1f(m.u.uScale, s);
    gl.uniform1f(m.u.uTime, frame.time);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(m.u.uMask, 2);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    for (const d of frame.drums) {
      if (!d.tex) continue;
      const [sx, sy, sw, sh] = d.scissor;
      gl.scissor(sx, H - sy - sh, sw, sh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.tex);
      gl.uniform1i(m.u.uDisp, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, d.massTex || this.blank);
      gl.uniform1i(m.u.uMass, 1);
      gl.uniform3f(m.u.uGrid, d.grid.x0, d.grid.y0, d.grid.h);
      gl.uniform2i(m.u.uSize, d.grid.W, d.grid.H);
      if (d.massGrid) {
        gl.uniform3f(m.u.uMassGrid, d.massGrid.x0, d.massGrid.y0, d.massGrid.h);
        gl.uniform2f(m.u.uMassSize, d.massGrid.W, d.massGrid.H);
      }
      gl.uniform1f(m.u.uHasMass, d.massTex ? 1 : 0);
      gl.uniform1f(m.u.uNodal, d.nodal);
      gl.uniform1f(m.u.uRelief, d.relief);
      gl.uniform1f(m.u.uGlow, d.glow || 0);
      gl.uniform3f(m.u.uTint, 1, 0.8, 0.5);
      gl.uniform1f(m.u.uTintAmt, d.tint);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);

    if (frame.sand && frame.sandCount > 0) {
      const sp = this.sand;
      gl.useProgram(sp.p);
      gl.bindVertexArray(this.sandVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sandBuf);
      gl.bufferData(gl.ARRAY_BUFFER, frame.sand.subarray(0, frame.sandCount * 2), gl.DYNAMIC_DRAW);
      gl.uniform2f(sp.u.uRes, W, H);
      gl.uniform2f(sp.u.uOrigin, ox, oy);
      gl.uniform1f(sp.u.uScale, s);
      gl.uniform1f(sp.u.uSize, frame.sandSize);
      gl.uniform1f(sp.u.uAlpha, frame.sandAlpha);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, frame.sandCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
