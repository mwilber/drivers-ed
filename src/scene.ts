import * as THREE from 'three';
import type { CarState } from './simulation.ts';
import { CAR } from './vehicle-config.ts';
import { HOUSES, ROADS, TREES } from './world-layout.ts';

const materials = new Map<number, THREE.MeshStandardMaterial>();
function material(color: number): THREE.MeshStandardMaterial {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  return materials.get(color)!;
}

function box(parent: THREE.Object3D, width: number, height: number, depth: number, x: number, y: number, z: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function beam(parent: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, width: number, color: number): void {
  const mesh = box(parent, width, start.distanceTo(end), width, 0, 0, 0, color);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
}

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc6dce3);
  scene.fog = new THREE.Fog(0xc6dce3, 150, 390);
  scene.add(new THREE.HemisphereLight(0xe7f3ff, 0x728357, 2.5));
  const sun = new THREE.DirectionalLight(0xffefd5, 3.1);
  sun.position.set(-90, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -165, right: 165, top: 145, bottom: -145, near: 1, far: 350 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  box(scene, 1800, 0.15, 1800, 0, -0.15, 0, 0x879e6b);
  // Sidewalk strips merge at junctions. The raised edge remains low and drivable.
  for (const road of ROADS) box(scene, road.width + 4, 0.13, road.depth + 4, road.x, -0.02, road.z, 0xc9c8b9);
  for (const road of ROADS) box(scene, road.width, 0.04, road.depth, road.x, 0.06, road.z, 0x596168);
  // Break center lines at all three intersections along each long street.
  for (const z of [-60, 60]) {
    for (let x = -90; x <= 90; x += 7) {
      if (Math.abs(x) < 9) continue;
      box(scene, 3.3, 0.006, 0.12, x, 0.084, z, 0xe6d59d).castShadow = false;
    }
  }
  for (const x of [-100, 0, 100]) {
    for (let z = -47; z < 50; z += 7) box(scene, 0.12, 0.006, 3.3, x, 0.084, z, 0xe6d59d).castShadow = false;
  }

  for (const house of HOUSES) {
    // Plain massing only: walls and a pitched roof, without doors or windows.
    box(scene, house.width + 0.5, 0.25, house.depth + 0.5, house.x, 0.1, house.z, 0xb7b7a9);
    box(scene, house.width, house.height, house.depth, house.x, house.height / 2, house.z, house.color);
    const roofGeometry = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
    roofGeometry.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeometry, material(house.roofColor));
    roof.scale.set((house.width + 1.6) / Math.SQRT2, 3.5, (house.depth + 1.6) / Math.SQRT2);
    roof.position.set(house.x, house.height + 1.75, house.z);
    roof.castShadow = true;
    scene.add(roof);
    if (Math.abs(house.x) < 100) {
      const roadZ = house.z < 0 ? -60 : 60;
      const towardRoad = Math.sign(roadZ - house.z);
      const edge = house.z + towardRoad * house.depth / 2;
      const end = roadZ - towardRoad * 5;
      box(scene, 3.8, 0.035, Math.abs(end - edge), house.x + 3, 0.02, (edge + end) / 2, 0xb8b9aa);
    }
  }

  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.29, 3.5, 7);
  for (const [index, tree] of TREES.entries()) {
    const trunk = new THREE.Mesh(trunkGeometry, material(0x776853));
    trunk.position.set(tree.x, 1.75 * tree.size, tree.z);
    trunk.scale.setScalar(tree.size);
    trunk.castShadow = true;
    scene.add(trunk);
    const crown = new THREE.Mesh(crownGeometry, material([0x587448, 0x6b8551, 0x78945c][index % 3]!));
    crown.position.set(tree.x, 4.7 * tree.size, tree.z);
    crown.scale.set(2.7 * tree.size, 3.2 * tree.size, 2.5 * tree.size);
    crown.castShadow = true;
    crown.receiveShadow = true;
    scene.add(crown);
  }
  // Low hedges make the sandbox's collision boundary visible.
  box(scene, 2, 1.6, 274, -177, 0.8, 0, 0x617a50);
  box(scene, 2, 1.6, 274, 177, 0.8, 0, 0x617a50);
  box(scene, 356, 1.6, 2, 0, 0.8, -137, 0x617a50);
  box(scene, 356, 1.6, 2, 0, 0.8, 137, 0x617a50);

  const car = new THREE.Group();
  scene.add(car);
  // A blank sedan with a hood, cabin frame, dashboard, and simple steering wheel.
  const paint = 0xc8cec8;
  box(car, CAR.width, 0.42, CAR.length, 0, 0.51, 0, paint);
  box(car, 1.72, 0.17, 1.3, 0, 0.81, -1.54, paint);
  box(car, 1.73, 0.1, 1.95, 0, 1.62, 0.35, paint);
  const headliner = box(car, 1.7, 0.01, 1.92, 0, 1.565, 0.35, paint);
  headliner.material = new THREE.MeshBasicMaterial({ color: 0xc7cec0 });
  box(car, 0.09, 0.32, 1.7, -0.86, 0.89, 0.28, 0x313b3c);
  box(car, 0.09, 0.32, 1.7, 0.86, 0.89, 0.28, 0x313b3c);
  for (const x of [-0.82, 0.82]) {
    beam(car, new THREE.Vector3(x, 0.85, -1), new THREE.Vector3(x, 1.6, -0.6), 0.075, 0x424e4d);
    beam(car, new THREE.Vector3(x, 0.85, 1.35), new THREE.Vector3(x, 1.6, 1.2), 0.08, paint);
  }
  box(car, 1.7, 0.2, 0.55, 0, 0.81, -0.65, 0x273332);
  box(car, 1.65, 0.07, 0.58, 0, 0.94, -0.68, 0x36423f);
  // Wheels establish the sedan's proportions without adding body styling.
  for (const x of [-0.87, 0.87]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 16), material(0x242b2b));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.32, z);
      car.add(wheel);
    }
  }
  const steeringPivot = new THREE.Group();
  steeringPivot.position.set(-0.38, 0.91, -0.22);
  steeringPivot.rotation.x = -0.24;
  car.add(steeringPivot);
  const steeringWheel = new THREE.Group();
  steeringPivot.add(steeringWheel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.022, 10, 40), material(0x172221));
  steeringWheel.add(ring);
  box(steeringWheel, 0.37, 0.028, 0.025, 0, 0, 0, 0x3e4945);
  box(steeringWheel, 0.03, 0.19, 0.026, 0, -0.095, 0, 0x3e4945);
  box(steeringWheel, 0.105, 0.072, 0.05, 0, 0, 0.015, 0x26322f);

  const camera = new THREE.PerspectiveCamera(68, 1, 0.035, 900);
  camera.position.set(-0.38, CAR.eyeHeight, 0.38);
  camera.rotation.x = -0.035;
  car.add(camera);
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  return {
    render(state: CarState) {
      car.position.set(state.x, 0, state.z);
      car.rotation.y = state.heading;
      steeringWheel.rotation.z = state.steering * 2.8;
      renderer.render(scene, camera);
    },
  };
}
