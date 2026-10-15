import { signal } from '@preact/signals';
import type { CameraDevice } from '../camera/camera';
import type { ErrorInfo } from '../camera/errors';
import type { CaptureMeta } from '../capture/store';
import type { FitMode, RenderStats } from '../render/renderer';
import { loadPrefs, type CaptureMode, type TimerSeconds } from './prefs';

export type AppStatus = 'booting' | 'idle' | 'starting' | 'running' | 'error';
export type SourceKind = 'camera' | 'demo';

/** One effect in the stack as the UI sees it. */
export interface LayerState {
  /** Unique per layer instance (the same effect could be re-added later). */
  readonly uid: number;
  readonly id: string;
  /** Aligned with the effect's params. */
  readonly values: readonly number[];
}

export const prefs = loadPrefs();

export const status = signal<AppStatus>('booting');
export const error = signal<ErrorInfo | null>(null);
export const sourceKind = signal<SourceKind | null>(null);
export const devices = signal<CameraDevice[]>([]);
export const currentDeviceId = signal<string | null>(null);
export const mirror = signal(true);
export const fit = signal<FitMode>(prefs.fit);
export const showStats = signal(prefs.showStats);
export const stats = signal<RenderStats>({ fps: 0, sourceFps: 0, width: 0, height: 0 });

/** Effects applied in order (index 0 first). Empty = no effect ("Normal"). */
export const stack = signal<readonly LayerState[]>([]);
/** When on, picking an effect adds/removes it from the stack instead of replacing it. */
export const stackMode = signal(prefs.stackMode);
export const panelOpen = signal(false);
/** Live-thumbnail grid of effects. */
export const galleryOpen = signal(false);
export const galleryPage = signal(0);
/** Set by the gallery component from its layout (pages depend on the screen shape). */
export const galleryPageCount = signal(1);
/** Width / height of the camera image, for sizing thumbnails. */
export const imageAspect = signal(16 / 9);

// --- AI --------------------------------------------------------------------

export const aiStatus = signal<'off' | 'loading' | 'ready' | 'error'>('off');
/** A face filter is applied in the live view (to hint when no face is found). */
export const aiNeedsFace = signal(false);
export const faceCount = signal(0);
/** User-picked effect images by `${effectId}/${key}` (originals, for previews). */
export const effectImages = signal<Record<string, Blob>>({});

// --- PWA -------------------------------------------------------------------

/** A new version is downloaded and waiting for the user to apply it. */
export const updateReady = signal(false);
/** The browser offered to install the app (Chromium's beforeinstallprompt). */
export const installAvailable = signal(false);
/** Big centered label shown briefly when the effect changes. */
export const toast = signal<{ text: string; key: number } | null>(null);
/** Small status message ("Foto guardada", errors…). */
export const notice = signal<{ text: string; key: number; error?: boolean } | null>(null);

// --- Capture -------------------------------------------------------------

export type CapturePhase =
  | { phase: 'idle' }
  | { phase: 'countdown'; count: number; shot?: number; shots?: number }
  | { phase: 'capturing'; progress: number }
  | { phase: 'recording'; elapsed: number }
  | { phase: 'processing'; label: string; progress: number };

export const captureMode = signal<CaptureMode>(prefs.captureMode);
export const timer = signal<TimerSeconds>(prefs.timer);
export const micOn = signal(prefs.mic);
export const capture = signal<CapturePhase>({ phase: 'idle' });
/** Bumped to retrigger the white flash animation. */
export const flashKey = signal(0);
/** Saved captures, newest first. */
export const captures = signal<CaptureMeta[]>([]);
export const capturesOpen = signal(false);
/** Capture open in the full-screen viewer. */
export const viewerId = signal<string | null>(null);
