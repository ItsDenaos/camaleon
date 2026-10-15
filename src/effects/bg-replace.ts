import { MASK_EDGE } from '../engine/glsl';
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'bg-replace',
  name: 'Cambiar fondo',
  order: 4,
  needs: { segmentation: true },
  images: [{ key: 'photo', label: 'Tu imagen de fondo', selects: { param: 'mode', value: 4 } }],
  params: [
    {
      key: 'mode',
      label: 'Fondo',
      min: 0,
      max: 4,
      step: 1,
      default: 0,
      options: ['Aurora', 'Estrellas', 'Synthwave', 'Color', 'Tu imagen'],
    },
    { key: 'hue', label: 'Tono', min: 0, max: 1, step: 0.005, default: 0.45 },
    { key: 'feather', label: 'Suavizado del borde', min: 0.02, max: 0.4, step: 0.01, default: 0.12 },
  ],
  fragment: /* glsl */ `${MASK_EDGE}
    vec3 aurora(vec2 uv) {
      vec2 p = centered(uv) * 2.0;
      float t = u_time * 0.08;
      float n = noise(p * 1.3 + vec2(t, -t * 0.5)) * 0.6 + noise(p * 2.7 - vec2(t * 1.3, 0.0)) * 0.4;
      float curtain = 0.5 + 0.5 * sin(p.x * 2.2 + n * 5.0 + u_time * 0.25);
      vec3 sky = mix(vec3(0.01, 0.02, 0.06), vec3(0.03, 0.06, 0.14), uv.y);
      vec3 glow = hsv2rgb(vec3(fract(u_hue + 0.12 * n + 0.08 * p.y), 0.75, 1.0));
      return sky + glow * curtain * smoothstep(-0.6, 0.9, p.y) * 0.55 * (0.4 + n);
    }

    vec3 stars(vec2 uv) {
      vec2 p = centered(uv);
      vec3 col = mix(vec3(0.0, 0.0, 0.02), vec3(0.03, 0.02, 0.1), uv.y);
      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        vec2 q = p * (40.0 + fl * 35.0) + vec2(u_time * (0.3 + fl * 0.4), fl * 11.0);
        vec2 id = floor(q);
        vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
        float on = step(0.82, hash(id + fl * 17.0));
        float star = smoothstep(0.09, 0.0, length(fract(q) - 0.5 - off * 0.6)) * on;
        float twinkle = 0.6 + 0.4 * sin(u_time * (2.0 + hash(id) * 4.0) + hash(id) * 30.0);
        col += star * twinkle * mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash(id + 1.3));
      }
      col += hsv2rgb(vec3(fract(u_hue + 0.1), 0.6, 0.3)) * pow(noise(p * 3.0 + 4.0), 3.0);
      return col;
    }

    vec3 synthwave(vec2 uv) {
      vec2 p = centered(uv);
      float horizon = -0.08;
      if (p.y > horizon) {
        vec3 sky = mix(vec3(0.98, 0.45, 0.35), vec3(0.16, 0.02, 0.3), smoothstep(horizon, 0.5, p.y));
        vec2 sp = p - vec2(0.0, horizon + 0.18);
        float sun = smoothstep(0.205, 0.195, length(sp));
        float cut = sp.y < 0.0 ? step(0.35, fract(sp.y * 16.0 + u_time * 0.4)) : 1.0;
        vec3 sunCol = mix(vec3(1.0, 0.85, 0.25), vec3(1.0, 0.2, 0.55), smoothstep(0.18, -0.18, sp.y));
        return mix(sky, sunCol, sun * cut);
      }
      float z = 0.1 / (horizon - p.y + 0.003);
      vec2 g = vec2(p.x * z * 3.0, z + u_time * 0.8);
      vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);
      float line = 1.0 - min(min(grid.x, grid.y), 1.0);
      vec3 floorCol = mix(vec3(0.16, 0.0, 0.22), vec3(0.03, 0.0, 0.06), smoothstep(0.0, 0.4, horizon - p.y));
      return floorCol + vec3(1.0, 0.25, 0.85) * line * (0.4 + 0.6 * smoothstep(0.4, 0.0, horizon - p.y));
    }

    vec3 background(vec2 uv) {
      int m = int(u_mode + 0.5);
      if (m == 1) return stars(uv);
      if (m == 2) return synthwave(uv);
      if (m == 3) return hsv2rgb(vec3(u_hue, 0.9, 0.85));
      // The picked image is never mirrored (its text must stay readable).
      if (m == 4 && u_photoSet > 0.5) return texture(u_photo, vec2(uv.x, 1.0 - uv.y)).rgb;
      return aurora(uv);
    }

    void main() {
      vec3 src = texture(u_input, v_uv).rgb;
      outColor = vec4(mix(background(v_uv), src, personAlpha(v_uv, u_feather)), 1.0);
    }
  `,
});
