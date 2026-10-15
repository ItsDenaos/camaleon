import { encodeGif } from '../capture/gif';
import {
  canvasToBlob,
  composeStrip,
  fileName,
  fitSize,
  makeThumb,
  pixelsToCanvas,
} from '../capture/image';
import { CanvasRecorder, canRecordVideo, encodeFrames } from '../capture/recorder';
import * as store from '../capture/store';
import type { CaptureKind, CaptureMeta } from '../capture/store';
import { getEffect } from '../engine/registry';
import { getRenderer, notify } from './controller';
import { savePrefs, type CaptureMode, type TimerSeconds } from './prefs';
import {
  capture,
  captureMode,
  captures,
  capturesOpen,
  flashKey,
  galleryOpen,
  micOn,
  prefs,
  stack,
  status,
  timer,
  viewerId,
} from './state';

/**
 * Capture flows. Photos and strips are rendered at full camera resolution (not the
 * screen size); GIF and boomerang grab small frames in bursts; video copies the live
 * preview into a MediaRecorder canvas.
 */

const PHOTO_MAX = 1920;
const STRIP_SHOT_MAX = 960;
const GIF = { maxSide: 480, fps: 12, seconds: 3 };
const BOOMERANG = { maxSide: 720, fps: 20, seconds: 1.6, outFps: 30, loops: 2 };
const VIDEO = { fps: 30, maxSide: 1920, maxSeconds: 180 };

export const MODES: { id: CaptureMode; label: string }[] = [
  { id: 'photo', label: 'Foto' },
  { id: 'strip', label: 'Fotomatón' },
  { id: 'gif', label: 'GIF' },
  ...(canRecordVideo
    ? [
        { id: 'boomerang' as const, label: 'Boomerang' },
        { id: 'video' as const, label: 'Vídeo' },
      ]
    : []),
];

const KIND_LABEL: Record<CaptureKind, string> = {
  photo: 'Foto',
  strip: 'Fotomatón',
  gif: 'GIF',
  boomerang: 'Boomerang',
  video: 'Vídeo',
};

let abort: AbortController | null = null;
let recording: {
  rec: CanvasRecorder;
  mic: MediaStream | null;
  interval: number;
  thumb: Promise<Blob>;
} | null = null;

// A saved preference may point at a mode this browser can't do (e.g. no MediaRecorder).
if (!MODES.some((m) => m.id === captureMode.value)) captureMode.value = 'photo';

export function isBusy() {
  return capture.value.phase !== 'idle';
}

export async function loadCaptures() {
  try {
    captures.value = await store.listCaptures();
  } catch (err) {
    console.error('[capturas] no se pudieron leer', err);
  }
}

export function setCaptureMode(mode: CaptureMode) {
  if (isBusy()) return;
  captureMode.value = mode;
  prefs.captureMode = mode;
  savePrefs(prefs);
}

export function cycleTimer() {
  const order: TimerSeconds[] = [0, 3, 5, 10];
  const next = order[(order.indexOf(timer.value) + 1) % order.length];
  timer.value = next;
  prefs.timer = next;
  savePrefs(prefs);
  notify(next ? `Temporizador: ${next} s` : 'Temporizador desactivado');
}

export function toggleMic() {
  micOn.value = !micOn.value;
  prefs.mic = micOn.value;
  savePrefs(prefs);
  notify(micOn.value ? 'Vídeo con sonido' : 'Vídeo sin sonido');
}

/** Shutter button / Space: starts the current mode, or stops/cancels what is running. */
export function shutter() {
  const st = capture.value;
  if (st.phase === 'recording') return void stopVideo();
  if (st.phase === 'countdown' || st.phase === 'capturing') return cancelCapture();
  if (st.phase !== 'idle' || status.value !== 'running' || galleryOpen.value) return;
  if (!getRenderer()?.sourceSize()) return;

  const controller = new AbortController();
  abort = controller;
  const flows: Record<CaptureMode, (signal: AbortSignal) => Promise<void>> = {
    photo: takePhoto,
    strip: takeStrip,
    gif: takeGif,
    boomerang: takeBoomerang,
    video: startVideo,
  };
  flows[captureMode.value](controller.signal)
    .catch((err: unknown) => {
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[captura]', err);
      notify(describeSaveError(err), true);
    })
    .finally(() => {
      if (abort === controller) abort = null;
      if (capture.value.phase !== 'recording') capture.value = { phase: 'idle' };
    });
}

