// WebGL2. Every mesh is drawn instanced: one instance per copy of the room in the universal cover.
import { STRIDE } from './mesh.js';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec2 aUV;
layout(location = 4) in vec2 aFace;
layout(location = 5) in vec4 aInst;      // deck transformation: sx, sz, tx, tz
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vNrm;
out vec3 vCol;
out vec2 vUV;
out vec2 vFace;
out vec3 vWorld;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  vPos = p.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol;
  vUV = aUV;
  vFace = aFace;
  vWorld = vec3(aInst.x * p.x + aInst.z, p.y, aInst.y * p.z + aInst.w);
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNrm;
in vec3 vCol;
in vec2 vUV;
in vec2 vFace;
in vec3 vWorld;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform vec3 uFog;
uniform float uFogDist;
uniform int uMode;        // 0 lit, 1 glow, 2 multiply decal
uniform float uGlow;
out vec4 o;
void main() {
  vec3 tex = texture(uTex, vUV).rgb;
  float dist = length(vWorld - uEye);
  float fog = 1.0 - exp(-pow(dist / uFogDist, 1.6));
  if (uMode == 2) { o = vec4(mix(tex, vec3(1.0), fog), 1.0); return; }
  if (uMode == 1) {
    vec3 g = mix(vec3(1.0, 0.985, 0.95), vec3(1.0), 0.5 + 0.5 * sin(vPos.y * 3.0 + uGlow * 6.0));
    o = vec4(mix(g, uFog, fog * 0.5), 1.0);
    return;
  }
  vec3 albedo = vCol * tex;
  // lighting lives in the room's own frame, so every copy (mirrored or not) is lit like the room
  vec3 n = normalize(vNrm);
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(vec3(0.74, 0.72, 0.7), vec3(1.0, 0.996, 0.988), hemi);
  float key = max(dot(n, normalize(vec3(0.36, 0.86, 0.36))), 0.0);
  float side = max(dot(n, normalize(vec3(-0.6, 0.2, -0.3))), 0.0);
  vec3 col = albedo * (amb * 0.8 + vec3(1.0, 0.97, 0.93) * key * 0.3 + vec3(0.9, 0.94, 1.0) * side * 0.06);
  if (abs(n.y) < 0.5) col *= 1.0 - 0.3 * exp(-vPos.y * 2.6);
  if (vFace.x >= 0.0) {
    vec2 d = min(vFace, 1.0 - vFace);
    vec2 fw = max(fwidth(vFace), vec2(1e-5));
    float e = min(d.x / fw.x, d.y / fw.y);
    float line = 1.0 - smoothstep(0.55, 1.55, e);
    col = mix(col, vec3(0.12, 0.12, 0.14), line * 0.7);
  }
  o = vec4(mix(col, uFog, fog), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This needs WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.u = {};
    for (const n of ['uVP', 'uModel', 'uTex', 'uEye', 'uFog', 'uFogDist', 'uMode', 'uGlow']) this.u[n] = gl.getUniformLocation(p, n);
    this.instRoom = gl.createBuffer();
    this.instAvatar = gl.createBuffer();
    this.instOne = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instOne);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, 0, 0]), gl.STATIC_DRAW);
    this.tex = null;
    this.maxDpr = 2;
    this.scale = 1;
    this.n = 0;
  }

  mesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, data.verts, gl.STATIC_DRAW);
    const F = 4 * STRIDE;
    const attr = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, F, off * 4); };
    attr(0, 3, 0); attr(1, 3, 3); attr(2, 3, 6); attr(3, 2, 9); attr(4, 2, 11);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vb, ib, count: data.count };
  }

  free(m) {
    if (!m) return;
    const gl = this.gl;
    gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib);
  }

  setAtlas(canvas) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }

  setInstances(buf, list) {
    const gl = this.gl;
    const a = new Float32Array(list.length * 4);
    list.forEach((g, k) => a.set([g.sx, g.sz, g.tx, g.tz], k * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW);
    return list.length;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr) * this.scale;
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return { w, h };
  }

  adapt(dt) {
    this.ft = (this.ft || 16) * 0.94 + dt * 1000 * 0.06;
    if (++this.n % 50) return;
    if (this.ft > 26) this.scale = Math.max(0.5, this.scale * 0.86);
    else if (this.ft < 15) this.scale = Math.min(1, this.scale * 1.06);
  }

  begin(view) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(view.fog[0], view.fog[1], view.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE); // mirrored copies reverse the winding
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, view.vp);
    gl.uniform3fv(this.u.uEye, view.eye);
    gl.uniform3fv(this.u.uFog, view.fog);
    gl.uniform1f(this.u.uFogDist, view.fogDist);
    gl.uniform1f(this.u.uGlow, view.time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uTex, 0);
  }

  draw(m, instBuf, count, model, mode = 0) {
    if (!m || !count) return;
    const gl = this.gl;
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(5, 1);
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform1i(this.u.uMode, mode);
    if (mode === 2) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -2);
    }
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, count);
    if (mode === 2) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    gl.bindVertexArray(null);
  }
}

// ---------------------------------------------------------------- mat4 helpers (column-major)
export const M4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  translate: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
  // rotation about y carrying local +z onto (sin a, 0, cos a)
  placeY(x, y, z, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookDir(eye, f) {
    const up = [0, 1, 0];
    const r = norm(cross(f, up)), u = cross(r, f);
    return new Float32Array([
      r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1,
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
};
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); }
