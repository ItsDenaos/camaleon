import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'sepia',
  name: 'Sepia',
  order: 20,
  params: [
    { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'fade', label: 'Desvanecido', min: 0, max: 0.5, step: 0.01, default: 0.12 },
  ],
  fragment: /* glsl */ `
    void main() {
      vec3 c = texture(u_input, v_uv).rgb;
      vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)),
                    dot(c, vec3(0.349, 0.686, 0.168)),
                    dot(c, vec3(0.272, 0.534, 0.131)));
      // Old print: contrast pulled toward a warm mid-tone.
      s = mix(clamp(s, 0.0, 1.0), vec3(0.78, 0.68, 0.52), u_fade);
      outColor = vec4(mix(c, s, u_amount), 1.0);
    }
  `,
});
