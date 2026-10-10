import RAPIER from '@dimforge/rapier3d-compat';
import { createCar, stopCar, updateDriveForces, type DrivingInput } from './simulation.ts';
import { CAR, HANDLING, SUSPENSION } from './vehicle-config.ts';
import { BOUNDARY_OBSTACLES, DRIVEWAYS, HOUSES, isOnRoad, PAVED_SURFACES, rampVertices, ROAD_HEIGHT, SIDEWALKS, SIDEWALK_HEIGHT, TEST_CURB, TREES } from './world-layout.ts';
import { FIXED_STEP } from './simulation-clock.ts';

export interface PhysicsBox { x: number; y: number; z: number; width: number; height: number; depth: number }
export interface Spawn { x: number; z: number; heading: number }
export interface PhysicsOptions { environment?: 'neighborhood' | 'flat'; spawn?: Spawn; boxes?: readonly PhysicsBox[] }
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
  body!: RAPIER.RigidBody;
  vehicle!: RAPIER.DynamicRayCastVehicleController;
  position = { x: 0, y: 0, z: 0 };
  rotation = { ...identity };
  up = { x: 0, y: 1, z: 0 };
  contacts = 0;

  constructor(options: PhysicsOptions) {
    this.options = options;
    this.world = new RAPIER.World({ x: 0, y: -HANDLING.gravity, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.numSolverIterations = 8;
    this.addBox({ x: 0, y: (options.environment === 'flat' ? ROAD_HEIGHT : 0) - 0.5, z: 0, width: 20000, height: 1, depth: 20000 });
    if (options.environment !== 'flat') {
      for (const rect of [...PAVED_SURFACES, ...DRIVEWAYS]) this.addBox({ ...rect, y: ROAD_HEIGHT / 2, height: ROAD_HEIGHT });
      for (const rect of SIDEWALKS) this.addBox({ ...rect, y: SIDEWALK_HEIGHT / 2, height: SIDEWALK_HEIGHT });
      for (const house of HOUSES) this.addBox({ ...house, y: house.height / 2 });
      for (const tree of TREES) {
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(1.75 * tree.size, 0.29 * tree.size)
          .setTranslation(tree.x, 1.75 * tree.size, tree.z).setFriction(0.6));
      }
      for (const obstacle of BOUNDARY_OBSTACLES) this.addBox({ ...obstacle, y: 0.8, width: obstacle.halfWidth * 2, height: 1.6, depth: obstacle.halfDepth * 2 });
      this.world.createCollider(RAPIER.ColliderDesc.convexHull(rampVertices())!.setFriction(0.9));
      this.addBox({ ...TEST_CURB, y: ROAD_HEIGHT + TEST_CURB.height / 2 });
    }
    for (const box of options.boxes ?? []) this.addBox(box);
    this.world.step(); // Populate scene queries before finding the spawn's ground height.
    this.reset();
  }

  private addBox(box: PhysicsBox): void {
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.width / 2, box.height / 2, box.depth / 2)
      .setTranslation(box.x, box.y, box.z).setFriction(0.9).setRestitution(0));
  }

  reset(spawn: Spawn = this.options.spawn ?? createCar()): void {
    if (this.vehicle) this.world.removeVehicleController(this.vehicle);
    if (this.body) this.world.removeRigidBody(this.body);
    Object.assign(this.state, createCar(), spawn);
    const hit = this.world.castRay(new RAPIER.Ray({ x: spawn.x, y: 100, z: spawn.z }, { x: 0, y: -1, z: 0 }), 200, true);
    const ground = hit ? 100 - hit.timeOfImpact : ROAD_HEIGHT;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, ground + SUSPENSION.centerOfMassHeight, spawn.z)
      .setRotation({ x: 0, y: Math.sin(spawn.heading / 2), z: 0, w: Math.cos(spawn.heading / 2) })
      .setCcdEnabled(true).setAngularDamping(0.3).setAdditionalSolverIterations(4));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(CAR.width / 2, 0.21, CAR.length / 2)
      .setTranslation(0, 0.51 - SUSPENSION.centerOfMassHeight, 0).setMass(CAR.mass).setFriction(0.25).setRestitution(0), this.body);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.82, 0.4, 0.88)
      .setTranslation(0, 1.17 - SUSPENSION.centerOfMassHeight, 0.28).setMass(0).setFriction(0.25), this.body);
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
    const { driveAcceleration, resistance } = updateDriveForces(this.state, input, dt, onRoad);
    const engineForce = Math.sign(this.state.gear) * Math.max(0, driveAcceleration - resistance) * CAR.mass / 4;
    const brakingImpulse = Math.max(0, resistance - driveAcceleration) * CAR.mass * dt / 4;
    for (let i = 0; i < 4; i++) {
      const contact = this.vehicle.wheelContactPoint(i);
      const paved = this.options.environment === 'flat' || (contact ? isOnRoad(contact.x, contact.z) : onRoad);
      this.vehicle.setWheelFrictionSlip(i, SUSPENSION.tireFriction * (paved ? 1 : HANDLING.grassGrip / HANDLING.dryGrip));
      this.vehicle.setWheelSteering(i, i < 2 ? this.state.steering : 0);
      // Rapier's wheel forward axis is +Z; the sedan faces local -Z.
      this.vehicle.setWheelEngineForce(i, -engineForce);
      this.vehicle.setWheelBrake(i, brakingImpulse);
    }
    this.body.wakeUp();
    this.vehicle.updateVehicle(dt, undefined, undefined, collider => collider.parent()?.handle !== this.body.handle);
    this.world.step();
    this.sync();
    this.state.acceleration = (this.state.speed - previousSpeed) / dt;
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
    stopCar(this.state);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (let i = 0; i < 4; i++) { this.vehicle.setWheelEngineForce(i, 0); this.vehicle.setWheelBrake(i, 0); }
  }

  get needsRecovery(): boolean { return this.up.y < 0.3 || this.position.y < -5; }

  dispose(): void { this.world.free(); }
}
