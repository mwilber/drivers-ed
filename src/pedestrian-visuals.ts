import * as THREE from 'three';
import { PEDESTRIAN, type Pedestrian } from './pedestrians.ts';

/** Placeholder silhouettes share the physics capsule's center and full orientation, including falls. */
export function createPedestrianVisuals(scene: THREE.Scene) {
  const skin = new THREE.MeshStandardMaterial({ color: 0xb9967b });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xc88d38 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x354956 });
  const torso = new THREE.BoxGeometry(0.43, 0.6, 0.28), limb = new THREE.BoxGeometry(0.15, 0.6, 0.16);
  const head = new THREE.SphereGeometry(0.17, 12, 8);
  const pool: { group: THREE.Group; legs: THREE.Mesh[]; arms: THREE.Mesh[] }[] = [];
  function create() {
    const group = new THREE.Group(), legs: THREE.Mesh[] = [], arms: THREE.Mesh[] = [];
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0) => {
      const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z); item.castShadow = true; group.add(item); return item;
    };
    mesh(torso, shirt, 0, 0.16); mesh(head, skin, 0, 0.65);
    for (const side of [-1, 1]) { legs.push(mesh(limb, trousers, side * 0.12, -0.54)); arms.push(mesh(limb, shirt, side * 0.28, 0.06)); }
    scene.add(group); const entry = { group, legs, arms }; pool.push(entry); return entry;
  }
  return {
    update(people: readonly Pedestrian[], seconds: number) {
      for (const entry of pool) entry.group.visible = false;
      people.forEach((p, i) => {
        const entry = pool[i] ?? create(), pos = p.body.translation(), q = p.body.rotation();
        entry.group.visible = true; entry.group.position.set(pos.x, pos.y, pos.z); entry.group.quaternion.set(q.x, q.y, q.z, q.w);
        const swing = p.state === 'crossing' ? Math.sin(seconds * 8) * Math.min(0.45, p.speed / PEDESTRIAN.speed * 0.45) : 0;
        entry.legs.forEach((leg, i) => { leg.rotation.x = (i ? -1 : 1) * swing; });
        entry.arms.forEach((arm, i) => { arm.rotation.x = (i ? 1 : -1) * swing; });
      });
    },
  };
}
