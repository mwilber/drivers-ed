import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createPavementVisuals, SURFACE_JOINTS, PAVEMENT_BUDGET } from '../src/pavement-visuals.ts';
import { PAVED_SURFACES, SIDEWALKS, DRIVEWAYS, ROAD_HEIGHT, SIDEWALK_HEIGHT } from '../src/world-layout.ts';
import { ROAD_PAINT, YIELD_PAINT } from '../src/road-paint.ts';
import { APPROACHES } from '../src/traffic-layout.ts';
import { CROSSINGS, STREETS, parkingMarkings } from '../src/road-network.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';

const matrix = new THREE.Matrix4();
function boxes(mesh) {
  mesh.geometry.computeBoundingBox();
  return Array.from({ length: mesh.count }, (_, i) => { mesh.getMatrixAt(i, matrix); return mesh.geometry.boundingBox.clone().applyMatrix4(matrix); });
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 3e-5, `${actual} != ${expected}`); }
function contains(rect, point, margin = 0) { return Math.abs(point.x - rect.x) <= rect.width / 2 - margin && Math.abs(point.z - rect.z) <= rect.depth / 2 - margin; }

test('batched pavement and curb boxes retain every authored surface footprint and Rapier height', async t => {
  const visuals = createPavementVisuals(new THREE.Scene());
  const sim = await createVehiclePhysics(); t.after(() => sim.dispose());
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  for (const [name, rects, height] of [['Asphalt', PAVED_SURFACES, ROAD_HEIGHT], ['Sidewalks', SIDEWALKS, SIDEWALK_HEIGHT], ['Driveways', DRIVEWAYS, ROAD_HEIGHT]]) {
    const mesh = visuals.group.getObjectByName(name), bounds = boxes(mesh);
    assert.equal(mesh.count, rects.length); assert.ok(mesh.castShadow && mesh.receiveShadow);
    rects.forEach((rect, i) => {
      close(bounds[i].min.x, rect.x - rect.width / 2); close(bounds[i].max.x, rect.x + rect.width / 2);
      close(bounds[i].min.z, rect.z - rect.depth / 2); close(bounds[i].max.z, rect.z + rect.depth / 2);
      close(bounds[i].min.y, 0); close(bounds[i].max.y, height);
      // Ground/ramp/house overlays already exist on some surfaces; inspect clear centers.
      if (name === 'Sidewalks' || name === 'Driveways') {
        const hit = sim.world.castRay(new RAPIER.Ray({ x: rect.x, y: 0.5, z: rect.z }, { x: 0, y: -1, z: 0 }), 0.6, true);
        assert.ok(hit); close(0.5 - hit.timeOfImpact, height);
      }
    });
  }
});

test('concrete joints stay flat and inset inside their sidewalk or driveway, including all cut openings', () => {
  const visuals = createPavementVisuals(new THREE.Scene()), joints = visuals.group.getObjectByName('Concrete joints');
  const bounds = boxes(joints); assert.equal(bounds.length, SURFACE_JOINTS.length); assert.ok(!joints.castShadow);
  for (let i = 0; i < bounds.length; i++) {
    const joint = SURFACE_JOINTS[i], b = bounds[i], sidewalk = joint.elevation > SIDEWALK_HEIGHT;
    close(b.min.y, joint.elevation); close(b.max.y, joint.elevation);
    const sources = sidewalk ? SIDEWALKS : DRIVEWAYS;
    assert.ok(sources.some(rect => contains(rect, { x: b.min.x, z: b.min.z }, 0.05) && contains(rect, { x: b.max.x, z: b.max.z }, 0.05)));
    if (sidewalk) assert.ok(![...PAVED_SURFACES, ...DRIVEWAYS].some(rect => contains(rect, joint)), 'no seam across a flush opening');
  }
});

