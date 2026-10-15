import type { FaceLandmarker, ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';
import { FaceTracker } from './face';

export type AiStatus = 'off' | 'loading' | 'ready' | 'error';

export interface AiNeeds {
  segmentation: boolean;
  face: boolean;
}

/** Same origin as the app (public/): no CDN, works offline. */
const BASE = import.meta.env.BASE_URL;
const WASM = `${BASE}mediapipe/wasm`;
const SEGMENTER_MODEL = `${BASE}models/selfie_segmenter.tflite`;
const FACE_MODEL = `${BASE}models/face_landmarker.task`;

/** Above this average inference time (ms) only every other camera frame is analysed. */
const SLOW_MS = 22;
/**
 * The segmenter's mask comes back at the input size, so it gets a downscaled copy of the
 * frame (the model itself works at 256 px): keeps the per-frame mask work tiny.
 */
const SEG_INPUT = 256;

type Vision = typeof import('@mediapipe/tasks-vision');
type Fileset = Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>>;

/**
 * Runs MediaPipe on camera frames, but only the models some visible effect needs, and
 * only once loaded (lazily, on first need). Runs on the main thread right after each
 * frame upload; with both models active they alternate frames to keep the budget.
 */
export class VisionEngine {
  private needs: AiNeeds = { segmentation: false, face: false };
  private lib: Promise<Vision> | null = null;
  private fileset: Promise<Fileset> | null = null;
  private segmenter: ImageSegmenter | null = null;
  private landmarker: FaceLandmarker | null = null;
  private loading = 0;
  private readonly pending = new Set<'segmenter' | 'landmarker'>();
  private failed: string | null = null;
  private lastTs = 0;
  private turn = 0;
  private skip = 0;
  private avgMs = 0;
  private maskState: Float32Array | null = null;
  private maskBytes: Uint8Array | null = null;
  private loggedMasks = false;
  private segCanvas: HTMLCanvasElement | null = null;
  private segCtx: CanvasRenderingContext2D | null = null;
  readonly faces = new FaceTracker();
  status: AiStatus = 'off';

  onStatus: ((status: AiStatus, detail?: string) => void) | null = null;
  onMask: ((data: Uint8Array, width: number, height: number) => void) | null = null;
  onFaces: ((faces: FaceTracker) => void) | null = null;
  /** Whether the preview is mirrored (face coordinates must follow it). */
  getMirror: () => boolean = () => false;

  setNeeds(needs: AiNeeds) {
    if (!needs.segmentation) this.maskState = null; // no ghost of an old mask on restart
    if (!needs.face) this.faces.reset();
    this.needs = needs;
    if (needs.segmentation && !this.segmenter) void this.load('segmenter');
    if (needs.face && !this.landmarker) void this.load('landmarker');
    this.updateStatus();
  }

  /** Call once per new camera frame. */
  process(source: TexImageSource, width: number, height: number, now: number) {
    const seg = this.needs.segmentation ? this.segmenter : null;
    const face = this.needs.face ? this.landmarker : null;
    if (!seg && !face) return;
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    let doSeg = !!seg;
    let doFace = !!face;
    if (seg && face) {
      doSeg = this.turn++ % 2 === 0;
      doFace = !doSeg;
    }
    const ts = this.nextTs(now);
    const t0 = performance.now();
    try {
      if (doSeg && seg) seg.segmentForVideo(this.segInput(source, width, height), ts, (r) => this.handleMask(r));
      if (doFace && face) {
        const r = face.detectForVideo(source, ts);
        this.faces.update(r.faceLandmarks, width / height, this.getMirror());
        this.onFaces?.(this.faces);
      }
    } catch (err) {
      console.error('[IA] fallo al procesar', err);
      this.fail(err);
      return;
    }
    // Clamp outliers (GC, tab switches) so one slow frame doesn't halve the AI rate for long.
    this.avgMs = this.avgMs * 0.9 + Math.min(60, performance.now() - t0) * 0.1;
    if (this.avgMs > SLOW_MS) this.skip = 1;
  }

  /** MediaPipe needs strictly increasing timestamps per task. */
  private nextTs(now: number) {
    this.lastTs = Math.max(this.lastTs + 1, Math.round(now));
    return this.lastTs;
  }

  /** Draws the frame into a small canvas (long side SEG_INPUT) for the segmenter. */
  private segInput(source: TexImageSource, width: number, height: number): HTMLCanvasElement {
    const k = SEG_INPUT / Math.max(width, height);
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    if (!this.segCanvas) {
      this.segCanvas = document.createElement('canvas');
      this.segCtx = this.segCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }
    const c = this.segCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.segCtx!.drawImage(source as CanvasImageSource, 0, 0, w, h);
    return c;
  }

  private handleMask(result: ImageSegmenterResult) {
    const masks = result.confidenceMasks;
    if (!masks?.length) return;
    if (import.meta.env.DEV && !this.loggedMasks) {
      this.loggedMasks = true;
      console.info(`[IA] segmentador: ${masks.length} máscara(s) de ${masks[0].width}×${masks[0].height}`);
    }
    // Single-output selfie models give the person probability; multi-class ones put
    // background first, so the person/foreground is the last mask.
    const mask = masks[masks.length - 1];
    const data = mask.getAsFloat32Array();
    const { width, height } = mask;
    const n = width * height;
    if (!this.maskState || this.maskState.length !== n) {
      this.maskState = Float32Array.from(data);
      this.maskBytes = new Uint8Array(n);
    } else {
      // Temporal smoothing: kills edge flicker between frames.
      const s = this.maskState;
      for (let i = 0; i < n; i++) s[i] += (data[i] - s[i]) * 0.6;
    }
    const s = this.maskState;
    const out = this.maskBytes!;
    for (let i = 0; i < n; i++) out[i] = s[i] <= 0 ? 0 : s[i] >= 1 ? 255 : (s[i] * 255) | 0;
    this.onMask?.(out, width, height);
  }

  private async load(kind: 'segmenter' | 'landmarker') {
    if (this.failed || this.pending.has(kind)) return;
    this.pending.add(kind);
    this.loading++;
    this.updateStatus();
    try {
      this.lib ??= import('@mediapipe/tasks-vision');
      const vision = await this.lib;
      this.fileset ??= vision.FilesetResolver.forVisionTasks(WASM);
      const fileset = await this.fileset;
      if (kind === 'segmenter' && !this.segmenter) {
        const segmenter = await withGpuFallback((delegate) =>
          vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          }),
        );
        // The first inference compiles GPU shaders (~2 s): pay it now, while "loading".
        segmenter.segmentForVideo(warmupFrame(), this.nextTs(performance.now()), () => {});
        this.segmenter = segmenter;
      } else if (kind === 'landmarker' && !this.landmarker) {
        const landmarker = await withGpuFallback((delegate) =>
          vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate },
            runningMode: 'VIDEO',
            numFaces: 2,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        );
        landmarker.detectForVideo(warmupFrame(), this.nextTs(performance.now()));
        this.landmarker = landmarker;
      }
    } catch (err) {
      console.error(`[IA] no se pudo cargar (${kind})`, err);
      this.fail(err);
    } finally {
      this.pending.delete(kind);
      this.loading--;
      this.updateStatus();
    }
  }

  private fail(err: unknown) {
    this.failed = err instanceof Error ? err.message : String(err);
    this.updateStatus();
  }

  private updateStatus() {
    const wanted = this.needs.segmentation || this.needs.face;
    const next: AiStatus = this.failed
      ? 'error'
      : !wanted
        ? 'off'
        : this.loading > 0 ||
            (this.needs.segmentation && !this.segmenter) ||
            (this.needs.face && !this.landmarker)
          ? 'loading'
          : 'ready';
    if (next === this.status) return;
    this.status = next;
    this.onStatus?.(next, this.failed ?? undefined);
  }
}

let warmup: HTMLCanvasElement | null = null;

/** A small grey frame to run each model once right after loading. */
function warmupFrame(): HTMLCanvasElement {
  if (!warmup) {
    warmup = document.createElement('canvas');
    warmup.width = SEG_INPUT;
    warmup.height = 144;
    const ctx = warmup.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, warmup.width, warmup.height);
  }
  return warmup;
}

/** Prefers the GPU delegate (much faster) and falls back to CPU where it is unavailable. */
async function withGpuFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch (err) {
    console.warn('[IA] GPU no disponible, usando CPU', err);
    return create('CPU');
  }
}
