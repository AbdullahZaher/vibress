import { performance } from "node:perf_hooks";

/** Disposable D1 dispatch guard, not a hard real-time supervisor or approved M. */
export const EXPERIMENTAL_D1_MS = 2517;
export class D1DeadlineExceeded extends Error {
  constructor() {
    super("D1 dispatch deadline exceeded");
    this.name = "D1DeadlineExceeded";
  }
}

export class ExperimentalD1Budget {
  private readonly t0: number;
  constructor(private readonly now: () => number = () => performance.now()) {
    this.t0 = now();
  }
  remainingMs(): number {
    return EXPERIMENTAL_D1_MS - (this.now() - this.t0);
  }
  expired(): boolean {
    return this.remainingMs() <= 0;
  }
  checkpoint(): void {
    if (this.expired()) throw new D1DeadlineExceeded();
  }
}
