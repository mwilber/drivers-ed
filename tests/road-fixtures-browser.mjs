import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRoadVisuals, ROAD_FIXTURE_BUDGET } from '../src/road-visuals.ts';
import { createPavementVisuals } from '../src/pavement-visuals.ts';
import { createSceneryVisuals } from '../src/scenery-visuals.ts';
import { ROAD_SIGNS, SIGNAL_FIXTURES } from '../src/traffic-layout.ts';
import { LIGHTING } from '../src/driving-conditions.ts';

const canvas = document.querySelector('#review');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, 0.05, 600);
const sky = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight(); scene.add(sky, sun); sun.position.set(-80, 130, -60);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshStandardMaterial({ color: 0x879e6b, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const pavement = createPavementVisuals(scene), scenery = createSceneryVisuals(scene), fixtures = createRoadVisuals(scene);
const controls = new OrbitControls(camera, canvas); controls.minDistance = 2; controls.maxDistance = 120; controls.maxPolarAngle = Math.PI / 2 - 0.03;
const locations = {
  signals: SIGNAL_FIXTURES.find(s => s.direction.z === -1),
  stops: ROAD_SIGNS.find(s => s.allWay && s.direction.z === -1),
  yield: ROAD_SIGNS.find(s => s.kind === 'yield'),
  mews: ROAD_SIGNS.find(s => s.id.startsWith('speed-mews') && s.mph === 15),
  parking: ROAD_SIGNS.find(s => s.kind === 'parking'),
};
const location = document.querySelector('#location'), side = document.querySelector('#side'), lighting = document.querySelector('#lighting'), phase = document.querySelector('#phase');
const retained = fixtures.group.children.map(m => [m.geometry, m.material, m.instanceMatrix.array, m.material.map]);
function update() {
  const setting = LIGHTING[lighting.value], point = locations[location.value];
  scene.background = new THREE.Color(setting.sky);
  sky.color.setHex(setting.skyLight); sky.groundColor.setHex(setting.groundLight); sky.intensity = setting.ambient;
  sun.color.setHex(setting.sunColor); sun.intensity = setting.sun;
  fixtures.update(Number(phase.value)); pavement.update(point, 'dry'); scenery.update(point);
  renderer.render(scene, camera); const stats = fixtures.stats();
  document.querySelector('#resources').textContent = `${stats.drawCalls} fixture draws/view · ${stats.triangles.toLocaleString()} triangles · ${stats.geometryBytes.toLocaleString()} geometry/instance bytes · ${(stats.textureBytes / 1048576).toFixed(2)} MiB base texture pixels`;
}
function focus() {
  const point = locations[location.value], signal = location.value === 'signals', back = side.value === 'back' ? -1 : 1;
  controls.target.set(point.x, signal ? 5.2 : 2.2, point.z);
  camera.position.set(point.x - point.direction.x * back * 7 + point.direction.z * 2.5,
    signal ? 4.6 : 3.4, point.z - point.direction.z * back * 7 - point.direction.x * 2.5);
  controls.update(); update();
}
for (const element of [location, side]) element.addEventListener('change', focus);
for (const element of [lighting, phase]) element.addEventListener('change', update);
controls.addEventListener('change', update);

/** Compare all 91 production face/arrow instances with the previous per-mesh plane transforms.
 * This temporary 64² target is created only by the review button, never by free driving. */
function checkDecalPixels() {
  const target = new THREE.WebGLRenderTarget(64, 64), a = new Uint8Array(64 * 64 * 4), b = new Uint8Array(a.length);
  const fixture = new THREE.Scene(); fixture.add(new THREE.AmbientLight(0xffffff, 2.5));
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const previousTarget = renderer.getRenderTarget(); let difference = 0, probes = 0;
  try {
    for (const batch of fixtures.group.children.filter(m => m.name.startsWith('Sign faces:') || m.name.startsWith('Lane arrows:'))) {
      const instanced = new THREE.InstancedMesh(batch.geometry, batch.material, 1);
      try {
        for (let i = 0; i < batch.count; i++) {
          batch.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
          const geometry = new THREE.PlaneGeometry(scale.x, scale.y), reference = new THREE.Mesh(geometry, batch.material);
          reference.position.copy(position); reference.quaternion.copy(rotation);
          const view = new THREE.OrthographicCamera(-scale.x / 2, scale.x / 2, scale.y / 2, -scale.y / 2, 0.1, 20);
          view.position.copy(position).add(new THREE.Vector3(0, 0, 10).applyQuaternion(rotation));
          view.up.set(0, 1, 0).applyQuaternion(rotation); view.lookAt(position);
          try {
            fixture.add(reference); renderer.setRenderTarget(target); renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, a); fixture.remove(reference);
            instanced.setMatrixAt(0, matrix); instanced.instanceMatrix.needsUpdate = true; instanced.computeBoundingSphere(); fixture.add(instanced);
            renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, b); fixture.remove(instanced);
            if (a.filter((_, j) => j % 4 === 0).every(v => v === 0)) throw new Error(`Empty decal: ${batch.name}`);
            for (let j = 0; j < a.length; j++) difference = Math.max(difference, Math.abs(a[j] - b[j])); probes++;
          } finally { fixture.remove(reference, instanced); geometry.dispose(); }
        }
      } finally { instanced.dispose(); }
    }
    if (difference > 1) throw new Error(`Decal pixels differ by ${difference}/255`);
    return { difference, probes };
  } finally { renderer.setRenderTarget(previousTarget); target.dispose(); }
}

