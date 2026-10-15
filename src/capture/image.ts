/** RGBA pixels (top-down rows) → a 2D canvas. */
export function pixelsToCanvas(pixels: Uint8Array<ArrayBuffer>, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const data = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, width * height * 4);
  canvas.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  );
}

/** Small JPEG for the captures grid (max 320 px on the long side). */
export function makeThumb(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const k = Math.min(1, 320 / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * k));
  c.height = Math.max(1, Math.round(height * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.8);
}

/**
 * Photo-booth strip: four shots on a paper-coloured card with a small caption.
 * Landscape shots stack vertically (classic strip); portrait shots use a 2×2 grid.
 */
export function composeStrip(shots: HTMLCanvasElement[]): HTMLCanvasElement {
  const { width: sw, height: sh } = shots[0];
  const portrait = sh > sw;
  const margin = 28;
  const gap = 18;
  const footer = 76;
  const cols = portrait ? 2 : 1;
  const rows = Math.ceil(shots.length / cols);
  const cardW = portrait ? 900 : 640;
  const photoW = Math.round((cardW - margin * 2 - gap * (cols - 1)) / cols);
  const photoH = Math.round((photoW * sh) / sw);
  const cardH = margin + rows * photoH + (rows - 1) * gap + footer;

  const canvas = document.createElement('canvas');
  canvas.width = cardW;
  canvas.height = cardH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5f1e8';
  ctx.fillRect(0, 0, cardW, cardH);
  ctx.imageSmoothingQuality = 'high';
  shots.forEach((shot, i) => {
    const x = margin + (i % cols) * (photoW + gap);
    const y = margin + Math.floor(i / cols) * (photoH + gap);
    ctx.drawImage(shot, x, y, photoW, photoH);
  });

  const base = cardH - footer / 2 + 2;
  ctx.fillStyle = '#1b1b24';
  ctx.textBaseline = 'middle';
  ctx.font = '700 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('Camaleón', margin, base);
  ctx.fillStyle = '#6b6878';
  ctx.font = '500 18px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(
    new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }),
    cardW - margin,
    base,
  );
  return canvas;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** camaleon-20261015-153012.png */
export function fileName(mime: string, createdAt: number): string {
  const d = new Date(createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `camaleon-${stamp}.${EXT[mime.split(';')[0]] ?? 'bin'}`;
}

/** Fits width×height inside maxSide, keeping the aspect; even sizes keep video encoders happy. */
export function fitSize(width: number, height: number, maxSide: number, even = false) {
  const k = Math.min(1, maxSide / Math.max(width, height));
  let w = Math.max(2, Math.round(width * k));
  let h = Math.max(2, Math.round(height * k));
  if (even) {
    w -= w % 2;
    h -= h % 2;
  }
  return { width: w, height: h };
}
