import { MASK_EDGE } from '../engine/glsl';
import { defineEffect } from '../engine/types';

/**
 * Background-only blur: the blur passes weight samples by "how background" they are,
 * so the person's colours don't bleed into the blurred background as a halo.
 * Alpha carries the background coverage between passes.
 */
const firstPass = /* glsl */ `
  void main() {
    vec2 stepUv = vec2(1.0 / aspect(), 0.0) * (u_radius * 0.70710678 / 6.0);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float gsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float g = exp(-float(i * i) / 18.0);
      vec2 uv = v_uv + stepUv * float(i);
      float w = g * (1.0 - personMask(uv) + 0.01);
      sum += texture(u_input, uv).rgb * w;
      wsum += w;
      gsum += g;
    }
    outColor = vec4(sum / wsum, wsum / gsum);
  }
`;

const nextPass = (axis: string) => /* glsl */ `
  void main() {
    vec2 stepUv = ${axis} * (u_radius * 0.70710678 / 6.0);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float gsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float g = exp(-float(i * i) / 18.0);
      vec4 s = texture(u_input, v_uv + stepUv * float(i));
      float w = g * (s.a + 0.001);
      sum += s.rgb * w;
      wsum += w;
      gsum += g;
    }
    outColor = vec4(sum / wsum, wsum / gsum);
  }
`;

export default defineEffect({
  id: 'bg-blur',
  name: 'Fondo desenfocado',
  order: 3,
  needs: { segmentation: true },
  params: [
    { key: 'radius', label: 'Desenfoque', min: 0.005, max: 0.08, step: 0.001, default: 0.035 },
    { key: 'feather', label: 'Suavizado del borde', min: 0.02, max: 0.4, step: 0.01, default: 0.14 },
    { key: 'dim', label: 'Oscurecer fondo', min: 0, max: 0.7, step: 0.01, default: 0 },
  ],
  passes: [
    { fragment: firstPass, scale: 0.5 },
    { fragment: nextPass('vec2(0.0, 1.0)'), scale: 0.5 },
    { fragment: nextPass('vec2(1.0 / aspect(), 0.0)'), scale: 0.5 },
    { fragment: nextPass('vec2(0.0, 1.0)'), scale: 0.5 },
    {
      fragment: /* glsl */ `${MASK_EDGE}
        void main() {
          vec3 src = texture(u_source, v_uv).rgb;
          vec3 bg = texture(u_input, v_uv).rgb * (1.0 - u_dim);
          outColor = vec4(mix(bg, src, personAlpha(v_uv, u_feather)), 1.0);
        }`,
    },
  ],
});
