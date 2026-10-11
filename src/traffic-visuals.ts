import * as THREE from 'three';
import { CAR } from './vehicle-config.ts';
import { ROAD_HEIGHT } from './world-layout.ts';
import type { TrafficCar } from './vehicle-traffic.ts';

/** Shared geometry/materials and a bounded pool, also visible in the existing mirror passes. */
export function createTrafficVisuals(scene: THREE.Scene) {
  const bodyGeometry = new THREE.BoxGeometry(CAR.width, 0.65, CAR.length);
  const cabinGeometry = new THREE.BoxGeometry(1.6, 0.65, 2.1);
  const wheelGeometry = new THREE.CylinderGeometry(CAR.tireRadius, CAR.tireRadius, 0.22, 12);
  const lampGeometry = new THREE.BoxGeometry(0.3, 0.15, 0.05);
  const paints = [0x577a96, 0xb68b65, 0xb9beb3, 0x805965].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  const glass = new THREE.MeshStandardMaterial({ color: 0x364b57, roughness: 0.35 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x242b2c });
  const brakeOn = new THREE.MeshStandardMaterial({ color: 0xb32420, emissive: 0xff2410, emissiveIntensity: 2 });
  const brakeOff = new THREE.MeshStandardMaterial({ color: 0x651b1a });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe59c27, emissive: 0xe59c27, emissiveIntensity: 2 });
  const groups: { group: THREE.Group; brakes: THREE.Mesh[]; signals: THREE.Mesh[] }[] = [];
  function create() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, paints[groups.length % paints.length]);
    body.position.y = 0.67; body.castShadow = true; group.add(body);
    const cabin = new THREE.Mesh(cabinGeometry, glass); cabin.position.set(0, 1.32, 0.15); cabin.castShadow = true; group.add(cabin);
    for (const x of [-0.86, 0.86]) for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
      const wheel = new THREE.Mesh(wheelGeometry, tire); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, CAR.tireRadius, z); group.add(wheel);
    }
    const brakes: THREE.Mesh[] = [], signals: THREE.Mesh[] = [];
    for (const x of [-0.65, 0.65]) {
      const brake = new THREE.Mesh(lampGeometry, brakeOff); brake.position.set(x, 0.7, CAR.length / 2 + 0.01); group.add(brake); brakes.push(brake);
      for (const z of [-CAR.length / 2 - 0.02, CAR.length / 2 + 0.02]) {
        const signal = new THREE.Mesh(lampGeometry, amber); signal.position.set(Math.sign(x) * 0.84, 0.8, z); group.add(signal); signals.push(signal);
      }
    }
    scene.add(group); const result = { group, brakes, signals }; groups.push(result); return result;
  }
  return {
    update(cars: readonly TrafficCar[], seconds: number) {
      for (const entry of groups) entry.group.visible = false;
      cars.forEach((car, i) => {
        const entry = groups[i] ?? create(); entry.group.visible = true;
        entry.group.position.set(car.x, ROAD_HEIGHT, car.z); entry.group.rotation.y = car.heading;
        for (const brake of entry.brakes) brake.material = car.braking ? brakeOn : brakeOff;
        for (const signal of entry.signals) signal.visible = seconds % 1 < 0.5 && (car.indicator === 'left' ? signal.position.x < 0 : car.indicator === 'right' && signal.position.x > 0);
      });
    },
  };
}
