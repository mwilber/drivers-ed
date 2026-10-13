import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSceneryVisuals, SCENERY_BUDGET } from '../src/scenery-visuals.ts';
import { TREES, OBSTACLES } from '../src/world-layout.ts';

test('branched trees keep their collider-aligned stems and original foliage envelope', () => {
  const scenery = createSceneryVisuals(new THREE.Scene());
  const trunk = scenery.group.children.find(m => m.geometry.name === 'Tree trunk and branches');
  assert.equal(trunk.count, TREES.length * 3);
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  const crowns = scenery.group.children.filter(m => m.geometry.name === 'Tree crown');
  assert.equal(crowns.reduce((sum, m) => sum + m.count, 0), TREES.length * 3);
  for (const [index, tree] of TREES.entries()) {
    assert.ok(OBSTACLES.some(o => o.x === tree.x && o.z === tree.z && o.halfWidth === 0.28 * tree.size && o.halfDepth === 0.28 * tree.size));
    for (let part = 0; part < 3; part++) {
      trunk.getMatrixAt(index * 3 + part, matrix);
      const positions = trunk.geometry.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        point.fromBufferAttribute(positions, j).applyMatrix4(matrix);
        const allowance = part === 0 ? 0.28001 : 1.20001;
        assert.ok(Math.abs(point.x - tree.x) <= allowance * tree.size);
        assert.ok(Math.abs(point.z - tree.z) <= allowance * tree.size);
        assert.ok(point.y >= (part === 0 ? -0.00001 : 2.49 * tree.size));
        assert.ok(point.y <= (part === 0 ? 3.50001 : 4.8) * tree.size);
      }
    }
  }
  for (const mesh of crowns) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const center = new THREE.Vector3().setFromMatrixPosition(matrix);
    const tree = TREES.reduce((a, b) => Math.hypot(center.x - a.x, center.z - a.z) < Math.hypot(center.x - b.x, center.z - b.z) ? a : b);
    const positions = mesh.geometry.attributes.position;
    for (let j = 0; j < positions.count; j++) {
      point.fromBufferAttribute(positions, j).applyMatrix4(matrix);
      assert.ok(Math.abs(point.x - tree.x) <= 2.80001 * tree.size);
      assert.ok(Math.abs(point.z - tree.z) <= 2.50001 * tree.size);
      assert.ok(point.y >= 1.49999 * tree.size && point.y <= 7.90001 * tree.size);
    }
  }
});

test('tree shapes and vertex shading are deterministic and retain all stems, forks and main crowns at distance', t => {
  const first = createSceneryVisuals(new THREE.Scene()), second = createSceneryVisuals(new THREE.Scene());
  const full = first.stats(); t.diagnostic(JSON.stringify(full));
  for (const key of ['drawCalls', 'triangles', 'geometryBytes']) assert.ok(full[key] <= SCENERY_BUDGET[key], key);
  const trees = first.group.children.filter(m => m.geometry.name.startsWith('Tree'));
  const others = second.group.children.filter(m => m.geometry.name.startsWith('Tree'));
  trees.forEach((mesh, i) => {
    assert.ok(mesh.material.vertexColors);
    assert.equal(mesh.material.map, null, 'no tree textures');
    assert.deepEqual(mesh.geometry.attributes.position.array, others[i].geometry.attributes.position.array);
    assert.deepEqual(mesh.geometry.attributes.color.array, others[i].geometry.attributes.color.array);
    assert.deepEqual(mesh.instanceMatrix.array, others[i].instanceMatrix.array);
    assert.ok(new Set(mesh.geometry.attributes.color.array).size > 3, 'varied bark/foliage tones');
  });
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), shapes = new Set();
  const persistent = trees.filter(m => m.castShadow);
  for (const mesh of persistent.filter(m => m.geometry.name === 'Tree crown')) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); scale.setFromMatrixScale(matrix);
    shapes.add((scale.y / scale.x).toFixed(3));
  }
  assert.equal(shapes.size, 3, 'broad, upright and rounded persistent crowns');
  const counts = persistent.map(m => m.count), arrays = trees.map(m => m.instanceMatrix.array);
  first.update({ x: 10000, z: 10000 });
  assert.deepEqual(persistent.map(m => m.count), counts);
  assert.ok(trees.filter(m => !m.castShadow).every(m => m.count === 0));
  assert.equal(first.stats().geometryBytes, full.geometryBytes);
  for (let i = 0; i < 10; i++) { first.update(TREES[i]); first.update({ x: 10000, z: 10000 }); }
  trees.forEach((m, i) => assert.equal(m.instanceMatrix.array, arrays[i]));
});
