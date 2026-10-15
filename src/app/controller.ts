import { VisionEngine } from '../ai/vision';
import { CameraController, SupersededError } from '../camera/camera';
import { describeError, errorInfo, type ErrorInfo } from '../camera/errors';
import { VideoSource, type FrameSource } from '../camera/source';
import { TestPatternSource } from '../camera/testPattern';
import { listAssets, putAsset } from '../capture/store';
import {
  defaultValues,
  effects,
  getEffect,
  sanitizeValues,
  valuesToRecord,
} from '../engine/registry';
import type { EffectLayer } from '../engine/types';
import { Renderer, type GalleryCell } from '../render/renderer';
import { savePrefs, savePrefsSoon } from './prefs';
import {
  aiNeedsFace,
  aiStatus,
  currentDeviceId,
  devices,
  effectImages,
  error,
  faceCount,
  fit,
  galleryOpen,
  galleryPage,
  galleryPageCount,
  imageAspect,
  mirror,
  panelOpen,
  prefs,
  showStats,
  sourceKind,
  stack,
  stackMode,
  notice,
  stats,
  status,
  toast,
  type LayerState,
} from './state';

/**
 * Glue between the UI (signals) and the non-UI parts (camera, renderer).
 * UI components call these functions; they never touch WebGL or getUserMedia.
 */

const camera = new CameraController();
let renderer: Renderer | null = null;
let source: FrameSource | null = null;

// Some mobile browsers only deliver frames for videos that are in the document.
camera.video.className = 'camera-feed';
camera.video.setAttribute('aria-hidden', 'true');
document.body.appendChild(camera.video);

camera.onEnded = () => {
  setSource(null);
  showError(errorInfo('ended'));
};
camera.onDevicesChanged = () => void refreshDevices();

// AI: models load lazily and only run while a visible effect needs them.
const vision = new VisionEngine();
vision.getMirror = () => mirror.value;
vision.onMask = (data, w, h) => renderer?.updateMask(data, w, h);
vision.onFaces = (f) => {
  renderer?.updateFaces(f.count, f.centers, f.axes, f.points);
  if (faceCount.value !== f.count) faceCount.value = f.count;
};
vision.onStatus = (st, detail) => {
  aiStatus.value = st;
  if (st === 'error') notify(`No se pudo usar la IA: ${detail ?? 'error desconocido'}`, true);
};

// Dev only: camera/GL modules hold live resources, so edits to them do a full reload
// instead of hot-swapping (which would leave a second render loop running).
import.meta.hot?.accept(() => location.reload());

/** For the capture module, which renders frames on demand. */
export function getRenderer(): Renderer | null {
  return renderer;
}

let noticeKey = 0;

/** Small transient status message at the bottom of the screen. */
export function notify(text: string, isError = false) {
  notice.value = { text, key: ++noticeKey, error: isError };
}

export function attachCanvas(canvas: HTMLCanvasElement): boolean {
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    showError(describeError(err));
    return false;
  }
  renderer.setMirror(mirror.value);
  renderer.setFit(fit.value);
  renderer.onStats = (s) => (stats.value = s);
  renderer.onSourceSize = (w, h) => {
    imageAspect.value = w / h;
    recropImages();
  };
  renderer.onSourceFrame = (src, now) => vision.process(src.element, src.width, src.height, now);
  void restoreEffectImages();
  renderer.setSource(source);
  renderer.prewarm(effects);
  syncStack();
  renderer.start();
  return true;
}

export function detachCanvas() {
  renderer?.dispose();
  renderer = null;
}

/** On load: start straight away if permission was granted before, otherwise show the welcome screen. */
export async function boot() {
  if (status.value === 'error') return; // e.g. WebGL2 missing
  if (await CameraController.isPermissionGranted()) await startCamera();
  else status.value = 'idle';
}

export async function startCamera(deviceId: string | null = prefs.deviceId ?? null) {
  status.value = 'starting';
  error.value = null;
  try {
    const info = await camera.start(deviceId);
    setSource(new VideoSource(camera.video));
    sourceKind.value = 'camera';
    currentDeviceId.value = info.deviceId;
    setMirror(prefs.mirrorByDevice[info.deviceId] ?? info.facingMode !== 'environment', false);
    prefs.deviceId = info.deviceId;
    savePrefs(prefs);
    status.value = 'running';
    await refreshDevices();
  } catch (err) {
    if (err instanceof SupersededError) return; // a newer request is in flight
    setSource(null);
    showError(describeError(err));
  }
}

