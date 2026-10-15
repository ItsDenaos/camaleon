import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'pixelate',
  name: 'Pixelado',
  order: 40,
  params: [
    { key: 'size', label: 'Tamaño', min: 0.005, max: 0.08, step: 0.001, default: 0.02 },
    { key: 'dots', label: 'Puntos LED', min: 0, max: 1, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `
    void main() {
      // Square cells measured in fractions of the image height, grid centered on the image.
      float cell = u_size;
      vec2 p = centered(v_uv);
      vec2 id = floor(p / cell + 0.5);
      vec2 center = id * cell;

      // Average 4 samples inside the cell: steadier than a single center tap.
      float q = cell * 0.25;
      vec3 c = (texture(u_input, uncentered(center + vec2(-q, -q))).rgb +
                texture(u_input, uncentered(center + vec2( q, -q))).rgb +
                texture(u_input, uncentered(center + vec2(-q,  q))).rgb +
                texture(u_input, uncentered(center + vec2( q,  q))).rgb) * 0.25;

      if (u_dots > 0.5) {
        float d = length(p - center) / (cell * 0.5);
        float aa = 1.5 / (cell * u_resolution.y * 0.5); // ~1.5 output px of edge softness
        c *= 1.0 - smoothstep(0.82 - aa, 0.82 + aa, d);
      }
      outColor = vec4(c, 1.0);
    }
  `,
});
