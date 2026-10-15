// Downloads the MediaPipe models the app serves itself (public/models/).
// Run once after cloning: npm run models
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = [
  {
    file: 'face_landmarker.task',
    url: `${BASE}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`,
    size: 3758596,
  },
  {
    file: 'selfie_segmenter.tflite',
    url: `${BASE}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`,
    size: 249537,
  },
];

const dir = join(root, 'public', 'models');
await mkdir(dir, { recursive: true });

for (const m of MODELS) {
  const dest = join(dir, m.file);
  const existing = await stat(dest).catch(() => null);
  if (existing?.size === m.size) {
    console.log(`✓ ${m.file} ya está`);
    continue;
  }
  process.stdout.write(`↓ ${m.file} … `);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== m.size) throw new Error(`${m.file}: tamaño inesperado (${buf.length} B)`);
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}
