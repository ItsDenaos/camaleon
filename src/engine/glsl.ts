/**
 * Reusable GLSL snippets that effects can paste into their fragment source
 * (the prelude stays small; only effects that import these pay for them).
 */

/** 2D signed distance functions (negative inside) and compositing helpers. */
export const SDF = /* glsl */ `
float dot2(vec2 v) { return dot(v, v); }

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float sdCircle(vec2 p, float r) { return length(p) - r; }

/** Approximate, but good enough for antialiased fills. */
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

/** Heart with its tip at the origin, about 1.2 wide and 1.1 tall. */
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

/** Smooth union. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/** Coverage of a shape with an antialiased edge "aa" wide. */
float fillAA(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

/** Premultiplied "over": paints rgb with coverage a on top of dst. */
vec4 over(vec4 dst, vec3 rgb, float a) {
  return vec4(rgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}
`;

/**
 * main() for face filters: the effect defines
 *   vec4 overlay(int face, vec2 q, float aa)   // premultiplied colour
 * where q is in face units (eyes at (±0.5, 0)) and aa is one pixel in those units.
 */
export const FACE_OVERLAY_MAIN = /* glsl */ `
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  vec2 p = centered(v_uv);
  for (int i = 0; i < MAX_FACES; i++) {
    if (float(i) >= u_faceCount) break;
    vec4 g = overlay(i, faceIso(i, p), facePx(i));
    c = c * (1.0 - g.a) + g.rgb;
  }
  outColor = vec4(c, 1.0);
}
`;

/** Person/background compositing edge: feathered threshold of the person mask. */
export const MASK_EDGE = /* glsl */ `
float personAlpha(vec2 uv, float feather) {
  if (u_hasMask < 0.5) return 1.0; // model not ready yet: keep the camera image
  return smoothstep(0.5 - feather, 0.5 + feather, personMask(uv));
}
`;
