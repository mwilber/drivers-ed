import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSceneryVisuals, SCENERY_BUDGET } from '../src/scenery-visuals.ts';
import { HOUSES, PARK_PAVILION, MEWS_MARKET, PAVED_SURFACES, DRIVEWAYS, SIDEWALKS, ROAD_HEIGHT, SIDEWALK_HEIGHT } from '../src/world-layout.ts';
import { LIGHTING } from '../src/driving-conditions.ts';

const canvas = document.querySelector('#review');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, 0.05, 600);
const controls = new OrbitControls(camera, canvas);
controls.minDistance = 10; controls.maxDistance = 120; controls.maxPolarAngle = Math.PI / 2 - 0.03;
const sky = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight(); scene.add(sky, sun);
sun.position.set(-80, 130, -60);
const cube = new THREE.BoxGeometry(1, 1, 1), materials = new Map();
function surface(rect, height, color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  const mesh = new THREE.Mesh(cube, materials.get(color));
  mesh.position.set(rect.x, height / 2, rect.z); mesh.scale.set(rect.width, height, rect.depth); scene.add(mesh);
}
surface({ x: 0, z: 0, width: 1800, depth: 1800 }, 0.001, 0x879e6b);
for (const rect of SIDEWALKS) surface(rect, SIDEWALK_HEIGHT, 0xc9c8b9);
for (const rect of PAVED_SURFACES) surface(rect, ROAD_HEIGHT, 0x596168);
for (const rect of DRIVEWAYS) surface(rect, ROAD_HEIGHT, 0xb8b9aa);
const scenery = createSceneryVisuals(scene), full = scenery.stats();
const retained = scenery.group.children.map(m => [m.geometry, m.material, m.instanceMatrix.array]);
const locations = { town: HOUSES.find(h => h.x === -51 && h.z === 39), park: PARK_PAVILION, mews: MEWS_MARKET };
const location = document.querySelector('#location'), lighting = document.querySelector('#lighting'), detail = document.querySelector('#detail');
function update() {
  const setting = LIGHTING[lighting.value];
  scene.background = new THREE.Color(setting.sky);
  sky.color.setHex(setting.skyLight); sky.groundColor.setHex(setting.groundLight); sky.intensity = setting.ambient;
  sun.color.setHex(setting.sunColor); sun.intensity = setting.sun;
  scenery.update(detail.value === 'near' ? locations[location.value] : { x: 10000, z: 10000 });
  renderer.render(scene, camera);
  const stats = scenery.stats();
  document.querySelector('#resources').textContent = `${stats.drawCalls} scenery draws/view · ${stats.triangles.toLocaleString()} triangles · ${stats.geometryBytes.toLocaleString()} retained geometry/instance bytes`;
}
function focus() {
  const house = locations[location.value];
  controls.target.set(house.x, 3.5, house.z);
  camera.position.set(house.x - 18, 12, house.z - 25); controls.update(); update();
}
location.addEventListener('change', focus);
for (const element of [lighting, detail]) element.addEventListener('change', update);
document.querySelector('#check').addEventListener('click', () => {
  const previous = detail.value;
  try {
    detail.value = 'near'; update(); const near = scenery.stats();
    const silhouettes = scenery.group.children.filter(m => m.castShadow).map(m => [m, m.count]);
    detail.value = 'far'; update(); const far = scenery.stats();
    if (far.triangles >= near.triangles || far.geometryBytes !== near.geometryBytes) throw new Error('Distance detail/buffer retention');
    if (silhouettes.some(([mesh, count]) => mesh.count !== count)) throw new Error('Missing distant silhouette');
    scenery.group.children.forEach((m, i) => {
      if (m.geometry !== retained[i][0] || m.material !== retained[i][1] || m.instanceMatrix.array !== retained[i][2]) throw new Error('Resource replacement');
      if (m.count && !Number.isFinite(m.boundingSphere.radius)) throw new Error('Invalid instance bounds');
    });
    for (const key of ['drawCalls', 'triangles', 'geometryBytes']) if (full[key] > SCENERY_BUDGET[key]) throw new Error(key);
    document.querySelector('#status').textContent = 'PASS: live WebGL rendering, persistent silhouettes, distance detail, retained buffers and scenery budgets.';
  } catch (error) { document.querySelector('#status').textContent = `FAIL: ${error.message}`; }
  detail.value = previous; update();
});
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); update();
}
window.addEventListener('resize', resize); focus(); resize();
renderer.setAnimationLoop(update);
