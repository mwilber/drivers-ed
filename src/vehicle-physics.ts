import RAPIER from '@dimforge/rapier3d-compat';
import { createCar, selectGear, stopCar, updateDriveForces, type DrivingInput, type GearSelection } from './simulation.ts';
import { CAR, HANDLING, SUSPENSION, TRANSMISSION } from './vehicle-config.ts';
import { BOUNDARY_OBSTACLES, DRIVEWAYS, HOUSES, isOnRoad, PAVED_SURFACES, rampVertices, ROAD_HEIGHT, SIDEWALKS, SIDEWALK_HEIGHT, TEST_CURB, TREES } from './world-layout.ts';
import { ROAD_POSTS } from './traffic-layout.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { VehicleDamage, type DamageContact } from './vehicle-damage.ts';
import { pavedGrip, type Weather } from './driving-conditions.ts';

export interface PhysicsBox { x: number; y: number; z: number; width: number; height: number; depth: number }
export interface Spawn { x: number; z: number; heading: number }
export interface PhysicsOptions { environment?: 'neighborhood' | 'flat'; spawn?: Spawn; boxes?: readonly PhysicsBox[]; damageHandling?: boolean; explicitControls?: boolean; weather?: Weather }
export interface WheelPose { x: number; y: number; z: number; steering: number; rotation: number; contact: boolean; suspensionLength: number }

const identity = { x: 0, y: 0, z: 0, w: 1 };
let initialization: Promise<void> | undefined;

export async function createVehiclePhysics(options: PhysicsOptions = {}): Promise<VehiclePhysics> {
  await (initialization ??= RAPIER.init());
  return new VehiclePhysics(options);
}

