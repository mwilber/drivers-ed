import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSceneryVisuals, SCENERY_BUDGET } from '../src/scenery-visuals.ts';
import { HOUSES, PARK_PAVILION, MEWS_MARKET } from '../src/world-layout.ts';
import { LANES } from '../src/traffic-layout.ts';

const matrix = new THREE.Matrix4();
function nearestHouse(point) {
  return HOUSES.reduce((nearest, house) => Math.hypot(point.x - house.x, point.z - house.z)
    < Math.hypot(point.x - nearest.x, point.z - nearest.z) ? house : nearest);
}

test('varied roofs and eaves retain the original overhead envelope; low facade detail hugs each collider', () => {
  const scenery = createSceneryVisuals(new THREE.Scene());
  const roofs = scenery.group.children.filter(m => /roof/.test(m.geometry.name));
  assert.equal(roofs.reduce((sum, m) => sum + m.count, 0), HOUSES.length);
  assert.ok(roofs.some(m => m.geometry.name === 'Gabled roof'));
  assert.ok(roofs.some(m => m.geometry.name === 'Hipped roof'));
  for (const mesh of scenery.group.children.filter(m => /roof|Facade|Siding/.test(m.geometry.name))) {
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(matrix), house = nearestHouse(bounds.getCenter(new THREE.Vector3()));
      const roof = /roof/.test(mesh.geometry.name), overhead = bounds.min.y >= house.height - 1e-5;
      const allowance = overhead ? 0.80001 : 0.02001;
      assert.ok(bounds.min.x >= house.x - house.width / 2 - allowance && bounds.max.x <= house.x + house.width / 2 + allowance);
      assert.ok(bounds.min.z >= house.z - house.depth / 2 - allowance && bounds.max.z <= house.z + house.depth / 2 + allowance);
      assert.ok(bounds.min.y >= -1e-5 && bounds.max.y <= house.height + 3.5 + 1e-5);
      if (roof) {
        assert.ok(Math.abs(bounds.min.y - house.height) < 1e-5);
        assert.ok(Math.abs(bounds.max.y - house.height - 3.5) < 1e-5);
        if (house === PARK_PAVILION || house === MEWS_MARKET) assert.equal(mesh.geometry.name, 'Hipped roof');
      }
    }
  }
});

test('new building detail leaves forward lane-edge and rear sightlines clear across the network', () => {
  const scenery = createSceneryVisuals(new THREE.Scene()); scenery.group.updateMatrixWorld(true);
  for (const lane of LANES) {
    const origin = new THREE.Vector3(lane.start.x, 1.22, lane.start.z);
    for (const offset of [-lane.width / 2, 0, lane.width / 2]) {
      const target = new THREE.Vector3(lane.end.x - lane.direction.z * offset, 1.22, lane.end.z + lane.direction.x * offset);
      const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target));
      assert.deepEqual(ray.intersectObject(scenery.group, true), [], `${lane.id} at edge ${offset}`);
    }
  }
});

test('side windows obey the shared 100/115 m hysteresis, while roof silhouettes and buffers persist', t => {
  const scenery = createSceneryVisuals(new THREE.Scene()), full = scenery.stats();
  t.diagnostic(JSON.stringify(full));
  for (const key of ['drawCalls', 'triangles', 'geometryBytes']) assert.ok(full[key] <= SCENERY_BUDGET[key], key);
  const resources = scenery.group.children.map(m => [m.geometry, m.material, m.instanceMatrix.array]);
  const house = HOUSES[0];
  const origin = new THREE.Vector3(house.x - house.width / 2 - 2, 3.2, house.z + house.depth * 0.27);
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(1, 0, 0), 0, 2.1);
  function glassVisible() {
    scenery.group.updateMatrixWorld(true);
    return ray.intersectObject(scenery.group, true).some(hit => hit.object.material.color.getHex() === 0x364b57);
  }
  scenery.update({ x: house.x - 99, z: house.z }); assert.ok(glassVisible());
  scenery.update({ x: house.x - 110, z: house.z }); assert.ok(glassVisible());
  scenery.update({ x: house.x - 116, z: house.z }); assert.ok(!glassVisible());
  scenery.update({ x: house.x - 110, z: house.z }); assert.ok(!glassVisible());
  scenery.update({ x: house.x - 99, z: house.z }); assert.ok(glassVisible());
  const roofCounts = scenery.group.children.filter(m => /roof/.test(m.geometry.name)).map(m => m.count);
  for (let i = 0; i < 10; i++) {
    scenery.update({ x: 10000, z: 10000 }); assert.ok(!glassVisible());
    assert.deepEqual(scenery.group.children.filter(m => /roof/.test(m.geometry.name)).map(m => m.count), roofCounts);
    scenery.update(house); assert.ok(glassVisible());
  }
  scenery.group.children.forEach((m, i) => {
    assert.equal(m.geometry, resources[i][0]); assert.equal(m.material, resources[i][1]); assert.equal(m.instanceMatrix.array, resources[i][2]);
    if (m.count) assert.ok(Number.isFinite(m.boundingSphere.radius));
  });
});
