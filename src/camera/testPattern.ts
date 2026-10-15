import type { FrameSource } from './source';

/**
 * Animated synthetic frame source: lets people try the app without a camera
 * and gives effects something colorful with edges, gradients and motion.
 */
export class TestPatternSource implements FrameSource {
  readonly element: HTMLCanvasElement;
  readonly width = 960;
  readonly height = 540;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly start = performance.now();
  private lastDraw = 0;

  constructor() {
    this.element = document.createElement('canvas');
    this.element.width = this.width;
    this.element.height = this.height;
    this.ctx = this.element.getContext('2d')!;
  }

  poll(now: number): boolean {
    // ~30 fps, like a typical webcam.
    if (now - this.lastDraw < 33) return false;
    this.lastDraw = now;
    this.draw((now - this.start) / 1000);
    return true;
  }

  private draw(t: number) {
    const { ctx, width: w, height: h } = this;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, `hsl(${(t * 20) % 360} 70% 22%)`);
    bg.addColorStop(1, `hsl(${(t * 20 + 140) % 360} 70% 12%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 48) ctx.moveTo(x + 0.5, 0), ctx.lineTo(x + 0.5, h);
    for (let y = 0; y <= h; y += 48) ctx.moveTo(0, y + 0.5), ctx.lineTo(w, y + 0.5);
    ctx.stroke();

    // Color bars
    const bars = ['#ffffff', '#ffd400', '#00e5ff', '#00e04b', '#ff3df2', '#ff2a2a', '#2a4dff', '#111111'];
    const bw = 34;
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(28 + i * bw, h - 120, bw, 92);
    });

    // Luma ramp
    const ramp = ctx.createLinearGradient(w - 330, 0, w - 28, 0);
    ramp.addColorStop(0, '#000');
    ramp.addColorStop(1, '#fff');
    ctx.fillStyle = ramp;
    ctx.fillRect(w - 330, h - 120, 302, 40);
    const hue = ctx.createLinearGradient(w - 330, 0, w - 28, 0);
    for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
    ctx.fillStyle = hue;
    ctx.fillRect(w - 330, h - 72, 302, 44);

    // Friendly "face" that bobs around, so face-ish effects have something to chew on.
    const cx = w / 2 + Math.sin(t * 0.9) * 150;
    const cy = h / 2 - 40 + Math.cos(t * 1.3) * 40;
    const r = 110;
    const face = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, r);
    face.addColorStop(0, '#ffd9b8');
    face.addColorStop(1, '#d9905f');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const blink = Math.sin(t * 3) > 0.96 ? 0.15 : 1;
    ctx.fillStyle = '#1b1b24';
    for (const dx of [-38, 38]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy - 20, 13, 16 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#7a2e2e';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy + 18, 48, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // Spinning ring
    ctx.save();
    ctx.translate(150, 140);
    ctx.rotate(t);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.fillStyle = `hsl(${i * 30} 90% 60%)`;
      ctx.fillRect(48, -8, 34, 16);
    }
    ctx.restore();

    // Label + clock (shows whether the mirror is applied: text reads backwards when mirrored)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(w - 300, 24, 276, 64);
    ctx.fillStyle = '#fff';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('CAMALEÓN · DEMO', w - 286, 46);
    ctx.font = '500 18px ui-monospace, monospace';
    ctx.fillStyle = '#7cf29c';
    ctx.fillText(`t = ${t.toFixed(2)} s`, w - 286, 72);
  }

  dispose() {
    this.element.width = this.element.height = 0;
  }
}
