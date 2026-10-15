import type { FitMode } from '../render/renderer';

export interface SavedLayer {
  id: string;
  /** Param values by key. */
  values: Record<string, number>;
}

export type CaptureMode = 'photo' | 'strip' | 'gif' | 'boomerang' | 'video';
export type TimerSeconds = 0 | 3 | 5 | 10;

export interface Prefs {
  deviceId?: string;
  /** Mirror choice per camera; front cameras default to mirrored. */
  mirrorByDevice: Record<string, boolean>;
  fit: FitMode;
  showStats: boolean;
  /** Last effect stack, restored on load. */
  stack: SavedLayer[];
  stackMode: boolean;
  captureMode: CaptureMode;
  timer: TimerSeconds;
  /** Record microphone audio with videos. */
  mic: boolean;
}

const KEY = 'camaleon:prefs:v1';
const defaults = (): Prefs => ({
  mirrorByDevice: {},
  fit: 'contain',
  // The fps meter is a development aid: on by default only in dev.
  showStats: import.meta.env.DEV,
  stack: [],
  stackMode: false,
  captureMode: 'photo',
  timer: 0,
  mic: true,
});

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Prefs>;
      const prefs = { ...defaults(), ...saved };
      if (!Array.isArray(prefs.stack)) prefs.stack = [];
      return prefs;
    }
  } catch {
    // Storage blocked (private mode, sandboxed iframe…) or corrupt: fall back to defaults.
  }
  return defaults();
}

let timer = 0;

export function savePrefs(prefs: Prefs) {
  clearTimeout(timer);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Best effort only.
  }
}

/** For values that change continuously (sliders): writes at most every 300 ms. */
export function savePrefsSoon(prefs: Prefs) {
  clearTimeout(timer);
  timer = window.setTimeout(() => savePrefs(prefs), 300);
}
