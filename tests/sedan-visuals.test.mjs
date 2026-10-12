import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSedanResources, TRAFFIC_VISUAL_BUDGET } from '../src/sedan-visuals.ts';
import { createTrafficVisuals } from '../src/traffic-visuals.ts';
import { createDamageVisuals } from '../src/damage-visuals.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { CAR } from '../src/vehicle-config.ts';
import { VIEW_LIMITS } from '../src/cockpit.ts';

function fixture() {
  const scene = new THREE.Scene(), visuals = createTrafficVisuals(scene), traffic = new VehicleTraffic();
  traffic.density = 'off';
  const car = traffic.add(['middle-n:center>north'], 22, 3.1);
  return { scene, visuals, traffic, car };
}

test('sedan proportions retain the existing footprint, roof height, wheelbase and shared resources', () => {
  const resources = createSedanResources();
  const a = resources.exterior(), b = resources.exterior();
  const cabin = resources.cabin(0xc8cec8), body = createDamageVisuals();
  const model = new THREE.Group(); model.add(a.group, cabin.group, body.group);
  const wheels = [];
  for (const x of [-0.78, 0.78]) for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
    const wheel = resources.wheel(); wheel.position.set(x, CAR.tireRadius, z); model.add(wheel); wheels.push(wheel);
  }
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(bounds.min.x >= -CAR.width / 2 - 0.01 && bounds.max.x <= CAR.width / 2 + 0.01);
  assert.ok(bounds.min.z >= -CAR.length / 2 - 0.003 && bounds.max.z <= CAR.length / 2 + 0.003);
  assert.ok(bounds.min.y >= -1e-7 && bounds.max.y <= 1.681);
  assert.equal(a.group.children[0].geometry, b.group.children[0].geometry);
  assert.equal(a.detail.children[0].geometry, b.detail.children[0].geometry);
  for (const wheel of wheels) for (let i = 0; i < 2; i++) assert.equal(wheel.children[i].geometry, wheels[0].children[i].geometry);
});

test('new player exterior leaves lane-edge, shoulder and rear sightlines clear at all seat extremes', () => {
  const exterior = createSedanResources().exterior().group;
  exterior.updateMatrixWorld(true);
  for (const eye of VIEW_LIMITS.eyeHeight) for (const seat of VIEW_LIMITS.seatZ) {
    const origin = new THREE.Vector3(-0.38, eye, seat);
    for (const target of [new THREE.Vector3(-2.5, 0, -12), new THREE.Vector3(2.5, 0, -12),
      new THREE.Vector3(-8, 1.22, 3), new THREE.Vector3(8, 1.22, 3), new THREE.Vector3(0, 1.22, 12)]) {
      const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target));
      assert.deepEqual(ray.intersectObject(exterior, true), [], `eye ${eye}, seat ${seat}, target ${target.toArray()}`);
    }
  }
});

test('visual wheel arches reveal the upper outside tire without enlarging the body panels', () => {
  const body = createDamageVisuals();
  const damage = new VehicleTraffic().add(['middle-n:center>north']).damage;
  body.update(damage); body.group.updateMatrixWorld(true);
  for (const side of [-1, 1]) for (const z of [-CAR.wheelbase / 2, CAR.wheelbase / 2]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(side * 2, 0.55, z), new THREE.Vector3(-side, 0, 0), 0, 2 - 0.87);
    assert.deepEqual(ray.intersectObject(body.group, true), [], `outside tire at ${side}, ${z}`);
  }
});

test('traffic detail has hysteresis and leaves windows, damage and lamps visible at distance', () => {
  const { scene, visuals, car } = fixture();
  car.damage.panels.left.scratch = 1; car.damage.revision++; car.indicator = 'left'; car.braking = true;
  const update = distance => visuals.update([car], 0, 'night', 'rain', { x: car.x + distance, z: car.z });
  update(44);
  const group = scene.children[0], detail = group.getObjectByName('sedan close detail');
  const near = visuals.stats();
  update(50); assert.equal(detail.visible, true);
  update(61); assert.equal(detail.visible, false);
  const far = visuals.stats(); assert.ok(far.triangles < near.triangles);
  assert.equal(group.getObjectByName('traffic cabin').visible, true);
  assert.equal(group.getObjectByName('sloped windows').visible, true);
  assert.equal(group.children[0].children.filter(n => n.isGroup && n.visible).length, 1, 'damaged panel marks remain');
  const lamps = group.children.filter(n => n.isMesh && n.position.z < -2 && Math.abs(n.position.x) === 0.65);
  assert.ok(lamps.every(n => n.visible && n.material.emissiveIntensity === 2));
  update(50); assert.equal(detail.visible, false);
  update(44); assert.equal(detail.visible, true);
  assert.deepEqual(visuals.stats(), near);
});

