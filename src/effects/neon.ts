import { defineEffect } from '../engine/types';

/** Rainbow-coloured edges; the same function runs in the glow pass and the final pass. */
const NEON = /* glsl */ `
  vec3 neonEdges(sampler2D tex, vec2 uv) {
    float e = smoothstep(0.08, 0.5, sobel(tex, uv, hpx() * 1.5));
    float hue = fract(uv.x * 0.6 + uv.y * 0.35 + u_time * u_speed);
    return hsv2rgb(vec3(hue, 0.85, 1.0)) * e;
  }
`;

const glow = (axis: string) => /* glsl */ `
  void main() {
    vec2 stepUv = ${axis} * (0.014 / 4.0);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float w = exp(-float(i * i) / 8.0);
      sum += texture(u_input, v_uv + stepUv * float(i)).rgb * w;
      wsum += w;
    }
    outColor = vec4(sum / wsum, 1.0);
  }
`;

/**
 * Pass 1: coloured edges (half res). Passes 2–3: blur them into a glow.
 * Pass 4: crisp edges recomputed from the effect's source + glow + a dim copy of the image.
 */
export default defineEffect({
  id: 'neon',
  name: 'Neón',
  order: 95,
  params: [
    { key: 'glow', label: 'Brillo', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'speed', label: 'Velocidad de color', min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: 'base', label: 'Imagen de fondo', min: 0, max: 0.6, step: 0.01, default: 0.1 },
  ],
  passes: [
    { fragment: `${NEON}\nvoid main() { outColor = vec4(neonEdges(u_input, v_uv), 1.0); }`, scale: 0.5 },
    { fragment: glow('vec2(1.0 / aspect(), 0.0)'), scale: 0.5 },
    { fragment: glow('vec2(0.0, 1.0)'), scale: 0.5 },
    {
      fragment: /* glsl */ `${NEON}
        void main() {
          vec3 edges = neonEdges(u_source, v_uv);
          vec3 halo = texture(u_input, v_uv).rgb * u_glow * 2.2;
          vec3 bg = texture(u_source, v_uv).rgb * u_base;
          outColor = vec4(clamp(edges * 1.15 + halo + bg, 0.0, 1.0), 1.0);
        }`,
    },
  ],
});
