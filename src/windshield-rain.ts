import type { Weather, WiperMode } from './driving-conditions.ts';

export const WINDSHIELD = { width: 1.65, height: Math.hypot(0.55, 0.42), columns: 32, rows: 16, bladeLength: 0.54, sweep: 1.15 } as const;
export const WIPER_PERIOD = { slow: 1.6, fast: 0.8 } as const;
export const RAIN_BUDGET = { streaks: 320, windshieldCells: WINDSHIELD.columns * WINDSHIELD.rows } as const;
/** Small, deterministic water grid in windshield coordinates; no physics or renderer dependency. */
export class WindshieldRain {
  readonly water = new Float32Array(RAIN_BUDGET.windshieldCells);
  private readonly angles = [-0.33, 0.33].map(pivot => Array.from(this.water, (_, i) => {
    const x = ((i % WINDSHIELD.columns + 0.5) / WINDSHIELD.columns - 0.5) * WINDSHIELD.width - pivot;
    const y = (Math.floor(i / WINDSHIELD.columns) + 0.5) / WINDSHIELD.rows * WINDSHIELD.height - 0.02;
    return { angle: Math.atan2(x, y), radius: Math.hypot(x, y) };
  }));
  private phase = 0;
  private period: number = WIPER_PERIOD.slow;
  private wasDry = true;
  revision = 0;
  get moving(): boolean { return this.phase > 0; }
  get angle(): number { return -WINDSHIELD.sweep * Math.cos(2 * Math.PI * this.phase); }
  get coverage(): number { return this.water.reduce((sum, water) => sum + water, 0) / this.water.length; }
  step(dt: number, weather: Weather, mode: WiperMode): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (weather === 'dry' && this.wasDry && !this.moving) return;
    this.wasDry = weather === 'dry';
    const before = this.angle;
    const active = weather === 'rain' && mode !== 'off';
    if (active) this.period = WIPER_PERIOD[mode as 'slow' | 'fast'];
    const previousPhase = this.phase;
    if (active || this.moving) {
      this.phase += dt / this.period;
      if (this.phase >= 1) this.phase = active ? this.phase % 1 : 0;
    }
    const after = this.angle;
    const maximum = previousPhase < 0.5 && this.phase >= 0.5 ? WINDSHIELD.sweep : Math.max(before, after);
    const minimum = Math.min(before, after);
    for (let i = 0; i < this.water.length; i++) {
      this.water[i] = weather === 'rain' ? Math.min(1, this.water[i]! + dt * (0.22 + (i * 13 % 17) / 100)) : 0;
      if ((active || previousPhase > 0) && this.angles.some(cells => {
        const cell = cells[i]!;
        return cell.radius <= WINDSHIELD.bladeLength && cell.angle >= minimum - 0.045 && cell.angle <= maximum + 0.045;
      })) this.water[i] = 0;
    }
    this.revision++;
  }
  reset(): void { this.water.fill(0); this.phase = 0; this.wasDry = true; this.revision++; }
}

/** Stable wrapping keeps streaks anchored in world space as the driver moves. */
export function rainStreak(index: number, seconds: number, position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const wrap = (value: number, span: number) => ((value % span) + span) % span - span / 2;
  return { x: position.x + wrap(index * 13.731 - position.x, 70), y: position.y + wrap(index * 7.319 - seconds * 12, 24) + 9,
    z: position.z + wrap(index * 19.913 - position.z, 70) };
}
