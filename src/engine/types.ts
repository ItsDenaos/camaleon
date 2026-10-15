/** A tweakable effect parameter, exposed to GLSL as `uniform float u_<key>`. */
export interface EffectParam {
  /** GLSL-safe identifier (letters, digits, underscore). */
  readonly key: string;
  /** Visible label (Spanish). */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly default: number;
  /**
   * Discrete choice: one label per integer value from `min` to `max` (step 1).
   * Shown as segmented buttons; GLSL still receives the index as a float.
   */
  readonly options?: readonly string[];
}

export interface EffectPass {
  /** Fragment shader body (GLSL ES 3.00 without header; the prelude is prepended). */
  readonly fragment: string;
  /**
   * Size of this pass's output relative to the pipeline resolution (default 1).
   * E.g. 0.5 for blur passes; whatever samples the result upscales it bilinearly.
   */
  readonly scale?: number;
}

export interface EffectDef {
  /** kebab-case, unique, equal to the file name in src/effects/. */
  readonly id: string;
  /** Visible name (Spanish). */
  readonly name: string;
  /** Position in the gallery (ascending; ties sorted by name). */
  readonly order?: number;
  readonly params: readonly EffectParam[];
  /** Single-pass effect. Use either `fragment` or `passes`. */
  readonly fragment?: string;
  /** Multipass effect: each pass reads the previous one through `u_input`. */
  readonly passes?: readonly EffectPass[];
  /** Extra sampler2D uniforms, built once when the effect is compiled (e.g. a glyph atlas). */
  readonly textures?: Readonly<Record<string, () => TexImageSource>>;
  /**
   * AI data the effect reads. Models only load and run while a visible effect needs them.
   * segmentation → personMask(uv); face → u_faceCount, faceIso(), facePoint().
   */
  readonly needs?: { readonly segmentation?: boolean; readonly face?: boolean };
  /**
   * Images the user can pick in the settings panel (e.g. a custom background). Each one
   * is declared as `uniform sampler2D u_<key>` + `uniform float u_<key>Set` (0 until chosen),
   * already cropped to the camera's aspect ratio, top row first (sample at 1 - uv.y).
   */
  readonly images?: readonly {
    readonly key: string;
    readonly label: string;
    /** After picking an image, set this param (e.g. the background mode to "your image"). */
    readonly selects?: { readonly param: string; readonly value: number };
  }[];
}

export const MAX_FACES = 2;
/** Key points per face, see FP_* in the prelude. */
export const FACE_POINTS = 8;

/**
 * Per-frame data shared by every effect: AI results and user images. Built once by the
 * renderer and updated in place (no per-frame allocation).
 */
export interface FrameContext {
  /** Person mask (R8, camera orientation: top row first, not mirrored), or null. */
  mask: WebGLTexture | null;
  /** 1 when the input pass mirrored the image, so the mask must be sampled mirrored. */
  mirror: number;
  faceCount: number;
  /** Per face, in centered() image space: midpoint between the eyes… */
  readonly faceC: Float32Array;
  /** …and the vector from the screen-left eye to the screen-right eye. */
  readonly faceX: Float32Array;
  /** FACE_POINTS points per face in face units (eyes at (±0.5, 0), y up). */
  readonly facePts: Float32Array;
  /** User images keyed `${effectId}/${key}`. */
  readonly images: ReadonlyMap<string, WebGLTexture>;
  /** 1×1 black texture bound to samplers that have no data yet. */
  dummy: WebGLTexture | null;
}

/** What the renderer needs to draw one layer of the stack. */
export interface EffectLayer {
  readonly def: EffectDef;
  /** One value per `def.params`, in the same order. */
  readonly values: readonly number[];
}

/** Identity helper that gives effect files type checking and autocompletion. */
export function defineEffect(def: EffectDef): EffectDef {
  return def;
}

export function effectPasses(def: EffectDef): readonly EffectPass[] {
  return def.passes ?? (def.fragment ? [{ fragment: def.fragment }] : []);
}
