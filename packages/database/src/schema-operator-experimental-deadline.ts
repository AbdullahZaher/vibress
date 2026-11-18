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
  private readonly marks:{stage:string;elapsedMs:number}[]=[];
  constructor(private readonly now: () => number = () => performance.now(), private readonly measure=false) {
    this.t0 = now();
  }
  mark(stage:string):void {
    if(this.measure&&this.marks.length<64)this.marks.push({stage,elapsedMs:this.now()-this.t0});
  }
  measurements(){return this.marks.map(mark=>({...mark}));}
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

// Node timer delivery is not an authoritative monotonic deadline observation.
// A scheduler returns a cancellation closure for its pending callback.
export function scheduleExperimentalD1Deadline(
  budget: ExperimentalD1Budget,
  onExpired: () => void,
  schedule: (callback: () => void, delayMs: number) => () => void = (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
): () => void {
  let finished = false;
  let cancelPending: (() => void) | undefined;
  const check = () => {
    if (finished) return;
    if (budget.expired()) {
      finished = true;
      onExpired();
      return;
    }
    cancelPending = schedule(check, Math.max(1, Math.ceil(budget.remainingMs())));
  };
  check();
  return () => {
    finished = true;
    cancelPending?.();
  };
}