/** Rotate a vector without coupling the simulation to Three.js. */
function rotate(v: RAPIER.Vector, q: RAPIER.Rotation): RAPIER.Vector {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
function dot(a: RAPIER.Vector, b: RAPIER.Vector): number { return a.x * b.x + a.y * b.y + a.z * b.z; }

export class VehiclePhysics {
  readonly world: RAPIER.World;
  readonly state = createCar();
  readonly wheels: WheelPose[] = [];
  readonly options: PhysicsOptions;
  readonly damage = new VehicleDamage();
  private readonly eventQueue = new RAPIER.EventQueue(true);
  private readonly colliderMaterials = new Map<number, string>();
  private readonly contactBodies = new Map<number, { body: RAPIER.RigidBody; receive: (contacts: readonly DamageContact[]) => void }>();
  private readonly damageBodies = new Map<number, { body: RAPIER.RigidBody; damage: VehicleDamage }>();
  body!: RAPIER.RigidBody;
  vehicle!: RAPIER.DynamicRayCastVehicleController;
  position = { x: 0, y: 0, z: 0 };
  rotation = { ...identity };
  up = { x: 0, y: 1, z: 0 };
  contacts = 0;
  weather: Weather;

  constructor(options: PhysicsOptions) {
    this.options = options;
    this.weather = options.weather ?? 'dry';
    this.damage.handlingEnabled = options.damageHandling ?? true;
    this.world = new RAPIER.World({ x: 0, y: -HANDLING.gravity, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.numSolverIterations = 8;
    this.addBox({ x: 0, y: (options.environment === 'flat' ? ROAD_HEIGHT : 0) - 0.5, z: 0, width: 20000, height: 1, depth: 20000 }, options.environment === 'flat' ? 'asphalt' : 'soil');
    if (options.environment !== 'flat') {
      for (const rect of [...PAVED_SURFACES, ...DRIVEWAYS]) this.addBox({ ...rect, y: ROAD_HEIGHT / 2, height: ROAD_HEIGHT }, 'asphalt');
      for (const rect of SIDEWALKS) this.addBox({ ...rect, y: SIDEWALK_HEIGHT / 2, height: SIDEWALK_HEIGHT });
      for (const post of ROAD_POSTS) this.addBox({ ...post, y: post.height / 2 }, 'metal');
      for (const house of HOUSES) this.addBox({ ...house, y: house.height / 2 }, 'masonry');
      for (const tree of TREES) {
        const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(1.75 * tree.size, 0.29 * tree.size)
          .setTranslation(tree.x, 1.75 * tree.size, tree.z).setFriction(0.6));
        this.colliderMaterials.set(collider.handle, 'wood');
      }
      for (const obstacle of BOUNDARY_OBSTACLES) this.addBox({ ...obstacle, y: 0.8, width: obstacle.halfWidth * 2, height: 1.6, depth: obstacle.halfDepth * 2 }, 'hedge');
      this.world.createCollider(RAPIER.ColliderDesc.convexHull(rampVertices())!.setFriction(0.9));
      this.addBox({ ...TEST_CURB, y: ROAD_HEIGHT + TEST_CURB.height / 2 });
    }
    for (const box of options.boxes ?? []) this.addBox(box);
    this.world.step(); // Populate scene queries before finding the spawn's ground height.
    this.reset();
  }

  private addBox(box: PhysicsBox, surface = 'concrete'): void {
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.width / 2, box.height / 2, box.depth / 2)
      .setTranslation(box.x, box.y, box.z).setFriction(0.9).setRestitution(0));
    this.colliderMaterials.set(collider.handle, surface);
  }

  setColliderMaterial(handle: number, material?: string): void {
    if (material) this.colliderMaterials.set(handle, material);
    else this.colliderMaterials.delete(handle);
  }

  registerDamageBody(body: RAPIER.RigidBody, damage: VehicleDamage): void {
    this.damageBodies.set(body.handle, { body, damage });
  }
  unregisterDamageBody(body: RAPIER.RigidBody): void { this.damageBodies.delete(body.handle); }

  /** Additional finite-mass road users share pre-solver relative contact sampling. */
  registerContactBody(body: RAPIER.RigidBody, receive: (contacts: readonly DamageContact[]) => void): void {
    this.contactBodies.set(body.handle, { body, receive });
  }
  unregisterContactBody(body: RAPIER.RigidBody): void { this.contactBodies.delete(body.handle); }

  reset(spawn: Spawn = this.options.spawn ?? createCar()): void {
    this.damage.repair();
    this.eventQueue.clear();
    if (this.vehicle) this.world.removeVehicleController(this.vehicle);
    if (this.body) {
      this.unregisterDamageBody(this.body);
      for (let i = 0; i < this.body.numColliders(); i++) this.setColliderMaterial(this.body.collider(i).handle);
      this.world.removeRigidBody(this.body);
    }
    Object.assign(this.state, createCar(), spawn);
    if (this.options.explicitControls) selectGear(this.state, 'P');
    const hit = this.world.castRay(new RAPIER.Ray({ x: spawn.x, y: 100, z: spawn.z }, { x: 0, y: -1, z: 0 }), 200, true);
    const ground = hit ? 100 - hit.timeOfImpact : ROAD_HEIGHT;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, ground + SUSPENSION.centerOfMassHeight, spawn.z)
      .setRotation({ x: 0, y: Math.sin(spawn.heading / 2), z: 0, w: Math.cos(spawn.heading / 2) })
      .setCcdEnabled(true).setAngularDamping(0.3).setAdditionalSolverIterations(4));
    const bodyCollider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(CAR.width / 2, 0.21, CAR.length / 2)
      .setTranslation(0, 0.51 - SUSPENSION.centerOfMassHeight, 0).setMass(CAR.mass).setFriction(0.25).setRestitution(0)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), this.body);
    const cabinCollider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.82, 0.4, 0.88)
      .setTranslation(0, 1.17 - SUSPENSION.centerOfMassHeight, 0.28).setMass(0).setFriction(0.25)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), this.body);
    this.setColliderMaterial(bodyCollider.handle, 'vehicle'); this.setColliderMaterial(cabinCollider.handle, 'vehicle');
    this.registerDamageBody(this.body, this.damage);
    this.vehicle = this.world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    this.wheels.length = 0;
    for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
      for (const x of [-SUSPENSION.trackWidth / 2, SUSPENSION.trackWidth / 2]) {
        const i = this.wheels.length;
        this.vehicle.addWheel({ x, y: 0, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION.restLength, CAR.tireRadius);
        this.vehicle.setWheelSuspensionStiffness(i, SUSPENSION.stiffness);
        this.vehicle.setWheelSuspensionCompression(i, SUSPENSION.compression);
        this.vehicle.setWheelSuspensionRelaxation(i, SUSPENSION.relaxation);
        this.vehicle.setWheelMaxSuspensionTravel(i, SUSPENSION.travel);
        this.vehicle.setWheelMaxSuspensionForce(i, SUSPENSION.maxForce);
        this.vehicle.setWheelSideFrictionStiffness(i, SUSPENSION.sideStiffness);
        this.vehicle.setWheelFrictionSlip(i, SUSPENSION.tireFriction);
        this.wheels.push({ x, y: -SUSPENSION.restLength, z, steering: 0, rotation: 0, contact: false, suspensionLength: SUSPENSION.restLength });
      }
    }
    // Settle vertically at reset so the driver's view does not drop into place.
    for (let i = 0; i < 120; i++) {
      for (let wheel = 0; wheel < 4; wheel++) this.vehicle.setWheelBrake(wheel, 100);
      this.vehicle.updateVehicle(FIXED_STEP, undefined, undefined, collider => collider.parent()?.handle !== this.body.handle);
      this.world.step();
    }
    this.pause();
    this.sync();
  }

  step(input: DrivingInput, dt = FIXED_STEP): void {
    this.world.timestep = dt;
    this.sync();
    const previousSpeed = this.state.speed;
    const onRoad = this.options.environment === 'flat' || isOnRoad(this.state.x, this.state.z);
    const { driveAcceleration, resistance, parkingResistance } = updateDriveForces(this.state, input, dt, onRoad);
    const effects = this.damage.effects;
    const engineForce = Math.sign(this.state.gear) * Math.max(0, driveAcceleration - resistance) * CAR.mass / 4 * effects.power;
    const brakingImpulse = Math.max(0, resistance - driveAcceleration) * CAR.mass * dt / 4;
    for (let i = 0; i < 4; i++) {
      const contact = this.vehicle.wheelContactPoint(i);
      const paved = this.options.environment === 'flat' || (contact ? isOnRoad(contact.x, contact.z) : onRoad);
      const grip = paved ? pavedGrip(this.weather) : HANDLING.grassGrip / HANDLING.dryGrip;
      this.vehicle.setWheelFrictionSlip(i, SUSPENSION.tireFriction * grip);
      this.vehicle.setWheelSteering(i, i < 2 ? this.state.steering + effects.steeringBias : 0);
      this.vehicle.setWheelSuspensionStiffness(i, SUSPENSION.stiffness * effects.suspension[i]!);
      this.vehicle.setWheelSuspensionCompression(i, SUSPENSION.compression * effects.suspension[i]!);
      this.vehicle.setWheelSuspensionRelaxation(i, SUSPENSION.relaxation * effects.suspension[i]!);
      // Rapier's wheel forward axis is +Z; the sedan faces local -Z.
      // Preserve dry tuning exactly. Wet pavement has a bounded per-wheel
      // longitudinal force budget as well as Rapier's combined tire-slip limit.
      const wetForceLimit = paved && this.weather === 'rain' ? CAR.mass * HANDLING.gravity * HANDLING.dryGrip * grip / 4 : Infinity;
      this.vehicle.setWheelEngineForce(i, -Math.sign(engineForce) * Math.min(Math.abs(engineForce), wetForceLimit));
      // Simplified wheel brakes hold Park and the separate parking brake.
      const parkingImpulse = parkingResistance * CAR.mass * dt / 4;
      this.vehicle.setWheelBrake(i, Math.min(brakingImpulse + parkingImpulse, wetForceLimit * dt));
    }
    this.body.wakeUp();
    this.vehicle.updateVehicle(dt, undefined, undefined, collider => collider.parent()?.handle !== this.body.handle);
    // Capture contact-point approach velocity before the collision solver changes it.
    const velocities = new Map([...this.damageBodies, ...this.contactBodies].map(([handle, { body }]) => [handle, { linear: body.linvel(), angular: body.angvel() }]));
    this.world.step(this.eventQueue);
    this.recordDamage(velocities, dt);
    this.sync();
    this.state.acceleration = (this.state.speed - previousSpeed) / dt;
  }

  private recordDamage(velocities: Map<number, { linear: RAPIER.Vector; angular: RAPIER.Vector }>, dt: number): void {
    const samples = new Map<number, Map<number, DamageContact>>();
    const pointVelocity = (body: RAPIER.RigidBody | null, point: RAPIER.Vector): RAPIER.Vector => {
      const motion = body && velocities.get(body.handle);
      if (!body || !motion) return { x: 0, y: 0, z: 0 };
      const position = body.translation(), angular = motion.angular;
      const arm = { x: point.x - position.x, y: point.y - position.y, z: point.z - position.z };
      return { x: motion.linear.x + angular.y * arm.z - angular.z * arm.y,
        y: motion.linear.y + angular.z * arm.x - angular.x * arm.z,
        z: motion.linear.z + angular.x * arm.y - angular.y * arm.x };
    };
    this.eventQueue.drainContactForceEvents(event => {
      const first = this.world.getCollider(event.collider1()), second = this.world.getCollider(event.collider2());
      const impulse = event.totalForceMagnitude() * dt;
      for (const car of [first, second]) {
        const body = car.parent(), other = car === first ? second : first;
        if (!body || (!this.damageBodies.has(body.handle) && !this.contactBodies.has(body.handle)) || other.parent()?.handle === body.handle) continue;
        const position = body.translation(), rotation = body.rotation();
        const inverse = { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
        const contacts = samples.get(body.handle) ?? new Map<number, DamageContact>();
        samples.set(body.handle, contacts);
        this.world.contactPair(car, other, (manifold, flipped) => {
          const raw = manifold.normal();
          const sign = flipped ? -1 : 1;
          const normal = { x: raw.x * sign, y: raw.y * sign, z: raw.z * sign };
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const point = manifold.solverContactPoint(i);
            if (!point || manifold.solverContactDist(i) > 0.01) continue;
            const arm = { x: point.x - position.x, y: point.y - position.y, z: point.z - position.z };
            const localPoint = rotate(arm, inverse);
            const own = pointVelocity(body, point), opposing = pointVelocity(other.parent(), point);
            const contactVelocity = { x: own.x - opposing.x, y: own.y - opposing.y, z: own.z - opposing.z };
            const closingSpeed = Math.max(0, dot(contactVelocity, normal));
            const tangentSpeed = Math.sqrt(Math.max(0, dot(contactVelocity, contactVelocity) - dot(contactVelocity, normal) ** 2));
            // Upright underside support is terrain contact, not a body scrape.
            const localNormal = rotate(normal, inverse);
            if (localPoint.y < -0.2 && Math.abs(localNormal.y) > 0.7 && closingSpeed < 2.5) continue;
            const sample = { obstacle: other.handle, point, localPoint, normal, localNormal, closingSpeed, tangentSpeed, impulse,
              material: this.colliderMaterials.get(other.handle) ?? 'concrete' };
            const previous = contacts.get(other.handle);
            if (!previous || closingSpeed > previous.closingSpeed) contacts.set(other.handle, sample);
          }
        });
      }
    });
    for (const [handle, { receive }] of this.contactBodies) receive([...(samples.get(handle)?.values() ?? [])]);
    for (const [handle, { damage }] of this.damageBodies) damage.update([...(samples.get(handle)?.values() ?? [])], dt);
  }

  /** Include lateral and vertical movement in the complete-stop selector interlock. */
  selectGear(selection: GearSelection): boolean {
    this.sync();
    const velocity = this.body.linvel();
    // Settled raycast suspension retains a small vertical solver velocity.
    // Ignore that jitter, but reject lateral movement and airborne falling.
    const motionSpeed = Math.hypot(velocity.x, velocity.z, Math.abs(velocity.y) > TRANSMISSION.suspensionJitterSpeed ? velocity.y : 0);
    return selectGear(this.state, selection, motionSpeed);
  }

  /** Restore the sedan in place, preserving its pose, velocity and selected gear. */
  repair(): void {
    this.damage.repair();
    this.eventQueue.clear();
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSteering(i, i < 2 ? this.state.steering : 0);
      this.vehicle.setWheelSuspensionStiffness(i, SUSPENSION.stiffness);
      this.vehicle.setWheelSuspensionCompression(i, SUSPENSION.compression);
      this.vehicle.setWheelSuspensionRelaxation(i, SUSPENSION.relaxation);
    }
    this.sync();
  }

  private sync(): void {
    this.position = this.body.translation();
    this.rotation = this.body.rotation();
    const forward = rotate({ x: 0, y: 0, z: -1 }, this.rotation);
    this.up = rotate({ x: 0, y: 1, z: 0 }, this.rotation);
    const velocity = this.body.linvel();
    const speed = dot(velocity, forward);
    this.state.speed = Math.abs(speed) < 0.03 ? 0 : speed;
    this.state.x = this.position.x;
    this.state.z = this.position.z;
    const heading = Math.atan2(-forward.x, -forward.z);
    this.state.heading += Math.atan2(Math.sin(heading - this.state.heading), Math.cos(heading - this.state.heading));
    this.state.yawRate = dot(this.body.angvel(), this.up);
    this.state.lateralAcceleration = this.state.speed * this.state.yawRate;
    this.contacts = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      wheel.suspensionLength = this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION.restLength;
      wheel.y = -wheel.suspensionLength;
      wheel.contact = this.vehicle.wheelIsInContact(i);
      wheel.steering = this.vehicle.wheelSteering(i) ?? 0;
      wheel.rotation = this.vehicle.wheelRotation(i) ?? 0;
      if (wheel.contact) this.contacts++;
    }
  }

  pause(): void {
    this.damage.pause();
    stopCar(this.state);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (let i = 0; i < 4; i++) { this.vehicle.setWheelEngineForce(i, 0); this.vehicle.setWheelBrake(i, 0); }
  }

  get needsRecovery(): boolean { return this.up.y < 0.3 || this.position.y < -5; }

  dispose(): void { this.eventQueue.free(); this.world.free(); }
}
