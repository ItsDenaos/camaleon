import { useLayoutEffect, useRef } from 'preact/hooks';
import { getEffect } from '../engine/registry';
import type { EffectParam } from '../engine/types';
import {
  clearStack,
  cycleEffect,
  moveLayer,
  openGallery,
  removeLayer,
  resetLayer,
  setGalleryPage,
  setParam,
  stepGalleryPage,
  toggleGallery,
  togglePanel,
  setEffectImage,
} from './controller';
import { useObjectUrl } from './hooks';
import {
  LastCaptureButton,
  MicButton,
  ModeSwitch,
  ShutterButton,
  TimerButton,
} from './CaptureUI';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  GridIcon,
  ImagesIcon,
  PlusIcon,
  ResetIcon,
  SlidersIcon,
} from './icons';
import {
  aiNeedsFace,
  aiStatus,
  capture,
  captureMode,
  effectImages,
  faceCount,
  galleryOpen,
  galleryPage,
  galleryPageCount,
  panelOpen,
  stack,
  toast,
  type LayerState,
} from './state';

/**
 * Bottom controls, three rows:
 *   [‹ current effect ›]
 *   Foto · Fotomatón · GIF · Boomerang · Vídeo
 *   [capturas] [efectos]   ( shutter )   [mic] [temporizador] [ajustes]
 * With the gallery open only the last row stays, with its pager in the middle.
 * Publishes its height as --footer-h so panels and the gallery sit above it.
 */
export function BottomBar() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--footer-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layers = stack.value;
  const name = layers.length
    ? layers.map((l) => getEffect(l.id)?.name ?? l.id).join(' + ')
    : 'Normal';
  const open = galleryOpen.value;
  const busy = capture.value.phase !== 'idle';
  return (
    <footer class="bottombar" ref={ref}>
      {!open && (
        <div class="bar-row">
          <EffectNav name={name} />
        </div>
      )}
      {!open && (
        <div class="bar-row">
          <ModeSwitch />
        </div>
      )}
      <div class="bar-row main">
        <div class="bar-side">
          {!open && <LastCaptureButton />}
          {!busy && (
            <button
              type="button"
              class={`icon-btn ${open ? 'active-solid' : ''}`}
              aria-pressed={open}
              aria-label="Galería de efectos"
              title="Galería de efectos (E)"
              onClick={toggleGallery}
            >
              <GridIcon />
            </button>
          )}
        </div>
        <div class="bar-center">{open ? <Pager /> : <ShutterButton />}</div>
        <div class="bar-side end">
          {!open && captureMode.value === 'video' && <MicButton />}
          {!open && <TimerButton />}
          <button
            type="button"
            class="icon-btn"
            aria-pressed={panelOpen.value}
            aria-label="Ajustes de efectos"
            title="Ajustes de efectos"
            onClick={() => togglePanel()}
          >
            <SlidersIcon />
            {layers.length > 0 && <span class="count">{layers.length}</span>}
          </button>
        </div>
      </div>
    </footer>
  );
}

