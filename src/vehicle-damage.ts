import { CAR, DAMAGE } from './vehicle-config.ts';

export const DAMAGE_PANELS = ['front', 'rear', 'left', 'right', 'roof'] as const;
export type DamagePanel = typeof DAMAGE_PANELS[number];
export interface DamageVector { x: number; y: number; z: number }
export interface PanelDamage { dent: number; scratch: number }
export interface DamageContact {
  obstacle: number;
  point: DamageVector;
  localPoint: DamageVector; // Chassis coordinates; forward is -Z.
  normal: DamageVector;
  localNormal?: DamageVector;
  closingSpeed: number;
  tangentSpeed: number;
  impulse: number;
  material: string;
}
export interface DamageEvent {
  kind: 'impact' | 'scrape-start' | 'scrape' | 'scrape-end';
  time: number;
  panel: DamagePanel;
  severity: number;
  point: DamageVector;
  normal: DamageVector;
  material: string;
}
interface ContactHistory { armed: boolean; lastImpact: number; lastScrape: number; scrape?: DamageEvent }
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function damagePanelAt(point: DamageVector, normal?: DamageVector): DamagePanel {
  if (normal) {
    if (Math.abs(normal.y) > 0.7 && point.y > 0.8) return 'roof';
    if (Math.abs(normal.z) > Math.abs(normal.x)) return point.z < 0 ? 'front' : 'rear';
    return point.x < 0 ? 'left' : 'right';
  }
  if (point.y > 0.8) return 'roof';
  return Math.abs(point.z) / (CAR.length / 2) > Math.abs(point.x) / (CAR.width / 2)
    ? point.z < 0 ? 'front' : 'rear'
    : point.x < 0 ? 'left' : 'right';
}

/** Persistent damage; transient contacts and bounded audio events are simulation-time based. */
export class VehicleDamage {
  readonly panels = Object.fromEntries(DAMAGE_PANELS.map(panel => [panel, { dent: 0, scratch: 0 }])) as Record<DamagePanel, PanelDamage>;
  readonly suspension = [0, 0, 0, 0];
  revision = 0;
  handlingEnabled = true;
  private time = 0;
  private contacts = new Map<number, ContactHistory>();
  private events: DamageEvent[] = [];

  update(samples: readonly DamageContact[], dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const sample of samples) {
      seen.add(sample.obstacle);
      const history = this.contacts.get(sample.obstacle) ?? { armed: true, lastImpact: -Infinity, lastScrape: -Infinity };
      this.contacts.set(sample.obstacle, history);
      const panel = damagePanelAt(sample.localPoint, sample.localNormal);
      const damage = this.panels[panel];
      const event = (kind: DamageEvent['kind'], severity: number): DamageEvent => ({
        kind, time: this.time, panel, severity, point: { ...sample.point }, normal: { ...sample.normal }, material: sample.material,
      });
      // Require both inward motion and a solver impulse. Support/resting forces alone cannot damage paint.
      if (history.armed && sample.closingSpeed >= DAMAGE.minimumImpactSpeed && sample.impulse > CAR.mass * 0.15 && this.time - history.lastImpact >= DAMAGE.impactCooldown) {
        const severity = clamp((sample.closingSpeed - DAMAGE.minimumImpactSpeed) / (DAMAGE.fullSeveritySpeed - DAMAGE.minimumImpactSpeed));
        damage.dent = clamp(damage.dent + 0.04 + severity * 0.7);
        damage.scratch = clamp(damage.scratch + 0.03 + severity * 0.18);
        if (sample.closingSpeed >= DAMAGE.heavyImpactSpeed) {
          const wheel = (sample.localPoint.z < 0 ? 0 : 2) + (sample.localPoint.x < 0 ? 0 : 1);
          this.suspension[wheel] = clamp(this.suspension[wheel]! + severity * 0.65);
        }
        history.armed = false;
        history.lastImpact = this.time;
        this.emit(event('impact', severity));
        this.revision++;
      }
      if (sample.closingSpeed < 0.3) history.armed = true;
      if (sample.tangentSpeed >= DAMAGE.minimumScrapeSpeed && sample.impulse > 0) {
        damage.scratch = clamp(damage.scratch + sample.tangentSpeed * dt * DAMAGE.scratchPerMetre);
        const scrape = event(history.scrape ? 'scrape' : 'scrape-start', clamp(sample.tangentSpeed / 18));
        if (!history.scrape || this.time - history.lastScrape >= DAMAGE.scrapeEventInterval) {
          this.emit(scrape);
          history.lastScrape = this.time;
        }
        history.scrape = scrape;
        this.revision++;
      } else this.endScrape(history);
    }
    for (const [obstacle, history] of this.contacts) {
      if (!seen.has(obstacle)) { this.endScrape(history); this.contacts.delete(obstacle); }
    }
  }

  private emit(event: DamageEvent): void {
    this.events.push(event);
    if (this.events.length > 128) this.events.shift();
  }
  private endScrape(history: ContactHistory): void {
    if (history.scrape) this.emit({ ...history.scrape, kind: 'scrape-end', time: this.time, severity: 0 });
    history.scrape = undefined;
  }
  /** Consume once per render frame (or by a future audio system). */
  drainEvents(): DamageEvent[] { const events = this.events; this.events = []; return events; }
  pause(): void { for (const history of this.contacts.values()) this.endScrape(history); }
  repair(): void {
    // Discard pending impacts, but stop any scrape a consumer has already started playing.
    this.events = this.events.filter(event => event.kind === 'scrape-end');
    for (const history of this.contacts.values()) this.endScrape(history);
    for (const panel of DAMAGE_PANELS) Object.assign(this.panels[panel], { dent: 0, scratch: 0 });
    this.suspension.fill(0);
    this.contacts.clear();
    this.revision++;
  }
  get effects() {
    const heavy = (panel: DamagePanel) => clamp((this.panels[panel].dent - 0.2) / 0.8);
    const enabled = this.handlingEnabled;
    const left = this.suspension[0]! + this.suspension[2]!, right = this.suspension[1]! + this.suspension[3]!;
    return {
      power: enabled ? 1 - heavy('front') * DAMAGE.maximumPowerLoss : 1,
      steeringBias: enabled ? (left - right) / 2 * DAMAGE.maximumSteeringBias : 0,
      suspension: this.suspension.map(value => enabled ? 1 - value * DAMAGE.maximumSuspensionLoss : 1),
    };
  }
  get condition(): 'undamaged' | 'cosmetic' | 'heavy' {
    if (DAMAGE_PANELS.some(panel => this.panels[panel].dent > 0.2)) return 'heavy';
    return DAMAGE_PANELS.some(panel => this.panels[panel].dent > 0 || this.panels[panel].scratch > 0) ? 'cosmetic' : 'undamaged';
  }
}
