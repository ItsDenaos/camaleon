import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'temperature',
  name: 'Cálido / frío',
  order: 28,
  params: [
    { key: 'temperature', label: 'Temperatura', min: -1, max: 1, step: 0.01, default: 0.45 },
    { key: 'tint', label: 'Matiz', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'saturation', label: 'Saturación', min: 0, max: 2, step: 0.01, default: 1.15 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      float t = u_temperature;
      // > 0 warms (more red, less blue); < 0 cools.
      c *= vec3(1.0 + 0.22 * t, 1.0 + 0.04 * t, 1.0 - 0.28 * t);
      // > 0 magenta, < 0 green.
      c *= vec3(1.0 + 0.08 * u_tint, 1.0 - 0.12 * u_tint, 1.0 + 0.08 * u_tint);
      c = mix(vec3(luma(c)), c, u_saturation);
      outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
});