export function startDemo() {
  camera.stop();
  setSource(new TestPatternSource());
  sourceKind.value = 'demo';
  currentDeviceId.value = null;
  setMirror(false, false);
  error.value = null;
  status.value = 'running';
}

export function switchCamera(deviceId: string) {
  if (deviceId !== currentDeviceId.value || sourceKind.value !== 'camera') void startCamera(deviceId);
}

/** Cycles to the next camera (the "flip" button on phones). */
export function nextCamera() {
  const list = devices.value;
  if (list.length < 2) return;
  const i = list.findIndex((d) => d.deviceId === currentDeviceId.value);
  switchCamera(list[(i + 1) % list.length].deviceId);
}

export function toggleMirror() {
  setMirror(!mirror.value, true);
}

export function toggleFit() {
  fit.value = fit.value === 'contain' ? 'cover' : 'contain';
  renderer?.setFit(fit.value);
  prefs.fit = fit.value;
  savePrefs(prefs);
}

export function toggleStats() {
  showStats.value = !showStats.value;
  prefs.showStats = showStats.value;
  savePrefs(prefs);
}

function setMirror(value: boolean, persist: boolean) {
  mirror.value = value;
  renderer?.setMirror(value);
  const id = currentDeviceId.value;
  if (persist && id && sourceKind.value === 'camera') {
    prefs.mirrorByDevice[id] = value;
    savePrefs(prefs);
  }
}

function setSource(next: FrameSource | null) {
  const prev = source;
  source = next;
  renderer?.setSource(next);
  prev?.dispose();
  if (!next) sourceKind.value = null;
}

async function refreshDevices() {
  try {
    devices.value = await camera.listDevices();
  } catch {
    devices.value = [];
  }
}

function showError(info: ErrorInfo) {
  error.value = info;
  status.value = 'error';
}

// ---------------------------------------------------------------------------
// Effect stack
// ---------------------------------------------------------------------------

let nextUid = 1;
let toastKey = 0;

function newLayer(id: string, values?: readonly number[]): LayerState | null {
  const def = getEffect(id);
  return def ? { uid: nextUid++, id, values: values ?? defaultValues(def) } : null;
}

// Restore the last stack (dropping effects that no longer exist).
stack.value = prefs.stack.flatMap((saved) => {
  const def = getEffect(saved.id);
  const layer = def && newLayer(def.id, sanitizeValues(def, saved.values));
  return layer ? [layer] : [];
});

/** The stack as the renderer consumes it (rebuilt on every change, never per frame). */
let renderLayers: EffectLayer[] = [];

/** Pushes the stack to the renderer (preview and gallery) and persists it. */
function syncStack(saveSoon = false) {
  const layers: EffectLayer[] = [];
  for (const l of stack.value) {
    const def = getEffect(l.id);
    if (def) layers.push({ def, values: l.values });
  }
  renderLayers = layers;
  renderer?.setStack(layers);
  syncGallery();
  prefs.stack = layers.map((l) => ({ id: l.def.id, values: valuesToRecord(l.def, l.values) }));
  if (saveSoon) savePrefsSoon(prefs);
  else savePrefs(prefs);
}

function setStack(next: readonly LayerState[], announceTop = true) {
  stack.value = next;
  syncStack();
  if (announceTop) announce(next.length ? getEffect(next[next.length - 1].id)!.name : 'Normal');
}

function announce(text: string) {
  toast.value = { text, key: ++toastKey };
}

/**
 * Picks an effect from the gallery. Normally it replaces the stack; in stack mode it
 * toggles the effect in/out of the stack. `null` = no effect.
 */
export function selectEffect(id: string | null) {
  const current = stack.value;
  if (id === null) return setStack([]);
  if (stackMode.value) {
    const existing = current.find((l) => l.id === id);
    if (existing) {
      const rest = current.filter((l) => l !== existing);
      stack.value = rest;
      syncStack();
      announce(`− ${getEffect(id)!.name}`);
    } else {
      const layer = newLayer(id);
      if (!layer) return;
      setStack([...current, layer], false);
      announce(`+ ${getEffect(id)!.name}`);
    }
    return;
  }
  // Re-selecting the only active effect keeps its tweaked values.
  if (current.length === 1 && current[0].id === id) return announce(getEffect(id)!.name);
  const layer = newLayer(id);
  if (layer) setStack([layer]);
}

