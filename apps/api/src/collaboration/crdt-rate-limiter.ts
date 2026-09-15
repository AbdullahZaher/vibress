export class CrdtRateLimiter {
  private windowMs: number;
  private maxOperations: number;
  private tracker = new Map<string, number[]>();

  constructor(windowMs = 60000, maxOperations = 120) {
    this.windowMs = windowMs;
    this.maxOperations = maxOperations;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = (this.tracker.get(key) || []).filter(
      (ts) => now - ts < this.windowMs,
    );

    if (timestamps.length >= this.maxOperations) {
      this.tracker.set(key, timestamps);
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

export const crdtRateLimiter = new CrdtRateLimiter(60000, 120);
