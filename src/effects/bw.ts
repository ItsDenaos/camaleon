import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'bw',
  name: 'Blanco y negro',
  order: 10,
  params: [
    { key: 'contrast', label: 'Contraste', min: 0.5, max: 2.5, step: 0.01, default: 1.2 },
    { key: 'brightness', label: 'Brillo', min: -0.4, max: 0.4, step: 0.01, default: 0 },
    { key: 'grain', label: 'Grano', min: 0, max: 0.4, step: 0.01, default: 0.06 },
  ],
  fragment: /* glsl */ `
    void main() {
      float y = luma(texture(u_input, v_uv).rgb);
      y = (y - 0.5) * u_contrast + 0.5 + u_brightness;
      // Grain cells are tied to image height (≈720 per frame), not to output pixels,
      // so the preview and a full-resolution capture look the same.
      vec2 cell = floor(centered(v_uv) * 720.0);
      y += (hash(cell + fract(u_time * 7.31) * 517.0) - 0.5) * u_grain;
      outColor = vec4(vec3(clamp(y, 0.0, 1.0)), 1.0);
    }
  `,
});
