export const FIXED_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;

/** Shared by the browser and frame-rate regression checks. Discard long pauses. */
export class SimulationClock {
  private accumulator = 0;

  advance(elapsed: number, update: (dt: number) => void): void {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    this.accumulator += Math.min(elapsed, MAX_FRAME_TIME);
    while (this.accumulator + 1e-10 >= FIXED_STEP) {
      update(FIXED_STEP);
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
    }
  }

  reset(): void {
    this.accumulator = 0;
  }
}
