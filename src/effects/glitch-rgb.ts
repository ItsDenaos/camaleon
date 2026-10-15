import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'glitch-rgb',
  name: 'Glitch RGB',
  order: 70,
  params: [
    { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'speed', label: 'Velocidad', min: 0, max: 3, step: 0.01, default: 1 },
    { key: 'split', label: 'Separación RGB', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  fragment: /* glsl */ `
    void main() {
      float t = u_time * u_speed;
      float tick = floor(t * 12.0);            // glitch pattern changes ~12×/s
      float burst = step(0.82, hash(vec2(tick, 3.7)));  // occasional strong frames

      vec2 uv = v_uv;

      // Horizontal slices that jump sideways.
      float bands = mix(6.0, 48.0, hash(vec2(tick, 1.3)));
      float band = floor(uv.y * bands);
      float r = hash(vec2(band, tick));
      float displaced = step(1.0 - (0.18 + 0.5 * burst) * u_amount, r);
      uv.x += (hash(vec2(band, tick + 9.1)) - 0.5) * 0.12 * u_amount * displaced;

      // Rare vertical roll on burst frames.
      uv.y = fract(uv.y + burst * u_amount * 0.04 * (hash(vec2(tick, 5.5)) - 0.5));

      // Chromatic split that breathes, stronger on bursts and on displaced slices.
      float s = u_split * u_amount * (0.006 + 0.03 * burst + 0.01 * displaced) * (0.6 + 0.4 * sin(t * 4.0));
      vec3 c;
      c.r = texture(u_input, uv + vec2(s, 0.0)).r;
      c.g = texture(u_input, uv).g;
      c.b = texture(u_input, uv - vec2(s, 0.0)).b;

      // Line noise and blocky dropouts.
      c += (hash(vec2(floor(uv.y * 360.0), tick)) - 0.5) * 0.12 * u_amount;
      vec2 block = floor(centered(uv) * vec2(16.0, 9.0));
      float drop = step(1.0 - 0.04 * u_amount * (1.0 + 4.0 * burst), hash(block + tick));
      c = mix(c, vec3(hash(block + tick + 2.0), hash(block - tick), hash(block * 1.7 + tick)), drop);

      outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
});
