import { TargetPool, type RenderTarget } from '../gl/framebuffer';
import type { FullscreenTriangle } from '../gl/quad';
import type { EffectCompiler } from './compiler';
import type { EffectLayer, FrameContext } from './types';

/**
 * Texture units: 0 = u_input, 1 = u_source, 2–4 = the effect's own textures,
 * 5–6 = user images, 7 = person mask.
 */
const UNIT_INPUT = 0;
const UNIT_SOURCE = 1;
const UNIT_EXTRA = 2;
const UNIT_IMAGES = 5;
const UNIT_MASK = 7;

/**
 * Runs a stack of effects over an input texture. Each pass draws into a pooled target
 * that is neither its input nor its effect's source, so passes chain freely
 * (generalized ping-pong). Allocation-free per frame once the pool is warm.
 */
export class Pipeline {
  private readonly pool: TargetPool;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly compiler: EffectCompiler,
    private readonly tri: FullscreenTriangle,
  ) {
    this.pool = new TargetPool(gl);
  }

  /**
   * Applies `layers` to `input` (width × height px) and returns the target holding the
   * result, or null if no layer ran (the result is `input` itself). The target may be
   * reused by the next run(); set `locked` on it to keep it while running other stacks.
   * Layers still compiling are skipped for this frame.
   */
  run(
    layers: readonly EffectLayer[],
    input: WebGLTexture,
    width: number,
    height: number,
    time: number,
    ctx: FrameContext,
  ): RenderTarget | null {
    const gl = this.gl;
    let current: RenderTarget | null = null;
    let currentTex = input;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const fx = this.compiler.get(layer.def);
      if (!fx) continue;

      const source = current;
      const sourceTex = currentTex;
      for (let pi = 0; pi < fx.passes.length; pi++) {
        const pass = fx.passes[pi];
        const out = this.pool.acquire(width * pass.scale, height * pass.scale, source, current);
        out.bind();
        gl.useProgram(pass.program.handle);

        gl.activeTexture(gl.TEXTURE0 + UNIT_INPUT);
        gl.bindTexture(gl.TEXTURE_2D, currentTex);
        gl.uniform1i(pass.uInput, UNIT_INPUT);
        gl.activeTexture(gl.TEXTURE0 + UNIT_SOURCE);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex);
        gl.uniform1i(pass.uSource, UNIT_SOURCE);
        for (let ti = 0; ti < fx.textures.length; ti++) {
          gl.activeTexture(gl.TEXTURE0 + UNIT_EXTRA + ti);
          gl.bindTexture(gl.TEXTURE_2D, fx.textures[ti]);
          gl.uniform1i(pass.uTextures[ti], UNIT_EXTRA + ti);
        }

        if (pass.uMask) {
          gl.activeTexture(gl.TEXTURE0 + UNIT_MASK);
          gl.bindTexture(gl.TEXTURE_2D, ctx.mask ?? ctx.dummy);
          gl.uniform1i(pass.uMask, UNIT_MASK);
        }
        if (pass.uHasMask) gl.uniform1f(pass.uHasMask, ctx.mask ? 1 : 0);
        if (pass.uAiMirror) gl.uniform1f(pass.uAiMirror, ctx.mirror);
        if (pass.uFaceCount) {
          gl.uniform1f(pass.uFaceCount, ctx.faceCount);
          gl.uniform2fv(pass.uFaceC, ctx.faceC);
          gl.uniform2fv(pass.uFaceX, ctx.faceX);
          gl.uniform2fv(pass.uFacePts, ctx.facePts);
        }
        const keys = fx.imageKeys;
        if (keys.length) {
          for (let k = 0; k < keys.length; k++) {
            const tex = ctx.images.get(keys[k]);
            gl.activeTexture(gl.TEXTURE0 + UNIT_IMAGES + k);
            gl.bindTexture(gl.TEXTURE_2D, tex ?? ctx.dummy);
            gl.uniform1i(pass.uImages[k], UNIT_IMAGES + k);
            gl.uniform1f(pass.uImagesSet[k], tex ? 1 : 0);
          }
        }

        gl.uniform2f(pass.uResolution, out.width, out.height);
        gl.uniform1f(pass.uTime, time);
        for (let k = 0; k < pass.uParams.length; k++) gl.uniform1f(pass.uParams[k], layer.values[k]);

        this.tri.draw();
        current = out;
        currentTex = out.texture;
      }
    }

    gl.activeTexture(gl.TEXTURE0);
    return current;
  }

  /** Call once per rendered frame so idle targets (old sizes) get freed. */
  endFrame() {
    this.pool.endFrame();
  }

  dispose() {
    this.pool.dispose();
  }
}
