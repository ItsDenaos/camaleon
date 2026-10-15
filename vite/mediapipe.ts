import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** The MediaPipe runtime loaders + wasm (SIMD and fallback); the "module" variant is unused. */
const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

/**
 * Copies MediaPipe's wasm runtime from node_modules into public/mediapipe/wasm so the
 * app serves it from its own origin (no CDN, works offline). Runs for dev and build.
 */
export function mediapipeWasm(): Plugin {
  return {
    name: 'camaleon:mediapipe-wasm',
    async buildStart() {
      const src = join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
      const dest = join(process.cwd(), 'public', 'mediapipe', 'wasm');
      await mkdir(dest, { recursive: true });
      for (const f of FILES) {
        const [a, b] = await Promise.all([stat(join(src, f)), stat(join(dest, f)).catch(() => null)]);
        if (b?.size !== a.size) await copyFile(join(src, f), join(dest, f));
      }
    },
  };
}
