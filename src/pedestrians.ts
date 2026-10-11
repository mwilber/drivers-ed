import RAPIER from '@dimforge/rapier3d-compat';
import { CROSSINGS, STREETS, type Crossing, type Point } from './road-network.ts';
import { signalState } from './traffic-rules.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import { CAR } from './vehicle-config.ts';
import type { TrafficActor } from './vehicle-traffic.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';

export const PEDESTRIAN = { mass: 75, radius: 0.26, height: 1.7, speed: 1.35, clearanceSpeed: 1.15, acceleration: 4, retirementSeconds: 20 } as const;
export interface Pedestrian extends Point {
  id: number; crossing: Crossing; side: number; state: 'waiting' | 'crossing' | 'fallen';
  body: RAPIER.RigidBody; wait: number; fallenFor: number; speed: number;
}
export interface CrossingHazard { crossing: Crossing }
export const crossingSpan = (crossing: Crossing): number => STREETS.find(s => s.id === crossing.streetId)!.width / 2 + 1.5;
const across = (c: Crossing) => ({ x: -c.direction.z, z: c.direction.x });

/** Gap acceptance includes both directions, reversing cars, and turning vehicles' physical poses. */
export function crossingSafe(c: Crossing, actors: readonly TrafficActor[]): boolean {
  const clearance = (crossingSpan(c) * 2 / PEDESTRIAN.clearanceSpeed) + 1.5;
  return !actors.some(actor => {
    const dx = c.x - actor.x, dz = c.z - actor.z;
    if (Math.abs(dx) < c.width / 2 + CAR.length / 2 && Math.abs(dz) < c.depth / 2 + CAR.length / 2) return true;
    const direction = Math.sign(actor.speed) || 1;
    const ux = -Math.sin(actor.heading) * direction, uz = -Math.cos(actor.heading) * direction;
    const along = dx * ux + dz * uz;
    const lateral = Math.abs(-dx * uz + dz * ux);
    const extent = Math.abs(uz) * c.width / 2 + Math.abs(ux) * c.depth / 2 + CAR.width;
    return lateral < extent && along > 0 && along < CAR.length / 2 + Math.abs(actor.speed) * clearance;
  });
}

/** Compatible vehicle phase plus a safe gap; these crossings have no authored WALK signals. */
export function crossingPhase(c: Crossing, seconds: number): boolean {
  if (c.junctionId !== 'center') return true;
  const phase = signalState(seconds);
  return phase[c.direction.z ? 'ns' : 'ew'] === 'red'
    && phase[c.direction.z ? 'ew' : 'ns'] === 'green'
    && phase.remaining > crossingSpan(c) * 2 / PEDESTRIAN.clearanceSpeed + 1;
}

