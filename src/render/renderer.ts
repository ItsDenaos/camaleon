import type { FrameSource } from '../camera/source';
import { EffectCompiler } from '../engine/compiler';
import { Pipeline } from '../engine/pipeline';
import {
  FACE_POINTS,
  MAX_FACES,
  type EffectDef,
  type EffectLayer,
  type FrameContext,
} from '../engine/types';
import { createGL } from '../gl/context';
import { RenderTarget } from '../gl/framebuffer';
import { FULLSCREEN_VERT, FullscreenTriangle } from '../gl/quad';
import { createProgram, type Program } from '../gl/shader';
import { SourceTexture, createImageTexture, setSampling } from '../gl/texture';
import { RateMeter } from './fps';
import { INPUT_FRAG, OUTPUT_FRAG } from './shaders';

export type FitMode = 'contain' | 'cover';

export interface RenderStats {
  /** Frames drawn per second. */
  fps: number;
  /** New source frames uploaded per second (the camera's real frame rate). */
  sourceFps: number;
  /** Processing resolution (thumbnail size while the gallery is open). */
  width: number;
  height: number;
}

/** One live thumbnail of the gallery. */
export interface GalleryCell {
  /** Rect normalized to the canvas (0..1, origin top-left), as measured from the DOM overlay. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Layers applied on top of the view's base (usually zero or one). */
  readonly layers: readonly EffectLayer[];
  /** Start from the plain camera image instead of the base stack. */
  readonly raw: boolean;
}

export interface GalleryView {
  /** Computed once per frame and shared by every non-raw cell (stack-mode preview). */
  readonly base: readonly EffectLayer[];
  readonly cells: readonly GalleryCell[];
  /** Cell corner radius in CSS px (matches the overlay's border-radius). */
  readonly radius: number;
}

/** Page background (#0b0b10) so letterbox bars and gallery gaps blend with the UI. */
const BG = [11 / 255, 11 / 255, 16 / 255] as const;
const MAX_DPR = 2;
/** Thumbnails never render taller than this many device px, however big the cell is. */
const MAX_THUMB_H = 270;

interface Resources {
  tri: FullscreenTriangle;
  sourceTex: SourceTexture;
  input: RenderTarget;
  galleryInput: RenderTarget;
  captureInput: RenderTarget;
  /** Final flipped copy for readPixels (rows come out top-down). */
  readback: RenderTarget;
  inputProg: Program;
  outputProg: Program;
  compiler: EffectCompiler;
  pipeline: Pipeline;
  /** Person mask uploaded from the segmenter (R8), created on first use. */
  maskTex: WebGLTexture | null;
  maskW: number;
  maskH: number;
  dummy: WebGLTexture;
  images: Map<string, WebGLTexture>;
}