test('all control bars, crosswalk stripes, parking bays and yield teeth survive batching and distant detail', () => {
  const visuals = createPavementVisuals(new THREE.Scene());
  for (const approach of APPROACHES.filter(a => a.line && a.kind !== 'yield')) {
    assert.equal(ROAD_PAINT.filter(p => p.color === 0xf3f1df && p.x === approach.line.x && p.z === approach.line.z && p.width === approach.line.width && p.depth === approach.line.depth).length, 1);
  }
  for (const crossing of CROSSINGS) {
    const horizontal = !!crossing.direction.x;
    const stripes = ROAD_PAINT.filter(p => p.color === 0xf3f1df && (horizontal ? p.x === crossing.x && p.width === 2 && p.depth === 0.5 : p.z === crossing.z && p.width === 0.5 && p.depth === 2));
    assert.equal(stripes.filter(p => contains(crossing, p)).length, STREETS.find(s => s.id === crossing.streetId).width);
  }
  const parking = ROAD_PAINT.filter(p => p.elevation === 0.004);
  assert.deepEqual(parking.map(({ elevation, ...p }) => p), parkingMarkings().map(p => ({ ...p, color: 0xe9e7da })));
  for (const mesh of visuals.group.children.filter(m => m.name.startsWith('Paint'))) {
    const color = mesh.material.color.getHex(), paint = ROAD_PAINT.filter(p => p.color === color), bounds = boxes(mesh);
    assert.equal(bounds.length, paint.length); assert.ok(!mesh.castShadow);
    paint.forEach((p, i) => {
      close(bounds[i].min.x, p.x - p.width / 2); close(bounds[i].max.x, p.x + p.width / 2);
      close(bounds[i].min.z, p.z - p.depth / 2); close(bounds[i].max.z, p.z + p.depth / 2);
      close(bounds[i].max.y, ROAD_HEIGHT + p.elevation + 0.003);
    });
  }
  const teeth = visuals.group.getObjectByName('Yield triangles'), positions = teeth.geometry.attributes.position;
  assert.equal(teeth.count, APPROACHES.filter(a => a.kind === 'yield').length * 5);
  YIELD_PAINT.forEach((paint, i) => {
    teeth.getMatrixAt(i, matrix);
    const approach = APPROACHES.find(a => a.kind === 'yield' && Math.hypot(a.x - paint.x, a.z - paint.z) < 2);
    const u = approach.direction, offset = -(paint.x - approach.x) * u.z + (paint.z - approach.z) * u.x;
    const expected = [
      { x: approach.x - u.z * offset + u.x * 0.4, z: approach.z + u.x * offset + u.z * 0.4 },
      { x: approach.x - u.z * offset - u.x * 0.3 - u.z * 0.3, z: approach.z + u.x * offset - u.z * 0.3 + u.x * 0.3 },
      { x: approach.x - u.z * offset - u.x * 0.3 + u.z * 0.3, z: approach.z + u.x * offset - u.z * 0.3 - u.x * 0.3 },
    ];
    expected.forEach((p, vertex) => { const actual = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(matrix); close(actual.x, p.x); close(actual.z, p.z); close(actual.y, ROAD_HEIGHT + 0.012); });
  });
  const counts = visuals.group.children.filter(m => m.name !== 'Concrete joints').map(m => m.count);
  visuals.update({ x: 10000, z: 10000 }, 'dry');
  assert.deepEqual(visuals.group.children.filter(m => m.name !== 'Concrete joints').map(m => m.count), counts);
});

test('fine joints use 100/115 m hysteresis, reappear without allocation, and wet asphalt restores exactly', t => {
  const visuals = createPavementVisuals(new THREE.Scene()), full = visuals.stats(); t.diagnostic(JSON.stringify(full));
  for (const key of ['drawCalls', 'triangles', 'geometryBytes', 'textureBytes']) assert.ok(full[key] <= PAVEMENT_BUDGET[key], key);
  const meshes = visuals.group.children, retained = meshes.map(m => [m.geometry, m.material, m.instanceMatrix.array]), map = visuals.asphalt.map;
  const joint = SURFACE_JOINTS[0], joints = visuals.group.getObjectByName('Concrete joints');
  function hasJoint() {
    return Array.from({ length: joints.count }, (_, i) => { joints.getMatrixAt(i, matrix); return Math.hypot(matrix.elements[12] - joint.x, matrix.elements[14] - joint.z) < 1e-4; }).some(Boolean);
  }
  for (const [distance, expected] of [[99, true], [110, true], [116, false], [110, false], [99, true]]) {
    visuals.update({ x: joint.x - distance, z: joint.z }, 'dry'); assert.equal(hasJoint(), expected);
  }
  for (let i = 0; i < 10; i++) {
    visuals.update({ x: 10000, z: 10000 }, 'rain'); assert.equal(joints.count, 0);
    assert.equal(visuals.asphalt.color.getHex(), 0x444d55); assert.equal(visuals.asphalt.roughness, 0.42);
    visuals.update(joint, 'dry'); assert.ok(hasJoint());
    assert.equal(visuals.asphalt.color.getHex(), 0x596168); assert.equal(visuals.asphalt.roughness, 0.92);
  }
  assert.equal(visuals.asphalt.map, map);
  meshes.forEach((mesh, i) => {
    assert.equal(mesh.geometry, retained[i][0]); assert.equal(mesh.material, retained[i][1]); assert.equal(mesh.instanceMatrix.array, retained[i][2]);
    if (mesh.count) assert.ok(Number.isFinite(mesh.boundingSphere.radius));
  });
  assert.equal(visuals.stats().geometryBytes, full.geometryBytes);
});
