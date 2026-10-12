import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSceneryVisuals, createAsphaltTexture, SCENERY_BUDGET } from '../src/scenery-visuals.ts';
import { HOUSES, TREES, PARK_PAVILION, isOnRoad, OBSTACLES } from '../src/world-layout.ts';
import { ROAD_EXAMPLES, LANES, APPROACHES, speedZoneAt } from '../src/traffic-layout.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { CyclistPhysics } from '../src/cyclist-physics.ts';
import { TrafficPhysics } from '../src/traffic-physics.ts';
import { overlapsCar } from '../src/simulation.ts';

const released = { forward: false, reverse: false, left: false, right: false };
const routes = [
  ['park-west:sw>park-w', 'park-south:park-w>park-e', 'park-east:park-e>se', 'south-e:se>south'],
  ['park-east:se>park-e', 'park-south:park-e>park-w', 'park-west:park-w>sw', 'south-w:sw>south'],
];

test('park loop is signed, has controlled exits, and starts the player on clear pavement in Park', async t => {
  for (const lane of LANES.filter(l => l.streetId.startsWith('park-'))) {
    assert.equal(speedZoneAt(lane.start).mph, 15);
    assert.equal(speedZoneAt(lane.end).mph, 15);
    if (['se', 'sw'].includes(lane.to)) assert.equal(APPROACHES.find(a => a.laneId === lane.id).kind, 'stop');
  }
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: ROAD_EXAMPLES.park });
  t.after(() => sim.dispose());
  for (let i = 0; i < 120; i++) sim.step(released);
  assert.equal(sim.state.selectedGear, 'P');
  assert.ok(isOnRoad(sim.state.x, sim.state.z));
  assert.ok(sim.wheels.every(w => w.contact));
  assert.ok(OBSTACLES.every(o => !overlapsCar(sim.state.x, sim.state.z, sim.state.heading, o)));
  sim.selectGear('D');
  for (let i = 0; i < 2 * 120; i++) sim.step({ ...released, forward: true });
  assert.ok(sim.state.x > ROAD_EXAMPLES.park.x + 1, 'player can drive into the loop');
  assert.equal(sim.damage.condition, 'undamaged');
});

for (const weather of ['dry', 'rain']) test(`physical traffic completes both directions of the park loop without collisions in ${weather}`, async t => {
  const sim = await createVehiclePhysics({ explicitControls: true, weather });
  const traffic = new VehicleTraffic(); traffic.density = 'off'; traffic.weather = weather;
  const cars = routes.map(route => traffic.add(route, 12));
  const bridge = new TrafficPhysics(sim);
  t.after(() => { bridge.clear(); sim.dispose(); });
  const visited = new Set();
  for (let i = 0; i < 180 * 120; i++) {
    traffic.step(traffic.seconds, sim.state); bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic);
    for (const car of traffic.cars) {
      visited.add(car.laneId);
      assert.ok(Number.isFinite(car.x + car.z + car.heading));
      assert.ok(isOnRoad(car.x, car.z));
      assert.equal(car.damage.condition, 'undamaged');
    }
  }
  assert.equal(traffic.completed, 2);
  assert.ok(cars.every(c => c.distanceTravelled > 400));
  for (const route of routes) for (const lane of route) assert.ok(visited.has(lane), lane);
});

test('physical cyclists finish both directions of the new park route in dry and rain', async t => {
  for (const weather of ['dry', 'rain']) {
    const sim = await createVehiclePhysics({ explicitControls: true, weather });
    const traffic = new VehicleTraffic(); traffic.density = 'off'; traffic.weather = weather;
    const bikes = new CyclistPhysics(sim, traffic);
    t.after(() => { bikes.clear(); sim.dispose(); });
    routes.forEach(route => traffic.add(route, 12, 0, 'cyclist'));
    const visited = new Set();
    for (let i = 0; i < 240 * 120 && traffic.cyclists.length; i++) {
      traffic.step(traffic.seconds, sim.state); bikes.sync(traffic.cars); sim.step(released); bikes.afterStep();
      for (const bike of bikes.riders) {
        visited.add(bike.actor.laneId);
        assert.equal(bike.state, 'riding');
        assert.ok(isOnRoad(bike.actor.x, bike.actor.z));
        assert.ok(Number.isFinite(bike.actor.x + bike.actor.z + bike.actor.speed));
      }
      assert.equal(bikes.drainEvents().length, 0);
    }
    assert.equal(traffic.completedCyclists, 2, weather);
    for (const route of routes) for (const lane of route) assert.ok(visited.has(lane), `${weather}: ${lane}`);
  }
});

test('instanced scenery stays within geometry budgets and distance detail returns without allocation or missing shells', t => {
  const scene = new THREE.Scene(), scenery = createSceneryVisuals(scene);
  const stats = scenery.stats();
  t.diagnostic(JSON.stringify(stats));
  assert.ok(stats.drawCalls <= SCENERY_BUDGET.drawCalls);
  assert.ok(stats.triangles <= SCENERY_BUDGET.triangles);
  assert.ok(stats.geometryBytes <= SCENERY_BUDGET.geometryBytes);
  const matrices = scenery.group.children.map(m => m.instanceMatrix.array);
  const full = scenery.group.children.map(m => m.count);
  scenery.update({ x: 10000, z: 10000 });
  const far = scenery.group.children.map(m => m.count);
  assert.ok(far.reduce((a, b) => a + b, 0) >= HOUSES.length * 3 + TREES.length * 2, 'all building shells and trunk/crown silhouettes remain');
  assert.ok(scenery.stats().triangles < stats.triangles);
  scenery.update(PARK_PAVILION);
  const near = scenery.group.children.map(m => m.count);
  assert.ok(near.some((count, i) => count > far[i]));
  for (let n = 0; n < 5; n++) {
    scenery.update({ x: 10000, z: 10000 }); scenery.update(PARK_PAVILION);
    assert.deepEqual(scenery.group.children.map(m => m.count), near);
  }
  scenery.group.children.forEach((mesh, i) => {
    assert.equal(mesh.instanceMatrix.array, matrices[i]);
    assert.ok(mesh.count <= full[i]);
    if (mesh.count) assert.ok(Number.isFinite(mesh.boundingSphere.radius));
  });
  const a = createAsphaltTexture(), b = createAsphaltTexture();
  assert.equal(a.image.data.byteLength, SCENERY_BUDGET.textureBytes);
  assert.deepEqual(a.image.data, b.image.data);
});

test('priority-road left turns clear before the opposing stopped park exit, avoiding a mutual wait', () => {
  const traffic = new VehicleTraffic(); traffic.density = 'off';
  const minor = traffic.add(['park-west:park-w>sw', 'west-s:sw>west'], 83.3);
  const priority = traffic.add(['west-s:west>sw', 'south-w:sw>south'], 83.3);
  const admitted = [];
  for (let i = 0; i < 90 * 120; i++) {
    traffic.step(traffic.seconds);
    for (const car of traffic.cars) if (car.connectionId && !admitted.includes(car.id)) admitted.push(car.id);
  }
  assert.deepEqual(admitted, [priority.id, minor.id]);
  assert.equal(traffic.completed, 2);
});
