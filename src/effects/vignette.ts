import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'vignette',
  name: 'Viñeta',
  order: 160,
  params: [
    { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: 'size', label: 'Tamaño', min: 0.2, max: 1.2, step: 0.01, default: 0.6 },
    { key: 'softness', label: 'Suavidad', min: 0.05, max: 1, step: 0.01, default: 0.55 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      // Round falloff: 0 at the centre, 1 at the corners, whatever the aspect ratio.
      float d = length(centered(v_uv)) / length(vec2(aspect(), 1.0) * 0.5);
      float v = 1.0 - smoothstep(u_size - u_softness * 0.5, u_size + u_softness * 0.5, d);
      outColor = vec4(c * mix(1.0, v, u_amount), 1.0);
    }
  `,
});
