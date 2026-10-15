import { FULLSCREEN_VERT } from '../gl/quad';
import {
  beginProgram,
  finishProgram,
  getParallelCompile,
  isProgramReady,
  type PendingProgram,
  type Program,
} from '../gl/shader';
import { createImageTexture } from '../gl/texture';
import { buildFragment } from './prelude';
import { effectPasses, type EffectDef } from './types';

type Loc = WebGLUniformLocation | null;

export interface CompiledPass {
  readonly program: Program;
  readonly scale: number;
  readonly uInput: Loc;
  readonly uSource: Loc;
  readonly uResolution: Loc;
  readonly uTime: Loc;
  /** Aligned with `def.params`. */
  readonly uParams: readonly Loc[];
  /** Aligned with `CompiledEffect.textures`. */
  readonly uTextures: readonly Loc[];
  /** AI uniforms; all null for passes that don't use them. */
  readonly uMask: Loc;
  readonly uHasMask: Loc;
  readonly uAiMirror: Loc;
  readonly uFaceCount: Loc;
  readonly uFaceC: Loc;
  readonly uFaceX: Loc;
  readonly uFacePts: Loc;
  /** Aligned with `def.images`: the sampler and its "is set" flag. */
  readonly uImages: readonly Loc[];
  readonly uImagesSet: readonly Loc[];
}

export interface CompiledEffect {
  readonly def: EffectDef;
  readonly passes: readonly CompiledPass[];
  readonly textures: readonly WebGLTexture[];
  /** `${def.id}/${key}` per user image, precomputed so the frame loop builds no strings. */
  readonly imageKeys: readonly string[];
}

type Entry =
  | { state: 'pending'; def: EffectDef; pending: PendingProgram[]; textures: WebGLTexture[] }
  | { state: 'ready'; compiled: CompiledEffect }
  | { state: 'failed' };

/**
 * Compiles effects lazily and caches them by id. With KHR_parallel_shader_compile the
 * driver compiles in the background and get() returns null until the program is ready,
 * so opening the gallery never stalls a frame; the pipeline simply skips that layer.
 */
export class EffectCompiler {
  private readonly cache = new Map<string, Entry>();
  private readonly ext: ReturnType<typeof getParallelCompile>;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = getParallelCompile(gl);
  }

  /** Starts compiling (no-op if already started). */
  prepare(def: EffectDef) {
    if (this.cache.has(def.id)) return;
    const gl = this.gl;
    let textures: WebGLTexture[] = [];
    try {
      textures = Object.values(def.textures ?? {}).map((make) => createImageTexture(gl, make()));
    } catch (err) {
      console.error(`[efectos] ${def.id}: no se pudo crear una textura`, err);
      textures.forEach((t) => gl.deleteTexture(t));
      this.cache.set(def.id, { state: 'failed' });
      return;
    }
    const pending = effectPasses(def).map((pass, i) =>
      beginProgram(gl, FULLSCREEN_VERT, buildFragment(def, pass.fragment), `${def.id}#${i}`),
    );
    this.cache.set(def.id, { state: 'pending', def, pending, textures });
  }

  prepareAll(defs: readonly EffectDef[]) {
    for (const d of defs) this.prepare(d);
  }

  /** The compiled effect, or null while compiling / if it failed. Never blocks when the extension exists. */
  get(def: EffectDef): CompiledEffect | null {
    let entry = this.cache.get(def.id);
    if (!entry) {
      this.prepare(def);
      entry = this.cache.get(def.id)!;
    }
    if (entry.state === 'ready') return entry.compiled;
    if (entry.state === 'failed') return null;
    for (const p of entry.pending) if (!isProgramReady(this.gl, this.ext, p)) return null;
    return this.finish(entry);
  }

  isFailed(def: EffectDef): boolean {
    return this.cache.get(def.id)?.state === 'failed';
  }

  dispose() {
    const gl = this.gl;
    for (const entry of this.cache.values()) {
      if (entry.state === 'ready') {
        entry.compiled.passes.forEach((p) => gl.deleteProgram(p.program.handle));
        entry.compiled.textures.forEach((t) => gl.deleteTexture(t));
      } else if (entry.state === 'pending') {
        entry.pending.forEach((p) => discardPending(gl, p));
        entry.textures.forEach((t) => gl.deleteTexture(t));
      }
    }
    this.cache.clear();
  }

  private finish(entry: Extract<Entry, { state: 'pending' }>): CompiledEffect | null {
    const gl = this.gl;
    const { def, pending, textures } = entry;
    const programs: Program[] = [];
    try {
      for (const p of pending) programs.push(finishProgram(gl, p));
    } catch (err) {
      console.error(`[efectos] Error compilando "${def.id}":\n${(err as Error).message}`);
      programs.forEach((p) => gl.deleteProgram(p.handle));
      pending.slice(programs.length + 1).forEach((p) => discardPending(gl, p));
      textures.forEach((t) => gl.deleteTexture(t));
      this.cache.set(def.id, { state: 'failed' });
      return null;
    }

    const passDefs = effectPasses(def);
    const textureNames = Object.keys(def.textures ?? {});
    const passes = programs.map((program, i): CompiledPass => {
      const u = program.uniforms;
      const loc = (name: string): Loc => u.get(name) ?? null;
      return {
        program,
        scale: passDefs[i].scale ?? 1,
        uInput: loc('u_input'),
        uSource: loc('u_source'),
        uResolution: loc('u_resolution'),
        uTime: loc('u_time'),
        uParams: def.params.map((p) => loc(`u_${p.key}`)),
        uTextures: textureNames.map(loc),
        uMask: loc('u_mask'),
        uHasMask: loc('u_hasMask'),
        uAiMirror: loc('u_aiMirror'),
        uFaceCount: loc('u_faceCount'),
        uFaceC: loc('u_faceC'),
        uFaceX: loc('u_faceX'),
        uFacePts: loc('u_facePts'),
        uImages: (def.images ?? []).map((img) => loc(`u_${img.key}`)),
        uImagesSet: (def.images ?? []).map((img) => loc(`u_${img.key}Set`)),
      };
    });
    const imageKeys = (def.images ?? []).map((img) => `${def.id}/${img.key}`);
    const compiled: CompiledEffect = { def, passes, textures, imageKeys };
    this.cache.set(def.id, { state: 'ready', compiled });
    return compiled;
  }
}

function discardPending(gl: WebGL2RenderingContext, p: PendingProgram) {
  gl.deleteProgram(p.handle);
  gl.deleteShader(p.vs);
  gl.deleteShader(p.fs);
}
