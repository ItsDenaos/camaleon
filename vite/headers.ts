import type { Plugin } from 'vite';

/**
 * Single source for the HTTP headers: written to dist/_headers for Netlify (works with
 * Git deploys, the CLI and drag-and-drop) and applied by `vite preview` to test locally.
 */

// Everything is same-origin by design: no CDNs, no analytics, no uploads.
const CSP = [
  "default-src 'self'",
  // MediaPipe compiles WebAssembly and injects its same-origin loader script.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // Preact sets inline style attributes (slider fill, grid sizes).
  "style-src 'self' 'unsafe-inline'",
  // Captures and thumbnails are shown through blob: URLs.
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Permissions-Policy':
    'camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const CACHE_RULES: [string, string][] = [
  // Hashed file names: safe to cache forever.
  ['/assets/*', 'public, max-age=31536000, immutable'],
  // Large AI files: a week in the HTTP cache (the service worker also keeps them).
  ['/mediapipe/*', 'public, max-age=604800'],
  ['/models/*', 'public, max-age=604800'],
  // Must always be revalidated so updates are noticed.
  ['/sw.js', 'no-cache'],
  ['/manifest.webmanifest', 'no-cache'],
  ['/index.html', 'no-cache'],
];

function netlifyHeaders(): string {
  const lines = ['/*', ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`)];
  for (const [path, value] of CACHE_RULES) lines.push(path, `  Cache-Control: ${value}`);
  return `${lines.join('\n')}\n`;
}

export function netlifyHeadersFile(): Plugin {
  return {
    name: 'camaleon:netlify-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: netlifyHeaders() });
    },
  };
}
