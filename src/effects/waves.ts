import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'waves',
  name: 'Ondas',
  order: 130,
  params: [
    {
      key: 'mode',
      label: 'Tipo',
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      options: ['Horizontal', 'Vertical', 'Circular'],
    },
    { key: 'amplitude', label: 'Amplitud', min: 0, max: 0.06, step: 0.001, default: 0.018 },
    { key: 'frequency', label: 'Frecuencia', min: 1, max: 30, step: 0.5, default: 6 },
    { key: 'speed', label: 'Velocidad', min: 0, max: 6, step: 0.1, default: 2 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec2 p = centered(v_uv);
      float t = u_time * u_speed;
      float k = u_frequency * TAU;
      int m = int(u_mode + 0.5);
      if (m == 0) {
        p.x += sin(p.y * k + t) * u_amplitude;
      } else if (m == 1) {
        p.y += sin(p.x * k + t) * u_amplitude;
      } else {
        // Ripples from the centre that fade towards the edges.
        float r = length(p);
        float fade = 1.0 - smoothstep(0.2, 0.9, r);
        p += (r > 0.0 ? p / r : vec2(0.0)) * sin(r * k - t * 2.0) * u_amplitude * (0.4 + fade);
      }
      outColor = texture(u_input, mirrorRepeat(uncentered(p)));
    }
  `,
});
