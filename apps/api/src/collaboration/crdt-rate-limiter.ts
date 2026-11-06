export class CrdtRateLimiter {
  private windowMs: number;
  private maxOperations: number;
  private tracker = new Map<string, number[]>();
  private opsSinceSweep = 0;

  constructor(windowMs = 60000, maxOperations = 120) {
    this.windowMs = windowMs;
    this.maxOperations = maxOperations;
  }

  private sweepExpired(now: number): void {
    for (const [key, tsList] of this.tracker.entries()) {
      const active = tsList.filter((ts) => now - ts < this.windowMs);
      if (active.length === 0) {
        this.tracker.delete(key);
      } else if (active.length !== tsList.length) {
        this.tracker.set(key, active);
      }
    }
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    if (++this.opsSinceSweep >= 250) {
      this.opsSinceSweep = 0;
      this.sweepExpired(now);
    }

    const timestamps = (this.tracker.get(key) || []).filter(
      (ts) => now - ts < this.windowMs,
    );

    if (timestamps.length >= this.maxOperations) {
      if (timestamps.length === 0) {
        this.tracker.delete(key);
      } else {
        this.tracker.set(key, timestamps);
      }
      return false;
    }

    timestamps.push(now);
    this.tracker.set(key, timestamps);
    return true;
  }

  reset(key?: string): void {
    if (key) {
      this.tracker.delete(key);
    } else {
      this.tracker.clear();
    }
  }
}

export const crdtRateLimiter = new CrdtRateLimiter(60000, 1200);
