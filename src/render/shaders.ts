/**
 * Input pass: camera frame (top-left origin, as uploaded) → GL convention
 * (bottom-left origin) at processing resolution, with optional mirror.
 */
export const INPUT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_video;
uniform float u_mirror;
void main() {
  vec2 uv = vec2(mix(v_uv.x, 1.0 - v_uv.x, u_mirror), 1.0 - v_uv.y);
  outColor = vec4(texture(u_video, uv).rgb, 1.0);
}
`;

/**
 * Output pass: draws a processed frame into the current viewport (whole canvas, or one
 * gallery cell). u_uvScale > 1 letterboxes (contain), < 1 crops (cover).
 * u_corner > 0 rounds the viewport corners (radius in px; u_viewSize = viewport px).
 */
export const OUTPUT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_input;
uniform vec2 u_uvScale;
uniform vec3 u_bg;
uniform vec2 u_viewSize;
uniform float u_corner;
void main() {
  vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;
  bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  vec3 col = outside ? u_bg : texture(u_input, uv).rgb;
  if (u_corner > 0.0) {
    vec2 q = abs(v_uv - 0.5) * u_viewSize - (0.5 * u_viewSize - u_corner);
    float d = length(max(q, 0.0)) - u_corner;   // > 0 outside the rounded rect
    col = mix(col, u_bg, clamp(d + 0.5, 0.0, 1.0));
  }
  outColor = vec4(col, 1.0);
}
`;
