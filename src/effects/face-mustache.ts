import { FACE_OVERLAY_MAIN, SDF } from '../engine/glsl';
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'face-mustache',
  name: 'Bigote',
  order: 7,
  needs: { face: true },
  params: [
    {
      key: 'style',
      label: 'Estilo',
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      options: ['Manubrio', 'Clásico', 'Morsa'],
    },
    {
      key: 'hair',
      label: 'Color',
      min: 0,
      max: 3,
      step: 1,
      default: 0,
      options: ['Castaño', 'Negro', 'Rubio', 'Pelirrojo'],
    },
    { key: 'size', label: 'Tamaño', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `${SDF}
    // Distance to the mustache in its own units (half-width 1), origin under the nose.
    float mustache(vec2 m) {
      int s = int(u_style + 0.5);
      float x = abs(m.x);
      float d;
      if (s == 0) {
        // Handlebar: thick in the middle, thin tips sweeping up into curls.
        d = max(abs(m.y - (-0.08 + 0.38 * x * x)) - mix(0.2, 0.03, smoothstep(0.05, 1.0, x)), x - 1.0);
        vec2 cp = vec2(x, m.y) - vec2(1.0, 0.42);
        float curl = max(abs(length(cp) - 0.13) - 0.035, -max(cp.x, cp.y));
        d = min(d, curl);
      } else if (s == 1) {
        // Chevron: straight, slightly drooping.
        d = max(abs(m.y - (0.02 - 0.12 * x)) - mix(0.17, 0.09, x), x - 0.82);
      } else {
        // Walrus: wide and droopy, covers the upper lip.
        d = max(abs(m.y - (-0.06 - 0.28 * x * x)) - mix(0.25, 0.13, x), x - 0.95);
      }
      // Small notch under the nose.
      return max(d, 0.04 - length(vec2(m.x, (m.y - 0.14) * 1.6)));
    }

    vec3 hairColor() {
      int h = int(u_hair + 0.5);
      if (h == 1) return vec3(0.05, 0.04, 0.04);
      if (h == 2) return vec3(0.78, 0.62, 0.33);
      if (h == 3) return vec3(0.62, 0.22, 0.07);
      return vec3(0.22, 0.12, 0.06);
    }

    vec4 overlay(int face, vec2 q, float aa) {
      vec2 anchor = mix(facePoint(face, FP_NOSE), facePoint(face, FP_LIP), 0.55);
      float scale = 0.6 * u_size;
      vec2 m = (q - anchor) / scale;
      float d = mustache(m) * scale;
      // Hair strands + a soft highlight along the top.
      vec3 col = hairColor() * (0.8 + 0.4 * noise(vec2(m.x * 38.0, m.y * 5.0)));
      col += 0.12 * smoothstep(0.0, 0.15, m.y + 0.05) * (1.0 - abs(m.x));
      return vec4(col, 1.0) * fillAA(d, aa);
    }
    ${FACE_OVERLAY_MAIN}
  `,
});
