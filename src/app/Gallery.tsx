import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { effects } from '../engine/registry';
import { closeGallery, pickFromGallery, setGalleryCells, stepGalleryPage, toggleStackMode } from './controller';
import { CloseIcon, LayersIcon } from './icons';
import { galleryPage, galleryPageCount, imageAspect, stack, stackMode } from './state';

/** Must match `.cell { border-radius }` so the GL-drawn thumbnail fits the DOM ring. */
const CELL_RADIUS = 12;

interface GridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/**
 * Picks the grid (≈9 cells per page) whose cells are biggest for this screen shape,
 * keeping every cell at the camera's aspect ratio.
 */
function computeLayout(w: number, h: number, aspect: number, gap: number): GridLayout {
  let best: GridLayout = { cols: 3, rows: 3, cellW: 0, cellH: 0 };
  for (const [cols, rows] of [
    [3, 3],
    [2, 4],
    [4, 2],
  ]) {
    const cellW = Math.floor(Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * aspect));
    if (cellW > best.cellW) best = { cols, rows, cellW, cellH: Math.floor(cellW / aspect) };
  }
  return best;
}

function useElementSize(ref: { current: HTMLElement | null }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    // Measure now so the first painted frame already has a real grid (RO reports later).
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

/**
 * Transparent overlay: lays out labelled buttons; the renderer draws the live
 * thumbnails underneath at the exact rects measured here.
 */
export function Gallery() {
  const stageRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const size = useElementSize(stageRef);

  const gap = size.w < 500 ? 6 : 10;
  const layout = computeLayout(size.w, size.h, imageAspect.value, gap);
  const perPage = layout.cols * layout.rows;
  const items = [null, ...effects];
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.min(galleryPage.value, pageCount - 1);
  const pageItems = items.slice(page * perPage, (page + 1) * perPage);
  const stacking = stackMode.value;
  const order = stack.value.map((l) => l.id);

  // After every layout: publish page count and cell rects to the renderer.
  useLayoutEffect(() => {
    if (galleryPageCount.value !== pageCount) galleryPageCount.value = pageCount;
    if (galleryPage.value !== page) galleryPage.value = page;
    const cells = [...(gridRef.current?.querySelectorAll<HTMLElement>('.cell') ?? [])].map((el) => ({
      id: el.dataset.id || null,
      rect: el.getBoundingClientRect(),
    }));
    setGalleryCells(layout.cellW > 0 ? cells : [], CELL_RADIUS);
  });

  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
    suppressClick.current = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.5) {
      suppressClick.current = true; // the click that follows this pointerup is not a tap
      stepGalleryPage(dx < 0 ? 1 : -1);
    }
  };

  return (
    <section class="gallery" aria-label="Galería de efectos">
      <header class="gallery-head">
        <h2>Efectos</h2>
        <label class="switch" title="Combina varios efectos: cada miniatura muestra tu mezcla actual + ese efecto">
          <LayersIcon size={16} />
          <span>Apilar</span>
          <input
            type="checkbox"
            role="switch"
            checked={stacking}
            onChange={(e) => toggleStackMode(e.currentTarget.checked)}
          />
        </label>
        <div class="spacer" />
        {stacking ? (
          <button type="button" class="btn small primary" onClick={closeGallery}>
            Listo
          </button>
        ) : (
          <button type="button" class="icon-btn small" aria-label="Cerrar galería" onClick={closeGallery}>
            <CloseIcon size={18} />
          </button>
        )}
      </header>
      <div
        class="gallery-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <div
          class="gallery-grid"
          ref={gridRef}
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, ${layout.cellW}px)`,
            gridAutoRows: `${layout.cellH}px`,
            gap: `${gap}px`,
          }}
        >
          {pageItems.map((def, i) => {
            const id = def?.id ?? '';
            const pos = def ? order.indexOf(def.id) : -1;
            const active = def ? pos >= 0 : order.length === 0;
            const label = def ? def.name : stacking ? 'Sin efectos' : 'Normal';
            return (
              <button
                type="button"
                key={id || '_none'}
                class={`cell ${active ? 'active' : ''}`}
                data-id={id}
                aria-pressed={active}
                aria-label={label}
                onClick={() => {
                  if (suppressClick.current) return;
                  pickFromGallery(def?.id ?? null);
                }}
              >
                {i < 9 && <span class="key-hint">{i + 1}</span>}
                {stacking && pos >= 0 && <span class="badge">{pos + 1}</span>}
                <span class="cell-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