/** Esc / tapping the shutter during a countdown or burst. */
export function cancelCapture() {
  abort?.abort();
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

async function takePhoto(signal: AbortSignal) {
  await countdown(timer.value, signal);
  flash();
  const { pixels, width, height } = grabFrame(PHOTO_MAX);
  capture.value = { phase: 'processing', label: 'Guardando foto…', progress: 1 };
  const canvas = pixelsToCanvas(pixels, width, height);
  const blob = await canvasToBlob(canvas, 'image/png');
  await persist('photo', blob, 'image/png', width, height, await makeThumb(canvas, width, height));
}

async function takeStrip(signal: AbortSignal) {
  const shots: HTMLCanvasElement[] = [];
  for (let i = 0; i < 4; i++) {
    await countdown(i === 0 ? timer.value || 3 : 3, signal, { shot: i + 1, shots: 4 });
    flash();
    const f = grabFrame(STRIP_SHOT_MAX);
    shots.push(pixelsToCanvas(f.pixels, f.width, f.height));
  }
  capture.value = { phase: 'processing', label: 'Montando la tira…', progress: 1 };
  const strip = composeStrip(shots);
  const blob = await canvasToBlob(strip, 'image/png');
  const thumb = await makeThumb(strip, strip.width, strip.height);
  await persist('strip', blob, 'image/png', strip.width, strip.height, thumb);
}

async function takeGif(signal: AbortSignal) {
  await countdown(timer.value, signal);
  const b = await burst(GIF.maxSide, GIF.fps, GIF.seconds, false, signal);
  // Thumbnail first: encoding transfers (detaches) the frame buffers to the worker.
  const thumb = await makeThumb(pixelsToCanvas(b.frames[0], b.width, b.height), b.width, b.height);
  capture.value = { phase: 'processing', label: 'Creando GIF…', progress: 0 };
  const blob = await encodeGif(b.frames, b.width, b.height, 1000 / b.fps, (p) => {
    capture.value = { phase: 'processing', label: 'Creando GIF…', progress: p };
  });
  await persist('gif', blob, 'image/gif', b.width, b.height, thumb, GIF.seconds);
}

async function takeBoomerang(signal: AbortSignal) {
  await countdown(timer.value, signal);
  const b = await burst(BOOMERANG.maxSide, BOOMERANG.fps, BOOMERANG.seconds, true, signal);
  const thumb = await makeThumb(pixelsToCanvas(b.frames[0], b.width, b.height), b.width, b.height);
  const n = b.frames.length;
  const once = [...Array(n).keys(), ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => n - 2 - i)];
  const order = Array.from({ length: BOOMERANG.loops }, () => once).flat();
  capture.value = { phase: 'processing', label: 'Creando boomerang…', progress: 0 };
  const out = await encodeFrames(b.frames, b.width, b.height, order, BOOMERANG.outFps, (p) => {
    capture.value = { phase: 'processing', label: 'Creando boomerang…', progress: p };
  });
  await persist('boomerang', out.blob, out.mime, b.width, b.height, thumb, out.duration);
}

async function startVideo(signal: AbortSignal) {
  await countdown(timer.value, signal);
  const renderer = getRenderer();
  const view = renderer?.viewSize();
  if (!renderer || !view) throw new Error('Sin imagen de cámara');

  let mic: MediaStream | null = null;
  if (micOn.value) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      notify('Sin micrófono: se grabará sin sonido');
    }
  }
  if (signal.aborted) {
    mic?.getTracks().forEach((t) => t.stop());
    throw new DOMException('Cancelado', 'AbortError');
  }

  const { width, height } = fitSize(view.width, view.height, VIDEO.maxSide, true);
  const rec = new CanvasRecorder(width, height, VIDEO.fps, mic);
  renderer.onFrameDrawn = (canvas, x, y, w, h) => rec.draw(canvas, x, y, w, h);
  rec.start();
  capture.value = { phase: 'recording', elapsed: 0 };
  const interval = window.setInterval(() => {
    capture.value = { phase: 'recording', elapsed: rec.elapsed };
    if (rec.elapsed >= VIDEO.maxSeconds) {
      notify(`Límite de ${VIDEO.maxSeconds / 60} minutos alcanzado`);
      void stopVideo();
    }
  }, 250);
  const thumb = delay(400).then(() => makeThumb(rec.canvas, width, height));
  recording = { rec, mic, interval, thumb };
}

export async function stopVideo() {
  const cur = recording;
  if (!cur) return;
  recording = null;
  clearInterval(cur.interval);
  const renderer = getRenderer();
  if (renderer) renderer.onFrameDrawn = null;
  capture.value = { phase: 'processing', label: 'Guardando vídeo…', progress: 1 };
  try {
    const out = await cur.rec.stop();
    const thumb = await cur.thumb.catch(() => makeThumb(cur.rec.canvas, cur.rec.width, cur.rec.height));
    await persist('video', out.blob, out.mime, cur.rec.width, cur.rec.height, thumb, out.duration);
  } catch (err) {
    console.error('[vídeo]', err);
    notify(describeSaveError(err), true);
  } finally {
    cur.mic?.getTracks().forEach((t) => t.stop());
    capture.value = { phase: 'idle' };
  }
}

