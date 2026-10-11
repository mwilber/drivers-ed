/** Opt-in local development measurements (?profile=1); no telemetry or GPU timing. */
export class RenderProfile {
  private key = '';
  private intervals: number[] = [];
  private costs: number[] = [];
  record(key: string, intervalMs: number, costMs: number): void {
    if (key !== this.key) { this.key = key; this.intervals = []; this.costs = []; }
    if (this.costs.length >= 300) return;
    this.intervals.push(intervalMs);
    this.costs.push(costMs);
    if (this.costs.length !== 300) return;
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const sorted = [...this.costs].sort((a, b) => a - b);
    console.info(`Render profile (${key}, 300 frames): ${Math.round(1000 / mean(this.intervals))} observed FPS; ${mean(this.costs).toFixed(2)} ms mean / ${sorted[284]!.toFixed(2)} ms p95 frame CPU. GPU completion is not measured.`);
  }
  pause(): void { this.key = ''; }
}
