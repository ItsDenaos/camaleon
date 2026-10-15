import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'comic',
  name: 'Cómic',
  order: 55,
  params: [
    { key: 'dotSize', label: 'Trama', min: 0.005, max: 0.03, step: 0.001, default: 0.011 },
    { key: 'ink', label: 'Tinta', min: 0, max: 1, step: 0.01, default: 0.65 },
    { key: 'levels', label: 'Colores', min: 2, max: 8, step: 1, default: 4 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;

      // Flat, punchy colours: boost saturation, posterize brightness only (hues survive).
      vec3 hsv = rgb2hsv(c);
      hsv.y = min(1.0, hsv.y * 1.35);
      float n = u_levels - 1.0;
      hsv.z = floor(hsv.z * n + 0.5) / n;
      vec3 base = mix(hsv2rgb(hsv), vec3(1.0, 0.97, 0.9), 0.06);

      // Halftone shading on a 45° grid: bigger dots where the image is darker.
      vec2 grid = mat2(0.7071, -0.7071, 0.7071, 0.7071) * centered(v_uv) / u_dotSize;
      float radius = sqrt(clamp(1.0 - luma(c), 0.0, 1.0)) * 0.62;
      float aa = 1.5 / (u_dotSize * u_resolution.y);
      float dots = 1.0 - smoothstep(radius - aa, radius + aa, length(fract(grid) - 0.5));
      base = mix(base, base * 0.3, dots * 0.7);

      // Ink outlines from luma edges.
      float e = sobel(u_input, v_uv, hpx() * 1.5);
      float lines = smoothstep(0.3, 0.65, e * (0.3 + u_ink * 1.7)) * step(0.01, u_ink);
      outColor = vec4(mix(base, vec3(0.04, 0.03, 0.06), lines), 1.0);
    }
  `,
});