/** Bounded walking/balance forces on full 3D bodies. The solver owns pose and impact momentum. */
export class Pedestrians {
  readonly people: Pedestrian[] = [];
  completed = 0;
  private nextId = 0;
  private events: number[] = [];
  private physics: VehiclePhysics;
  constructor(physics: VehiclePhysics) { this.physics = physics; }
  add(crossingId: string, side = 1, progress = 0, wait = 0): Pedestrian {
    const c = CROSSINGS.find(c => c.id === crossingId);
    if (!c || ![1, -1].includes(side)) throw new Error('Invalid pedestrian crossing');
    const u = across(c), offset = side * (crossingSpan(c) - progress);
    const heading = Math.atan2(u.x * side, u.z * side);
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(c.x + u.x * offset, ROAD_HEIGHT + PEDESTRIAN.height / 2 + 0.01, c.z + u.z * offset)
      .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) })
      .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(1).setAdditionalSolverIterations(4));
    const collider = this.physics.world.createCollider(RAPIER.ColliderDesc.capsule(PEDESTRIAN.height / 2 - PEDESTRIAN.radius, PEDESTRIAN.radius)
      .setMass(PEDESTRIAN.mass).setFriction(0.12).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.physics.setColliderMaterial(collider.handle, 'pedestrian');
    const person: Pedestrian = { id: this.nextId++, crossing: c, side, state: progress > 0 ? 'crossing' : 'waiting', body,
      x: body.translation().x, z: body.translation().z, wait, fallenFor: 0, speed: 0 };
    this.people.push(person);
    this.physics.registerContactBody(body, contacts => {
      if (person.state === 'fallen') return;
      const impact = contacts.some(c => c.material === 'vehicle' && c.impulse > 8 && c.closingSpeed > 0.6);
      const q = body.rotation(), up = 1 - 2 * (q.x ** 2 + q.z ** 2);
      if (!impact && up > 0.65) return;
      person.state = 'fallen'; body.resetForces(true); body.resetTorques(true);
      collider.setFriction(0.65); collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average); this.events.push(person.id);
      if (this.events.length > 32) this.events.shift();
    });
    return person;
  }
  drainEvents(): number[] { const events = this.events; this.events = []; return events; }
  clear(): void { for (const person of [...this.people]) this.remove(person); this.events = []; }
  private remove(person: Pedestrian): void {
    this.physics.unregisterContactBody(person.body);
    this.physics.setColliderMaterial(person.body.collider(0).handle);
    this.physics.world.removeRigidBody(person.body);
    this.people.splice(this.people.indexOf(person), 1);
  }
  reset(enabled = true): void {
    this.clear(); this.nextId = 0; this.completed = 0;
    if (enabled) ['north-middle-n', 'center-town-w', 'south-middle-s'].forEach((id, i) => this.add(id, i % 2 ? -1 : 1, 0, 2 + i * 3));
  }
  hazards(seconds: number): CrossingHazard[] {
    return this.people.filter(p => p.state === 'crossing' || (p.state === 'waiting' && p.wait <= 0 && crossingPhase(p.crossing, seconds)))
      .map(p => ({ crossing: p.crossing }));
  }
  obstacles(): TrafficActor[] {
    return this.people.filter(p => p.state === 'fallen').map(p => ({ x: p.x, z: p.z, heading: 0, speed: 0 }));
  }
  beforeStep(seconds: number, actors: readonly TrafficActor[], dt = FIXED_STEP): void {
    for (const p of this.people) {
      const body = p.body; body.resetForces(true); body.resetTorques(true);
      if (p.state === 'fallen') continue;
      p.wait = Math.max(0, p.wait - dt);
      if (p.state === 'waiting' && p.wait === 0 && crossingPhase(p.crossing, seconds) && crossingSafe(p.crossing, actors)) p.state = 'crossing';
      const c = p.crossing, u = across(c), span = crossingSpan(c);
      const target = p.state === 'crossing' ? -p.side * span : p.side * span;
      const offset = (p.x - c.x) * u.x + (p.z - c.z) * u.z;
      if (p.state === 'crossing' && Math.abs(target - offset) < 0.12) {
        p.state = 'waiting'; p.side *= -1; p.wait = 8; this.completed++;
      }
      const desired = Math.max(-PEDESTRIAN.speed, Math.min(PEDESTRIAN.speed, (target - offset) * 3));
      const v = body.linvel();
      let ax = (u.x * desired - v.x) * 10 + (c.x + u.x * offset - p.x) * 5;
      let az = (u.z * desired - v.z) * 10 + (c.z + u.z * offset - p.z) * 5;
      const magnitude = Math.hypot(ax, az), scale = Math.min(1, PEDESTRIAN.acceleration / (magnitude || 1));
      body.addForce({ x: ax * scale * PEDESTRIAN.mass, y: 0, z: az * scale * PEDESTRIAN.mass }, true);
      const q = body.rotation(), angular = body.angvel();
      const ux = 2 * (q.x * q.y - q.w * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
      const heading = Math.atan2(u.x * p.side, u.z * p.side);
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y ** 2 + q.z ** 2));
      const error = Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw));
      const clamp = (v: number) => Math.max(-1500, Math.min(1500, v));
      body.addTorque({ x: clamp(-uz * 1800 - angular.x * 180), y: Math.max(-80, Math.min(80, error * 80 - angular.y * 20)), z: clamp(ux * 1800 - angular.z * 180) }, true);
    }
  }
  afterStep(dt = FIXED_STEP): void {
    for (const p of [...this.people]) {
      const v = p.body.linvel(), pos = p.body.translation(); p.x = pos.x; p.z = pos.z; p.speed = Math.hypot(v.x, v.z);
      if (p.state === 'fallen') { p.fallenFor += dt; if (p.fallenFor >= PEDESTRIAN.retirementSeconds) this.remove(p); }
    }
  }
}
