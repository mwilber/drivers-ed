import { APPROACHES, LANES, LANE_CONNECTIONS, type Approach } from './traffic-layout.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import type { Point } from './road-network.ts';

export type SignalColor = 'red' | 'yellow' | 'green';
export type SignalGroup = Approach['signalGroup'];
// Authored demonstration timing, in simulation seconds. All-red clearance
// separates perpendicular movements; opposing left turns remain permissive.
export const SIGNAL_PHASES = [
  { seconds: 14, ns: 'green', ew: 'red' },
  { seconds: 3, ns: 'yellow', ew: 'red' },
  { seconds: 2, ns: 'red', ew: 'red' },
  { seconds: 14, ns: 'red', ew: 'green' },
  { seconds: 3, ns: 'red', ew: 'yellow' },
  { seconds: 2, ns: 'red', ew: 'red' },
] as const;
export const SIGNAL_CYCLE = SIGNAL_PHASES.reduce((sum, phase) => sum + phase.seconds, 0);
export function signalState(seconds: number): { ns: SignalColor; ew: SignalColor; remaining: number } {
  let time = Number.isFinite(seconds) ? ((seconds % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE : 0;
  for (const phase of SIGNAL_PHASES) {
    if (time < phase.seconds) return { ns: phase.ns, ew: phase.ew, remaining: phase.seconds - time };
    time -= phase.seconds;
  }
  return { ns: 'green', ew: 'red', remaining: 14 };
}
/** One tick per vehicle step. Pauses do not advance; resets restart the cycle. */
export class TrafficSignals {
  private ticks = 0;
  get seconds(): number { return this.ticks * FIXED_STEP; }
  step(): void { this.ticks++; }
  reset(): void { this.ticks = 0; }
  color(approachId: string): SignalColor | undefined {
    const approach = APPROACHES.find(a => a.id === approachId);
    return approach?.kind === 'signal' ? signalState(this.seconds)[approach.signalGroup] : undefined;
  }
}
export interface MovementRule {
  action: 'stop' | 'yield' | 'proceed' | 'caution';
  reasons: readonly string[];
}
/** Rule metadata for manual guidance and the subsequent traffic phase, not a penalty system. */
export function movementRule(connectionId: string, seconds: number, stopped = false): MovementRule {
  const connection = LANE_CONNECTIONS.find(c => c.id === connectionId);
  if (!connection) throw new Error(`Unknown lane connection: ${connectionId}`);
  const approach = APPROACHES.find(a => a.laneId === connection.incoming)!;
  if (approach.kind === 'signal') {
    const color = signalState(seconds)[approach.signalGroup];
    if (color === 'red') return { action: 'stop', reasons: ['Red signal', 'No turn on red'] };
    if (color === 'yellow') return { action: 'caution', reasons: ['Stop if you can do so safely; clear the junction if already committed'] };
  }
  if (approach.kind === 'all-way-stop' || approach.kind === 'stop') {
    if (!stopped) return { action: 'stop', reasons: ['Complete stop before the line'] };
    return { action: 'yield', reasons: approach.kind === 'all-way-stop'
      ? ['Earlier arrivals', 'Driver on the right at simultaneous arrival', 'Pedestrians', ...(connection.turn === 'left' ? ['Oncoming traffic'] : [])]
      : ['Through traffic', 'Pedestrians'] };
  }
  if (approach.kind === 'yield') return { action: 'yield', reasons: ['Through traffic', 'Pedestrians; stop if necessary'] };
  return { action: connection.turn === 'left' ? 'yield' : 'proceed', reasons: connection.turn === 'left' ? ['Oncoming traffic', 'Pedestrians'] : ['Yield to pedestrians and traffic still clearing the intersection'] };
}
export interface UpcomingControl { approach: Approach; distance: number }
export function upcomingControl(point: Point, heading: number): UpcomingControl | undefined {
  const forward = { x: -Math.sin(heading), z: -Math.cos(heading) };
  const candidates = APPROACHES.filter(a => a.kind !== 'priority').flatMap(approach => {
    const u = approach.direction;
    if (forward.x * u.x + forward.z * u.z < 0.8) return [];
    const delta = { x: approach.x - point.x, z: approach.z - point.z };
    const distance = delta.x * u.x + delta.z * u.z - 2.25; // Front bumper, not car center.
    const lateral = Math.abs(-u.z * delta.x + u.x * delta.z);
    const lane = LANES.find(l => l.id === approach.laneId)!;
    return distance >= -0.5 && distance <= 65 && lateral <= lane.width / 2 ? [{ approach, distance }] : [];
  });
  return candidates.sort((a, b) => a.distance - b.distance)[0];
}
export function controlGuidance(control: UpcomingControl | undefined, signals: TrafficSignals): string {
  if (!control) return 'Keep right · yield to pedestrians';
  const distance = Math.max(0, Math.round(control.distance));
  const a = control.approach;
  const label = a.kind === 'signal' ? `${signals.color(a.id)!.toUpperCase()} · ${signals.color(a.id) === 'green' ? 'left turns yield' : signals.color(a.id) === 'yellow' ? 'stop if safe' : 'no turn on red'}`
    : a.kind === 'all-way-stop' ? 'ALL-WAY STOP · full stop, then yield'
    : a.kind === 'stop' ? 'STOP · yield to through traffic' : 'YIELD · stop if necessary';
  return `${label} · ${distance} m`;
}
