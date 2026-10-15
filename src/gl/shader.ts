export class ShaderError extends Error {
  constructor(
    readonly label: string,
    readonly log: string,
    readonly source?: string,
  ) {
    super(`[${label}] ${log}`);
    this.name = 'ShaderError';
  }
}

export interface Program {
  readonly handle: WebGLProgram;
  readonly label: string;
  /** Active uniform locations by name (array uniforms are stored without the "[0]" suffix). */
  readonly uniforms: ReadonlyMap<string, WebGLUniformLocation>;
}

/** A program whose compile/link was requested but whose status has not been checked yet. */
export interface PendingProgram {
  readonly handle: WebGLProgram;
  readonly label: string;
  readonly vs: WebGLShader;
  readonly fs: WebGLShader;
  readonly vsSource: string;
  readonly fsSource: string;
}

type ParallelCompileExt = { readonly COMPLETION_STATUS_KHR: GLenum };

/** Enables KHR_parallel_shader_compile when present, so status checks don't block the frame. */
export function getParallelCompile(gl: WebGL2RenderingContext): ParallelCompileExt | null {
  return gl.getExtension('KHR_parallel_shader_compile') as ParallelCompileExt | null;
}

/** Starts compiling and linking without querying any status (which would force a sync). */
export function beginProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
  label: string,
): PendingProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vsSource);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fsSource);
  gl.compileShader(fs);
  const handle = gl.createProgram()!;
  gl.attachShader(handle, vs);
  gl.attachShader(handle, fs);
  gl.linkProgram(handle);
  return { handle, label, vs, fs, vsSource, fsSource };
}

/** True when finishProgram() can run without stalling (always true without the extension). */
export function isProgramReady(
  gl: WebGL2RenderingContext,
  ext: ParallelCompileExt | null,
  p: PendingProgram,
): boolean {
  return !ext || gl.getProgramParameter(p.handle, ext.COMPLETION_STATUS_KHR) === true;
}

/** Checks link status, reports errors with annotated source, and collects uniform locations. */
export function finishProgram(gl: WebGL2RenderingContext, p: PendingProgram): Program {
  const { handle } = p;
  const linked = gl.getProgramParameter(handle, gl.LINK_STATUS) || gl.isContextLost();
  let error: ShaderError | null = null;
  if (!linked) {
    if (!gl.getShaderParameter(p.vs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(p.vs) ?? '';
      error = new ShaderError(`${p.label}.vert`, log + '\n' + annotate(p.vsSource, log), p.vsSource);
    } else if (!gl.getShaderParameter(p.fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(p.fs) ?? '';
      error = new ShaderError(`${p.label}.frag`, log + '\n' + annotate(p.fsSource, log), p.fsSource);
    } else {
      error = new ShaderError(p.label, gl.getProgramInfoLog(handle) ?? 'link failed');
    }
  }
  gl.detachShader(handle, p.vs);
  gl.detachShader(handle, p.fs);
  gl.deleteShader(p.vs);
  gl.deleteShader(p.fs);
  if (error) {
    gl.deleteProgram(handle);
    throw error;
  }

  const uniforms = new Map<string, WebGLUniformLocation>();
  const count: number = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) ?? 0;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(handle, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(handle, info.name);
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), loc);
  }
  return { handle, label: p.label, uniforms };
}

/** Synchronous compile + link, for the few built-in programs needed before the first frame. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
  label: string,
): Program {
  return finishProgram(gl, beginProgram(gl, vsSource, fsSource, label));
}

/** Prints the source lines referenced by the compiler log ("ERROR: 0:12: ..."), with numbers. */
function annotate(source: string, log: string): string {
  const lines = source.split('\n');
  const wanted = new Set<number>();
  for (const m of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) wanted.add(Number(m[1]));
  const out: string[] = [];
  for (const n of wanted) {
    for (let i = Math.max(1, n - 2); i <= Math.min(lines.length, n + 2); i++) {
      out.push(`${i === n ? '>' : ' '}${String(i).padStart(4)} | ${lines[i - 1]}`);
    }
    out.push('');
  }
  return out.join('\n');
}
