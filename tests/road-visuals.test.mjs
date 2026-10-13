import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRoadVisuals, ROAD_FIXTURE_BUDGET } from '../src/road-visuals.ts';
import { ROAD_SIGNS, ROAD_POSTS, SIGNAL_FIXTURES, LANE_ARROWS, APPROACHES, LANES } from '../src/traffic-layout.ts';
import { ROAD_HEIGHT } from '../src/world-layout.ts';
import { signalState, SIGNAL_CYCLE } from '../src/traffic-rules.ts';

// Geometry/resource tests don't rasterize text; the live browser review checks real canvas pixels.
function canvasFactory(width, height) {
  const context = Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillText', 'fillRect', 'strokeRect', 'save', 'translate', 'rotate', 'restore', 'quadraticCurveTo'].map(k => [k, () => {}]));
  return { width, height, getContext: () => context };
}
const matrix = new THREE.Matrix4(), vector = new THREE.Vector3();
function close(a, b) { assert.ok(Math.abs(a - b) < 3e-5, `${a} != ${b}`); }
function fixture() { return createRoadVisuals(new THREE.Scene(), canvasFactory); }

test('batched metal posts retain every physical footprint and signal booms stay overhead', () => {
  const visuals = fixture(), mesh = visuals.group.getObjectByName('Metal supports');
  assert.equal(mesh.count, ROAD_POSTS.length + SIGNAL_FIXTURES.length);
  mesh.geometry.computeBoundingBox();
  ROAD_POSTS.forEach((post, i) => {
    mesh.getMatrixAt(i, matrix); const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
    close(bounds.min.x, post.x - post.width / 2); close(bounds.max.x, post.x + post.width / 2);
    close(bounds.min.z, post.z - post.depth / 2); close(bounds.max.z, post.z + post.depth / 2);
    close(bounds.min.y, 0); close(bounds.max.y, post.height);
  });
  SIGNAL_FIXTURES.forEach((s, i) => {
    mesh.getMatrixAt(ROAD_POSTS.length + i, matrix);
    for (const sign of [-1, 1]) {
      vector.set(sign * 0.5, 0, 0).applyMatrix4(matrix);
      const endpoint = sign < 0 ? s.pole : s;
      close(vector.x, endpoint.x); close(vector.z, endpoint.z); close(vector.y, 5.7);
    }
  });
});

test('every sign face and all-way plaque preserves its dimensions, elevation and approach-facing orientation', () => {
  const visuals = fixture();
  for (const mesh of visuals.group.children.filter(m => m.name.startsWith('Sign faces:'))) {
    const plaque = mesh.name.endsWith('all-way');
    const signs = ROAD_SIGNS.filter(s => plaque ? s.allWay : mesh.name === `Sign faces: ${s.kind}-${s.mph ?? ''}`);
    assert.equal(mesh.count, signs.length); assert.ok(!mesh.castShadow && !mesh.receiveShadow);
    assert.ok(mesh.material.alphaTest === 0.1 && mesh.material.emissiveIntensity === 0.15);
    signs.forEach((s, i) => {
      const shared = s.kind === 'speed' && ROAD_SIGNS.some(other => other.kind !== 'speed' && other.x === s.x && other.z === s.z);
      const width = plaque ? 0.8 : s.kind === 'speed' ? 0.9 : 1.1, height = plaque ? 0.2 : s.kind === 'speed' ? 1.2 : 1.1;
      mesh.getMatrixAt(i, matrix);
      close(matrix.elements[12], s.x - s.direction.x * 0.08); close(matrix.elements[14], s.z - s.direction.z * 0.08);
      close(matrix.elements[13], plaque ? 1.97 : shared ? 1.25 : 2.65);
      vector.setFromMatrixScale(matrix); close(vector.x, width); close(vector.y, height);
      vector.set(0, 0, 1).transformDirection(matrix); close(vector.x, -s.direction.x); close(vector.z, -s.direction.z);
    });
  }
  assert.equal(visuals.group.children.filter(m => m.name.startsWith('Sign faces:')).reduce((sum, m) => sum + m.count, 0), ROAD_SIGNS.length + ROAD_SIGNS.filter(s => s.allWay).length);
  const backs = visuals.group.children.filter(m => m.name.startsWith('Sign backs:'));
  assert.equal(backs.reduce((sum, m) => sum + m.count, 0), ROAD_SIGNS.length + 4);
  for (const mesh of backs) {
    assert.ok(mesh.material.polygonOffset && mesh.material.polygonOffsetUnits > 0, 'metal backs are biased behind readable distant faces');
    mesh.geometry.computeBoundingBox(); const b = mesh.geometry.boundingBox;
    assert.ok(b.min.x >= -0.500001 && b.max.x <= 0.500001 && b.min.y >= -0.500001 && b.max.y <= 0.500001);
    close(b.min.z, -0.037); close(b.max.z, -0.002);
  }
  assert.equal(backs.find(m => m.name.endsWith('stop')).count, ROAD_SIGNS.filter(s => s.kind === 'stop').length);
  assert.equal(backs.find(m => m.name.endsWith('yield')).count, ROAD_SIGNS.filter(s => s.kind === 'yield').length);
});

