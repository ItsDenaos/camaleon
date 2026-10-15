/** Anything the renderer can pull frames from (camera video, test pattern, …). */
export interface FrameSource {
  readonly element: TexImageSource;
  readonly width: number;
  readonly height: number;
  /** True when a frame newer than the last uploaded one is available. */
  poll(now: number): boolean;
  dispose(): void;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Wraps a playing <video>. Uses requestVideoFrameCallback when available to upload only new frames. */
export class VideoSource implements FrameSource {
  private dirty = true;
  private rvfcHandle = 0;
  private lastTime = -1;
  private disposed = false;

  constructor(readonly element: HTMLVideoElement) {
    const v = element as VideoWithRvfc;
    if (v.requestVideoFrameCallback) {
      const onFrame = () => {
        if (this.disposed) return;
        this.dirty = true;
        this.rvfcHandle = v.requestVideoFrameCallback!(onFrame);
      };
      this.rvfcHandle = v.requestVideoFrameCallback(onFrame);
    }
  }

  get width() {
    return this.element.videoWidth;
  }

  get height() {
    return this.element.videoHeight;
  }

  poll(): boolean {
    const v = this.element;
    if (v.readyState < v.HAVE_CURRENT_DATA || v.videoWidth === 0) return false;
    if ((v as VideoWithRvfc).requestVideoFrameCallback) {
      const d = this.dirty;
      this.dirty = false;
      return d;
    }
    // Fallback: currentTime advances with each new frame on most browsers.
    if (v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      return true;
    }
    return false;
  }

  dispose() {
    this.disposed = true;
    (this.element as VideoWithRvfc).cancelVideoFrameCallback?.(this.rvfcHandle);
  }
}
