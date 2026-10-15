import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'mirror',
  name: 'Espejo',
  order: 100,
  params: [
    {
      key: 'mode',
      label: 'Lado',
      min: 0,
      max: 4,
      step: 1,
      default: 0,
      options: ['Izquierda', 'Derecha', 'Arriba', 'Abajo', 'Cuatro'],
    },
    { key: 'axis', label: 'Posición', min: 0.35, max: 0.65, step: 0.005, default: 0.5 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec2 uv = v_uv;
      float a = u_axis;
      int m = int(u_mode + 0.5);
      // Keep one side of the axis and reflect it onto the other (GL: y = 1 is the top).
      if (m == 0) uv.x = a - abs(uv.x - a);
      else if (m == 1) uv.x = a + abs(uv.x - a);
      else if (m == 2) uv.y = a + abs(uv.y - a);
      else if (m == 3) uv.y = a - abs(uv.y - a);
      else uv = vec2(a - abs(uv.x - a), a + abs(uv.y - a));
      outColor = texture(u_input, mirrorRepeat(uv));
    }
  `,
});
