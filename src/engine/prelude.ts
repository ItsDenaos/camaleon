import { FACE_POINTS, MAX_FACES, type EffectDef } from './types';

/**
 * Prepended to every effect pass. Keep helpers small and pure; effects may rely on them.
 * Coordinates: v_uv in [0,1], (0,0) = bottom-left (GL convention).
 */
const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_input;   // previous pass output
uniform sampler2D u_source;  // this effect's input, before its first pass
uniform vec2 u_resolution;   // output size of this pass, in px
uniform float u_time;        // seconds

#define PI 3.14159265359
#define TAU 6.28318530718

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/** Width/height of the output. Multiply uv.x by it to get a square-pixel space. */
float aspect() { return u_resolution.x / u_resolution.y; }

/** uv mapped to a space where y spans [0,1] and x keeps square proportions, centered at 0. */
vec2 centered(vec2 uv) { return (uv - 0.5) * vec2(aspect(), 1.0); }
vec2 uncentered(vec2 p) { return p / vec2(aspect(), 1.0) + 0.5; }

/** Cheap hash in [0,1). Stable across GPUs for moderate input magnitudes. */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Smooth value noise in [0,1]. */
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

/** One "720p pixel" in uv units: 1/720 of the image height. Use for resolution-independent offsets. */
vec2 hpx() { return vec2(1.0 / (720.0 * aspect()), 1.0 / 720.0); }

/** Sobel gradient magnitude of luma around uv; "px" = sample spacing in uv units. */
float sobel(sampler2D tex, vec2 uv, vec2 px) {
  float tl = luma(texture(tex, uv + px * vec2(-1.0,  1.0)).rgb);
  float tc = luma(texture(tex, uv + px * vec2( 0.0,  1.0)).rgb);
  float tr = luma(texture(tex, uv + px * vec2( 1.0,  1.0)).rgb);
  float ml = luma(texture(tex, uv + px * vec2(-1.0,  0.0)).rgb);
  float mr = luma(texture(tex, uv + px * vec2( 1.0,  0.0)).rgb);
  float bl = luma(texture(tex, uv + px * vec2(-1.0, -1.0)).rgb);
  float bc = luma(texture(tex, uv + px * vec2( 0.0, -1.0)).rgb);
  float br = luma(texture(tex, uv + px * vec2( 1.0, -1.0)).rgb);
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  return length(vec2(gx, gy));
}

/** uv folded back into [0,1] like a mirror, so displaced lookups never hit a hard edge. */
vec2 mirrorRepeat(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }

// --- AI data (real values only for effects that declare needs; unused ones compile away) ---

uniform sampler2D u_mask;
uniform float u_hasMask;
uniform float u_aiMirror;

/** Person probability at uv: 1 = person, 0 = background (and 0 until the model is ready). */
float personMask(vec2 uv) {
  if (u_hasMask < 0.5) return 0.0;
  return texture(u_mask, vec2(mix(uv.x, 1.0 - uv.x, u_aiMirror), 1.0 - uv.y)).r;
}

#define MAX_FACES ${MAX_FACES}
// Key points, already in face units (screen left/right, after mirroring).
#define FP_NOSE 0
#define FP_LIP 1
#define FP_MOUTH_L 2
#define FP_MOUTH_R 3
#define FP_CHIN 4
#define FP_FOREHEAD 5
#define FP_CHEEK_L 6
#define FP_CHEEK_R 7

uniform float u_faceCount;
uniform vec2 u_faceC[MAX_FACES];
uniform vec2 u_faceX[MAX_FACES];
uniform vec2 u_facePts[MAX_FACES * ${FACE_POINTS}];

/**
 * centered() space → face units of face i: the eyes sit at (-0.5, 0) and (0.5, 0),
 * one unit = the distance between the eyes, y points to the forehead. Isotropic, so
 * circles stay round; it follows head roll, size and position.
 */
vec2 faceIso(int i, vec2 p) {
  vec2 d = p - u_faceC[i];
  vec2 x = u_faceX[i];
  return vec2(dot(d, x), dot(d, vec2(-x.y, x.x))) / dot(x, x);
}

/** One output pixel measured in face units (for antialiasing edges). */
float facePx(int i) { return 1.0 / (u_resolution.y * length(u_faceX[i])); }

vec2 facePoint(int i, int k) { return u_facePts[i * ${FACE_POINTS} + k]; }
`;

/** Full fragment source for one pass: prelude + auto-declared uniforms + effect body. */
export function buildFragment(def: EffectDef, body: string): string {
  const decls: string[] = [];
  for (const p of def.params) decls.push(`uniform float u_${p.key};`);
  for (const name of Object.keys(def.textures ?? {})) decls.push(`uniform sampler2D ${name};`);
  for (const img of def.images ?? []) {
    decls.push(`uniform sampler2D u_${img.key};`, `uniform float u_${img.key}Set;`);
  }
  return `${PRELUDE}\n// --- ${def.id} ---\n${decls.join('\n')}\n${body}\n`;
}
