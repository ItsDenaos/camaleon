import { useEffect, useMemo, useState } from 'preact/hooks';
import { useObjectUrl } from './hooks';
import type { CaptureMeta } from '../capture/store';
import {
  MODES,
  closeCaptures,
  cycleTimer,
  downloadBlob,
  getCaptureBlob,
  isPersistent,
  kindLabel,
  openCaptures,
  openViewer,
  removeAllCaptures,
  removeCapture,
  setCaptureMode,
  shareCapture,
  shareFile,
  shutter,
  stepViewer,
  storageUsed,
  toggleMic,
} from './capture';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  ImagesIcon,
  MicIcon,
  MicOffIcon,
  ShareIcon,
  TimerIcon,
  TrashIcon,
} from './icons';
import {
  capture,
  captureMode,
  captures,
  capturesOpen,
  flashKey,
  micOn,
  notice,
  timer,
  viewerId,
} from './state';

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString('es', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Controls in the bottom bar
// ---------------------------------------------------------------------------

const SHUTTER_LABEL = {
  photo: 'Hacer foto',
  strip: 'Hacer fotomatón (4 fotos)',
  gif: 'Crear GIF',
  boomerang: 'Crear boomerang',
  video: 'Grabar vídeo',
} as const;

export function ShutterButton() {
  const st = capture.value;
  const mode = captureMode.value;
  const label =
    st.phase === 'recording'
      ? 'Detener grabación'
      : st.phase === 'countdown' || st.phase === 'capturing'
        ? 'Cancelar'
        : SHUTTER_LABEL[mode];
  const progress = st.phase === 'capturing' || st.phase === 'processing' ? st.progress : 0;
  return (
    <button
      type="button"
      class={`shutter mode-${mode} phase-${st.phase}`}
      aria-label={label}
      title={`${label} (Espacio)`}
      disabled={st.phase === 'processing'}
      style={{ '--p': String(progress) }}
      onClick={shutter}
    >
      <span class="shutter-inner">{mode === 'gif' && st.phase === 'idle' ? 'GIF' : null}</span>
    </button>
  );
}

export function ModeSwitch() {
  const busy = capture.value.phase !== 'idle';
  const current = captureMode.value;
  return (
    <div class="modes" role="radiogroup" aria-label="Modo de captura">
      {MODES.map((m) => (
        <button
          type="button"
          key={m.id}
          role="radio"
          aria-checked={m.id === current}
          class={`mode ${m.id === current ? 'current' : ''}`}
          disabled={busy && m.id !== current}
          onClick={() => setCaptureMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function TimerButton() {
  const t = timer.value;
  return (
    <button
      type="button"
      class="icon-btn"
      aria-label={t ? `Temporizador: ${t} segundos` : 'Temporizador desactivado'}
      title="Temporizador (T)"
      aria-pressed={t > 0}
      disabled={capture.value.phase !== 'idle'}
      onClick={cycleTimer}
    >
      <TimerIcon />
      {t > 0 && <span class="count">{t}</span>}
    </button>
  );
}

export function MicButton() {
  const on = micOn.value;
  return (
    <button
      type="button"
      class="icon-btn"
      aria-label={on ? 'Grabar con sonido' : 'Grabar sin sonido'}
      title={on ? 'Con sonido' : 'Sin sonido'}
      aria-pressed={on}
      disabled={capture.value.phase !== 'idle'}
      onClick={toggleMic}
    >
      {on ? <MicIcon /> : <MicOffIcon />}
    </button>
  );
}

export function LastCaptureButton() {
  const last = captures.value[0];
  const url = useObjectUrl(last?.thumb);
  return (
    <button
      type="button"
      class="last-capture"
      aria-label={`Capturas (${captures.value.length})`}
      title="Mis capturas"
      onClick={openCaptures}
    >
      {url ? <img src={url} alt="" key={last.id} /> : <ImagesIcon />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Overlays: countdown, recording, progress, flash, notices
// ---------------------------------------------------------------------------

export function CaptureOverlays() {
  const st = capture.value;
  return (
    <>
      {st.phase === 'countdown' && (
        <div class="countdown" aria-live="assertive">
          <span class="count-num" key={`${st.shot ?? 0}-${st.count}`}>
            {st.count}
          </span>
          {st.shots && (
            <span class="count-sub">
              Foto {st.shot} de {st.shots}
            </span>
          )}
        </div>
      )}
      {st.phase === 'recording' && (
        <div class="status-pill rec" role="status">
          <span class="rec-dot" /> {formatTime(st.elapsed)}
        </div>
      )}
      {st.phase === 'capturing' && (
        <div class="status-pill" role="status">
          <span class="rec-dot" /> Capturando…
        </div>
      )}
      {st.phase === 'processing' && (
        <div class="status-pill" role="status">
          <span class="spinner small" /> {st.label}
          {st.progress < 1 && <span class="dim"> {Math.round(st.progress * 100)}%</span>}
        </div>
      )}
      {flashKey.value > 0 && <div class="flash" key={flashKey.value} aria-hidden="true" />}
      <Notice />
    </>
  );
}

function Notice() {
  const n = notice.value;
  if (!n) return null;
  return (
    <div class={`notice ${n.error ? 'error' : ''}`} key={n.key} role="status">
      {n.text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captures library
// ---------------------------------------------------------------------------

export function CapturesSheet() {
  return capturesOpen.value ? <CapturesSheetBody /> : null;
}

function CapturesSheetBody() {
  const list = captures.value;
  const [used, setUsed] = useState<number | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    void storageUsed().then(setUsed);
    void isPersistent().then(setPersistent);
  }, [list.length]);

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Capturas">
      <header class="sheet-head">
        <h2>
          Capturas <span class="dim">{list.length}</span>
        </h2>
        {used !== null && list.length > 0 && <span class="dim small">{formatBytes(used)}</span>}
        <div class="spacer" />
        {list.length > 0 &&
          (confirmAll ? (
            <span class="confirm">
              ¿Borrar todas?
              <button
                type="button"
                class="btn small danger"
                onClick={() => {
                  setConfirmAll(false);
                  void removeAllCaptures();
                }}
              >
                Sí
              </button>
              <button type="button" class="btn small" onClick={() => setConfirmAll(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" class="link-btn" onClick={() => setConfirmAll(true)}>
              Borrar todas
            </button>
          ))}
        <button type="button" class="icon-btn small" aria-label="Cerrar capturas" onClick={closeCaptures}>
          <CloseIcon size={18} />
        </button>
      </header>
      {!persistent && (
        <p class="warn">
          Este navegador no deja guardar datos: las capturas se perderán al cerrar la página.
          Descárgalas para conservarlas.
        </p>
      )}
      {list.length === 0 ? (
        <div class="empty">
          <ImagesIcon size={40} />
          <p>Aún no hay capturas.</p>
          <p class="hint">Pulsa el botón redondo (o Espacio) para hacer tu primera foto.</p>
        </div>
      ) : (
        <div class="captures-grid">
          {list.map((c) => (
            <CaptureTile key={c.id} meta={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CaptureTile({ meta }: { meta: CaptureMeta }) {
  const url = useObjectUrl(meta.thumb);
  const badge =
    meta.kind === 'video'
      ? `▶ ${formatTime(meta.duration ?? 0)}`
      : meta.kind === 'photo'
        ? null
        : kindLabel(meta.kind);
  return (
    <button
      type="button"
      class="tile"
      aria-label={`${kindLabel(meta.kind)}, ${formatDate(meta.createdAt)}`}
      onClick={() => openViewer(meta.id)}
    >
      {url && <img src={url} alt="" loading="lazy" />}
      {badge && <span class="tile-badge">{badge}</span>}
    </button>
  );
}

export function CaptureViewer() {
  const meta = captures.value.find((c) => c.id === viewerId.value);
  return meta ? <ViewerBody meta={meta} key={meta.id} /> : null;
}

function ViewerBody({ meta }: { meta: CaptureMeta }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const url = useObjectUrl(blob);
  const file = useMemo(() => (blob ? shareFile(meta, blob) : null), [blob]);

  useEffect(() => {
    let alive = true;
    void getCaptureBlob(meta.id).then((b) => {
      if (!alive) return;
      if (b) setBlob(b);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [meta.id]);

  const list = captures.value;
  const index = list.findIndex((c) => c.id === meta.id);
  const isVideo = meta.mime.startsWith('video/');
  const details = [
    formatDate(meta.createdAt),
    `${meta.width}×${meta.height}`,
    formatBytes(meta.size),
    meta.duration && meta.kind !== 'gif' ? formatTime(meta.duration) : null,
  ].filter(Boolean);

  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label={kindLabel(meta.kind)}>
      <header class="viewer-head">
        <div class="viewer-title">
          <strong>{kindLabel(meta.kind)}</strong>
          <span class="dim"> · {details.join(' · ')}</span>
          {meta.effects.length > 0 && <div class="dim small">{meta.effects.join(' + ')}</div>}
        </div>
        <button type="button" class="icon-btn" aria-label="Cerrar" onClick={() => openViewer(null)}>
          <CloseIcon />
        </button>
      </header>
      <div class="viewer-media">
        {missing ? (
          <p class="hint">No se encontró el archivo de esta captura.</p>
        ) : !url ? (
          <div class="spinner" />
        ) : isVideo ? (
          <video
            src={url}
            controls
            autoplay
            playsInline
            loop={meta.kind === 'boomerang'}
            muted={meta.kind === 'boomerang'}
          />
        ) : (
          <img src={url} alt={kindLabel(meta.kind)} />
        )}
        {index > 0 && (
          <button
            type="button"
            class="icon-btn viewer-nav prev"
            aria-label="Más reciente"
            onClick={() => stepViewer(-1)}
          >
            <ChevronLeftIcon />
          </button>
        )}
        {index < list.length - 1 && (
          <button
            type="button"
            class="icon-btn viewer-nav next"
            aria-label="Más antigua"
            onClick={() => stepViewer(1)}
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>
      <footer class="viewer-actions">
        <button type="button" class="btn" disabled={!blob} onClick={() => blob && downloadBlob(meta, blob)}>
          <DownloadIcon size={18} /> Descargar
        </button>
        {file && (
          <button type="button" class="btn" onClick={() => void shareCapture(file)}>
            <ShareIcon size={18} /> Compartir
          </button>
        )}
        {confirm ? (
          <>
            <button type="button" class="btn danger" onClick={() => void removeCapture(meta.id)}>
              Sí, borrar
            </button>
            <button type="button" class="btn ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" class="btn ghost" onClick={() => setConfirm(true)}>
            <TrashIcon size={18} /> Borrar
          </button>
        )}
      </footer>
    </div>
  );
}
