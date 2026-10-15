import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'edges',
  name: 'Bordes',
  order: 90,
  params: [
    { key: 'strength', label: 'Intensidad', min: 0.5, max: 5, step: 0.01, default: 2 },
    { key: 'color', label: 'Color original', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'paper', label: 'Fondo blanco', min: 0, max: 1, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      float e = clamp(sobel(u_input, v_uv, hpx()) * u_strength, 0.0, 1.0);
      vec3 col;
      if (u_paper > 0.5) {
        // Pencil sketch: dark lines on paper.
        vec3 lead = mix(vec3(0.08), c * 0.55, u_color);
        col = mix(vec3(0.97, 0.96, 0.93), lead, e);
      } else {
        // Glowing lines on black.
        col = mix(vec3(1.0), clamp(c * 1.6, 0.0, 1.0), u_color) * e;
      }
      outColor = vec4(col, 1.0);
    }
  `,
});
