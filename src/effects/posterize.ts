import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'posterize',
  name: 'Posterizar',
  order: 32,
  params: [
    { key: 'levels', label: 'Niveles', min: 2, max: 12, step: 1, default: 4 },
    { key: 'dither', label: 'Tramado', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'saturation', label: 'Saturación', min: 0, max: 2, step: 0.01, default: 1.25 },
  ],
  fragment: /* glsl */ `
    const float BAYER[16] = float[16](
      0.0, 8.0, 2.0, 10.0,
      12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0,
      15.0, 7.0, 13.0, 5.0);

    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      c = mix(vec3(luma(c)), c, u_saturation);
      // 4×4 ordered dither on a grid tied to image height (≈360 cells), so captures match.
      ivec2 m = ivec2(mod(floor(centered(v_uv) * 360.0), 4.0));
      float b = BAYER[m.x + m.y * 4] / 16.0 - 0.47;
      float n = u_levels - 1.0;
      c = floor(clamp(c, 0.0, 1.0) * n + 0.5 + b * u_dither) / n;
      outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
});
