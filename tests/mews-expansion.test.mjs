import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { STREETS, createLanes, JUNCTION_RADIUS, junction } from '../src/road-network.ts';
import { LANES, APPROACHES, ROAD_SIGNS, ROAD_EXAMPLES, speedZoneAt } from '../src/traffic-layout.ts';
import { HOUSES, MEWS_MARKET, DRIVEWAYS, drivewayToStreet, SIDEWALKS, BOUNDARY_OBSTACLES, WORLD_BOUNDS, isOnRoad, ROAD_HEIGHT } from '../src/world-layout.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { TrafficPhysics } from '../src/traffic-physics.ts';
import { CyclistPhysics } from '../src/cyclist-physics.ts';
import { createSceneryVisuals, SCENERY_BUDGET } from '../src/scenery-visuals.ts';
import { FIXED_STEP } from '../src/simulation-clock.ts';
import { TRAFFIC_TUNING } from '../src/vehicle-traffic.ts';
import { RAIN, pavedGrip } from '../src/driving-conditions.ts';

const released = { forward: false, reverse: false, left: false, right: false };
const routes = [
  ['mews-north:east>mews-n', 'mews-east:mews-n>mews-s', 'mews-south:mews-s>se', 'south-e:se>south'],
  ['mews-south:se>mews-s', 'mews-east:mews-s>mews-n', 'mews-north:mews-n>east', 'east-n:east>ne'],
];

test('Mews uses its own paved/lane width while every existing lane retains its previous coordinates', () => {
  for (const side of ['left', 'right']) for (const lane of createLanes(side)) {
    const node = junction(lane.from), street = STREETS.find(s => s.id === lane.streetId);
    const mews = street.id.startsWith('mews-'), offset = (side === 'right' ? 1 : -1) * (mews ? 2 : 2.5);
    assert.equal(lane.width, mews ? 4 : 5);
    assert.deepEqual(lane.start, { x: node.x + lane.direction.x * (lane.from === 'lot' ? 0 : JUNCTION_RADIUS) - lane.direction.z * offset,
      z: node.z + lane.direction.z * (lane.from === 'lot' ? 0 : JUNCTION_RADIUS) + lane.direction.x * offset });
    if (mews) assert.equal(street.width, 8);
  }
  for (const lane of LANES.filter(l => l.streetId.startsWith('mews-'))) {
    const midpoint = { x: (lane.start.x + lane.end.x) / 2, z: (lane.start.z + lane.end.z) / 2 };
    assert.equal(speedZoneAt(midpoint).id, 'mews'); assert.equal(speedZoneAt(midpoint).mph, 15);
    const approach = APPROACHES.find(a => a.laneId === lane.id);
    assert.equal(approach.kind, ['east', 'se'].includes(lane.to) ? 'stop' : 'priority');
    const sign = ROAD_SIGNS.find(s => s.id === `speed-${lane.id}`); assert.ok(sign);
    assert.equal(sign.mph, lane.to === 'east' ? 25 : 15);
  }
});

test('Mews player starts safely in Park and can launch on the narrower pavement', async t => {
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: ROAD_EXAMPLES.mews });
  t.after(() => sim.dispose());
  for (let i = 0; i < 120; i++) sim.step(released);
  assert.equal(sim.state.selectedGear, 'P'); assert.equal(speedZoneAt(sim.state).id, 'mews');
  assert.ok(sim.wheels.every(w => w.contact)); assert.ok(isOnRoad(sim.state.x, sim.state.z));
  sim.selectGear('D');
  for (let i = 0; i < 2 * 120; i++) sim.step({ ...released, forward: true });
  assert.ok(sim.state.z > ROAD_EXAMPLES.mews.z + 1);
  assert.ok(Math.abs(sim.state.x - ROAD_EXAMPLES.mews.x) < 0.1);
  assert.equal(sim.damage.condition, 'undamaged');
});

for (const weather of ['dry', 'rain']) test(`traffic brakes before the Mews entry sign without a velocity snap in ${weather}`, async t => {
  for (const physical of [false, true]) {
    const sim = physical ? await createVehiclePhysics({ explicitControls: true, weather }) : undefined;
    const traffic = new VehicleTraffic(); traffic.density = 'off'; traffic.weather = weather;
    const car = traffic.add(['mews-north:east>mews-n'], 0, 5);
    const bridge = sim ? new TrafficPhysics(sim) : undefined;
    t.after(() => { bridge?.clear(); sim?.dispose(); });
    let brakingBeforeSign = false, passedSign = false, peakAfter = 0;
    const limit = 15 * 0.44704 * (weather === 'rain' ? RAIN.trafficSpeed : 1);
    for (let i = 0; i < 6 * 120; i++) {
      const previous = car.speed;
      traffic.step(traffic.seconds, sim?.state);
      if (bridge) { bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic); }
      assert.ok(previous - car.speed <= TRAFFIC_TUNING.braking * pavedGrip(weather) * FIXED_STEP + 1e-4, 'deceleration remains gradual');
      if (car.braking && car.x < 130) brakingBeforeSign = true;
      if (car.x >= 130) {
        passedSign = true; peakAfter = Math.max(peakAfter, car.speed);
        assert.ok(car.speed <= limit + (physical ? 0.3 : 0.02), `entry ${physical ? 'physical' : 'lane'} speed ${car.speed}`);
      }
      assert.equal(car.damage.condition, 'undamaged');
    }
    assert.ok(brakingBeforeSign && passedSign);
    t.diagnostic(`${weather}, ${physical ? 'physical' : 'lane'} peak after sign: ${peakAfter.toFixed(3)} m/s; target ${limit.toFixed(3)} m/s`);
  }
});