test('wheel rolling follows simulation time, pauses cleanly, and resets on pool reuse', () => {
  const { scene, visuals, traffic, car } = fixture();
  visuals.update([car], 0); visuals.update([car], 0.1);
  const wheels = scene.children[0].children.filter(n => n.name === 'sedan wheel');
  assert.ok(wheels.every(w => Math.abs(w.rotation.x + 1) < 1e-9));
  visuals.update([car], 0.1); assert.ok(wheels.every(w => Math.abs(w.rotation.x + 1) < 1e-9));
  car.speed = 0; visuals.update([car], 0.2); assert.ok(wheels.every(w => Math.abs(w.rotation.x + 1) < 1e-9));
  const replacement = traffic.add(['middle-n:center>north'], 22, 0);
  visuals.update([replacement], 0.2); assert.ok(wheels.every(w => w.rotation.x === 0));
  replacement.speed = -3.1; visuals.update([replacement], 0.3);
  assert.ok(wheels.every(w => Math.abs(w.rotation.x - 1) < 1e-9));
});

test('Busy traffic, including every damaged panel, stays within budgets through detail and density churn', t => {
  const scene = new THREE.Scene(), visuals = createTrafficVisuals(scene), traffic = new VehicleTraffic();
  traffic.setDensity('busy');
  for (const car of traffic.cars) {
    for (const panel of Object.values(car.damage.panels)) { panel.dent = 1; panel.scratch = 1; }
    car.damage.revision++; car.indicator = 'left'; car.braking = true;
  }
  visuals.update(traffic.cars, 0, 'night', 'rain');
  const full = visuals.stats(); t.diagnostic(JSON.stringify(full));
  for (const key of ['cars', 'drawCalls', 'triangles', 'geometryBytes']) assert.ok(full[key] <= TRAFFIC_VISUAL_BUDGET[key], key);
  const arrays = [];
  scene.traverse(n => { if (n.isMesh) arrays.push(n.geometry.attributes.position.array); });
  for (let i = 0; i < 20; i++) {
    visuals.update(traffic.cars, 0, 'night', 'rain', { x: 10000, z: 10000 });
    assert.ok(visuals.stats().drawCalls < full.drawCalls);
    visuals.update([], 0); assert.equal(visuals.stats().drawCalls, 0);
    assert.equal(visuals.stats().geometryBytes, full.geometryBytes);
    visuals.update(traffic.cars.slice(0, 1), 0);
    visuals.update(traffic.cars, 0, 'night', 'rain');
    assert.deepEqual(visuals.stats(), full);
  }
  const after = []; scene.traverse(n => { if (n.isMesh) after.push(n.geometry.attributes.position.array); });
  after.forEach((array, i) => assert.equal(array, arrays[i]));
  scene.traverse(n => assert.ok(!n.isLight, 'sedan detail adds no shadow/light passes'));
});

test('batched scratch marks grow and repair without reallocating or leaking between traffic actors', () => {
  const { scene, visuals, traffic, car } = fixture();
  visuals.update([car], 0);
  const body = scene.children[0].children[0];
  const marks = body.children.filter(n => n.isGroup);
  const buffers = marks.map(mark => mark.children[0].instanceMatrix.array);
  for (const scratch of [0.01, 0.5, 1]) {
    car.damage.panels.front.scratch = scratch; car.damage.revision++; visuals.update([car], 0);
    assert.equal(marks[0].children[0].count, Math.ceil(scratch * 7));
    assert.equal(marks[0].visible, true);
  }
  car.damage.repair(); visuals.update([car], 0);
  assert.ok(marks.every(mark => !mark.visible && mark.children[0].count === 0));
  car.damage.panels.rear.scratch = 1; car.damage.revision++; visuals.update([car], 0);
  const clean = traffic.add(['middle-n:center>north']); clean.damage.revision = car.damage.revision;
  visuals.update([clean], 0);
  assert.ok(marks.every(mark => !mark.visible && mark.children[0].count === 0));
  marks.forEach((mark, i) => assert.equal(mark.children[0].instanceMatrix.array, buffers[i]));
});
