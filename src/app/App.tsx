import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  cancelCapture,
  closeCaptures,
  cycleTimer,
  isBusy,
  loadCaptures,
  openViewer,
  shutter,
  stepViewer,
} from './capture';
import { CaptureOverlays, CaptureViewer, CapturesSheet } from './CaptureUI';
import { applyUpdate, dismissUpdate, initPwa, promptInstall } from './pwa';
import { AiStatusPill, BottomBar, EffectToast, StackPanel } from './EffectsUI';
import { Gallery } from './Gallery';
import {
  attachCanvas,
  boot,
  closeGallery,
  cycleEffect,
  detachCanvas,
  openGallery,
  pickGalleryIndex,
  nextCamera,
  startCamera,
  startDemo,
  switchCamera,
  toggleFit,
  stepGalleryPage,
  toggleMirror,
  togglePanel,
  toggleStats,
} from './controller';
import {
  AlertIcon,
  CameraIcon,
  CloseIcon,
  DownloadIcon,
  ContainIcon,
  CoverIcon,
  LockIcon,
  LogoMark,
  MirrorIcon,
  RetryIcon,
  SparkleIcon,
  StatsIcon,
  SwitchCameraIcon,
} from './icons';
import {
  capture,
  capturesOpen,
  currentDeviceId,
  devices,
  installAvailable,
  updateReady,
  error,
  fit,
  galleryOpen,
  mirror,
  showStats,
  sourceKind,
  stats,
  status,
  viewerId,
} from './state';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (attachCanvas(canvasRef.current!)) void boot();
    void loadCaptures();
    void initPwa();
    return detachCanvas;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.closest?.('input, select, textarea, [contenteditable], video')) return;

      // Capture library and viewer work even without a camera.
      if (viewerId.value) {
        if (e.key === 'Escape') openViewer(null);
        else if (e.key === 'ArrowLeft') stepViewer(-1);
        else if (e.key === 'ArrowRight') stepViewer(1);
        else return;
        e.preventDefault();
        return;
      }
      if (capturesOpen.value) {
        if (e.key === 'Escape') closeCaptures();
        else return;
        e.preventDefault();
        return;
      }

      if (status.value !== 'running') return;
      // Space is the shutter everywhere in the live view (buttons still activate with Enter).
      if (e.key === ' ' && !galleryOpen.value) {
        e.preventDefault();
        if (!e.repeat) shutter();
        return;
      }
      if (isBusy()) {
        if (e.key === 'Escape' && capture.value.phase !== 'recording') cancelCapture();
        else if (e.key === 'ArrowRight') cycleEffect(1);
        else if (e.key === 'ArrowLeft') cycleEffect(-1);
        else return;
        e.preventDefault();
        return;
      }
      if (galleryOpen.value) {
        if (e.key === 'ArrowRight') stepGalleryPage(1);
        else if (e.key === 'ArrowLeft') stepGalleryPage(-1);
        else if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') closeGallery();
        else if (/^[1-9]$/.test(e.key)) pickGalleryIndex(Number(e.key) - 1);
        else return;
      } else {
        if (e.key === 'ArrowRight') cycleEffect(1);
        else if (e.key === 'ArrowLeft') cycleEffect(-1);
        else if (e.key === 'e' || e.key === 'E') openGallery();
        else if (e.key === 't' || e.key === 'T') cycleTimer();
        else if (e.key === 'Escape') togglePanel(false);
        else return;
      }
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Horizontal swipe on the preview changes effect (mobile).
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || status.value !== 'running') return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.timeStamp - start.t < 600) {
      cycleEffect(dx < 0 ? 1 : -1);
    }
  };

  const s = status.value;
  const live = s === 'running' || (s === 'starting' && sourceKind.value !== null);
  return (
    <div class="app">
      <canvas
        ref={canvasRef}
        class="stage"
        aria-label="Vista previa de la cámara"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      />
      <TopBar />
      {live && galleryOpen.value && <Gallery />}
      {live && <EffectToast />}
      {live && <StackPanel />}
      {live && <BottomBar />}
      {live && <CaptureOverlays />}
      {live && <AiStatusPill />}
      <CapturesSheet />
      <CaptureViewer />
      {updateReady.value && <UpdateBanner />}
      {sourceKind.value === 'demo' &&
        s === 'running' &&
        !galleryOpen.value &&
        capture.value.phase === 'idle' && <DemoBanner />}
      {s === 'idle' && <StartScreen />}
      {s === 'starting' && <Starting overlay={sourceKind.value === null} />}
      {s === 'error' && <ErrorScreen />}
    </div>
  );
}

