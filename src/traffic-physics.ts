import RAPIER from '@dimforge/rapier3d-compat';
import { CAR } from './vehicle-config.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import type { TrafficCar } from './vehicle-traffic.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';

/** Lane traffic uses kinematic bodies: the player can hit it, but cannot push it off its route. */
export class TrafficPhysics {
  private bodies = new Map<number, RAPIER.RigidBody>();
  private physics: VehiclePhysics;
  constructor(physics: VehiclePhysics) { this.physics = physics; }
  get count(): number { return this.bodies.size; }
  clear(): void {
    for (const body of this.bodies.values()) this.remove(body);
    this.bodies.clear();
  }
  private remove(body: RAPIER.RigidBody): void {
    this.physics.setColliderMaterial(body.collider(0).handle);
    this.physics.world.removeRigidBody(body);
  }
  sync(cars: readonly TrafficCar[]): void {
    const active = new Set(cars.map(car => car.id));
    for (const [id, body] of this.bodies) if (!active.has(id)) {
      this.remove(body); this.bodies.delete(id);
    }
    for (const car of cars) {
      const rotation = { x: 0, y: Math.sin(car.heading / 2), z: 0, w: Math.cos(car.heading / 2) };
      const position = { x: car.x, y: ROAD_HEIGHT + 0.75, z: car.z };
      let body = this.bodies.get(car.id);
      if (!body) {
        body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z).setRotation(rotation));
        const collider = this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(CAR.width / 2, 0.65, CAR.length / 2).setFriction(0.3).setRestitution(0), body);
        this.physics.setColliderMaterial(collider.handle, 'vehicle');
        this.bodies.set(car.id, body);
      }
      body.setNextKinematicTranslation(position); body.setNextKinematicRotation(rotation);
    }
  }
}
