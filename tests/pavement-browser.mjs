import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPavementVisuals, PAVEMENT_BUDGET } from '../src/pavement-visuals.ts';
import { createSceneryVisuals } from '../src/scenery-visuals.ts';
import { DRIVEWAYS, ROAD_HEIGHT } from '../src/world-layout.ts';

const canvas = document.querySelector('#review');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, 0.05, 600);
scene.background = new THREE.Color(0xc6dce3);
const controls = new OrbitControls(camera, canvas);
controls.minDistance = 5; controls.maxDistance = 120; controls.maxPolarAngle = Math.PI / 2 - 0.03;
scene.add(new THREE.HemisphereLight(0xe7f3ff, 0x728357, 2.5));
const sun = new THREE.DirectionalLight(0xffefd5, 3.1); sun.position.set(-80, 130, -60); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshStandardMaterial({ color: 0x879e6b, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const pavement = createPavementVisuals(scene), full = pavement.stats(), scenery = createSceneryVisuals(scene);
const retained = pavement.group.children.map(m => [m.geometry, m.material, m.instanceMatrix.array]);
const locations = { crossing: { x: 13, z: 60 }, driveway: DRIVEWAYS.find(d => d.x === -48 && d.z > 39), lot: { x: -51, z: -145 }, mews: { x: 122, z: 60 } };
const location = document.querySelector('#location'), weather = document.querySelector('#weather'), detail = document.querySelector('#detail');
function update() {
  const point = locations[location.value];
  pavement.update(detail.value === 'near' ? point : { x: 10000, z: 10000 }, weather.value);
  scenery.update(point); renderer.render(scene, camera);
  const stats = pavement.stats();
  document.querySelector('#resources').textContent = `${stats.drawCalls} pavement draws/view · ${stats.triangles.toLocaleString()} triangles · ${stats.geometryBytes.toLocaleString()} geometry/instance bytes · ${stats.textureBytes.toLocaleString()} texture bytes`;
}
function focus() {
  const point = locations[location.value]; controls.target.set(point.x, ROAD_HEIGHT, point.z);
  const driveway = location.value === 'driveway';
  camera.position.set(point.x - 10, driveway ? 5 : 8, point.z + (driveway ? 13 : -13)); controls.update(); update();
}
location.addEventListener('change', focus);
for (const element of [weather, detail]) element.addEventListener('change', update);

/** Compare the production instanced shader to the previous per-box world UVs.
 * The tiny temporary target belongs to this manual review, never free driving. */
function checkAsphaltUVs() {
  const target = new THREE.WebGLRenderTarget(64, 64), a = new Uint8Array(64 * 64 * 4), b = new Uint8Array(a.length);
  const fixture = new THREE.Scene(); fixture.add(new THREE.AmbientLight(0xffffff, 3));
  const referenceMaterial = pavement.asphalt.clone();
  referenceMaterial.onBeforeCompile = () => {}; referenceMaterial.customProgramCacheKey = () => 'reference-pavement-uv';
  const unit = new THREE.BoxGeometry(1, 1, 1), instanced = new THREE.InstancedMesh(unit, pavement.asphalt, 1), pose = new THREE.Object3D();
  const previousTarget = renderer.getRenderTarget(); let maxDifference = 0;
  try {
    for (const rect of [{ x: 1.3, z: -7.2, width: 12, depth: 5 }, { x: 218, z: 130, width: 8, depth: 120 }, { x: -0.7, z: -125, width: 120, depth: 90 }]) {
      const view = new THREE.OrthographicCamera(-rect.width / 2, rect.width / 2, rect.depth / 2, -rect.depth / 2, 0.1, 30);
      view.up.set(0, 0, -1); view.position.set(rect.x, 10, rect.z); view.lookAt(rect.x, 0, rect.z);
      const geometry = new THREE.BoxGeometry(rect.width, ROAD_HEIGHT, rect.depth), positions = geometry.attributes.position, uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + rect.x) * 0.5, (positions.getZ(i) + rect.z) * 0.5);
      const reference = new THREE.Mesh(geometry, referenceMaterial); reference.position.set(rect.x, ROAD_HEIGHT / 2, rect.z); fixture.add(reference);
      renderer.setRenderTarget(target); renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, a);
      fixture.remove(reference);
      pose.position.copy(reference.position); pose.scale.set(rect.width, ROAD_HEIGHT, rect.depth); pose.updateMatrix(); instanced.setMatrixAt(0, pose.matrix); instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere(); fixture.add(instanced);
      renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, b); fixture.remove(instanced);
      for (let i = 0; i < a.length; i++) maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
      if (a.filter((_, i) => i % 4 === 0).every(v => v === 0)) throw new Error('Empty asphalt probe');
      geometry.dispose();
    }
    if (maxDifference > 1) throw new Error(`World asphalt UVs (${maxDifference} pixel levels)`);
    return maxDifference;
  } finally { renderer.setRenderTarget(previousTarget); target.dispose(); unit.dispose(); referenceMaterial.dispose(); instanced.dispose(); }
}
document.querySelector('#check').addEventListener('click', () => {
  const previous = detail.value;
  try {
    const difference = checkAsphaltUVs();
    detail.value = 'near'; update(); const near = pavement.stats();
    const permanent = pavement.group.children.filter(m => m.name !== 'Concrete joints').map(m => [m, m.count]);
    detail.value = 'far'; update(); const far = pavement.stats();
    if (far.triangles >= near.triangles || far.geometryBytes !== near.geometryBytes) throw new Error('Joint detail/buffers');
    if (permanent.some(([mesh, count]) => mesh.count !== count)) throw new Error('Missing pavement or paint');
    pavement.group.children.forEach((mesh, i) => {
      if (mesh.geometry !== retained[i][0] || mesh.material !== retained[i][1] || mesh.instanceMatrix.array !== retained[i][2]) throw new Error('Resource replacement');
    });
    for (const key of ['drawCalls', 'triangles', 'geometryBytes', 'textureBytes']) if (full[key] > PAVEMENT_BUDGET[key]) throw new Error(key);
    document.querySelector('#status').textContent = `PASS: live WebGL, world UV parity (${difference}/255 maximum pixel difference), permanent paint, joint detail and resource budgets.`;
  } catch (error) { document.querySelector('#status').textContent = `FAIL: ${error.message}`; }
  detail.value = previous; update();
});
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); update();
}
window.addEventListener('resize', resize); focus(); resize(); renderer.setAnimationLoop(update);
