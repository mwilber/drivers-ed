import * as THREE from 'three';
import { createSceneryVisuals, createAsphaltTexture } from './scenery-visuals.ts';
import { createRoadVisuals } from './road-visuals.ts';
import { createDamageVisuals } from './damage-visuals.ts';
import { createSedanResources } from './sedan-visuals.ts';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { indicatorLit, type CarState } from './simulation.ts';
import type { VehiclePhysics } from './vehicle-physics.ts';
import { CAR, SUSPENSION } from './vehicle-config.ts';
import { createTrafficVisuals } from './traffic-visuals.ts';
import type { TrafficCar } from './vehicle-traffic.ts';
import { createCyclistVisuals } from './cyclist-visuals.ts';
import type { CyclistBody } from './cyclist-physics.ts';
import { createPedestrianVisuals } from './pedestrian-visuals.ts';
import { createDrivingLighting } from './driving-lighting.ts';
import type { TimeOfDay } from './driving-conditions.ts';
import type { Weather } from './driving-conditions.ts';
import { createWeatherVisuals } from './weather-visuals.ts';
import { WindshieldRain } from './windshield-rain.ts';
import type { Pedestrian } from './pedestrians.ts';
import { MIRRORS, MIRROR_BUDGET, MirrorSchedule, mirrorGeometry, placeDriverCamera, placeMirrorCamera, type ViewSettings } from './cockpit.ts';
import { BOUNDARY_OBSTACLES, DRIVEWAYS, PARKING_MARKINGS, PAVED_SURFACES, rampVertices, ROAD_HEIGHT, SIDEWALKS, SIDEWALK_HEIGHT, TEST_CURB, TEST_RAMP } from './world-layout.ts';

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
  const lighting = createDrivingLighting(scene);

  box(scene, 1800, 0.15, 1800, 0, -0.075, 0, 0x879e6b);
  for (const sidewalk of SIDEWALKS) box(scene, sidewalk.width, SIDEWALK_HEIGHT, sidewalk.depth, sidewalk.x, SIDEWALK_HEIGHT / 2, sidewalk.z, 0xc9c8b9);
  material(0x596168).map = createAsphaltTexture();
  for (const road of PAVED_SURFACES) {
    const mesh = box(scene, road.width, ROAD_HEIGHT, road.depth, road.x, ROAD_HEIGHT / 2, road.z, 0x596168);
    const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + road.x) * 0.5, (positions.getZ(i) + road.z) * 0.5);
  }
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
  const roadVisuals = createRoadVisuals(scene);
  const sedan = createSedanResources();
  const trafficVisuals = createTrafficVisuals(scene, sedan);
  const cyclistVisuals = createCyclistVisuals(scene);
  const pedestrianVisuals = createPedestrianVisuals(scene);

  const scenery = createSceneryVisuals(scene);
  // Low hedges make the sandbox's collision boundary visible.
  for (const boundary of BOUNDARY_OBSTACLES) box(scene, boundary.halfWidth * 2, 1.6, boundary.halfDepth * 2, boundary.x, 0.8, boundary.z, 0x617a50);

  const chassis = new THREE.Group();
  scene.add(chassis);
  const car = new THREE.Group();
  car.position.y = -SUSPENSION.centerOfMassHeight;
  chassis.add(car);
  // Shared exterior/wheels surround the validated open cockpit and damage panels.
  const paint = 0xc8cec8;
  const damageVisuals = createDamageVisuals();
  car.add(damageVisuals.group);
  car.add(sedan.exterior().group);
  const headlightMaterials: THREE.MeshStandardMaterial[] = [];
  const rearLampMaterials: THREE.MeshStandardMaterial[] = [];
  const signalMaterials: { side: 'left' | 'right'; paint: THREE.MeshStandardMaterial }[] = [];
  for (const x of [-0.68, 0.68]) {
    const lens = box(car, 0.32, 0.14, 0.05, x, 0.6, -CAR.length / 2 - 0.01, 0xd8dfd2);
    const lensPaint = new THREE.MeshStandardMaterial({ color: 0xd8dfd2, emissive: 0xfff4ce, emissiveIntensity: 0 });
    lens.material = lensPaint;
    headlightMaterials.push(lensPaint);
    const rearLamp = box(car, 0.32, 0.14, 0.05, x, 0.6, CAR.length / 2 + 0.01, 0x651b1a);
    const rearPaint = new THREE.MeshStandardMaterial({ color: 0x651b1a, emissive: 0xff2410, emissiveIntensity: 0 });
    rearLamp.material = rearPaint;
    rearLampMaterials.push(rearPaint);
    for (const z of [-CAR.length / 2 - 0.02, CAR.length / 2 + 0.02]) {
      const signal = box(car, 0.14, 0.12, 0.05, Math.sign(x) * 0.84, 0.6, z, 0x8c6b32);
      const signalPaint = new THREE.MeshStandardMaterial({ color: 0x8c6b32, emissive: 0xffa51f, emissiveIntensity: 0 });
      signal.material = signalPaint;
      signalMaterials.push({ side: x < 0 ? 'left' : 'right', paint: signalPaint });
    }
  }
  const headliner = box(car, 1.7, 0.01, 1.92, 0, 1.565, 0.35, paint);
  headliner.material = new THREE.MeshStandardMaterial({ color: 0xc7cec0, roughness: 1 });
  box(car, 0.09, 0.32, 1.7, -0.86, 0.89, 0.28, 0x313b3c);
  box(car, 0.09, 0.32, 1.7, 0.86, 0.89, 0.28, 0x313b3c);
  for (const x of [-0.82, 0.82]) {
    beam(car, new THREE.Vector3(x, 0.85, -1), new THREE.Vector3(x, 1.6, -0.6), 0.075, 0x424e4d);
    beam(car, new THREE.Vector3(x, 0.85, 1.35), new THREE.Vector3(x, 1.6, 1.2), 0.08, paint);
  }
  box(car, 1.7, 0.2, 0.55, 0, 0.81, -0.65, 0x273332);
  box(car, 1.65, 0.07, 0.58, 0, 0.94, -0.68, 0x36423f);
  // Inset dash vents and a center console stay below the validated windshield sightline.
  for (const x of [-0.7, -0.12, 0.35, 0.65]) {
    box(car, 0.18, 0.075, 0.012, x, 0.85, -0.367, 0x111d1e);
    for (const y of [0.83, 0.855, 0.88]) box(car, 0.16, 0.008, 0.014, x, y, -0.359, 0x58635f);
  }
  box(car, 0.27, 0.22, 0.5, 0.12, 0.58, -0.13, 0x273332);
  const wheelMeshes: THREE.Group[] = [];
  for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
    for (const x of [-SUSPENSION.trackWidth / 2, SUSPENSION.trackWidth / 2]) {
      const wheel = sedan.wheel();
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
  const weatherVisuals = createWeatherVisuals(scene, car);
  const emptyWindshield = new WindshieldRain();
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
    audioListenerPose() {
      return { point: camera.position.clone(), forward: camera.getWorldDirection(new THREE.Vector3()), up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion) };
    },
    render(state: CarState, physics: VehiclePhysics, view: ViewSettings, headYaw: number, time: number, trafficTime = 0, traffic: readonly TrafficCar[] = [], pedestrians: readonly Pedestrian[] = [], timeOfDay: TimeOfDay = 'day', weather: Weather = 'dry', windshield = emptyWindshield, cyclists: readonly CyclistBody[] = []) {
      scenery.update(physics.position);
      lighting.update(timeOfDay, state.headlights, physics.position, physics.rotation, weather);
      weatherVisuals.update(weather, trafficTime, physics.position, windshield);
      material(0x596168).roughness = weather === 'rain' ? 0.42 : 0.92;
      material(0x596168).color.setHex(weather === 'rain' ? 0x444d55 : 0x596168);
      roadVisuals.update(trafficTime);
      trafficVisuals.update(traffic, trafficTime, timeOfDay, weather, physics.position);
      pedestrianVisuals.update(pedestrians, trafficTime);
      cyclistVisuals.update(cyclists, trafficTime, timeOfDay, weather);
      damageVisuals.update(physics.damage);
      for (const lens of headlightMaterials) lens.emissiveIntensity = state.headlights ? 2 : 0;
      for (const lamp of rearLampMaterials) lamp.emissiveIntensity = state.brake > 0.05 ? 2 : state.headlights ? 0.6 : 0;
      for (const signal of signalMaterials) signal.paint.emissiveIntensity = indicatorLit(state) && (state.indicator === signal.side || state.indicator === 'hazards') ? 3 : 0;
      chassis.position.copy(physics.position);
      chassis.quaternion.copy(physics.rotation);
      for (let i = 0; i < wheelMeshes.length; i++) {
        const pose = physics.wheels[i]!;
        const wheel = wheelMeshes[i]!;
        wheel.position.set(pose.x, pose.y, pose.z);
        wheel.rotation.y = pose.steering;
        for (const part of wheel.children) part.rotation.x = pose.rotation;
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
