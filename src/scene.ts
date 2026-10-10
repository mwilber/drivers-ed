import * as THREE from 'three';
import { createDamageVisuals } from './damage-visuals.ts';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { indicatorLit, type CarState } from './simulation.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';
import { CAR, SUSPENSION } from './vehicle-config.ts';
import { MIRRORS, MIRROR_BUDGET, MirrorSchedule, mirrorGeometry, placeDriverCamera, placeMirrorCamera, type ViewSettings } from './cockpit.ts';
import { BOUNDARY_OBSTACLES, DRIVEWAYS, HOUSES, PARKING_MARKINGS, PAVED_SURFACES, rampVertices, ROAD_HEIGHT, SIDEWALKS, SIDEWALK_HEIGHT, TEST_CURB, TEST_RAMP, TREES } from './world-layout.ts';

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

  box(scene, 1800, 0.15, 1800, 0, -0.075, 0, 0x879e6b);
  for (const sidewalk of SIDEWALKS) box(scene, sidewalk.width, SIDEWALK_HEIGHT, sidewalk.depth, sidewalk.x, SIDEWALK_HEIGHT / 2, sidewalk.z, 0xc9c8b9);
  for (const road of PAVED_SURFACES) box(scene, road.width, ROAD_HEIGHT, road.depth, road.x, ROAD_HEIGHT / 2, road.z, 0x596168);
  for (const driveway of DRIVEWAYS) box(scene, driveway.width, ROAD_HEIGHT, driveway.depth, driveway.x, ROAD_HEIGHT / 2, driveway.z, 0xb8b9aa);
  for (const line of PARKING_MARKINGS) box(scene, line.width, 0.006, line.depth, line.x, 0.084, line.z, 0xe9e7da).castShadow = false;
  const vertices = rampVertices();
  const points = [];
  for (let i = 0; i < vertices.length; i += 3) points.push(new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]));
  const ramp = new THREE.Mesh(new ConvexGeometry(points), material(0xb2aa8b));
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  scene.add(ramp);
  box(scene, TEST_CURB.width, TEST_CURB.height, TEST_CURB.depth, TEST_CURB.x, ROAD_HEIGHT + TEST_CURB.height / 2, TEST_CURB.z, 0xc9c8b9);
  for (const [text, x, z] of [['RAMP', TEST_RAMP.x, -124], ['CURB', TEST_CURB.x, -132]] as const) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const context = labelCanvas.getContext('2d')!;
    context.fillStyle = '#ede5bd';
    context.textAlign = 'center';
    context.font = 'bold 80px sans-serif';
    context.fillText(text, 256, 95);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(labelCanvas), transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, ROAD_HEIGHT + 0.01, z);
    scene.add(label);
  }
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
  for (const boundary of BOUNDARY_OBSTACLES) box(scene, boundary.halfWidth * 2, 1.6, boundary.halfDepth * 2, boundary.x, 0.8, boundary.z, 0x617a50);

  const chassis = new THREE.Group();
  scene.add(chassis);
  const car = new THREE.Group();
  car.position.y = -SUSPENSION.centerOfMassHeight;
  chassis.add(car);
  // A blank sedan with a hood, cabin frame, dashboard, and simple steering wheel.
  const paint = 0xc8cec8;
  const damageVisuals = createDamageVisuals();
  car.add(damageVisuals.group);
  const headlightMaterials: THREE.MeshStandardMaterial[] = [];
  const headlightBeams: THREE.SpotLight[] = [];
  const signalMaterials: { side: 'left' | 'right'; paint: THREE.MeshStandardMaterial }[] = [];
  for (const x of [-0.68, 0.68]) {
    const lens = box(car, 0.32, 0.14, 0.05, x, 0.6, -CAR.length / 2 - 0.01, 0xd8dfd2);
    const lensPaint = new THREE.MeshStandardMaterial({ color: 0xd8dfd2, emissive: 0xfff4ce, emissiveIntensity: 0 });
    lens.material = lensPaint;
    headlightMaterials.push(lensPaint);
    const beam = new THREE.SpotLight(0xfff4ce, 0, 60, 0.35, 0.45, 2);
    beam.position.set(x, 0.63, -2.2);
    beam.target.position.set(x, 0, -35);
    car.add(beam, beam.target);
    headlightBeams.push(beam);
    for (const z of [-CAR.length / 2 - 0.02, CAR.length / 2 + 0.02]) {
      const signal = box(car, 0.14, 0.12, 0.05, Math.sign(x) * 0.84, 0.6, z, 0x8c6b32);
      const signalPaint = new THREE.MeshStandardMaterial({ color: 0x8c6b32, emissive: 0xffa51f, emissiveIntensity: 0 });
      signal.material = signalPaint;
      signalMaterials.push({ side: x < 0 ? 'left' : 'right', paint: signalPaint });
    }
  }
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
  const wheelMeshes: THREE.Group[] = [];
  const tireGeometry = new THREE.CylinderGeometry(CAR.tireRadius, CAR.tireRadius, 0.18, 16);
  tireGeometry.rotateZ(Math.PI / 2);
  for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
    for (const x of [-SUSPENSION.trackWidth / 2, SUSPENSION.trackWidth / 2]) {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tireGeometry, material(0x242b2b)));
      wheel.position.set(x, -SUSPENSION.restLength, z);
      chassis.add(wheel);
      wheelMeshes.push(wheel);
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
  scene.add(camera);
  const mirrorScene = new THREE.Scene();
  const mirrorOverlay = new THREE.OrthographicCamera(0, window.innerWidth, window.innerHeight, 0, -1, 1);
  const mirrorSchedule = new MirrorSchedule();
  const mirrors = MIRRORS.map(definition => {
    const target = new THREE.WebGLRenderTarget(1, 1, { generateMipmaps: false });
    const geometry = mirrorGeometry();
    const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false, toneMapped: false }));
    mirrorScene.add(surface);
    return { definition, target, surface, camera: new THREE.PerspectiveCamera(definition.fov, 2, 0.1, 220), element: document.querySelector<HTMLElement>(`#mirror-${definition.id}`)! };
  });
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const mirrorStrip = document.querySelector<HTMLElement>('#mirrors')!;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    mirrorOverlay.right = window.innerWidth;
    mirrorOverlay.top = window.innerHeight;
    mirrorOverlay.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  return {
    render(state: CarState, physics: VehiclePhysics, view: ViewSettings, headYaw: number, time: number) {
      damageVisuals.update(physics.damage);
      for (const lens of headlightMaterials) lens.emissiveIntensity = state.headlights ? 2 : 0;
      for (const beam of headlightBeams) beam.intensity = state.headlights ? 900 : 0;
      for (const signal of signalMaterials) signal.paint.emissiveIntensity = indicatorLit(state) && (state.indicator === signal.side || state.indicator === 'hazards') ? 3 : 0;
      chassis.position.copy(physics.position);
      chassis.quaternion.copy(physics.rotation);
      for (let i = 0; i < wheelMeshes.length; i++) {
        const pose = physics.wheels[i]!;
        const wheel = wheelMeshes[i]!;
        wheel.position.set(pose.x, pose.y, pose.z);
        wheel.rotation.y = pose.steering;
        wheel.children[0]!.rotation.x = pose.rotation;
      }
      steeringWheel.rotation.z = state.steering * 2.8;
      position.copy(physics.position);
      rotation.copy(physics.rotation);
      placeDriverCamera(camera, position, rotation, state.heading, view, headYaw);
      // Main pass updates shadows once. Mirror passes reuse them and omit the player's shell.
      renderer.render(scene, camera);
      mirrorStrip.hidden = view.mirrors === 'off';
      if (view.mirrors === 'off') return;
      if (mirrorSchedule.due(time, view.mirrors)) {
        const budget = MIRROR_BUDGET[view.mirrors];
        renderer.shadowMap.autoUpdate = false;
        chassis.visible = false;
        try {
          for (const mirror of mirrors) {
            if (mirror.target.width !== budget.width) mirror.target.setSize(budget.width, budget.height);
            placeMirrorCamera(mirror.camera, mirror.definition, position, rotation);
            renderer.setRenderTarget(mirror.target);
            renderer.render(scene, mirror.camera);
          }
        } finally {
          chassis.visible = true;
          renderer.setRenderTarget(null);
          renderer.shadowMap.autoUpdate = true;
        }
      }
      for (const mirror of mirrors) {
        const rect = mirror.element.getBoundingClientRect();
        mirror.surface.position.set(rect.left + rect.width / 2, window.innerHeight - rect.top - rect.height / 2, 0);
        mirror.surface.scale.set(rect.width, rect.height, 1);
      }
      renderer.autoClear = false;
      renderer.render(mirrorScene, mirrorOverlay);
      renderer.autoClear = true;
    },
  };
}
