import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTrafficVisuals } from '../src/traffic-visuals.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { TRAFFIC_VISUAL_BUDGET } from '../src/sedan-visuals.ts';

const canvas = document.querySelector('#review');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 200);
camera.position.set(6, 3.2, -7);
const controls = new OrbitControls(camera, canvas); controls.target.set(0, 0.9, 0); controls.update();
controls.minDistance = 5; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI / 2 - 0.03;
const sky = new THREE.HemisphereLight(0xdcecf4, 0x4f6046, 2.2); scene.add(sky);
const sun = new THREE.DirectionalLight(0xffefcf, 2.7); sun.position.set(-4, 8, -5); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x76817b, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = 0.078; scene.add(ground);
const traffic = new VehicleTraffic(); traffic.density = 'off';
const cars = [traffic.add(['middle-n:center>north']), traffic.add(['middle-n:center>north'])];
Object.assign(cars[0], { x: -2.1, z: 0, heading: 0 });
Object.assign(cars[1], { x: 2.1, z: 0.5, heading: Math.PI });
const visuals = createTrafficVisuals(scene);
const lighting = document.querySelector('#lighting'), detail = document.querySelector('#detail');
const damage = document.querySelector('#damage'), rolling = document.querySelector('#rolling');
let seconds = 0;
function update() {
  const night = lighting.value === 'night';
  sky.intensity = night ? 0.35 : 2.2; sun.intensity = night ? 0.45 : 2.7;
  scene.background = new THREE.Color(night ? 0x192730 : 0xc3d2d4);
  for (const car of cars) {
    car.speed = rolling.checked ? 2 : 0; car.braking = damage.checked; car.indicator = damage.checked ? 'left' : 'off';
  }
  visuals.update(cars, seconds, lighting.value, 'dry', { x: detail.value === 'near' ? 0 : 1000, z: 0 });
  renderer.render(scene, camera);
  const stats = visuals.stats();
  document.querySelector('#resources').textContent = `${stats.cars} cars · ${stats.drawCalls} sedan draws/view · ${stats.triangles.toLocaleString()} triangles · ${stats.geometryBytes.toLocaleString()} geometry/instance bytes`;
}
damage.addEventListener('change', () => {
  for (const car of cars) {
    if (damage.checked) { for (const panel of Object.values(car.damage.panels)) { panel.dent = panel.scratch = 1; } car.damage.revision++; }
    else car.damage.repair();
  }
  update();
});
for (const element of [lighting, detail, rolling]) element.addEventListener('change', update);
document.querySelector('#check').addEventListener('click', () => {
  const previousDetail = detail.value, previousLighting = lighting.value;
  try {
    detail.value = 'near'; update(); const near = visuals.stats();
    detail.value = 'far'; update(); const far = visuals.stats();
    if (far.triangles >= near.triangles || far.geometryBytes !== near.geometryBytes) throw new Error('Distance detail/buffer reuse');
    lighting.value = 'night'; update();
    const lamps = scene.children.filter(n => n.isGroup).flatMap(g => g.children.filter(n => n.isMesh && n.position.z < -2 && Math.abs(n.position.x) === 0.65));
    if (lamps.length !== 4 || lamps.some(l => l.material.emissiveIntensity !== 2)) throw new Error('Night lamps');
    lighting.value = 'day'; update();
    if (lamps.some(l => l.material.emissive.getHex() !== 0)) throw new Error('Day lamp restoration');
    for (const key of ['drawCalls', 'triangles', 'geometryBytes']) if (near[key] > TRAFFIC_VISUAL_BUDGET[key]) throw new Error(key);
    document.querySelector('#status').textContent = 'PASS: live WebGL rendering, distance detail, retained buffers, day/night lamps and resource limits.';
  } catch (error) { document.querySelector('#status').textContent = `FAIL: ${error.message}`; }
  detail.value = previousDetail; lighting.value = previousLighting; update();
});
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); update();
}
window.addEventListener('resize', resize); resize();
let lastTime;
renderer.setAnimationLoop(time => {
  const dt = lastTime === undefined ? 0 : Math.min(0.1, (time - lastTime) / 1000); lastTime = time;
  if (rolling.checked) seconds += dt;
  update();
});
