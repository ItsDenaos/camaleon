/** Counts events (frames rendered, frames uploaded…) and reports a per-second rate. */
export class RateMeter {
  private count = 0;
  private since = 0;
  value = 0;

  mark() {
    this.count++;
  }

  /** Recomputes the rate once `windowMs` has elapsed. Returns true when `value` changed. */
  sample(now: number, windowMs = 1000): boolean {
    if (this.since === 0) {
      this.since = now;
      this.count = 0;
      return false;
    }
    const dt = now - this.since;
    if (dt < windowMs) return false;
    this.value = (this.count * 1000) / dt;
    this.count = 0;
    this.since = now;
    return true;
  }

  reset() {
    this.count = 0;
    this.since = 0;
    this.value = 0;
  }
}
