import { FACE_OVERLAY_MAIN, SDF } from '../engine/glsl';
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'face-glasses',
  name: 'Gafas',
  order: 6,
  needs: { face: true },
  params: [
    {
      key: 'style',
      label: 'Modelo',
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      options: ['De sol', 'Corazón', '8-bit'],
    },
    { key: 'opacity', label: 'Opacidad de los cristales', min: 0.3, max: 1, step: 0.01, default: 0.88 },
  ],
  fragment: /* glsl */ `${SDF}
    // Lens + frame + bridge + temples built from a lens distance field (right half, mirrored).
    vec4 framed(vec2 q, vec2 a, float lens, vec3 glass, vec3 frameCol, float aa) {
      float frame = abs(lens) - 0.035;
      float bridge = sdSegment(q, vec2(-0.2, 0.08), vec2(0.2, 0.08)) - 0.03;
      float temple = sdSegment(a, vec2(0.8, 0.1), vec2(1.12, 0.15)) - 0.028;
      vec4 col = over(vec4(0.0), glass, fillAA(lens, aa) * u_opacity);
      return over(col, frameCol, fillAA(min(min(frame, bridge), temple), aa));
    }

    vec4 sunglasses(vec2 q, float aa) {
      vec2 a = vec2(abs(q.x), q.y);
      vec2 l = a - vec2(0.5, -0.03);
      float lens = sdRoundBox(l, vec2(0.3, 0.21), 0.16);
      vec3 glass = mix(vec3(0.02, 0.03, 0.06), vec3(0.2, 0.17, 0.3), smoothstep(-0.2, 0.25, l.y));
      glass += 0.3 * smoothstep(0.045, 0.0, abs(l.x + l.y * 0.8 + 0.07));   // reflections
      glass += 0.18 * smoothstep(0.025, 0.0, abs(l.x + l.y * 0.8 - 0.06));
      return framed(q, a, lens, glass, vec3(0.05, 0.05, 0.06), aa);
    }

    vec4 hearts(vec2 q, float aa) {
      vec2 a = vec2(abs(q.x), q.y);
      float s = 0.5;
      float lens = sdHeart((a - vec2(0.5, -0.28)) / s) * s;
      vec3 glass = mix(vec3(0.85, 0.05, 0.3), vec3(1.0, 0.5, 0.65), smoothstep(-0.25, 0.25, a.y));
      glass += 0.25 * smoothstep(0.035, 0.0, abs(a.x - 0.5 + a.y * 0.7 - 0.05));
      return framed(q, a, lens, glass, vec3(0.75, 0.0, 0.35), aa);
    }

    // "Deal with it" pixel-art glasses on a grid of face-sized cells.
    vec4 pixelGlasses(vec2 q) {
      vec2 g = floor((q - vec2(0.0, 0.03)) / 0.085);
      float x = g.x;
      float y = g.y;
      bool on = (y == 1.0 && x >= -12.0 && x <= 11.0)
        || (y <= 0.0 && y >= -2.0 && ((x >= -11.0 && x <= -2.0) || (x >= 1.0 && x <= 10.0)))
        || (y == -3.0 && ((x >= -10.0 && x <= -3.0) || (x >= 2.0 && x <= 9.0)))
        || (y == 0.0 && x >= -1.0 && x <= 0.0);
      if (!on) return vec4(0.0);
      bool shine = (y == 0.0 && (x == -9.0 || x == 3.0)) || (y == -1.0 && (x == -8.0 || x == 4.0));
      return vec4(shine ? vec3(1.0) : vec3(0.0), 1.0);
    }

    vec4 overlay(int face, vec2 q, float aa) {
      int s = int(u_style + 0.5);
      if (s == 1) return hearts(q, aa);
      if (s == 2) return pixelGlasses(q);
      return sunglasses(q, aa);
    }
    ${FACE_OVERLAY_MAIN}
  `,
});
