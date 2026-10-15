import { FACE_OVERLAY_MAIN, SDF } from '../engine/glsl';
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'face-mask',
  name: 'Antifaz',
  order: 8,
  needs: { face: true },
  params: [
    { key: 'hue', label: 'Color', min: 0, max: 1, step: 0.005, default: 0.0 },
    { key: 'gloss', label: 'Brillo', min: 0, max: 1, step: 0.01, default: 0.55 },
  ],
  fragment: /* glsl */ `${SDF}
    vec4 overlay(int face, vec2 q, float aa) {
      vec2 a = vec2(abs(q.x), q.y);
      // Two lobes around the eyes, pointy outer tips and a bridge over the nose.
      float lobe = sdEllipse(a - vec2(0.48, 0.0), vec2(0.4, 0.25));
      float tip = sdTriangle(a, vec2(0.7, 0.13), vec2(0.99, 0.24), vec2(0.8, -0.12));
      float bridge = sdRoundBox(q - vec2(0.0, 0.06), vec2(0.18, 0.08), 0.06);
      float d = smin(smin(lobe, tip, 0.06), bridge, 0.08);
      // Almond eye holes.
      d = max(d, -sdEllipse(rot(a - vec2(0.5, 0.0), -0.12), vec2(0.2, 0.1)));

      vec3 base = hsv2rgb(vec3(u_hue, 0.8, 0.55));
      float depth = clamp(-d / 0.08, 0.0, 1.0); // 0 at the edge → 1 inside
      vec3 col = base * (0.45 + 0.55 * depth);
      col += u_gloss * 0.35 * pow(clamp(1.0 - abs(q.y - 0.13 + 0.05 * a.x) / 0.06, 0.0, 1.0), 2.0);
      return vec4(col, 1.0) * fillAA(d, aa);
    }
    ${FACE_OVERLAY_MAIN}
  `,
});
