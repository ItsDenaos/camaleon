/** Preferred containers: MP4 plays everywhere (and is what Safari records); WebM as fallback. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export const canRecordVideo =
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function';

function pickMime(): string {
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
  return ''; // let the browser decide
}

/**
 * Records whatever is drawn into its own 2D canvas. The live preview copies the image
 * area of the WebGL canvas into it right after each frame (no letterbox, no UI).
 */
export class CanvasRecorder {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly stream: MediaStream;
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly track: CanvasCaptureMediaStreamTrack | null;
  private readonly manual: boolean;
  private readonly frameMs: number;
  private lastPush = -Infinity;
  private startedAt = 0;

  /**
   * Frames enter the video explicitly (requestFrame) rather than being sampled from the
   * canvas, so every drawn frame counts once. Falls back to sampling at `fps` where
   * requestFrame is missing.
   */
  constructor(
    readonly width: number,
    readonly height: number,
    readonly fps: number,
    audio: MediaStream | null,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);
    let stream = this.canvas.captureStream(0);
    let track = (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;
    this.manual = typeof track?.requestFrame === 'function';
    if (!this.manual) {
      stream.getTracks().forEach((t) => t.stop());
      stream = this.canvas.captureStream(fps);
      track = (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;
    }
    this.stream = stream;
    this.track = track;
    this.frameMs = 1000 / fps;
    audio?.getAudioTracks().forEach((t) => this.stream.addTrack(t));
    const mimeType = pickMime();
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: Math.round(Math.min(8e6, width * height * fps * 0.15)),
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
  }

  /**
   * Live recording: copies a region of `source` (e.g. the WebGL canvas) as the next frame,
   * at most `fps` times per second (the preview may render faster).
   */
  draw(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
    const now = performance.now();
    if (now - this.lastPush < this.frameMs - 2) return;
    this.lastPush = now;
    this.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, this.width, this.height);
    this.pushFrame();
  }

  /** Commits what is currently on the canvas as the next video frame. */
  pushFrame() {
    if (this.manual) this.track?.requestFrame();
  }

  start() {
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  /** Seconds since start(). */
  get elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<{ blob: Blob; mime: string; duration: number }> {
    const duration = this.elapsed;
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        // Our own video track only; audio tracks belong to the caller's mic stream.
        this.stream.getVideoTracks().forEach((t) => t.stop());
        const mime = (this.recorder.mimeType || 'video/webm').split(';')[0];
        resolve({ blob: new Blob(this.chunks, { type: mime }), mime, duration });
      };
      this.recorder.onerror = () => reject(new Error('MediaRecorder error'));
      if (this.recorder.state === 'inactive') this.recorder.onstop.call(this.recorder, new Event('stop'));
      else this.recorder.stop();
    });
  }
}

/**
 * Plays RGBA frames in the given order at `fps` into a recorder (real time) and
 * returns the video. Used for boomerangs: forward, then backward, looped.
 */
export async function encodeFrames(
  frames: Uint8Array<ArrayBuffer>[],
  width: number,
  height: number,
  order: readonly number[],
  fps: number,
  onProgress?: (value: number) => void,
): Promise<{ blob: Blob; mime: string; duration: number }> {
  const rec = new CanvasRecorder(width, height, fps, null);
  const images = frames.map(
    (f) => new ImageData(new Uint8ClampedArray(f.buffer, f.byteOffset, width * height * 4), width, height),
  );
  rec.ctx.putImageData(images[order[0]], 0, 0);
  rec.start();
  rec.pushFrame();
  const frameMs = 1000 / fps;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    let shown = 0;
    const tick = () => {
      const due = Math.min(order.length - 1, Math.floor((performance.now() - t0) / frameMs));
      if (due !== shown) {
        shown = due;
        rec.ctx.putImageData(images[order[due]], 0, 0);
        rec.pushFrame();
        onProgress?.((due + 1) / order.length);
      }
      if (performance.now() - t0 >= order.length * frameMs) resolve();
      else setTimeout(tick, frameMs / 3); // timers keep running even if rAF pauses
    };
    tick();
  });
  const out = await rec.stop();
  return { ...out, duration: order.length / fps };
}
