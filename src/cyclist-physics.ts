import RAPIER from '@dimforge/rapier3d-compat';
import { CYCLIST } from './cyclist-config.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { pavedGrip } from './driving-conditions.ts';
import type { DamageContact } from './vehicle-damage.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';
import type { TrafficActor, TrafficCar, VehicleTraffic } from './vehicle-traffic.ts';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
const yaw = (q: RAPIER.Rotation) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y ** 2 + q.z ** 2));
export interface CyclistBody {
  actor: TrafficCar; bicycle: RAPIER.RigidBody; rider: RAPIER.RigidBody;
  joint?: RAPIER.ImpulseJoint; state: 'riding' | 'fallen'; fallenFor: number; blockedFor: number;
}
export interface CyclistImpact { id: number; speed: number; material: string }

/** Separate bicycle/rider bodies, coupled while riding. Forces never replace physical poses or velocities. */
export class CyclistPhysics {
  private bodies = new Map<number, CyclistBody>();
  private events: CyclistImpact[] = [];
  private physics: VehiclePhysics;
  private traffic: VehicleTraffic;
  constructor(physics: VehiclePhysics, traffic: VehicleTraffic) { this.physics = physics; this.traffic = traffic; }
  get riders(): readonly CyclistBody[] { return [...this.bodies.values()]; }
  get count(): number { return this.bodies.size; }
  getBody(id: number): CyclistBody | undefined { return this.bodies.get(id); }
  drainEvents(): CyclistImpact[] { const events = this.events; this.events = []; return events; }
  clear(): void { for (const entry of this.bodies.values()) this.remove(entry); this.bodies.clear(); this.events = []; }
  private remove(entry: CyclistBody): void {
    if (entry.joint) this.physics.world.removeImpulseJoint(entry.joint, true);
    for (const body of [entry.bicycle, entry.rider]) {
      this.physics.unregisterContactBody(body);
      for (let i = 0; i < body.numColliders(); i++) this.physics.setColliderMaterial(body.collider(i).handle);
      this.physics.world.removeRigidBody(body);
    }
    entry.actor.physical = false;
  }
  private fall(entry: CyclistBody, contacts: readonly DamageContact[]): void {
    if (entry.state === 'fallen') return;
    const impact = contacts.find(c => !['asphalt', 'soil'].includes(c.material)
      && c.closingSpeed > 0.6 && c.impulse > 8);
    const q = entry.bicycle.rotation(), up = 1 - 2 * (q.x ** 2 + q.z ** 2);
    if (!impact && up > 0.65) return;
    entry.state = 'fallen'; entry.actor.fallen = true; entry.actor.recovering = true; entry.actor.driveSpeed = 0;
    this.traffic.releaseReservations(entry.actor);
    if (entry.joint) { this.physics.world.removeImpulseJoint(entry.joint, true); entry.joint = undefined; }
    for (const body of [entry.bicycle, entry.rider]) {
      body.resetForces(true); body.resetTorques(true);
      for (let i = 0; i < body.numColliders(); i++) {
        body.collider(i).setFriction(0.65); body.collider(i).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
      }
    }
    this.events.push({ id: entry.actor.id, speed: impact?.closingSpeed ?? 0, material: impact?.material ?? 'ground' });
    if (this.events.length > 32) this.events.shift();
  }
  private create(actor: TrafficCar): CyclistBody {
    const world = this.physics.world, rotation = { x: 0, y: Math.sin(actor.heading / 2), z: 0, w: Math.cos(actor.heading / 2) };
    const makeBody = (x: number, y: number, z: number) => world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z).setRotation(rotation).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(1).setAdditionalSolverIterations(8));
    const bicycle = makeBody(actor.x, ROAD_HEIGHT + 0.6, actor.z);
    const rider = makeBody(actor.x + Math.sin(actor.heading) * 0.12, ROAD_HEIGHT + 1.4, actor.z + Math.cos(actor.heading) * 0.12);
    const add = (body: RAPIER.RigidBody, desc: RAPIER.ColliderDesc, material: string) => {
      const collider = world.createCollider(desc.setFriction(0.03).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
      this.physics.setColliderMaterial(collider.handle, material);
    };
    add(bicycle, RAPIER.ColliderDesc.cuboid(0.06, 0.17, 0.6).setMass(9), 'bicycle');
    add(bicycle, RAPIER.ColliderDesc.cuboid(CYCLIST.width / 2, 0.03, 0.05).setTranslation(0, 0.4, -0.55).setMass(0), 'bicycle');
    for (const z of [-CYCLIST.wheelbase / 2, CYCLIST.wheelbase / 2]) {
      add(bicycle, RAPIER.ColliderDesc.roundCylinder(0.015, CYCLIST.wheelRadius - 0.02, 0.02).setTranslation(0, CYCLIST.wheelRadius - 0.6, z)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setMass(3), 'bicycle');
    }
    add(rider, RAPIER.ColliderDesc.capsule(0.32, 0.22).setMass(CYCLIST.riderMass), 'rider');
    const joint = world.createImpulseJoint(RAPIER.JointData.fixed({ x: 0, y: 0.8, z: 0.12 }, identity, { x: 0, y: 0, z: 0 }, identity), bicycle, rider, true);
    joint.setContactsEnabled(false);
    const velocity = { x: -Math.sin(actor.heading) * actor.speed, y: 0, z: -Math.cos(actor.heading) * actor.speed };
    bicycle.setLinvel(velocity, true); rider.setLinvel(velocity, true); actor.physical = true;
    const entry: CyclistBody = { actor, bicycle, rider, joint, state: 'riding', fallenFor: 0, blockedFor: 0 };
    for (const body of [bicycle, rider]) this.physics.registerContactBody(body, contacts => this.fall(entry, contacts));
    return entry;
  }
  sync(actors: readonly TrafficCar[]): void {
    const cyclists = actors.filter(c => c.kind === 'cyclist'), active = new Set(cyclists.map(c => c.id));
    for (const [id, entry] of this.bodies) if (!active.has(id)) { this.remove(entry); this.bodies.delete(id); }
    for (const actor of cyclists) {
      let entry = this.bodies.get(actor.id);
      if (!entry) { entry = this.create(actor); this.bodies.set(actor.id, entry); }
      const { bicycle, rider } = entry;
      bicycle.resetForces(true); bicycle.resetTorques(true); rider.resetForces(true); rider.resetTorques(true);
      if (entry.state === 'fallen') continue;
      const pos = bicycle.translation(), v = bicycle.linvel(), q = bicycle.rotation(), angular = bicycle.angvel();
      const dx = actor.x - pos.x, dz = actor.z - pos.z, headingError = angle(actor.heading - yaw(q));
      const speed = Math.abs(headingError) > 0.6 || Math.hypot(dx, dz) > 1 ? 0 : actor.driveSpeed;
      const desired = { x: -Math.sin(actor.heading) * speed + dx * 2, z: -Math.cos(actor.heading) * speed + dz * 2 };
      let ax = (desired.x - v.x) * 6, az = (desired.z - v.z) * 6;
      const magnitude = Math.hypot(ax, az), limit = CYCLIST.braking * pavedGrip(this.physics.weather);
      if (magnitude > limit) { ax *= limit / magnitude; az *= limit / magnitude; }
      // Distribute the riding controller across the coupled masses, avoiding a large
      // artificial joint impulse from applying the entire motor to the light frame.
      for (const [body, mass] of [[bicycle, CYCLIST.bicycleMass], [rider, CYCLIST.riderMass]] as const) {
        body.addForce({ x: ax * mass, y: 0, z: az * mass }, true);
      }
      const ux = 2 * (q.x * q.y - q.w * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
      const torque = { x: clamp(-uz * 3600 - angular.x * 320, 2500), y: clamp(headingError * 100 - angular.y * 35, 100),
        z: clamp(ux * 3600 - angular.z * 320, 2500) };
      for (const [body, mass] of [[bicycle, CYCLIST.bicycleMass], [rider, CYCLIST.riderMass]] as const) {
        const fraction = mass / (CYCLIST.bicycleMass + CYCLIST.riderMass);
        body.addTorque({ x: torque.x * fraction, y: torque.y * fraction, z: torque.z * fraction }, true);
      }
    }
  }
  /** Keep detached parts visible to road users at their actual positions. */
  obstacles(): TrafficActor[] {
    return this.riders.filter(e => e.state === 'fallen').flatMap(e => [e.bicycle, e.rider].map(body => {
      const pos = body.translation(); return { x: pos.x, z: pos.z, heading: yaw(body.rotation()), speed: 0, width: 1.4, length: 2 };
    }));
  }
  afterStep(dt = FIXED_STEP): void {
    for (const [id, entry] of this.bodies) {
      const { bicycle, actor } = entry, pos = bicycle.translation(), heading = yaw(bicycle.rotation()), v = bicycle.linvel();
      const pose = { x: pos.x, z: pos.z, heading, speed: -v.x * Math.sin(heading) - v.z * Math.cos(heading) };
      if (entry.state === 'fallen') { Object.assign(actor, pose); entry.fallenFor += dt; }
      else {
        const deviation = this.traffic.reconcile(actor, pose);
        entry.blockedFor = deviation > 0.8 ? entry.blockedFor + dt : 0;
      }
      if (entry.fallenFor >= CYCLIST.retirementSeconds || entry.blockedFor >= CYCLIST.retirementSeconds) {
        this.traffic.retire(actor); this.remove(entry); this.bodies.delete(id);
      }
    }
  }
}
