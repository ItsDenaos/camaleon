import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FACE_POINTS, MAX_FACES } from '../engine/types';

// MediaPipe Face Mesh indices (478-point model with irises).
const IRIS_A = 468;
const IRIS_B = 473;
const EYE_A = [33, 133];
const EYE_B = [362, 263];
// Order must match the FP_* defines in the prelude.
const NOSE = 1;
const LIP = 0;
const MOUTH = [61, 291];
const CHIN = 152;
const FOREHEAD = 10;
const CHEEKS = [234, 454];

interface RawFace {
  cx: number;
  cy: number;
  xx: number;
  xy: number;
  pts: number[];
}

/**
 * Turns landmarks into what the shaders use: per face, the midpoint between the eyes and
 * the eye-to-eye vector (in centered() image space, after mirroring), plus key points in
 * face units. Smooths adaptively: still faces don't jitter, fast moves don't lag.
 */
export class FaceTracker {
  readonly centers = new Float32Array(MAX_FACES * 2);
  readonly axes = new Float32Array(MAX_FACES * 2);
  readonly points = new Float32Array(MAX_FACES * FACE_POINTS * 2);
  count = 0;

  update(faces: NormalizedLandmark[][], aspect: number, mirror: boolean) {
    const raw = faces
      .slice(0, MAX_FACES)
      .map((f) => measure(f, aspect, mirror))
      .sort((a, b) => a.cx - b.cx); // stable slots: left to right on screen
    const keep = raw.length === this.count; // same faces as before → smooth, else snap
    raw.forEach((r, i) => this.store(i, r, keep));
    this.count = raw.length;
  }

  reset() {
    this.count = 0;
  }

  private store(i: number, r: RawFace, smooth: boolean) {
    const c = this.centers;
    const x = this.axes;
    let a = 1;
    if (smooth) {
      // Movement in eye-distances since the last update: more movement, less smoothing.
      const eye = Math.hypot(x[i * 2], x[i * 2 + 1]) || 1;
      const moved = Math.hypot(r.cx - c[i * 2], r.cy - c[i * 2 + 1]) / eye;
      a = Math.min(1, 0.35 + moved * 6);
    }
    c[i * 2] += (r.cx - c[i * 2]) * a;
    c[i * 2 + 1] += (r.cy - c[i * 2 + 1]) * a;
    x[i * 2] += (r.xx - x[i * 2]) * a;
    x[i * 2 + 1] += (r.xy - x[i * 2 + 1]) * a;
    const o = i * FACE_POINTS * 2;
    for (let k = 0; k < r.pts.length; k++) this.points[o + k] += (r.pts[k] - this.points[o + k]) * a;
  }
}

function measure(f: NormalizedLandmark[], aspect: number, mirror: boolean): RawFace {
  // Camera space (top-left origin, unmirrored) → centered() space (y up, mirrored like the preview).
  const P = (l: NormalizedLandmark): [number, number] => [
    ((mirror ? 1 - l.x : l.x) - 0.5) * aspect,
    0.5 - l.y,
  ];
  const avg = (idx: number[]): [number, number] => {
    const pts = idx.map((k) => P(f[k]));
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };

  let a = f.length > IRIS_B ? P(f[IRIS_A]) : avg(EYE_A);
  let b = f.length > IRIS_B ? P(f[IRIS_B]) : avg(EYE_B);
  if (b[0] < a[0]) [a, b] = [b, a]; // a = screen-left eye
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const xx = b[0] - a[0];
  const xy = b[1] - a[1];
  const s2 = xx * xx + xy * xy || 1e-6;

  // Same transform as faceIso() in the prelude.
  const local = (p: [number, number]): [number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return [(dx * xx + dy * xy) / s2, (-dx * xy + dy * xx) / s2];
  };
  const pair = (idx: number[]) => {
    const [p, q] = idx.map((k) => local(P(f[k])));
    return p[0] <= q[0] ? [p, q] : [q, p];
  };
  const [mouthL, mouthR] = pair(MOUTH);
  const [cheekL, cheekR] = pair(CHEEKS);
  const pts = [
    local(P(f[NOSE])),
    local(P(f[LIP])),
    mouthL,
    mouthR,
    local(P(f[CHIN])),
    local(P(f[FOREHEAD])),
    cheekL,
    cheekR,
  ].flat();
  return { cx, cy, xx, xy, pts };
}