function TopBar() {
  const running = status.value === 'running' || status.value === 'starting';
  const camList = devices.value;
  // Switching cameras mid-recording would change the image size under the recorder.
  const isCamera = sourceKind.value === 'camera' && capture.value.phase !== 'recording';
  return (
    <header class="topbar">
      <div class="brand">
        <LogoMark />
        <span class="brand-name">Camaleón</span>
      </div>
      <div class="spacer" />
      {installAvailable.value && (
        <IconButton label="Instalar app" onClick={() => void promptInstall()}>
          <DownloadIcon />
        </IconButton>
      )}
      {running && (
        <>
          {showStats.value && <StatsChip />}
          <IconButton label="Mostrar rendimiento" pressed={showStats.value} onClick={toggleStats}>
            <StatsIcon />
          </IconButton>
          {isCamera && camList.length > 1 && (
            <>
              <label class="select hide-narrow">
                <CameraIcon size={18} />
                <select
                  aria-label="Cámara"
                  value={currentDeviceId.value ?? ''}
                  onChange={(e) => switchCamera(e.currentTarget.value)}
                >
                  {camList.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <IconButton label="Cambiar de cámara" class="show-narrow" onClick={nextCamera}>
                <SwitchCameraIcon />
              </IconButton>
            </>
          )}
          <IconButton label="Modo espejo" pressed={mirror.value} onClick={toggleMirror}>
            <MirrorIcon />
          </IconButton>
          <IconButton
            label={fit.value === 'contain' ? 'Llenar pantalla' : 'Ver imagen completa'}
            onClick={toggleFit}
          >
            {fit.value === 'contain' ? <CoverIcon /> : <ContainIcon />}
          </IconButton>
        </>
      )}
    </header>
  );
}

function StatsChip() {
  const { fps, sourceFps, width, height } = stats.value;
  const tone = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad';
  return (
    <div class={`chip stats ${tone}`} role="status" aria-live="off">
      <span>{Math.round(fps)} fps</span>
      <span class="dim">cám {Math.round(sourceFps)}</span>
      <span class="dim hide-narrow">
        {width}×{height}
      </span>
    </div>
  );
}

function StartScreen() {
  return (
    <div class="overlay">
      <div class="card">
        <div class="hero-logo">
          <LogoMark size={72} />
        </div>
        <h1>Camaleón</h1>
        <p class="lead">Efectos en tiempo real para tu webcam.</p>
        <div class="actions">
          <button class="btn primary" onClick={() => void startCamera()} autoFocus>
            <CameraIcon /> Activar cámara
          </button>
          <button class="btn ghost" onClick={startDemo}>
            <SparkleIcon /> Probar sin cámara
          </button>
        </div>
        <p class="privacy">
          <LockIcon size={16} /> Todo se procesa en tu dispositivo. Nada se sube a internet.
        </p>
      </div>
    </div>
  );
}

function Starting({ overlay }: { overlay: boolean }) {
  return (
    <div class={overlay ? 'overlay' : 'overlay subtle'}>
      <div class="card">
        <div class="spinner" aria-hidden="true" />
        <p class="lead">Conectando con la cámara…</p>
        {overlay && <p class="hint">Si el navegador te pregunta, pulsa «Permitir».</p>}
      </div>
    </div>
  );
}

function ErrorScreen() {
  const e = error.value;
  if (!e) return null;
  return (
    <div class="overlay">
      <div class="card" role="alert">
        <div class="error-icon">
          <AlertIcon size={32} />
        </div>
        <h2>{e.title}</h2>
        <p class="lead">{e.message}</p>
        {e.hint && <p class="hint">{e.hint}</p>}
        <div class="actions">
          {e.retryable && (
            <button class="btn primary" onClick={() => void startCamera()} autoFocus>
              <RetryIcon /> Reintentar
            </button>
          )}
          {e.kind !== 'webgl' && (
            <button class="btn ghost" onClick={startDemo}>
              <SparkleIcon /> Probar sin cámara
            </button>
          )}
        </div>
        {e.detail && (
          <details class="detail">
            <summary>Detalles técnicos</summary>
            <code>{e.detail}</code>
          </details>
        )}
      </div>
    </div>
  );
}

/** A new version finished downloading: offer to reload (never automatically). */
function UpdateBanner() {
  const busy = capture.value.phase !== 'idle';
  return (
    <div class="update-banner" role="status">
      <span>Hay una versión nueva de Camaleón</span>
      <button
        type="button"
        class="btn small primary"
        disabled={busy}
        title={busy ? 'Termina la captura primero' : undefined}
        onClick={applyUpdate}
      >
        Actualizar
      </button>
      <button type="button" class="icon-btn small" aria-label="Ahora no" onClick={dismissUpdate}>
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

function DemoBanner() {
  return (
    <div class="demo-banner">
      <span>Modo demo</span>
      <button class="btn small" onClick={() => void startCamera()}>
        <CameraIcon size={16} /> Usar cámara
      </button>
    </div>
  );
}

function IconButton(props: {
  label: string;
  pressed?: boolean;
  class?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={`icon-btn ${props.class ?? ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
