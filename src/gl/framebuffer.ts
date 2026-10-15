import { setSampling } from './texture';

/** A color-only framebuffer with an RGBA8 texture attachment. */
export class RenderTarget {
  readonly fbo: WebGLFramebuffer;
  private tex: WebGLTexture | null = null;
  width = 0;
  height = 0;
  /** While true, TargetPool never hands this target out (its content is still needed). */
  locked = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
  ) {
    this.fbo = gl.createFramebuffer()!;
    this.resize(width, height);
  }

  get texture(): WebGLTexture {
    return this.tex!;
  }

  resize(width: number, height: number) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (width === this.width && height === this.height && this.tex) return;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    setSampling(gl, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.width = width;
    this.height = height;
  }

  /** Binds this target for drawing and sets the viewport to cover it. */
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  dispose() {
    this.gl.deleteFramebuffer(this.fbo);
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
  }
}

/**
 * Recycles render targets across passes and frames. A chain of passes asks for a target
 * of a given size that is not one of the textures it still needs to read (`avoidA/B`),
 * which generalizes ping-pong to multipass effects that also sample their source.
 * Targets unused for a while (e.g. after a resize) are freed.
 */
export class TargetPool {
  private readonly items: RenderTarget[] = [];
  private readonly lastUsed: number[] = [];
  private frame = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxIdleFrames = 120,
  ) {}

  acquire(
    width: number,
    height: number,
    avoidA: RenderTarget | null = null,
    avoidB: RenderTarget | null = null,
  ): RenderTarget {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i];
      if (t.locked || t === avoidA || t === avoidB || t.width !== width || t.height !== height)
        continue;
      this.lastUsed[i] = this.frame;
      return t;
    }
    const t = new RenderTarget(this.gl, width, height);
    this.items.push(t);
    this.lastUsed.push(this.frame);
    return t;
  }

  /** Call once per frame; frees targets that have been idle too long. */
  endFrame() {
    this.frame++;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.frame - this.lastUsed[i] > this.maxIdleFrames) {
        this.items[i].dispose();
        this.items.splice(i, 1);
        this.lastUsed.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const t of this.items) t.dispose();
    this.items.length = 0;
    this.lastUsed.length = 0;
  }
}