test('street-assigned driveways have flush physical curb openings and asymmetric world hedges match the map', async t => {
  const sim = await createVehiclePhysics(); t.after(() => sim.dispose());
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  for (const house of HOUSES.filter(h => h.drivewayStreetId)) {
    const driveway = drivewayToStreet(house, house.drivewayStreetId);
    assert.ok(DRIVEWAYS.some(d => d.x === driveway.x && d.z === driveway.z));
    for (let i = 0; i <= 10; i++) {
      const point = { x: driveway.x, z: driveway.z + (driveway.depth / 2 - 0.1) * (i / 5 - 1) };
      assert.ok(!SIDEWALKS.some(s => Math.abs(point.x - s.x) < s.width / 2 && Math.abs(point.z - s.z) < s.depth / 2));
      const hit = sim.world.castRay(new RAPIER.Ray({ x: point.x, y: 10, z: point.z }, { x: 0, y: -1, z: 0 }), 11, true);
      assert.ok(hit && Math.abs(10 - hit.timeOfImpact - ROAD_HEIGHT) < 1e-4);
    }
  }
  const sideDriveway = drivewayToStreet({ x: 245, z: 120, width: 12, depth: 11 }, 'mews-east');
  assert.equal(sideDriveway.depth, 3.8); assert.equal(sideDriveway.x - sideDriveway.width / 2, 224);
  assert.throws(() => drivewayToStreet({ ...MEWS_MARKET, x: 205 }, 'mews-south'), /junction/);
  for (const hedge of BOUNDARY_OBSTACLES.filter(h => h.z === WORLD_BOUNDS.minZ || h.z === WORLD_BOUNDS.maxZ)) {
    assert.equal(hedge.x - hedge.halfWidth, WORLD_BOUNDS.minX - 1);
    assert.equal(hedge.x + hedge.halfWidth, WORLD_BOUNDS.maxX + 1);
  }
});

for (const weather of ['dry', 'rain']) test(`physical cars and cyclists finish both Mews directions in ${weather}`, async t => {
  for (const kind of ['car', 'cyclist']) {
    const sim = await createVehiclePhysics({ explicitControls: true, weather });
    const traffic = new VehicleTraffic(); traffic.density = 'off'; traffic.weather = weather;
    const bridge = kind === 'car' ? new TrafficPhysics(sim) : new CyclistPhysics(sim, traffic);
    t.after(() => { bridge.clear(); sim.dispose(); });
    const actors = routes.map(route => traffic.add(route, 12, 0, kind));
    const visited = new Set();
    for (let i = 0; i < 240 * 120 && traffic.cars.length; i++) {
      traffic.step(traffic.seconds, sim.state); bridge.sync(traffic.cars); sim.step(released);
      if (kind === 'car') bridge.afterStep(traffic); else bridge.afterStep();
      for (const car of traffic.cars) {
        visited.add(car.laneId);
        assert.ok(isOnRoad(car.x, car.z)); assert.ok(Number.isFinite(car.x + car.z + car.speed + car.heading));
        assert.equal(car.damage.condition, 'undamaged');
      }
      if (kind === 'cyclist') {
        assert.ok(bridge.riders.every(r => r.state === 'riding')); assert.equal(bridge.drainEvents().length, 0);
      } else assert.equal(bridge.drainEvents().length, 0);
    }
    assert.equal(kind === 'car' ? traffic.completed : traffic.completedCyclists, 2, `${kind} ${weather}`);
    assert.ok(actors.every(a => a.distanceTravelled > 300));
    for (const route of routes) for (const lane of route) assert.ok(visited.has(lane), lane);
  }
});

test('market silhouettes and facade buffers return with detail while expanded scenery keeps the existing budgets', t => {
  const scenery = createSceneryVisuals(new THREE.Scene()), full = scenery.stats(); t.diagnostic(JSON.stringify(full));
  for (const key of ['drawCalls', 'triangles', 'geometryBytes']) assert.ok(full[key] <= SCENERY_BUDGET[key], key);
  const arrays = scenery.group.children.map(mesh => mesh.instanceMatrix.array);
  scenery.update({ x: 10000, z: 10000 }); const far = scenery.stats();
  assert.ok(far.triangles < full.triangles);
  for (let i = 0; i < 10; i++) {
    scenery.update(MEWS_MARKET); assert.ok(scenery.stats().triangles > far.triangles);
    scenery.update({ x: 10000, z: 10000 }); assert.deepEqual(scenery.stats(), far);
  }
  scenery.group.children.forEach((mesh, i) => assert.equal(mesh.instanceMatrix.array, arrays[i]));
});
