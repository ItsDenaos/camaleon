import { defineEffect } from '../engine/types';

/**
 * Separable gaussian, 13 taps per pass, run twice (H,V,H,V) at half resolution.
 * Two iterations at radius/√2 equal one at full radius but with denser taps, so large
 * radii stay smooth; half resolution keeps it cheap and the next pass upsamples bilinearly.
 */
const pass = (axis: string) => /* glsl */ `
  void main() {
    // Radius is a fraction of the image height; axis converts it to uv units.
    vec2 stepUv = ${axis} * (u_radius * 0.70710678 / 6.0);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float fi = float(i);
      float w = exp(-fi * fi / 18.0);
      sum += texture(u_input, v_uv + stepUv * fi).rgb * w;
      wsum += w;
    }
    outColor = vec4(sum / wsum, 1.0);
  }
`;

const H = pass('vec2(1.0 / aspect(), 0.0)');
const V = pass('vec2(0.0, 1.0)');

export default defineEffect({
  id: 'blur',
  name: 'Desenfoque',
  order: 150,
  params: [{ key: 'radius', label: 'Intensidad', min: 0, max: 0.08, step: 0.001, default: 0.02 }],
  passes: [
    { fragment: H, scale: 0.5 },
    { fragment: V, scale: 0.5 },
    { fragment: H, scale: 0.5 },
    { fragment: V, scale: 0.5 },
  ],
});
