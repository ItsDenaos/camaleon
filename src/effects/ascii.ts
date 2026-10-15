import { defineEffect } from '../engine/types';

/** Characters from empty to dense. */
const RAMP = ' .:-=+*#%@';
const GLYPH_W = 40;
const GLYPH_H = 64;

/** One-row atlas of white glyphs on black, drawn once with the platform monospace font. */
function glyphAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_W * RAMP.length;
  canvas.height = GLYPH_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(GLYPH_H * 0.78)}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < RAMP.length; i++) {
    ctx.fillText(RAMP[i], i * GLYPH_W + GLYPH_W / 2, GLYPH_H / 2 + 2);
  }
  return canvas;
}

export default defineEffect({
  id: 'ascii',
  name: 'ASCII',
  order: 50,
  params: [
    { key: 'size', label: 'Tamaño de letra', min: 0.012, max: 0.06, step: 0.001, default: 0.022 },
    { key: 'color', label: 'Color original', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'gamma', label: 'Gamma', min: 0.4, max: 2, step: 0.01, default: 1 },
  ],
  textures: { u_glyphs: glyphAtlas },
  fragment: /* glsl */ `
    const float N = ${RAMP.length}.0;
    const float GLYPH_ASPECT = ${(GLYPH_W / GLYPH_H).toFixed(4)};

    void main() {
      // Cell size as a fraction of image height, glyph-shaped (taller than wide).
      vec2 cell = vec2(u_size * GLYPH_ASPECT, u_size);
      vec2 p = centered(v_uv);
      vec2 id = floor(p / cell);
      vec2 local = p / cell - id;           // 0..1 inside the cell, y up

      vec3 c = texture(u_input, uncentered((id + 0.5) * cell)).rgb;
      float y = pow(clamp(luma(c), 0.0, 1.0), u_gamma);
      float gi = min(floor(y * N), N - 1.0);

      // Atlas rows are top-down (canvas upload, no flip), so flip local.y.
      vec2 guv = vec2((gi + local.x) / N, 1.0 - local.y);
      // Explicit gradients: fract() would otherwise pick the wrong mip at cell borders.
      vec2 cellPx = cell * u_resolution.y;
      float g = textureGrad(u_glyphs, guv, vec2(1.0 / (cellPx.x * N), 0.0), vec2(0.0, 1.0 / cellPx.y)).r;

      vec3 phosphor = vec3(0.45, 1.0, 0.6);
      vec3 tint = mix(phosphor, clamp(c * 1.25 + 0.05, 0.0, 1.0), u_color);
      vec3 bg = mix(vec3(0.0, 0.03, 0.01), vec3(0.0), u_color);
      outColor = vec4(mix(bg, tint, g), 1.0);
    }
  `,
});
