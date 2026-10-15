import { CameraError, classifyError } from './errors';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
  facingMode?: string;
  width: number;
  height: number;
}

/** Thrown when a newer start()/stop() call made this one obsolete. Callers should ignore it. */
export class SupersededError extends Error {
  constructor() {
    super('superseded');
    this.name = 'SupersededError';
  }
}

const IDEAL_VIDEO: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

/**
 * Owns the getUserMedia stream and the hidden <video> element that plays it.
 * Only one stream is open at a time (phones can't open two cameras at once).
 */
export class CameraController {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  /** Incremented on every start/stop so stale getUserMedia results get discarded. */
  private generation = 0;

  /** Called when the active track ends unexpectedly (unplugged, revoked permission…). */
  onEnded: (() => void) | null = null;
  /** Called when cameras are plugged/unplugged. */
  onDevicesChanged: (() => void) | null = null;

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    this.video = v;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.onDevicesChanged?.());
  }

  static checkSupport() {
    if (!window.isSecureContext) throw new CameraError('insecure');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
  }

  /** Whether camera permission was already granted (so we can start without a click). */
  static async isPermissionGranted(): Promise<boolean> {
    try {
      const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
      return status?.state === 'granted';
    } catch {
      return false;
    }
  }

  async listDevices(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: cleanLabel(d.label) || `Cámara ${i + 1}` }));
  }

  async start(deviceId?: string | null): Promise<CameraInfo> {
    CameraController.checkSupport();
    this.stop();
    const gen = ++this.generation;

    const stream = await this.open(deviceId);
    if (gen !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new SupersededError();
    }
    this.stream = stream;

    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (gen === this.generation) this.onEnded?.();
    });

    this.video.srcObject = stream;
    await waitForMetadata(this.video);
    try {
      await this.video.play();
    } catch (err) {
      // Muted inline video may still be blocked on some browsers until a gesture.
      if ((err as Error).name !== 'AbortError') throw err;
    }
    if (gen !== this.generation) throw new SupersededError();

    const s = track.getSettings();
    return {
      deviceId: s.deviceId ?? deviceId ?? '',
      label: cleanLabel(track.label),
      facingMode: s.facingMode,
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    };
  }

  stop() {
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get active() {
    return this.stream !== null;
  }

  /** Tries progressively looser constraints so odd cameras still open. */
  private async open(deviceId?: string | null): Promise<MediaStream> {
    const attempts: MediaTrackConstraints[] = deviceId
      ? [{ ...IDEAL_VIDEO, deviceId: { exact: deviceId } }, { deviceId: { exact: deviceId } }]
      : [];
    attempts.push({ ...IDEAL_VIDEO, facingMode: 'user' }, {});

    let lastErr: unknown;
    for (const video of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: Object.keys(video).length ? video : true,
          audio: false,
        });
      } catch (err) {
        lastErr = err;
        const kind = classifyError(err);
        // Only constraint/missing-device failures are worth retrying with looser constraints.
        if (kind !== 'overconstrained' && kind !== 'not-found') break;
      }
    }
    throw lastErr;
  }
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= video.HAVE_METADATA && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new DOMException('La cámara no envía imagen', 'NotReadableError'));
    }, 10_000);
    const onMeta = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onMeta);
    };
    video.addEventListener('loadedmetadata', onMeta);
  });
}

/** Strips USB vendor/product ids like "FaceTime HD Camera (05ac:8514)". */
function cleanLabel(label: string) {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}