/** Exercise the driving camera's 0.035/900 m depth range with the real metal backing.
 * Compare only opaque face interiors; the new metal rim legitimately changes corner pixels. */
function checkDistantFaces() {
  const target = new THREE.WebGLRenderTarget(64, 64), a = new Uint8Array(64 * 64 * 4), b = new Uint8Array(a.length);
  const fixture = new THREE.Scene(); fixture.add(new THREE.AmbientLight(0xffffff, 2.5));
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const previousTarget = renderer.getRenderTarget(); let difference = 0, samples = 0, worst = '';
  try {
    for (const batch of fixtures.group.children.filter(m => m.name.startsWith('Sign faces:'))) {
      const shape = batch.name.includes('stop-') ? 'stop' : batch.name.includes('yield-') ? 'yield' : 'rectangle';
      const backing = fixtures.group.getObjectByName(`Sign backs: ${shape}`);
      const face = new THREE.InstancedMesh(batch.geometry, batch.material, 1), back = new THREE.InstancedMesh(backing.geometry, backing.material, 1);
      batch.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
      face.setMatrixAt(0, matrix); back.setMatrixAt(0, matrix); face.computeBoundingSphere(); back.computeBoundingSphere();
      const image = batch.material.map.image, pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      try {
        for (const distance of [20, 60, 120]) {
          const view = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(scale.y / (2 * distance))), scale.x / scale.y, 0.035, 900);
          view.position.copy(position).add(new THREE.Vector3(0, 0, distance).applyQuaternion(rotation)); view.up.set(0, 1, 0).applyQuaternion(rotation); view.lookAt(position);
          fixture.add(face); renderer.setRenderTarget(target); renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, a);
          fixture.add(back); renderer.render(fixture, view); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, b); fixture.remove(face, back);
          for (let row = 1; row < 63; row++) for (let col = 1; col < 63; col++) {
            const x = Math.floor((col + 0.5) * image.width / 64), y = Math.floor((63.5 - row) * image.height / 64);
            const opaque = [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => pixels[((y + dy * 8) * image.width + x + dx * 8) * 4 + 3] === 255));
            if (!opaque) continue;
            const index = (row * 64 + col) * 4;
            for (let channel = 0; channel < 3; channel++) {
              const delta = Math.abs(a[index + channel] - b[index + channel]);
              if (delta > difference) { difference = delta; worst = `${batch.name} at ${distance} m, pixel ${col},${row}: ${a[index + channel]} vs ${b[index + channel]}`; }
            }
            samples++;
          }
        }
      } finally { fixture.remove(face, back); face.dispose(); back.dispose(); }
    }
    if (!samples || difference > 1) throw new Error(`Distant sign faces differ by ${difference}/255 (${worst})`);
    return difference;
  } finally { renderer.setRenderTarget(previousTarget); target.dispose(); }
}
document.querySelector('#check').addEventListener('click', () => {
  try {
    const parity = checkDecalPixels(), distantDifference = checkDistantFaces();
    for (const time of [0, 14, 17, 19, 33, 36, 38, 0]) {
      fixtures.update(time); const stats = fixtures.stats();
      for (const key of Object.keys(ROAD_FIXTURE_BUDGET)) if (stats[key] > ROAD_FIXTURE_BUDGET[key]) throw new Error(key);
      if (fixtures.group.children.filter(m => m.name.startsWith('Signal lenses:')).reduce((sum, m) => sum + m.count, 0) !== SIGNAL_FIXTURES.length * 3) throw new Error('Missing lens');
      fixtures.group.children.forEach((m, i) => {
        if (m.geometry !== retained[i][0] || m.material !== retained[i][1] || m.instanceMatrix.array !== retained[i][2] || m.material.map !== retained[i][3]) throw new Error('Resource replacement');
        if (m.count && !Number.isFinite(m.boundingSphere.radius)) throw new Error('Invalid instance bounds');
      });
    }
    document.querySelector('#status').textContent = `PASS: live WebGL, ${parity.probes} decal probes (${parity.difference}/255 pixel difference), distant sign faces (${distantDifference}/255), signal reset, retained buffers and budgets.`;
  } catch (error) { document.querySelector('#status').textContent = `FAIL: ${error.message}`; }
  update();
});
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); update();
}
window.addEventListener('resize', resize); focus(); resize();
