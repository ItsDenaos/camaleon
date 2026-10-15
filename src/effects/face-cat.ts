import { FACE_OVERLAY_MAIN, SDF } from '../engine/glsl';
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'face-cat',
  name: 'Gato',
  order: 9,
  needs: { face: true },
  params: [
    {
      key: 'fur',
      label: 'Pelaje',
      min: 0,
      max: 3,
      step: 1,
      default: 1,
      options: ['Gris', 'Naranja', 'Negro', 'Blanco'],
    },
    { key: 'whiskers', label: 'Bigotes', min: 0, max: 1, step: 1, default: 1 },
    { key: 'blush', label: 'Mejillas', min: 0, max: 1, step: 1, default: 1 },
  ],
  fragment: /* glsl */ `${SDF}
    vec3 furColor() {
      int f = int(u_fur + 0.5);
      if (f == 1) return vec3(0.93, 0.52, 0.18);
      if (f == 2) return vec3(0.08, 0.07, 0.08);
      if (f == 3) return vec3(0.96, 0.95, 0.93);
      return vec3(0.55, 0.56, 0.6);
    }

    vec4 ear(vec4 col, vec2 q, vec2 base, float side, float aa) {
      float outer = sdTriangle(q, base + vec2(-0.27, -0.05), base + vec2(0.27, -0.05), base + vec2(side * 0.14, 0.62)) - 0.04;
      float inner = sdTriangle(q, base + vec2(-0.14, 0.04), base + vec2(0.14, 0.04), base + vec2(side * 0.1, 0.44)) - 0.02;
      vec3 fur = furColor() * (0.85 + 0.15 * smoothstep(-0.1, 0.5, q.y - base.y));
      col = over(col, fur, fillAA(outer, aa));
      return over(col, vec3(1.0, 0.62, 0.7), fillAA(inner, aa));
    }

    vec4 overlay(int face, vec2 q, float aa) {
      vec4 col = vec4(0.0);
      vec2 nose = facePoint(face, FP_NOSE);

      // Rosy cheeks (soft, drawn first so everything else sits on top).
      if (u_blush > 0.5) {
        for (int k = 0; k < 2; k++) {
          vec2 cheek = mix(facePoint(face, k == 0 ? FP_CHEEK_L : FP_CHEEK_R), nose, 0.42) - vec2(0.0, 0.05);
          col = over(col, vec3(1.0, 0.45, 0.55), 0.35 * smoothstep(0.2, 0.0, length(q - cheek)));
        }
      }

      // Ears above the forehead, tilted outward.
      vec2 top = facePoint(face, FP_FOREHEAD);
      col = ear(col, q, top + vec2(-0.5, 0.02), -1.0, aa);
      col = ear(col, q, top + vec2(0.5, 0.02), 1.0, aa);

      // Whiskers: three per side, fanning out from beside the nose.
      if (u_whiskers > 0.5) {
        float w = 1e3;
        for (int k = -1; k <= 1; k++) {
          float fk = float(k);
          for (int s = -1; s <= 1; s += 2) {
            float fs = float(s);
            vec2 a = nose + vec2(fs * 0.17, -0.06 + fk * 0.045);
            vec2 b = nose + vec2(fs * 0.78, -0.02 + fk * 0.15);
            w = min(w, sdSegment(q, a, b) - 0.008);
          }
        }
        col = over(col, vec3(0.12), fillAA(w, aa));
      }

      // Little pink nose with a highlight.
      vec2 n = q - nose - vec2(0.0, 0.03);
      float nd = sdTriangle(n, vec2(-0.09, 0.05), vec2(0.09, 0.05), vec2(0.0, -0.05)) - 0.025;
      vec3 noseCol = vec3(0.98, 0.5, 0.6) + 0.25 * smoothstep(0.04, 0.0, length(n - vec2(-0.03, 0.05)));
      return over(col, noseCol, fillAA(nd, aa));
    }
    ${FACE_OVERLAY_MAIN}
  `,
});