/** ←/→ and swipes: steps through the gallery, replacing the top layer. */
export function cycleEffect(delta: 1 | -1) {
  const ids: (string | null)[] = [null, ...effects.map((e) => e.id)];
  const current = stack.value;
  const top = current.length ? current[current.length - 1].id : null;
  const nextId = ids[(ids.indexOf(top) + delta + ids.length) % ids.length];
  const base = stackMode.value ? current.slice(0, -1).filter((l) => l.id !== nextId) : [];
  const layer = nextId ? newLayer(nextId) : null;
  setStack(layer ? [...base, layer] : base, false);
  announce(nextId ? getEffect(nextId)!.name : 'Normal');
}

export function setParam(uid: number, index: number, value: number) {
  stack.value = stack.value.map((l) =>
    l.uid === uid ? { ...l, values: l.values.map((v, i) => (i === index ? value : v)) } : l,
  );
  syncStack(true);
}

export function resetLayer(uid: number) {
  stack.value = stack.value.map((l) =>
    l.uid === uid ? { ...l, values: defaultValues(getEffect(l.id)!) } : l,
  );
  syncStack();
}

export function removeLayer(uid: number) {
  stack.value = stack.value.filter((l) => l.uid !== uid);
  syncStack();
}

export function moveLayer(uid: number, delta: -1 | 1) {
  const list = [...stack.value];
  const i = list.findIndex((l) => l.uid === uid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  stack.value = list;
  syncStack();
}

export function clearStack() {
  setStack([]);
}

export function toggleStackMode(on = !stackMode.value) {
  if (on === stackMode.value) return;
  stackMode.value = on;
  prefs.stackMode = on;
  savePrefs(prefs);
  syncGallery();
}

export function togglePanel(open = !panelOpen.value) {
  panelOpen.value = open;
  if (open) closeGallery();
}

// ---------------------------------------------------------------------------
// Gallery (live thumbnails drawn by the renderer under a DOM overlay)
// ---------------------------------------------------------------------------

interface MeasuredCell {
  /** Effect id, or null for the "no effect" cell. */
  id: string | null;
  rect: DOMRect;
}

/** Cells of the visible page, normalized to the canvas. */
let galleryCells: { id: string | null; x: number; y: number; w: number; h: number }[] = [];
let galleryRadius = 12;

export function openGallery(withStack?: boolean) {
  if (withStack !== undefined) toggleStackMode(withStack);
  panelOpen.value = false;
  galleryOpen.value = true;
}

export function closeGallery() {
  if (!galleryOpen.value) return;
  galleryOpen.value = false;
  galleryCells = [];
  syncGallery();
}

export function toggleGallery() {
  if (galleryOpen.value) closeGallery();
  else openGallery();
}

export function setGalleryPage(page: number) {
  const count = galleryPageCount.value;
  galleryPage.value = ((page % count) + count) % count;
}

export function stepGalleryPage(delta: 1 | -1) {
  setGalleryPage(galleryPage.value + delta);
}

/** Tap on a thumbnail. Outside stack mode it applies the effect and returns to the preview. */
export function pickFromGallery(id: string | null) {
  selectEffect(id);
  if (!stackMode.value) closeGallery();
}

/** Keyboard 1–9: picks the n-th cell of the visible page. */
export function pickGalleryIndex(index: number) {
  const cell = galleryCells[index];
  if (cell) pickFromGallery(cell.id);
}

/** Called by the gallery overlay after layout with the on-screen rect of each cell. */
export function setGalleryCells(cells: readonly MeasuredCell[], radius: number) {
  const canvas = renderer?.canvas;
  if (!canvas) return;
  const c = canvas.getBoundingClientRect();
  if (c.width === 0 || c.height === 0) return;
  galleryCells = cells.map(({ id, rect }) => ({
    id,
    x: (rect.left - c.left) / c.width,
    y: (rect.top - c.top) / c.height,
    w: rect.width / c.width,
    h: rect.height / c.height,
  }));
  galleryRadius = radius;
  syncGallery();
}

/**
 * What each thumbnail shows. Normal mode: the effect alone (with your tweaks if it is
 * the active one). Stack mode: your current stack + that effect, computed from a shared
 * base so the stack runs once per frame, not once per cell.
 */
function syncGallery() {
  syncAiNeeds();
  if (!renderer) return;
  if (!galleryOpen.value || galleryCells.length === 0) {
    renderer.setGallery(null);
    return;
  }
  const stacking = stackMode.value;
  const current = stack.value;
  const cells: GalleryCell[] = galleryCells.map(({ id, x, y, w, h }) => {
    if (id === null) return { x, y, w, h, layers: [], raw: true };
    const existing = current.find((l) => l.id === id);
    if (stacking && existing) return { x, y, w, h, layers: [], raw: false };
    const def = getEffect(id)!;
    const values = existing && current.length === 1 ? existing.values : defaultValues(def);
    return { x, y, w, h, layers: [{ def, values }], raw: false };
  });
  renderer.setGallery({ base: stacking ? renderLayers : [], cells, radius: galleryRadius });
}

// ---------------------------------------------------------------------------
// AI needs and user images
// ---------------------------------------------------------------------------

/** Which models must run: those needed by the stack and by visible gallery cells. */
function syncAiNeeds() {
  const ids = new Set<string>();
  for (const l of renderLayers) ids.add(l.def.id);
  if (galleryOpen.value) for (const c of galleryCells) if (c.id) ids.add(c.id);
  let segmentation = false;
  let face = false;
  for (const id of ids) {
    const n = getEffect(id)?.needs;
    segmentation ||= !!n?.segmentation;
    face ||= !!n?.face;
  }
  vision.setNeeds({ segmentation, face });
  if (!segmentation) renderer?.clearMask();
  if (!face) {
    renderer?.clearFaces();
    faceCount.value = 0;
  }
  aiNeedsFace.value = renderLayers.some((l) => l.def.needs?.face);
}

/** Originals of user images, kept to re-crop when the camera's aspect ratio changes. */
const imageOriginals = new Map<string, ImageBitmap>();

/** Cover-crops an image to the camera aspect ratio so shaders can sample it with plain uv. */
function cropToAspect(src: ImageBitmap, aspect: number, maxSide = 1600): HTMLCanvasElement {
  let sw = src.width;
  let sh = src.height;
  if (sw / sh > aspect) sw = sh * aspect;
  else sh = sw / aspect;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function applyImage(id: string, bitmap: ImageBitmap | null) {
  imageOriginals.get(id)?.close();
  if (bitmap) imageOriginals.set(id, bitmap);
  else imageOriginals.delete(id);
  renderer?.setImage(id, bitmap ? cropToAspect(bitmap, imageAspect.value) : null);
}

function recropImages() {
  for (const [id, bmp] of imageOriginals) renderer?.setImage(id, cropToAspect(bmp, imageAspect.value));
}

async function restoreEffectImages() {
  try {
    const saved: Record<string, Blob> = {};
    for (const [id, blob] of await listAssets()) {
      applyImage(id, await createImageBitmap(blob));
      saved[id] = blob;
    }
    effectImages.value = saved;
  } catch (err) {
    console.warn('[imágenes] no se pudieron restaurar', err);
  }
}

/**
 * Picks (or removes, with null) a user image for an effect layer, persists it and,
 * if the effect asks for it, switches the layer to the mode that shows it.
 */
export async function setEffectImage(uid: number, key: string, file: Blob | null) {
  const layer = stack.value.find((l) => l.uid === uid);
  const def = layer && getEffect(layer.id);
  if (!def) return;
  const id = `${def.id}/${key}`;
  try {
    applyImage(id, file ? await createImageBitmap(file) : null);
    const next = { ...effectImages.value };
    if (file) next[id] = file;
    else delete next[id];
    effectImages.value = next;
    const sel = def.images?.find((img) => img.key === key)?.selects;
    const index = sel ? def.params.findIndex((p) => p.key === sel.param) : -1;
    if (file && sel && index >= 0) setParam(uid, index, sel.value);
    await putAsset(id, file);
  } catch (err) {
    console.error('[imágenes]', err);
    notify('No se pudo usar esa imagen', true);
  }
}