// A hidden tab stops rendering, so the video would freeze: finish it instead.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (recording) void stopVideo();
    else cancelCapture();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flash() {
  flashKey.value++;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelado', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelado', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function countdown(
  seconds: number,
  signal: AbortSignal,
  extra: { shot?: number; shots?: number } = {},
) {
  for (let n = seconds; n > 0; n--) {
    capture.value = { phase: 'countdown', count: n, ...extra };
    await delay(1000, signal);
  }
}

function grabFrame(maxSide: number, even = false) {
  const renderer = getRenderer();
  const src = renderer?.sourceSize();
  if (!renderer || !src) throw new Error('Sin imagen de cámara');
  const { width, height } = fitSize(src.width, src.height, maxSide, even);
  const pixels = renderer.grab(width, height);
  if (!pixels) throw new Error('Sin imagen de cámara');
  return { pixels, width, height };
}

/** Grabs `fps × seconds` frames in real time (one per rendered frame when due). */
function burst(
  maxSide: number,
  fps: number,
  seconds: number,
  even: boolean,
  signal: AbortSignal,
): Promise<{ frames: Uint8Array<ArrayBuffer>[]; width: number; height: number; fps: number }> {
  const renderer = getRenderer();
  const src = renderer?.sourceSize();
  if (!renderer || !src) return Promise.reject(new Error('Sin imagen de cámara'));
  const { width, height } = fitSize(src.width, src.height, maxSide, even);
  const total = Math.round(fps * seconds);
  const interval = 1000 / fps;
  const frames: Uint8Array<ArrayBuffer>[] = [];
  const t0 = performance.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) return reject(new DOMException('Cancelado', 'AbortError'));
      const elapsed = performance.now() - t0;
      if (elapsed >= frames.length * interval) {
        const px = renderer.grab(width, height);
        if (px) frames.push(px);
        capture.value = { phase: 'capturing', progress: frames.length / total };
      }
      if (frames.length >= total) {
        // Real rate, in case the device could not keep up: keeps playback speed true.
        const realFps = Math.min(fps, (frames.length * 1000) / Math.max(1, elapsed + interval));
        resolve({ frames, width, height, fps: realFps });
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

function effectNames(): string[] {
  return stack.value.flatMap((l) => {
    const name = getEffect(l.id)?.name;
    return name ? [name] : [];
  });
}

async function persist(
  kind: CaptureKind,
  blob: Blob,
  mime: string,
  width: number,
  height: number,
  thumb: Blob,
  duration?: number,
) {
  const meta = await store.saveCapture(
    { kind, mime, width, height, duration, effects: effectNames(), thumb },
    blob,
  );
  captures.value = [meta, ...captures.value];
  notify(`${KIND_LABEL[kind]} guardad${kind === 'photo' ? 'a' : 'o'}`);
}

function describeSaveError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'QuotaExceededError') return 'Sin espacio: borra algunas capturas';
  return `No se pudo capturar: ${(err as Error)?.message ?? err}`;
}

// ---------------------------------------------------------------------------
// Captures library actions
// ---------------------------------------------------------------------------

export function kindLabel(kind: CaptureKind) {
  return KIND_LABEL[kind];
}

export function openCaptures() {
  capturesOpen.value = true;
}

export function closeCaptures() {
  capturesOpen.value = false;
  viewerId.value = null;
}

export function openViewer(id: string | null) {
  viewerId.value = id;
}

/** Newer (-1) / older (+1) capture in the viewer. */
export function stepViewer(delta: -1 | 1) {
  const list = captures.value;
  const i = list.findIndex((c) => c.id === viewerId.value);
  const next = list[i + delta];
  if (next) viewerId.value = next.id;
}

export function getCaptureBlob(id: string) {
  return store.getCaptureBlob(id);
}

/** Download: takes the already-loaded blob so it runs inside the user's click. */
export function downloadBlob(meta: CaptureMeta, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(meta.mime, meta.createdAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function shareFile(meta: CaptureMeta, blob: Blob): File | null {
  const file = new File([blob], fileName(meta.mime, meta.createdAt), { type: meta.mime });
  try {
    return navigator.canShare?.({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

/** Web Share API with the file itself (must be called from the click handler). */
export async function shareCapture(file: File) {
  try {
    await navigator.share({ files: [file], title: 'Camaleón' });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') notify('No se pudo compartir', true);
  }
}

export async function removeCapture(id: string) {
  const list = captures.value;
  const i = list.findIndex((c) => c.id === id);
  await store.deleteCapture(id);
  const rest = list.filter((c) => c.id !== id);
  captures.value = rest;
  if (viewerId.value === id) viewerId.value = (rest[i] ?? rest[i - 1])?.id ?? null;
  notify('Captura borrada');
}

export async function removeAllCaptures() {
  await store.deleteAllCaptures();
  captures.value = [];
  viewerId.value = null;
  notify('Capturas borradas');
}

export { storageUsed, isPersistent } from '../capture/store';
