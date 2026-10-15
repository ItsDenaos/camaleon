import { GIFEncoder, applyPalette, quantize } from 'gifenc';

interface GifJob {
  width: number;
  height: number;
  /** Per-frame delay in ms. */
  delay: number;
  /** RGBA frames, top-down rows. */
  frames: ArrayBuffer[];
}

type Out = { type: 'progress'; value: number } | { type: 'done'; bytes: Uint8Array };
const post = (msg: Out, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: Out, t: Transferable[]): void }).postMessage(msg, transfer);

/** Every 4th pixel of up to 8 evenly spaced frames: enough for a good shared palette. */
function paletteSample(frames: ArrayBuffer[], pixels: number): Uint8Array {
  const picks = Math.min(8, frames.length);
  const stride = 4;
  const perFrame = Math.ceil(pixels / stride);
  const out = new Uint8Array(picks * perFrame * 4);
  let o = 0;
  for (let k = 0; k < picks; k++) {
    const src = new Uint8Array(frames[Math.floor((k * (frames.length - 1)) / Math.max(1, picks - 1))]);
    for (let p = 0; p < pixels; p += stride) {
      const i = p * 4;
      out[o++] = src[i];
      out[o++] = src[i + 1];
      out[o++] = src[i + 2];
      out[o++] = 255;
    }
  }
  return out.subarray(0, o);
}

self.onmessage = (e: MessageEvent<GifJob>) => {
  const { width, height, delay, frames } = e.data;
  // One global palette keeps colours stable between frames (no shimmer) and the file smaller.
  const palette = quantize(paletteSample(frames, width * height), 256);
  const gif = GIFEncoder();
  frames.forEach((buf, i) => {
    const index = applyPalette(new Uint8Array(buf), palette);
    gif.writeFrame(index, width, height, i === 0 ? { palette, delay, repeat: 0 } : { delay });
    post({ type: 'progress', value: (i + 1) / frames.length });
  });
  gif.finish();
  const bytes = gif.bytes();
  post({ type: 'done', bytes }, [bytes.buffer]);
};
