import * as THREE from 'three';
import { CYCLIST } from './cyclist-config.ts';
import type { CyclistBody } from './cyclist-physics.ts';
import type { TimeOfDay, Weather } from './driving-conditions.ts';

/** A bounded pool uses both physical poses, including separated riders and bicycles after a fall. */
export function createCyclistVisuals(scene: THREE.Scene) {
  const frame = new THREE.MeshStandardMaterial({ color: 0x3a8993 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x252d30 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc4caca, metalness: 0.5, roughness: 0.45 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xdb8145 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb9967b });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x354956 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2e9cd });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9eee2, emissive: 0xe9eee2, emissiveIntensity: 2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc83626, emissive: 0xc83626, emissiveIntensity: 2 });
  const wheelGeometry = new THREE.TorusGeometry(CYCLIST.wheelRadius - 0.03, 0.03, 6, 16);
  const sphere = new THREE.SphereGeometry(0.17, 12, 8);
  const beamGeometry = new THREE.BoxGeometry(1, 1, 1);
  const pool: { bicycle: THREE.Group; rider: THREE.Group; wheels: THREE.Group[]; legs: THREE.Group[]; lamps: THREE.Mesh[]; actor?: CyclistBody['actor']; wheelAngle: number; pedalAngle: number }[] = [];
  const mesh = (group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3) => {
    const m = new THREE.Mesh(geometry, material); m.position.copy(position); m.castShadow = true; group.add(m); return m;
  };
  const beam = (group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const m = mesh(group, beamGeometry, material, a.clone().add(b).multiplyScalar(0.5));
    m.scale.set(radius, a.distanceTo(b), radius); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return m;
  };
  const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  function create() {
    const bicycle = new THREE.Group(), rider = new THREE.Group(), wheels: THREE.Group[] = [], legs: THREE.Group[] = [], lamps: THREE.Mesh[] = [];
    for (const z of [-CYCLIST.wheelbase / 2, CYCLIST.wheelbase / 2]) {
      const wheel = new THREE.Group(); wheel.position.set(0, CYCLIST.wheelRadius - 0.6, z); bicycle.add(wheel); wheels.push(wheel);
      mesh(wheel, wheelGeometry, tire, point(0, 0, 0)).rotation.y = Math.PI / 2;
      beam(wheel, point(0, -0.3, 0), point(0, 0.3, 0), 0.018, metal);
      beam(wheel, point(0, 0, -0.3), point(0, 0, 0.3), 0.018, metal);
    }
    const rear = point(0, -0.26, 0.55), crank = point(0, -0.12, 0.05), seat = point(0, 0.32, 0.3), neck = point(0, 0.32, -0.48);
    for (const [a, b] of [[rear, crank], [rear, seat], [crank, seat], [seat, neck], [neck, crank], [neck, point(0, -0.26, -0.55)]]) beam(bicycle, a, b, 0.055, frame);
    beam(bicycle, neck, point(0, 0.4, -0.55), 0.04, metal);
    beam(bicycle, point(-0.325, 0.4, -0.55), point(0.325, 0.4, -0.55), 0.04, tire);
    const saddle = mesh(bicycle, beamGeometry, tire, point(0, 0.37, 0.3)); saddle.scale.set(0.22, 0.05, 0.32);
    const frontLamp = mesh(bicycle, sphere, white, point(0, 0.37, -0.57)); frontLamp.scale.setScalar(0.26); lamps.push(frontLamp);
    const rearLamp = mesh(bicycle, sphere, red, point(0, 0.35, 0.49)); rearLamp.scale.setScalar(0.23); lamps.push(rearLamp);
    const torso = mesh(rider, beamGeometry, shirt, point(0, 0.02, -0.05)); torso.scale.set(0.4, 0.47, 0.28); torso.rotation.x = -0.2;
    mesh(rider, sphere, skin, point(0, 0.35, -0.11));
    const cap = mesh(rider, sphere, helmet, point(0, 0.4, -0.11)); cap.scale.set(1.1, 0.65, 1.1);
    for (const side of [-1, 1]) {
      beam(rider, point(side * 0.2, 0.18, -0.1), point(side * 0.3, -0.4, -0.67), 0.12, shirt);
      const leg = new THREE.Group(); rider.add(leg); legs.push(leg);
      beam(leg, point(side * 0.13, -0.2, 0.1), point(side * 0.17, -0.5, -0.3), 0.14, trousers);
      beam(leg, point(side * 0.17, -0.5, -0.3), point(side * 0.17, -0.87, 0.05), 0.12, trousers);
    }
    scene.add(bicycle, rider); const entry = { bicycle, rider, wheels, legs, lamps, actor: undefined as CyclistBody['actor'] | undefined, wheelAngle: 0, pedalAngle: 0 }; pool.push(entry); return entry;
  }
  let lastSeconds = 0;
  return {
    update(riders: readonly CyclistBody[], seconds: number, timeOfDay: TimeOfDay = 'day', weather: Weather = 'dry') {
      const dt = Math.max(0, Math.min(0.1, seconds - lastSeconds)); lastSeconds = seconds;
      for (const e of pool) { e.bicycle.visible = false; e.rider.visible = false; }
      riders.forEach((entry, i) => {
        const e = pool[i] ?? create();
        if (e.actor !== entry.actor) { e.actor = entry.actor; e.wheelAngle = 0; e.pedalAngle = 0; }
        for (const [group, body] of [[e.bicycle, entry.bicycle], [e.rider, entry.rider]] as const) {
          const p = body.translation(), q = body.rotation(); group.visible = true; group.position.set(p.x, p.y, p.z); group.quaternion.set(q.x, q.y, q.z, q.w);
        }
        if (entry.state === 'riding') { e.wheelAngle += entry.actor.speed * dt / CYCLIST.wheelRadius; e.pedalAngle += entry.actor.speed * dt * 2; }
        e.wheels.forEach(w => { w.rotation.x = -e.wheelAngle; });
        e.legs.forEach((l, i) => { l.rotation.x = entry.state === 'riding' ? Math.sin(e.pedalAngle + i * Math.PI) * 0.12 : 0; });
        for (const lamp of e.lamps) lamp.visible = timeOfDay !== 'day' || weather === 'rain';
      });
    },
  };
}
