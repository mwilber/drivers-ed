import RAPIER from '@dimforge/rapier3d-compat';
import { CAR, SUSPENSION } from './vehicle-config.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { type TrafficCar, type VehicleTraffic } from './vehicle-traffic.ts';
import type { DamageEvent } from './vehicle-damage.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';
import { pavedGrip } from './driving-conditions.ts';

export const TRAFFIC_COLLISIONS = { reactionSeconds: 0.8, recoverySeconds: 20, maxAcceleration: 4.5, maxYawAcceleration: 2 } as const;
interface TrafficBody { body: RAPIER.RigidBody; car: TrafficCar; recoveryTime: number; lastHeading: number }
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
const clamp = (value: number, bound: number) => Math.max(-bound, Math.min(bound, value));
const yaw = (q: RAPIER.Rotation) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y ** 2 + q.z ** 2));

/** Finite-mass grounded sedans. Motors use forces/torque; poses and collision velocities are never overwritten. */
export class TrafficPhysics {
  private bodies = new Map<number, TrafficBody>();
  private physics: VehiclePhysics;
  private events: { carId: number; event: DamageEvent }[] = [];
  constructor(physics: VehiclePhysics) { this.physics = physics; }
  get count(): number { return this.bodies.size; }
  getBody(id: number): RAPIER.RigidBody | undefined { return this.bodies.get(id)?.body; }
  drainEvents(): { carId: number; event: DamageEvent }[] { const events = this.events; this.events = []; return events; }
  pause(): void { for (const { car } of this.bodies.values()) car.damage.pause(); }
  clear(): void {
    for (const entry of this.bodies.values()) this.remove(entry);
    this.bodies.clear(); this.events = [];
  }
  private remove({ body, car }: TrafficBody): void {
    car.damage.pause(); car.physical = false;
    this.physics.unregisterDamageBody(body);
    for (let i = 0; i < body.numColliders(); i++) this.physics.setColliderMaterial(body.collider(i).handle);
    this.physics.world.removeRigidBody(body);
  }
  sync(cars: readonly TrafficCar[], dt = FIXED_STEP): void {
    const active = new Set(cars.map(car => car.id));
    for (const [id, entry] of this.bodies) if (!active.has(id)) { this.remove(entry); this.bodies.delete(id); }
    for (const car of cars) {
      let entry = this.bodies.get(car.id);
      if (!entry) {
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(car.x, ROAD_HEIGHT + SUSPENSION.centerOfMassHeight, car.z)
          .setRotation({ x: 0, y: Math.sin(car.heading / 2), z: 0, w: Math.cos(car.heading / 2) })
          .enabledTranslations(true, false, true).enabledRotations(false, true, false)
          .setLinearDamping(0.12).setAngularDamping(1).setCcdEnabled(true).setAdditionalSolverIterations(4));
        // Match the player sedan's body envelope, mass and low contact surface.
        for (const desc of [
          RAPIER.ColliderDesc.cuboid(CAR.width / 2, 0.21, CAR.length / 2).setTranslation(0, 0.51 - SUSPENSION.centerOfMassHeight, 0).setMass(CAR.mass),
          RAPIER.ColliderDesc.cuboid(0.82, 0.4, 0.88).setTranslation(0, 1.17 - SUSPENSION.centerOfMassHeight, 0.28).setMass(0),
        ]) {
          const collider = this.physics.world.createCollider(desc.setFriction(0.25).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
          this.physics.setColliderMaterial(collider.handle, 'vehicle');
        }
        body.setLinvel({ x: -Math.sin(car.heading) * car.speed, y: 0, z: -Math.cos(car.heading) * car.speed }, true);
        this.physics.registerDamageBody(body, car.damage);
        car.physical = true;
        entry = { body, car, recoveryTime: 0, lastHeading: car.heading }; this.bodies.set(car.id, entry);
      }
      const { body } = entry;
      body.resetForces(true); body.resetTorques(true);
      if (car.parked || car.stunnedFor > 0) { entry.lastHeading = car.heading; continue; }
      const position = body.translation(), velocity = body.linvel(), heading = yaw(body.rotation());
      const headingError = angle(car.heading - heading);
      const dx = car.x - position.x, dz = car.z - position.z;
      const speed = Math.abs(headingError) > 0.6 || Math.hypot(dx, dz) > 1.5 ? 0 : car.driveSpeed;
      const desired = { x: -Math.sin(car.heading) * speed + dx * 2, z: -Math.cos(car.heading) * speed + dz * 2 };
      let ax = (desired.x - velocity.x) * 6 + velocity.x * 0.12;
      let az = (desired.z - velocity.z) * 6 + velocity.z * 0.12;
      const magnitude = Math.hypot(ax, az), limit = TRAFFIC_COLLISIONS.maxAcceleration * pavedGrip(this.physics.weather);
      if (magnitude > limit) { ax *= limit / magnitude; az *= limit / magnitude; }
      body.addForce({ x: ax * CAR.mass, y: 0, z: az * CAR.mass }, true);
      const yawRate = clamp(angle(car.heading - entry.lastHeading) / dt, 1);
      const yawAcceleration = clamp(12 * headingError + 6 * (yawRate - body.angvel().y), TRAFFIC_COLLISIONS.maxYawAcceleration);
      const inertia = CAR.mass * (CAR.length ** 2 + CAR.width ** 2) / 12;
      body.addTorque({ x: 0, y: yawAcceleration * inertia, z: 0 }, true);
      entry.lastHeading = car.heading;
    }
  }
  /** Call once after the player's shared world step, before rendering or the next AI decision. */
  afterStep(traffic: VehicleTraffic, dt = FIXED_STEP): void {
    for (const [id, entry] of this.bodies) {
      const { body, car } = entry;
      const position = body.translation(), heading = yaw(body.rotation()), velocity = body.linvel();
      const desiredHeading = car.heading;
      const deviation = traffic.reconcile(car, { x: position.x, z: position.z, heading,
        speed: -velocity.x * Math.sin(heading) - velocity.z * Math.cos(heading) });
      const events = car.damage.drainEvents();
      for (const event of events) this.events.push({ carId: id, event });
      if (this.events.length > 128) this.events.splice(0, this.events.length - 128);
      car.stunnedFor = Math.max(0, car.stunnedFor - dt);
      if (events.some(event => event.kind === 'impact')) car.stunnedFor = TRAFFIC_COLLISIONS.reactionSeconds;
      car.recovering = car.stunnedFor > 0 || deviation > 0.65 || Math.abs(angle(desiredHeading - heading)) > 0.3;
      if (car.recovering) { car.arrivedAt = undefined; car.stoppedFor = 0; entry.recoveryTime += dt; }
      else entry.recoveryTime = 0;
      if (!car.parked && entry.recoveryTime > TRAFFIC_COLLISIONS.recoverySeconds) {
        traffic.retire(car); this.remove(entry); this.bodies.delete(id);
      }
    }
  }
}
