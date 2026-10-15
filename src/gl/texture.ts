/** RGBA8 texture fed from a video/canvas each time a new frame arrives. */
export class SourceTexture {
  private tex: WebGLTexture | null = null;
  width = 0;
  height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get texture(): WebGLTexture | null {
    return this.tex;
  }

  upload(source: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    if (width !== this.width || height !== this.height || !this.tex) {
      // texStorage2D is immutable, so a size change means a new texture.
      if (this.tex) gl.deleteTexture(this.tex);
      this.tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      setSampling(gl, gl.LINEAR);
      this.width = width;
      this.height = height;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  dispose() {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
    this.width = this.height = 0;
  }
}

/** Immutable mipmapped texture from an image/canvas (lookup tables, glyph atlases…). */
export function createImageTexture(gl: WebGL2RenderingContext, source: TexImageSource): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  setSampling(gl, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  return tex;
}

export function setSampling(
  gl: WebGL2RenderingContext,
  filter: GLenum,
  wrap: GLenum = gl.CLAMP_TO_EDGE,
) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}
