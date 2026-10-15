/** Encodes RGBA frames into a looping GIF off the main thread. */
export function encodeGif(
  frames: Uint8Array<ArrayBuffer>[],
  width: number,
  height: number,
  delayMs: number,
  onProgress?: (value: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: string; value?: number; bytes?: Uint8Array }>) => {
      if (e.data.type === 'progress') onProgress?.(e.data.value ?? 0);
      else if (e.data.type === 'done') {
        worker.terminate();
        resolve(new Blob([e.data.bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'GIF worker failed'));
    };
    const buffers = frames.map((f) =>
      f.byteOffset === 0 && f.byteLength === f.buffer.byteLength ? f.buffer : f.slice().buffer,
    );
    worker.postMessage({ width, height, delay: delayMs, frames: buffers }, buffers);
  });
}
