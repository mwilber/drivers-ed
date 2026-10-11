import { indicatorLit, type CarState } from './simulation.ts';
import type { DamageEvent, DamageVector } from './vehicle-damage.ts';
import type { Weather } from './driving-conditions.ts';

export const AUDIO_CHANNELS = ['vehicle', 'effects', 'environment'] as const;
export type AudioChannel = typeof AUDIO_CHANNELS[number];
export interface AudioSettings { muted: boolean; master: number; vehicle: number; effects: number; environment: number }
export const DEFAULT_AUDIO: Readonly<AudioSettings> = { muted: false, master: 0.65, vehicle: 0.8, effects: 0.8, environment: 0.45 };
export const AUDIO_BUDGET = { traffic: 6, scrapes: 4, loops: 19, oneShots: 8, queuedCues: 24, radius: 55, scrapeTimeout: 0.7 } as const;
const clamp = (v: number, max = 1) => Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
export function loadAudio(serialized: string | null): AudioSettings {
  try {
    const data = JSON.parse(serialized ?? 'null'), s = data?.settings;
    if (data?.version === 1 && typeof s?.muted === 'boolean' && ['master', ...AUDIO_CHANNELS].every(k => typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 1)) {
      return { muted: s.muted, master: s.master, vehicle: s.vehicle, effects: s.effects, environment: s.environment };
    }
  } catch { /* Session defaults remain usable without storage. */ }
  return { ...DEFAULT_AUDIO };
}
export const serializeAudio = (settings: AudioSettings) => JSON.stringify({ version: 1, settings });
export interface AudioLoop {
  id: string; channel: AudioChannel; waveform: 'sine' | 'triangle' | 'noise';
  frequency: number; gain: number; point?: DamageVector;
}
export interface AudioCue {
  kind: 'indicator-on' | 'indicator-off' | 'shift' | 'impact'; channel: AudioChannel;
  gain: number; frequency: number; duration: number; point?: DamageVector;
}
export interface AudioTraffic { id: number; x: number; z: number; speed: number; parked?: boolean }
export interface AudioSample {
  car: Readonly<CarState>; grounded: number; paved: number; lateralSpeed: number; weather: Weather;
  traffic: readonly AudioTraffic[];
}
interface Scrape { loop: AudioLoop; updated: number; source: string }

/** Authored placeholder timbres: material changes brightness/decay, never impact severity. */
export function impactSound(event: DamageEvent): AudioCue {
  const severity = clamp(event.severity);
  const soft = ['hedge', 'soil', 'rider', 'pedestrian'].includes(event.material);
  const metal = ['metal', 'vehicle', 'bicycle'].includes(event.material);
  return { kind: 'impact', channel: 'effects', gain: (soft ? 0.07 : 0.13) + severity * (soft ? 0.09 : 0.22),
    frequency: soft ? 260 : metal ? 1800 : event.material === 'wood' ? 650 : 950,
    duration: 0.09 + severity * (metal ? 0.38 : 0.25), point: { ...event.point } };
}

/** Run on simulation ticks, independently of AudioContext time and rendering cadence. */
export class DrivingAudioModel {
  private time = 0;
  private previousIndicator?: boolean;
  private previousGear?: string;
  private scrapes = new Map<string, Scrape>();
  private cues: AudioCue[] = [];
  private continuous: AudioLoop[] = [];
  private position?: { x: number; z: number };

