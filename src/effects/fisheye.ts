import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'fisheye',
  name: 'Ojo de pez',
  order: 120,
  params: [
    { key: 'strength', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'circle', label: 'Lente circular', min: 0, max: 1, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `
    void main() {
      // Normalised radius: 1 at the corners, or at the top/bottom edge for the round lens.
      vec2 p = centered(v_uv) * 2.0;
      float norm = u_circle > 0.5 ? 1.0 : length(vec2(aspect(), 1.0));
      vec2 pn = p / norm;
      float r = length(pn);

      // Equidistant fisheye viewing a rectilinear image: angle grows linearly with r,
      // the source radius grows with tan(angle). Magnifies the centre, keeps the rim.
      float halfFov = u_strength * 1.35;
      float rr = r;
      if (halfFov > 0.001) rr = r * halfFov < 1.55 ? tan(r * halfFov) / tan(halfFov) : 1e3;
      vec2 q = r > 0.0 ? pn * (rr / r) * norm : p;
      vec2 uv = uncentered(q * 0.5);

      bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
      vec3 c = outside ? vec3(0.0) : texture(u_input, uv).rgb;
      if (u_circle > 0.5) {
        float aa = 2.0 / u_resolution.y;
        c *= 1.0 - smoothstep(1.0 - aa, 1.0, r);
      }
      outColor = vec4(c, 1.0);
    }
  `,
});
