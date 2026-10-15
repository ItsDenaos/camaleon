import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'kaleidoscope',
  name: 'Caleidoscopio',
  order: 110,
  params: [
    { key: 'segments', label: 'Segmentos', min: 3, max: 16, step: 1, default: 6 },
    { key: 'speed', label: 'Giro', min: -1, max: 1, step: 0.01, default: 0.15 },
    { key: 'zoom', label: 'Zoom', min: 0.5, max: 2.5, step: 0.01, default: 1.2 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec2 p = centered(v_uv);
      float r = length(p);
      float seg = TAU / u_segments;
      float a = mod(atan(p.y, p.x) + u_time * u_speed, seg);
      a = abs(a - seg * 0.5); // mirror inside each wedge so neighbours join seamlessly
      vec2 q = vec2(cos(a), sin(a)) * r / u_zoom;
      outColor = texture(u_input, mirrorRepeat(uncentered(q)));
    }
  `,
});