function EffectNav({ name }: { name: string }) {
  return (
    <div class="effect-nav">
      <button
        type="button"
        class="icon-btn ghost"
        aria-label="Efecto anterior"
        title="Efecto anterior (←)"
        onClick={() => cycleEffect(-1)}
      >
        <ChevronLeftIcon />
      </button>
      <button type="button" class="effect-name" title={name} onClick={() => openGallery()}>
        {name}
      </button>
      <button
        type="button"
        class="icon-btn ghost"
        aria-label="Efecto siguiente"
        title="Efecto siguiente (→)"
        onClick={() => cycleEffect(1)}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

function Pager() {
  const count = galleryPageCount.value;
  const page = galleryPage.value;
  return (
    <nav class="effect-nav" aria-label="Páginas de la galería">
      <button
        type="button"
        class="icon-btn ghost"
        aria-label="Página anterior"
        disabled={count < 2}
        onClick={() => stepGalleryPage(-1)}
      >
        <ChevronLeftIcon />
      </button>
      <div class="dots">
        {Array.from({ length: count }, (_, i) => (
          <button
            type="button"
            key={i}
            class={`dot ${i === page ? 'current' : ''}`}
            aria-label={`Página ${i + 1} de ${count}`}
            aria-current={i === page ? 'page' : undefined}
            onClick={() => setGalleryPage(i)}
          />
        ))}
      </div>
      <button
        type="button"
        class="icon-btn ghost"
        aria-label="Página siguiente"
        disabled={count < 2}
        onClick={() => stepGalleryPage(1)}
      >
        <ChevronRightIcon />
      </button>
    </nav>
  );
}

/** Sliders for every layer in the stack, in application order. */
export function StackPanel() {
  if (!panelOpen.value) return null;
  const layers = stack.value;
  return (
    <aside class="panel" aria-label="Ajustes de efectos">
      <header class="panel-head">
        <h2>{layers.length > 1 ? `Efectos (${layers.length})` : 'Ajustes'}</h2>
        {layers.length > 1 && (
          <button type="button" class="link-btn" onClick={clearStack}>
            Quitar todos
          </button>
        )}
        <button
          type="button"
          class="icon-btn small"
          aria-label="Cerrar ajustes"
          onClick={() => togglePanel(false)}
        >
          <CloseIcon size={18} />
        </button>
      </header>
      <div class="panel-body">
        {layers.length === 0 && (
          <p class="hint">Sin efectos. Elige uno en la galería o añade varios para combinarlos.</p>
        )}
        {layers.map((l, i) => (
          <LayerCard key={l.uid} layer={l} index={i} count={layers.length} />
        ))}
        <button type="button" class="btn small add-btn" onClick={() => openGallery(true)}>
          <PlusIcon size={16} /> Añadir efecto
        </button>
      </div>
    </aside>
  );
}

function LayerCard({ layer, index, count }: { layer: LayerState; index: number; count: number }) {
  const def = getEffect(layer.id);
  if (!def) return null;
  return (
    <section class="layer">
      <div class="layer-head">
        {count > 1 && <span class="layer-num">{index + 1}</span>}
        <h3>{def.name}</h3>
        <div class="layer-actions">
          {count > 1 && (
            <>
              <button
                type="button"
                class="icon-btn small"
                aria-label="Aplicar antes"
                title="Aplicar antes"
                disabled={index === 0}
                onClick={() => moveLayer(layer.uid, -1)}
              >
                <ChevronUpIcon size={16} />
              </button>
              <button
                type="button"
                class="icon-btn small"
                aria-label="Aplicar después"
                title="Aplicar después"
                disabled={index === count - 1}
                onClick={() => moveLayer(layer.uid, 1)}
              >
                <ChevronDownIcon size={16} />
              </button>
            </>
          )}
          {def.params.length > 0 && (
            <button
              type="button"
              class="icon-btn small"
              aria-label={`Restablecer ${def.name}`}
              title="Restablecer valores"
              onClick={() => resetLayer(layer.uid)}
            >
              <ResetIcon size={16} />
            </button>
          )}
          <button
            type="button"
            class="icon-btn small"
            aria-label={`Quitar ${def.name}`}
            title="Quitar efecto"
            onClick={() => removeLayer(layer.uid)}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      {def.params.map((p, k) => (
        <ParamControl
          key={p.key}
          param={p}
          value={layer.values[k]}
          onChange={(v) => setParam(layer.uid, k, v)}
        />
      ))}
      {def.images?.map((img) => (
        <ImagePicker key={img.key} uid={layer.uid} effectId={def.id} imgKey={img.key} label={img.label} />
      ))}
    </section>
  );
}

/** Lets the user pick a photo for an effect (stored locally, never uploaded). */
function ImagePicker(props: { uid: number; effectId: string; imgKey: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const blob = effectImages.value[`${props.effectId}/${props.imgKey}`];
  const url = useObjectUrl(blob);
  return (
    <div class="param">
      <span class="param-label">{props.label}</span>
      <div class="image-pick">
        {url ? (
          <img class="image-thumb" src={url} alt="" />
        ) : (
          <span class="image-thumb empty">
            <ImagesIcon size={18} />
          </span>
        )}
        <button type="button" class="btn small" onClick={() => input.current?.click()}>
          {blob ? 'Cambiar' : 'Elegir imagen…'}
        </button>
        {blob && (
          <button
            type="button"
            class="btn small ghost"
            onClick={() => void setEffectImage(props.uid, props.imgKey, null)}
          >
            Quitar
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void setEffectImage(props.uid, props.imgKey, file);
          }}
        />
      </div>
    </div>
  );
}

/** "Preparando IA…" while models load, and a hint when a face filter finds no face. */
export function AiStatusPill() {
  if (galleryOpen.value || capture.value.phase !== 'idle') return null;
  const st = aiStatus.value;
  if (st === 'loading') {
    return (
      <div class="status-pill" role="status">
        <span class="spinner small" /> Preparando IA…
      </div>
    );
  }
  if (st === 'ready' && aiNeedsFace.value && faceCount.value === 0) {
    return (
      <div class="status-pill delayed" role="status">
        Buscando una cara…
      </div>
    );
  }
  return null;
}

const isToggle = (p: EffectParam) => !p.options && p.step === 1 && p.max - p.min === 1;

/**
 * Human-friendly readout: integers as-is; otherwise 0–100 % of the range, or ±100
 * around zero for signed params.
 */
function formatValue(p: EffectParam, v: number): string {
  if (p.step === 1) return String(Math.round(v));
  if (p.min < 0 && p.max > 0) {
    const n = Math.round((v / Math.max(-p.min, p.max)) * 100);
    return n > 0 ? `+${n}` : String(n);
  }
  return String(Math.round(((v - p.min) / (p.max - p.min)) * 100));
}

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: EffectParam;
  value: number;
  onChange: (v: number) => void;
}) {
  if (param.options) {
    const current = Math.round(value);
    return (
      <div class="param" role="group" aria-label={param.label}>
        <span class="param-label">{param.label}</span>
        <div class="segmented">
          {param.options.map((label, i) => {
            const v = param.min + i;
            return (
              <button
                type="button"
                key={label}
                class={v === current ? 'current' : ''}
                aria-pressed={v === current}
                onClick={() => onChange(v)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (isToggle(param)) {
    return (
      <label class="param toggle">
        <span>{param.label}</span>
        <input
          type="checkbox"
          role="switch"
          checked={value > (param.min + param.max) / 2}
          onChange={(e) => onChange(e.currentTarget.checked ? param.max : param.min)}
        />
      </label>
    );
  }
  const pct = ((value - param.min) / (param.max - param.min)) * 100;
  return (
    <label class="param" title="Doble clic para restablecer">
      <span class="param-label">
        {param.label}
        <output>{formatValue(param, value)}</output>
      </span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step ?? (param.max - param.min) / 100}
        value={value}
        style={{ '--pct': `${pct}%` }}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        onDblClick={() => onChange(param.default)}
      />
    </label>
  );
}

/** Big effect name that fades out after a change. */
export function EffectToast() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class="toast" key={t.key} aria-live="polite">
      {t.text}
    </div>
  );
}