  step(sample: AudioSample, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    const { car, weather } = sample;
    this.position = { x: car.x, z: car.z };
    const speed = clamp(Math.abs(car.speed), 60), grounded = clamp(sample.grounded), paved = clamp(sample.paved);
    const rpm = Math.max(600, clamp(car.engineRpm, 8000));
    const load = clamp(car.throttle) * (car.shiftRemaining > 0 ? 0.25 : 1);
    const lit = indicatorLit(car), gear = `${car.selectedGear}:${car.gear}`;
    if (car.indicator !== 'off' && lit !== this.previousIndicator) this.enqueue({ kind: lit ? 'indicator-on' : 'indicator-off', channel: 'effects', gain: 0.06, frequency: lit ? 1700 : 1200, duration: 0.035 });
    if (this.previousGear !== undefined && gear !== this.previousGear) this.enqueue({ kind: 'shift', channel: 'vehicle', gain: 0.045, frequency: 190, duration: 0.09 });
    this.previousIndicator = lit; this.previousGear = gear;
    const rolling = grounded * clamp(speed / 28), wet = weather === 'rain';
    // Lateral motion is measured from the rigid body. Turning demand supplements it at grip saturation.
    const slip = grounded * clamp(speed / 4) * clamp(Math.max(Math.abs(sample.lateralSpeed) - 0.8, (Math.abs(car.lateralAcceleration) - (wet ? 4.5 : 8)) / 3) / 4);
    this.continuous = [
      { id: 'engine', channel: 'vehicle', waveform: 'triangle', frequency: rpm / 30, gain: 0.065 + load * 0.065 },
      { id: 'engine-harmonic', channel: 'vehicle', waveform: 'sine', frequency: rpm / 15, gain: 0.015 + load * 0.025 },
      { id: 'transmission', channel: 'vehicle', waveform: 'sine', frequency: 120 + speed * 16, gain: car.gear === 0 ? 0 : clamp(speed / 30) * (car.gear < 0 ? 0.035 : 0.012) },
      { id: 'road', channel: 'vehicle', waveform: 'noise', frequency: paved > 0.5 ? wet ? 2200 : 850 : 380, gain: rolling * (paved > 0.5 ? wet ? 0.11 : 0.07 : 0.1) },
      { id: 'skid', channel: 'vehicle', waveform: 'noise', frequency: paved > 0.5 ? 3200 : 550, gain: slip * 0.085 },
      { id: 'horn-low', channel: 'effects', waveform: 'triangle', frequency: 350, gain: car.horn ? 0.1 : 0 },
      { id: 'horn-high', channel: 'effects', waveform: 'sine', frequency: 440, gain: car.horn ? 0.055 : 0 },
      { id: 'air', channel: 'environment', waveform: 'noise', frequency: 450 + speed * 12, gain: 0.007 + clamp(speed / 50) * 0.035 },
      { id: 'rain', channel: 'environment', waveform: 'noise', frequency: 3600, gain: wet ? 0.055 : 0 },
    ];
    const nearby = sample.traffic.filter(t => !t.parked && Math.hypot(t.x - car.x, t.z - car.z) < AUDIO_BUDGET.radius)
      .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z) || a.id - b.id).slice(0, AUDIO_BUDGET.traffic);
    for (const t of nearby) this.continuous.push({ id: `traffic:${t.id}`, channel: 'environment', waveform: 'triangle',
      frequency: 45 + clamp(Math.abs(t.speed), 35) * 4, gain: 0.025, point: { x: t.x, y: 0.8, z: t.z } });
    const active = new Set(sample.traffic.map(t => `traffic:${t.id}`));
    for (const [key, scrape] of this.scrapes) if (this.time - scrape.updated > AUDIO_BUDGET.scrapeTimeout || (scrape.source !== 'player' && !active.has(scrape.source))) this.scrapes.delete(key);
  }
  damageEvents(source: string, events: readonly DamageEvent[]): void {
    for (const event of events) {
      const key = `${source}:scrape:${event.obstacle}`;
      if (this.position && Math.hypot(event.point.x - this.position.x, event.point.z - this.position.z) > AUDIO_BUDGET.radius) {
        this.scrapes.delete(key); continue;
      }
      if (event.kind === 'impact') this.enqueue(impactSound(event));
      else if (event.kind === 'scrape-end') this.scrapes.delete(key);
      else if (this.scrapes.has(key) || this.scrapes.size < AUDIO_BUDGET.scrapes) {
        this.scrapes.set(key, { source, updated: this.time, loop: { id: key, channel: 'effects', waveform: 'noise',
          frequency: ['vehicle', 'metal', 'bicycle'].includes(event.material) ? 2400 : 750,
          gain: clamp(event.severity) * 0.08, point: { ...event.point } } });
      }
    }
  }
  clearSource(source: string): void {
    for (const [key, scrape] of this.scrapes) if (scrape.source === source) this.scrapes.delete(key);
  }
  private enqueue(cue: AudioCue): void {
    if (this.cues.length < AUDIO_BUDGET.queuedCues) this.cues.push(cue);
  }
  get loops(): readonly AudioLoop[] { return [...this.continuous, ...[...this.scrapes.values()].map(s => s.loop)]; }
  drainCues(): AudioCue[] { const cues = this.cues; this.cues = []; return cues; }
  reset(): void {
    this.time = 0; this.previousIndicator = undefined; this.previousGear = undefined;
    this.scrapes.clear(); this.cues = []; this.continuous = []; this.position = undefined;
  }
}

/** Seamless periodic noise with matched value and slope at the wrap, shared by every voice. */
export function noiseSamples(length: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(length);
  let seed = 0x12345678;
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 0xffffffff * 2 - 1) * Math.min(1, i / 128, (length - 1 - i) / 128);
  }
  if (length >= 4) { data[0] = 0; data[1] = 0; data[length - 2] = 0; data[length - 1] = 0; }
  return data;
}