/**
 * Owns the WebGL2 context and the render loop. The UI talks to it only through
 * its public methods; nothing here depends on Preact.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private res: Resources | null = null;
  private source: FrameSource | null = null;
  private hasFrame = false;
  private mirror = true;
  private fit: FitMode = 'contain';
  private stack: readonly EffectLayer[] = [];
  private gallery: GalleryView | null = null;
  private prewarmDefs: readonly EffectDef[] = [];
  private raf = 0;
  private frameCount = 0;
  private procW = 0;
  private procH = 0;
  private reportedW = 0;
  private reportedH = 0;
  /** Device px per CSS px of the canvas. */
  private cssScale = 1;
  /** Shared per-frame data for effects (AI results, user images); updated in place. */
  private readonly ctx: FrameContext;
  /** Kept so user images can be re-uploaded after a context loss. */
  private readonly imageSources = new Map<string, TexImageSource>();
  /** Time value of the last drawn frame, reused by grab() so captures match the preview. */
  private lastTime = 0;
  /** Visible image area on the canvas in the last preview frame (device px, top-left origin). */
  private drewView = false;
  private viewX = 0;
  private viewY = 0;
  private viewW = 0;
  private viewH = 0;
  private readonly t0 = performance.now();
  private readonly maxSide: number;
  private readonly renderRate = new RateMeter();
  private readonly sourceRate = new RateMeter();
  private readonly uvScale = new Float32Array(2);
  private readonly resizeObserver: ResizeObserver;

  onStats: ((stats: RenderStats) => void) | null = null;
  /** Called when the source resolution changes (new camera, rotation…). */
  onSourceSize: ((width: number, height: number) => void) | null = null;
  /** Called after each new camera frame is uploaded (the AI runs from here). */
  onSourceFrame: ((source: FrameSource, now: number) => void) | null = null;
  /**
   * Called right after each preview frame is drawn with the canvas and the visible image
   * rect (device px, top-left origin). Copying from the canvas here is safe: the drawing
   * buffer is still intact within the same task. Used by the video recorder.
   */
  onFrameDrawn:
    | ((canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) => void)
    | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = createGL(canvas);
    this.maxSide = matchMedia('(pointer: coarse)').matches ? 960 : 1280;
    this.res = this.createResources();
    this.ctx = {
      mask: null,
      mirror: 1,
      faceCount: 0,
      faceC: new Float32Array(MAX_FACES * 2),
      faceX: new Float32Array(MAX_FACES * 2),
      facePts: new Float32Array(MAX_FACES * FACE_POINTS * 2),
      images: this.res.images,
      dummy: this.res.dummy,
    };

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = new ResizeObserver(([entry]) => this.onResize(entry));
    try {
      this.resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(canvas);
    }
  }

  setSource(source: FrameSource | null) {
    this.source = source;
    // Keep showing the previous frame while a new camera warms up; clear only when stopping.
    if (!source) this.hasFrame = false;
    this.sourceRate.reset();
  }

  setMirror(mirror: boolean) {
    this.mirror = mirror;
  }

  setFit(fit: FitMode) {
    this.fit = fit;
  }

  /** Effect layers applied in order, bottom first. The array is read every frame; pass a new one to change it. */
  setStack(layers: readonly EffectLayer[]) {
    this.stack = layers;
  }

  /** Shows the live-thumbnail grid instead of the full preview (null = back to the preview). */
  setGallery(view: GalleryView | null) {
    this.gallery = view;
  }

  /** Uploads the latest person mask (one byte per pixel, camera orientation). */
  updateMask(data: Uint8Array, width: number, height: number) {
    const res = this.res;
    if (!res) return;
    const gl = this.gl;
    if (!res.maskTex || res.maskW !== width || res.maskH !== height) {
      if (res.maskTex) gl.deleteTexture(res.maskTex);
      res.maskTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, res.maskTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);
      setSampling(gl, gl.LINEAR);
      res.maskW = width;
      res.maskH = height;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, res.maskTex);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.ctx.mask = res.maskTex;
  }

  /** Face data in effect space (see FrameContext); arrays are copied. */
  updateFaces(count: number, centers: Float32Array, axes: Float32Array, points: Float32Array) {
    this.ctx.faceCount = count;
    this.ctx.faceC.set(centers);
    this.ctx.faceX.set(axes);
    this.ctx.facePts.set(points);
  }

  /** Forget AI results when their model is turned off, so stale data never shows up later. */
  clearMask() {
    this.ctx.mask = null;
  }

  clearFaces() {
    this.ctx.faceCount = 0;
  }

  /** User image for an effect (`${effectId}/${key}`), or null to remove it. */
  setImage(id: string, source: TexImageSource | null) {
    const res = this.res;
    if (source) this.imageSources.set(id, source);
    else this.imageSources.delete(id);
    if (!res) return;
    const old = res.images.get(id);
    if (old) this.gl.deleteTexture(old);
    res.images.delete(id);
    if (source) res.images.set(id, createImageTexture(this.gl, source));
  }

  /** Size of the visible image on the canvas in the last preview frame (device px). */
  viewSize(): { width: number; height: number } | null {
    return this.viewW > 0 && this.viewH > 0 ? { width: this.viewW, height: this.viewH } : null;
  }

  /** Camera resolution of the current frame, or null before the first frame. */
  sourceSize(): { width: number; height: number } | null {
    const t = this.res?.sourceTex;
    return this.hasFrame && t?.texture ? { width: t.width, height: t.height } : null;
  }

  /**
   * Renders the current frame with the current stack at width × height (independent of
   * the screen) and returns RGBA pixels with top-down rows, or null if there is no frame.
   * Synchronous (readPixels): fine for photos and small burst frames.
   */
  grab(width: number, height: number): Uint8Array<ArrayBuffer> | null {
    const res = this.res;
    const gl = this.gl;
    if (!res || !this.hasFrame || !res.sourceTex.texture || gl.isContextLost()) return null;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));

    res.captureInput.resize(width, height);
    this.drawInput(res, res.captureInput);
    this.ctx.mirror = this.mirror ? 1 : 0;
    const out = res.pipeline.run(
      this.stack,
      res.captureInput.texture,
      width,
      height,
      this.lastTime,
      this.ctx,
    );

    // Flip vertically while copying so the CPU gets rows in image order.
    res.readback.resize(width, height);
    res.readback.bind();
    gl.useProgram(res.outputProg.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, out ? out.texture : res.captureInput.texture);
    const u = res.outputProg.uniforms;
    gl.uniform1i(u.get('u_input')!, 0);
    gl.uniform2f(u.get('u_uvScale')!, 1, -1);
    gl.uniform3f(u.get('u_bg')!, BG[0], BG[1], BG[2]);
    gl.uniform2f(u.get('u_viewSize')!, width, height);
    gl.uniform1f(u.get('u_corner')!, 0);
    res.tri.draw();

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  /** Starts compiling these effects in the background so selecting one later is instant. */
  prewarm(defs: readonly EffectDef[]) {
    this.prewarmDefs = defs;
    this.res?.compiler.prepareAll(defs);
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.disposeResources();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const res = this.res;
    if (!res || this.gl.isContextLost()) return;

    const src = this.source;
    if (src && src.poll(now) && src.width > 0 && src.height > 0) {
      res.sourceTex.upload(src.element, src.width, src.height);
      this.hasFrame = true;
      this.sourceRate.mark();
      this.onSourceFrame?.(src, now);
      if (src.width !== this.reportedW || src.height !== this.reportedH) {
        this.reportedW = src.width;
        this.reportedH = src.height;
        this.onSourceSize?.(src.width, src.height);
      }
    }

    this.lastTime = ((now - this.t0) / 1000) % 3600;
    this.drewView = false;
    this.draw(res, this.lastTime);
    if (this.drewView && this.onFrameDrawn) {
      this.onFrameDrawn(this.canvas, this.viewX, this.viewY, this.viewW, this.viewH);
    }
    res.pipeline.endFrame();
    this.renderRate.mark();

    // Dev: finish compiling every prewarmed effect so shader errors show up in the console
    // at startup instead of only when that effect is picked.
    if (import.meta.env.DEV && (++this.frameCount & 31) === 0) {
      for (const def of this.prewarmDefs) res.compiler.get(def);
    }

    this.sourceRate.sample(now);
    if (this.renderRate.sample(now)) {
      this.onStats?.({
        fps: this.renderRate.value,
        sourceFps: this.sourceRate.value,
        width: this.procW,
        height: this.procH,
      });
    }
  };

  private draw(res: Resources, time: number) {
    const gl = this.gl;
    this.ctx.mirror = this.mirror ? 1 : 0;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    if (!this.hasFrame || !res.sourceTex.texture) {
      this.clearCanvas();
      return;
    }

    const sw = res.sourceTex.width;
    const sh = res.sourceTex.height;
    if (this.gallery) {
      this.drawGallery(res, this.gallery, time, sw, sh);
      return;
    }

    // 1. Input pass → processing-resolution target.
    const k = this.processScale(sw, sh, cw, ch);
    res.input.resize(sw * k, sh * k);
    this.drawInput(res, res.input);
    this.procW = res.input.width;
    this.procH = res.input.height;

    // 2. Effect stack.
    const out = res.pipeline.run(this.stack, res.input.texture, this.procW, this.procH, time, this.ctx);

    // 3. Output pass → canvas, fitted.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drawOutput(res, out ? out.texture : res.input.texture, 0, 0, cw, ch, sw / sh, this.fit, 0);

    // Visible image rect: letterboxed (contain) or the whole canvas (cover).
    this.viewW = Math.min(cw, Math.round(cw / this.uvScale[0]));
    this.viewH = Math.min(ch, Math.round(ch / this.uvScale[1]));
    this.viewX = Math.round((cw - this.viewW) / 2);
    this.viewY = Math.round((ch - this.viewH) / 2);
    this.drewView = true;
  }

  /**
   * Gallery: the camera frame goes through the input pass once, the base stack runs
   * once at thumbnail size, then each cell adds its own layer and is drawn into its rect.
   */
  private drawGallery(res: Resources, view: GalleryView, time: number, sw: number, sh: number) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.clearCanvas();
    if (view.cells.length === 0) return;

    const aspect = sw / sh;
    const first = view.cells[0];
    const th = Math.max(16, Math.round(Math.min(first.h * ch, (first.w * cw) / aspect, MAX_THUMB_H)));
    const tw = Math.max(16, Math.round(th * aspect));
    this.procW = tw;
    this.procH = th;

    // Input at ~2× thumbnail size so each cell's first pass downsamples smoothly.
    const k = Math.min(1, (2 * th) / sh);
    res.galleryInput.resize(sw * k, sh * k);
    this.drawInput(res, res.galleryInput);
    const inputTex = res.galleryInput.texture;

    const base = res.pipeline.run(view.base, inputTex, tw, th, time, this.ctx);
    const baseTex = base ? base.texture : inputTex;
    if (base) base.locked = true; // keep it intact while the cells run
    const corner = view.radius * this.cssScale;

    for (let i = 0; i < view.cells.length; i++) {
      const cell = view.cells[i];
      const from = cell.raw ? inputTex : baseTex;
      const out = cell.layers.length
        ? res.pipeline.run(cell.layers, from, tw, th, time, this.ctx)
        : null;
      const x = Math.round(cell.x * cw);
      const y = Math.round(cell.y * ch);
      const w = Math.round((cell.x + cell.w) * cw) - x;
      const h = Math.round((cell.y + cell.h) * ch) - y;
      if (w <= 0 || h <= 0) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // GL viewports count from the bottom; DOM rects from the top.
      this.drawOutput(res, out ? out.texture : from, x, ch - y - h, w, h, aspect, 'cover', corner);
    }

    if (base) base.locked = false;
  }

  private drawInput(res: Resources, target: RenderTarget) {
    const gl = this.gl;
    target.bind();
    gl.useProgram(res.inputProg.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.sourceTex.texture);
    gl.uniform1i(res.inputProg.uniforms.get('u_video')!, 0);
    gl.uniform1f(res.inputProg.uniforms.get('u_mirror')!, this.mirror ? 1 : 0);
    res.tri.draw();
  }

  /** Draws `tex` (with the given aspect) into a viewport of the bound framebuffer. */
  private drawOutput(
    res: Resources,
    tex: WebGLTexture,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    imageAspect: number,
    fit: FitMode,
    cornerPx: number,
  ) {
    const gl = this.gl;
    gl.viewport(vx, vy, vw, vh);
    gl.useProgram(res.outputProg.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const viewAspect = vw / vh;
    const wider = viewAspect > imageAspect;
    if (fit === 'contain') {
      this.uvScale[0] = wider ? viewAspect / imageAspect : 1;
      this.uvScale[1] = wider ? 1 : imageAspect / viewAspect;
    } else {
      this.uvScale[0] = wider ? 1 : viewAspect / imageAspect;
      this.uvScale[1] = wider ? imageAspect / viewAspect : 1;
    }
    const u = res.outputProg.uniforms;
    gl.uniform1i(u.get('u_input')!, 0);
    gl.uniform2fv(u.get('u_uvScale')!, this.uvScale);
    gl.uniform3f(u.get('u_bg')!, BG[0], BG[1], BG[2]);
    gl.uniform2f(u.get('u_viewSize')!, vw, vh);
    gl.uniform1f(u.get('u_corner')!, cornerPx);
    res.tri.draw();
  }

  private clearCanvas() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Preview resolution: no larger than what is actually displayed, the source,
   * or the device cap. Captures render separately at full resolution (phase 4).
   */
  private processScale(sw: number, sh: number, cw: number, ch: number): number {
    const display =
      this.fit === 'contain' ? Math.min(cw / sw, ch / sh) : Math.max(cw / sw, ch / sh);
    return Math.min(1, display, this.maxSide / Math.max(sw, sh));
  }

  private onResize(entry: ResizeObserverEntry) {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, MAX_DPR);
    let w: number;
    let h: number;
    const dpBox = entry.devicePixelContentBoxSize?.[0];
    if (dpBox) {
      w = (dpBox.inlineSize * scale) / dpr;
      h = (dpBox.blockSize * scale) / dpr;
    } else {
      w = entry.contentRect.width * scale;
      h = entry.contentRect.height * scale;
    }
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
    this.cssScale = entry.contentRect.width > 0 ? this.canvas.width / entry.contentRect.width : scale;
  }

  private createResources(): Resources {
    const gl = this.gl;
    const tri = new FullscreenTriangle(gl);
    const compiler = new EffectCompiler(gl);
    compiler.prepareAll(this.prewarmDefs);
    return {
      tri,
      sourceTex: new SourceTexture(gl),
      input: new RenderTarget(gl, 1, 1),
      galleryInput: new RenderTarget(gl, 1, 1),
      captureInput: new RenderTarget(gl, 1, 1),
      readback: new RenderTarget(gl, 1, 1),
      inputProg: createProgram(gl, FULLSCREEN_VERT, INPUT_FRAG, 'input'),
      outputProg: createProgram(gl, FULLSCREEN_VERT, OUTPUT_FRAG, 'output'),
      compiler,
      pipeline: new Pipeline(gl, compiler, tri),
      maskTex: null,
      maskW: 0,
      maskH: 0,
      dummy: createDummyTexture(gl),
      images: new Map(
        [...this.imageSources].map(([id, src]) => [id, createImageTexture(gl, src)] as const),
      ),
    };
  }

  private disposeResources() {
    const r = this.res;
    if (!r) return;
    const gl = this.gl;
    r.tri.dispose();
    r.sourceTex.dispose();
    r.input.dispose();
    r.galleryInput.dispose();
    r.captureInput.dispose();
    r.readback.dispose();
    r.pipeline.dispose();
    r.compiler.dispose();
    if (r.maskTex) gl.deleteTexture(r.maskTex);
    gl.deleteTexture(r.dummy);
    r.images.forEach((t) => gl.deleteTexture(t));
    gl.deleteProgram(r.inputProg.handle);
    gl.deleteProgram(r.outputProg.handle);
    this.res = null;
  }

  private onContextLost = (e: Event) => {
    e.preventDefault(); // allows the context to be restored
    this.res = null; // GL objects are already invalid
  };

  private onContextRestored = () => {
    const res = this.createResources();
    this.res = res;
    this.hasFrame = false;
    // New GL objects: point the shared context at them (the mask comes back next frame).
    Object.assign(this.ctx, { mask: null, images: res.images, dummy: res.dummy });
  };
}

function createDummyTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  setSampling(gl, gl.NEAREST);
  return tex;
}
