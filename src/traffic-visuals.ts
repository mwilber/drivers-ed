import * as THREE from 'three';
import { CAR } from './vehicle-config.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import type { TrafficCar } from './vehicle-traffic.ts';
import { createDamageVisuals } from './damage-visuals.ts';
import type { TimeOfDay, Weather } from './driving-conditions.ts';
import { createSedanResources, SEDAN_DETAIL, visualStats } from './sedan-visuals.ts';
import type { Point } from './road-network.ts';

/** Shared geometry/materials and a bounded pool, also visible in the existing mirror passes. */
export function createTrafficVisuals(scene: THREE.Scene, sedan = createSedanResources()) {
  const lampGeometry = new THREE.BoxGeometry(0.3, 0.15, 0.05);
  const paints = [0x577a96, 0xb68b65, 0xb9beb3, 0x805965];
  const brakeOn = new THREE.MeshStandardMaterial({ color: 0xb32420, emissive: 0xff2410, emissiveIntensity: 2 });
  const brakeOff = new THREE.MeshStandardMaterial({ color: 0x651b1a });
  const tailOn = new THREE.MeshStandardMaterial({ color: 0x651b1a, emissive: 0xff2410, emissiveIntensity: 0.6 });
  const headOn = new THREE.MeshStandardMaterial({ color: 0xd8dfd2, emissive: 0xfff4ce, emissiveIntensity: 2 });
  const headOff = new THREE.MeshStandardMaterial({ color: 0xd8dfd2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe59c27, emissive: 0xe59c27, emissiveIntensity: 2 });
  const groups: { group: THREE.Group; brakes: THREE.Mesh[]; headlights: THREE.Mesh[]; signals: THREE.Mesh[];
    damage: ReturnType<typeof createDamageVisuals>; exterior: ReturnType<typeof sedan.exterior>;
    cabin: ReturnType<typeof sedan.cabin>; wheels: THREE.Group[]; actor?: TrafficCar; seconds: number; roll: number; detailed: boolean }[] = [];
  function create() {
    const group = new THREE.Group();
    const damage = createDamageVisuals(paints[groups.length % paints.length]);
    group.add(damage.group);
    const exterior = sedan.exterior(), cabin = sedan.cabin(paints[groups.length % paints.length]!);
    group.add(exterior.group, cabin.group);
    const wheels: THREE.Group[] = [];
    for (const x of [-0.78, 0.78]) for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
      const wheel = sedan.wheel(); wheel.position.set(x, CAR.tireRadius, z); group.add(wheel); wheels.push(wheel);
    }
    const brakes: THREE.Mesh[] = [], headlights: THREE.Mesh[] = [], signals: THREE.Mesh[] = [];
    for (const x of [-0.65, 0.65]) {
      const headlight = new THREE.Mesh(lampGeometry, headOff); headlight.position.set(x, 0.7, -CAR.length / 2 - 0.01); group.add(headlight); headlights.push(headlight);
      const brake = new THREE.Mesh(lampGeometry, brakeOff); brake.position.set(x, 0.7, CAR.length / 2 + 0.01); group.add(brake); brakes.push(brake);
      for (const z of [-CAR.length / 2 - 0.02, CAR.length / 2 + 0.02]) {
        const signal = new THREE.Mesh(lampGeometry, amber); signal.position.set(Math.sign(x) * 0.84, 0.8, z); group.add(signal); signals.push(signal);
      }
    }
    scene.add(group); const result = { group, brakes, headlights, signals, damage, exterior, cabin, wheels,
      actor: undefined as TrafficCar | undefined, seconds: 0, roll: 0, detailed: true }; groups.push(result); return result;
  }
  return {
    update(cars: readonly TrafficCar[], seconds: number, timeOfDay: TimeOfDay = 'day', weather: Weather = 'dry', viewer?: Point) {
      for (const entry of groups) entry.group.visible = false;
      cars.filter(car => car.kind === 'car').forEach((car, i) => {
        const entry = groups[i] ?? create(); entry.group.visible = true;
        if (entry.actor !== car) { entry.actor = car; entry.roll = 0; entry.seconds = seconds; entry.detailed = true; }
        const dt = Math.min(0.1, Math.max(0, seconds - entry.seconds)); entry.seconds = seconds;
        entry.roll = (entry.roll - car.speed * dt / CAR.tireRadius) % (Math.PI * 2);
        const distance = viewer ? Math.hypot(car.x - viewer.x, car.z - viewer.z) : 0;
        entry.detailed = distance <= (entry.detailed ? SEDAN_DETAIL.leave : SEDAN_DETAIL.enter);
        entry.exterior.detail.visible = entry.cabin.pillars.visible = entry.detailed;
        for (const wheel of entry.wheels) { wheel.rotation.x = entry.roll; wheel.children[1]!.visible = entry.detailed; }
        entry.group.position.set(car.x, ROAD_HEIGHT, car.z); entry.group.rotation.y = car.heading;
        entry.damage.update(car.damage);
        const lights = timeOfDay !== 'day' || weather === 'rain';
        for (const headlight of entry.headlights) headlight.material = lights ? headOn : headOff;
        for (const brake of entry.brakes) brake.material = car.braking ? brakeOn : lights ? tailOn : brakeOff;
        for (const signal of entry.signals) signal.visible = seconds % 1 < 0.5 && (car.indicator === 'left' ? signal.position.x < 0 : car.indicator === 'right' && signal.position.x > 0);
      });
    },
    stats() {
      const stats = visualStats(groups.map(entry => entry.group));
      stats.geometryBytes += groups.reduce((sum, entry) => sum + entry.damage.snapshotBytes, 0);
      return { cars: groups.length, ...stats };
    },
  };
}
