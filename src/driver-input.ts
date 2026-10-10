import type { DrivingInput, Indicator } from './simulation.ts';

export const ACTIONS = ['forward', 'reverse', 'left', 'right', 'park', 'gearReverse', 'neutral', 'drive', 'parkingBrake', 'indicatorLeft', 'indicatorRight', 'hazards', 'headlights', 'horn', 'reset'] as const;
export type Action = typeof ACTIONS[number];
export type Bindings = Record<Action, string[]>;
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Accelerator', reverse: 'Brake', left: 'Steer left', right: 'Steer right',
  park: 'Select Park', gearReverse: 'Select Reverse', neutral: 'Select Neutral', drive: 'Select Drive',
  parkingBrake: 'Parking brake', indicatorLeft: 'Left indicator', indicatorRight: 'Right indicator',
  hazards: 'Hazard lights', headlights: 'Headlights', horn: 'Horn (hold)', reset: 'Reset car',
};
export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW', 'ArrowUp'], reverse: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  park: ['Digit1'], gearReverse: ['Digit2'], neutral: ['Digit3'], drive: ['Digit4'],
  parkingBrake: ['KeyB'], indicatorLeft: ['KeyQ'], indicatorRight: ['KeyE'], hazards: ['KeyX'],
  headlights: ['KeyH'], horn: ['Space'], reset: ['KeyR'],
};
const isAction = (value: unknown): value is Action => typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
export const validKey = (code: string): boolean => /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(code);
export const keyLabel = (code: string): string => code.replace(/^Key|^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');

/** Device sources are independent: releasing one never clears another held control. */
export class DriverInput {
  bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  parkingBrake = false;
  headlights = false;
  indicator: Indicator = 'off';
  private readonly sources = new Map<string, Action>();

  actionForKey(code: string): Action | undefined {
    return ACTIONS.find(action => this.bindings[action].includes(code));
  }

  press(source: string, action: Action): Action | undefined {
    if (this.sources.has(source)) return;
    this.sources.set(source, action);
    switch (action) {
      case 'parkingBrake': this.parkingBrake = !this.parkingBrake; break;
      case 'headlights': this.headlights = !this.headlights; break;
      case 'indicatorLeft': this.indicator = this.indicator === 'left' ? 'off' : 'left'; break;
      case 'indicatorRight': this.indicator = this.indicator === 'right' ? 'off' : 'right'; break;
      case 'hazards': this.indicator = this.indicator === 'hazards' ? 'off' : 'hazards'; break;
    }
    return action;
  }

  release(source: string): void { this.sources.delete(source); }

  /** Clear held pedals/steering/horn; deliberate switches retain their state. */
  clear(): void { this.sources.clear(); }

  reset(): void {
    this.clear();
    this.parkingBrake = false;
    this.headlights = false;
    this.indicator = 'off';
  }

  snapshot(): DrivingInput {
    const held = new Set(this.sources.values());
    return { forward: held.has('forward'), reverse: held.has('reverse'), left: held.has('left'), right: held.has('right'),
      horn: held.has('horn'), parkingBrake: this.parkingBrake, headlights: this.headlights, indicator: this.indicator };
  }

  /** Reject conflicts instead of silently moving another control to a different key. */
  remap(action: Action, code: string): string | undefined {
    if (!validKey(code)) return 'Use a letter, number, arrow, Shift, or Space key.';
    const conflict = this.actionForKey(code);
    if (conflict && conflict !== action) return `${keyLabel(code)} is assigned to ${ACTION_LABELS[conflict]}.`;
    this.clear();
    this.bindings[action] = [code];
  }

  restoreDefaults(): void { this.clear(); this.bindings = structuredClone(DEFAULT_BINDINGS); }
  serialize(): string { return JSON.stringify({ version: 1, bindings: this.bindings }); }

  load(serialized: string | null): void {
    if (!serialized) return;
    try {
      const data = JSON.parse(serialized);
      if (data?.version !== 1 || !data.bindings || typeof data.bindings !== 'object') return;
      const used = new Set<string>();
      const next = {} as Bindings;
      for (const action of ACTIONS) {
        const codes: unknown = data.bindings[action];
        if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) return;
        for (const code of codes) {
          if (typeof code !== 'string' || !validKey(code) || used.has(code)) return;
          used.add(code);
        }
        next[action] = codes;
      }
      if (Object.keys(data.bindings).some(action => !isAction(action))) return;
      this.clear();
      this.bindings = next;
    } catch { /* Invalid or older preferences fall back to the active bindings. */ }
  }
}
