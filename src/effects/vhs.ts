import { defineEffect } from '../engine/types';

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** On-screen display of the "VCR": row 0 = PLAY, row 1 = today's date. White on transparent. */
function osdTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.font = "700 78px ui-monospace, 'Courier New', monospace";
  ctx.fillText('PLAY ▶', 12, 64);
  const d = new Date();
  ctx.font = "700 62px ui-monospace, 'Courier New', monospace";
  ctx.fillText(`${MONTHS[d.getMonth()]}. ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`, 12, 192);
  return canvas;
}

export default defineEffect({
  id: 'vhs',
  name: 'VHS',
  order: 60,
  params: [
    { key: 'wear', label: 'Desgaste', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'tracking', label: 'Tracking', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'osd', label: 'Texto en pantalla', min: 0, max: 1, step: 1, default: 1 },
  ],
  textures: { u_osdTex: osdTexture },
  fragment: /* glsl */ `
    const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 YIQ2RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

    // One OSD row drawn in a 4:1 box; p in image space (x ∈ [0, aspect], y ∈ [0, 1], y up).
    vec4 osdBox(vec2 p, vec2 origin, float row) {
      vec2 q = (p - origin) / vec2(0.36, 0.09);
      if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return vec4(0.0);
      return texture(u_osdTex, vec2(q.x, row * 0.5 + (1.0 - q.y) * 0.5));
    }

    void main() {
      float t = u_time;
      vec2 uv = v_uv;
      float line = floor(uv.y * 240.0);

      // Per-line wobble, plus a tracking band rolling down the frame.
      uv.x += (noise(vec2(line * 0.35, t * 9.0)) - 0.5) * 0.006 * u_wear;
      float bandPos = 1.0 - fract(t * 0.11);
      float band = 1.0 - smoothstep(0.0, 0.05, abs(uv.y - bandPos));
      uv.x += band * (hash(vec2(line, floor(t * 24.0))) - 0.5) * 0.08 * u_tracking;

      // Sharp luma, smeared and shifted chroma (low tape bandwidth).
      vec3 yiq = RGB2YIQ * texture(u_input, uv).rgb;
      vec2 iq = vec2(0.0);
      float stepX = 0.0035 / aspect();
      for (int i = 0; i < 6; i++) {
        vec2 o = vec2((float(i) - 1.0) * stepX + 0.004 * u_wear, 0.0);
        iq += (RGB2YIQ * texture(u_input, uv + o).rgb).yz;
      }
      yiq.yz = iq / 6.0 * (1.0 - 0.25 * u_wear);
      vec3 c = YIQ2RGB * yiq;

      // Colour cast, lifted blacks, noise, scanlines and the band's bright streaks.
      c = c * vec3(1.02, 0.98, 1.06) * 0.92 + 0.04;
      c += (hash(floor(centered(v_uv) * vec2(640.0, 480.0)) + fract(t * 61.0) * 100.0) - 0.5) * 0.12 * u_wear;
      float lineVis = smoothstep(420.0, 700.0, u_resolution.y); // avoid moiré in small previews
      c *= 1.0 - lineVis * 0.07 * (0.5 + 0.5 * sin(v_uv.y * 480.0 * PI));
      c += band * step(0.75, hash(vec2(floor(uv.x * 160.0), floor(t * 30.0) + line))) * 0.35 * u_tracking;
      vec2 q = v_uv - 0.5;
      c *= 1.0 - dot(q, q) * 0.6 * u_wear;

      // The OSD comes from the VCR, so it is not distorted by the tape.
      if (u_osd > 0.5) {
        vec2 p = vec2(v_uv.x * aspect(), v_uv.y);
        vec4 top = osdBox(p, vec2(0.06, 0.85), 0.0);
        vec4 bottom = osdBox(p, vec2(0.06, 0.06), 1.0);
        c = mix(c, top.rgb, top.a);
        c = mix(c, bottom.rgb, bottom.a);
      }
      outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
});
