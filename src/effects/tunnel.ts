import { defineEffect } from '../engine/types';

/**
 * Light tunnel: the centre stays untouched (your face) and the pixels on the rim of
 * that circle stream outward along each ray, twisting, with rushing light bands.
 */
export default defineEffect({
  id: 'tunnel',
  name: 'Túnel',
  order: 140,
  params: [
    { key: 'radius', label: 'Tamaño', min: 0.12, max: 0.45, step: 0.005, default: 0.28 },
    { key: 'twist', label: 'Giro', min: -2, max: 2, step: 0.01, default: 0.6 },
    { key: 'speed', label: 'Velocidad', min: 0, max: 3, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec2 p = centered(v_uv);
      float r = length(p);
      float R = u_radius;
      vec3 inside = texture(u_input, v_uv).rgb;

      float depth = log(max(r, R) / R); // 0 at the rim, grows outward
      float a = atan(p.y, p.x) + depth * u_twist;
      vec3 c = texture(u_input, uncentered(vec2(cos(a), sin(a)) * R * 0.985)).rgb;
      float bands = 0.72 + 0.28 * sin(depth * 18.0 - u_time * u_speed * 6.0);
      c *= bands * exp(-depth * 0.35);

      float rim = smoothstep(R, R + 0.006, r);
      outColor = vec4(mix(inside, c, rim), 1.0);
    }
  `,
});