test('batched arrow decals retain every lane movement, paint height and exact old transform', () => {
  const visuals = fixture(), expected = new THREE.Object3D();
  for (const mesh of visuals.group.children.filter(m => m.name.startsWith('Lane arrows:'))) {
    const arrows = LANE_ARROWS.filter(a => mesh.name === `Lane arrows: ${a.turns.slice().sort().join(',')}`);
    assert.equal(mesh.count, arrows.length); assert.ok(!mesh.castShadow && mesh.receiveShadow && !mesh.material.depthWrite);
    arrows.forEach((a, i) => {
      expected.position.set(a.x, ROAD_HEIGHT + 0.012, a.z); expected.scale.set(2.8, 3.8, 1);
      expected.rotation.set(-Math.PI / 2, 0, Math.atan2(-a.direction.x, -a.direction.z)); expected.updateMatrix();
      mesh.getMatrixAt(i, matrix); matrix.elements.forEach((n, j) => close(n, expected.matrix.elements[j]));
    });
  }
  assert.equal(visuals.group.children.filter(m => m.name.startsWith('Lane arrows:')).reduce((sum, m) => sum + m.count, 0), LANE_ARROWS.length);
});

test('signal lenses preserve the exact cycle and reset with retained buffers, visible approach rays and bounded resources', t => {
  const visuals = fixture(), meshes = visuals.group.children;
  const retained = meshes.map(m => [m.geometry, m.material, m.instanceMatrix.array, m.material.map]);
  t.diagnostic(JSON.stringify(visuals.stats()));
  assert.equal(new Set(meshes.filter(m => m.material.map).map(m => m.material.map)).size, 14, '7 sign faces, one shared all-way plaque, 6 arrow images');
  assert.equal(meshes.find(m => m.name === 'Sign faces: all-way').material.map.image.width, 512);
  assert.equal(meshes.find(m => m.name === 'Sign faces: all-way').material.map.image.height, 128);
  for (const seconds of [0, 14, 17, 19, 33, 36, 38, 0, ...Array.from({ length: SIGNAL_CYCLE * 10 }, (_, i) => i / 10)]) {
    visuals.update(seconds); const state = signalState(seconds), stats = visuals.stats();
    for (const key of Object.keys(ROAD_FIXTURE_BUDGET)) assert.ok(stats[key] <= ROAD_FIXTURE_BUDGET[key], key);
    const lamps = meshes.filter(m => m.name.startsWith('Signal lenses:'));
    assert.equal(lamps.reduce((sum, m) => sum + m.count, 0), SIGNAL_FIXTURES.length * 3);
    for (const [color, index] of ['red', 'yellow', 'green'].map((c, i) => [c, i])) {
      const mesh = lamps.find(m => m.name.endsWith(`: ${color}`));
      const expected = SIGNAL_FIXTURES.filter(s => state[APPROACHES.find(a => a.id === s.approachId).signalGroup] === color);
      assert.equal(mesh.count, expected.length);
      expected.forEach((s, i) => {
        mesh.getMatrixAt(i, matrix); close(matrix.elements[13], 5.2 + 0.49 - index * 0.49);
        close(matrix.elements[12], s.x - s.direction.x * 0.16); close(matrix.elements[14], s.z - s.direction.z * 0.16);
      });
    }
  }
  visuals.update(0); const versions = meshes.map(m => m.instanceMatrix.version); visuals.update(1);
  assert.deepEqual(meshes.map(m => m.instanceMatrix.version), versions, 'no uploads between color changes');
  meshes.forEach((m, i) => {
    assert.equal(m.geometry, retained[i][0]); assert.equal(m.material, retained[i][1]); assert.equal(m.instanceMatrix.array, retained[i][2]); assert.equal(m.material.map, retained[i][3]);
    if (m.count) assert.ok(Number.isFinite(m.boundingSphere.radius));
  });
  visuals.group.updateMatrixWorld(true);
  for (const s of SIGNAL_FIXTURES) {
    const approach = APPROACHES.find(a => a.id === s.approachId), state = signalState(0);
    const index = ['red', 'yellow', 'green'].indexOf(state[approach.signalGroup]);
    for (const distance of [8, 20, 40]) for (const offset of [-2, 0, 2]) {
      const origin = new THREE.Vector3(approach.x - s.direction.x * distance - s.direction.z * offset, 1.22, approach.z - s.direction.z * distance + s.direction.x * offset);
      const target = new THREE.Vector3(s.x - s.direction.x * 0.16, 5.2 + 0.49 - index * 0.49, s.z - s.direction.z * 0.16);
      const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target) + 0.01);
      const hit = ray.intersectObject(visuals.group, true)[0];
      assert.ok(hit?.object.name === `Signal lenses: ${state[approach.signalGroup]}`, `unobstructed lamp at ${approach.id}, ${distance} m, offset ${offset}`);
    }
  }
  for (const lane of LANES) for (const offset of [-lane.width / 2, 0, lane.width / 2]) {
    const origin = new THREE.Vector3(lane.start.x - lane.direction.z * offset, 1.22, lane.start.z + lane.direction.x * offset);
    const target = new THREE.Vector3(lane.end.x - lane.direction.z * offset, 1.22, lane.end.z + lane.direction.x * offset);
    assert.deepEqual(new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target)).intersectObject(visuals.group, true), [], `${lane.id} low sightline`);
  }
  let lights = 0; visuals.group.traverse(o => { lights += Number(!!o.isLight); }); assert.equal(lights, 0);
});
