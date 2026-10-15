import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'invert',
  name: 'Negativo',
  order: 25,
  params: [
    { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'keepHue', label: 'Mantener colores', min: 0, max: 1, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      vec3 inv = 1.0 - c;
      if (u_keepHue > 0.5) {
        // Invert brightness only: dark becomes light but skin stays skin-coloured.
        vec3 h = rgb2hsv(c);
        h.z = 1.0 - h.z;
        inv = hsv2rgb(h);
      }
      outColor = vec4(mix(c, inv, u_amount), 1.0);
    }
  `,
});
