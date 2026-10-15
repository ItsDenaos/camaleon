import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'thermal',
  name: 'Térmico',
  order: 80,
  params: [
    { key: 'contrast', label: 'Contraste', min: 0.5, max: 3, step: 0.01, default: 1.4 },
    { key: 'heat', label: 'Temperatura', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
    { key: 'bands', label: 'Isotermas', min: 0, max: 1, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `
    // Iron-bow style palette: black → blue → magenta → orange → yellow → white.
    vec3 palette(float t) {
      vec3 c0 = vec3(0.02, 0.0, 0.08);
      vec3 c1 = vec3(0.16, 0.0, 0.55);
      vec3 c2 = vec3(0.75, 0.0, 0.55);
      vec3 c3 = vec3(1.0, 0.35, 0.0);
      vec3 c4 = vec3(1.0, 0.85, 0.05);
      vec3 c5 = vec3(1.0, 1.0, 0.9);
      float s = clamp(t, 0.0, 1.0) * 5.0;
      if (s < 1.0) return mix(c0, c1, s);
      if (s < 2.0) return mix(c1, c2, s - 1.0);
      if (s < 3.0) return mix(c2, c3, s - 2.0);
      if (s < 4.0) return mix(c3, c4, s - 3.0);
      return mix(c4, c5, s - 4.0);
    }

    void main() {
      // Thermal imagers are soft: average a 3×3 neighbourhood before mapping.
      vec2 o = hpx() * 3.0;
      float y = 0.0;
      for (int i = -1; i <= 1; i++)
        for (int j = -1; j <= 1; j++)
          y += luma(texture(u_input, v_uv + vec2(float(i), float(j)) * o).rgb);
      y = clamp((y / 9.0 - 0.5) * u_contrast + 0.5 + u_heat, 0.0, 1.0);
      if (u_bands > 0.5) y = floor(y * 10.0) / 10.0;
      outColor = vec4(palette(y), 1.0);
    }
  `,
});
