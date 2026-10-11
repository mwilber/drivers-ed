import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { VehicleTraffic, TRAFFIC_DENSITIES, TRAFFIC_TUNING, trafficRoute, trafficStopProgress } from '../src/vehicle-traffic.ts';
import { LANES, LANE_CONNECTIONS, APPROACHES, speedZoneAt } from '../src/traffic-layout.ts';
import { loadTrafficScenario, TRAFFIC_SCENARIOS } from '../src/traffic-scenarios.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { signalState } from '../src/traffic-rules.ts';
import { CAR } from '../src/vehicle-config.ts';
import { isOnRoad } from '../src/world-layout.ts';

const lane = id => LANES.find(l => l.id === id);
function advance(sim, seconds, player, check = () => {}) {
  for (let i = 0; i < seconds * 120; i++) { sim.step(sim.seconds, player); check(sim); }
}
// Oriented sedan footprints, not point distances, detect crossing and rear-end collisions.
function overlap(a, b) {
  const axes = a => [{ x: -Math.sin(a.heading), z: -Math.cos(a.heading), extent: CAR.length / 2 }, { x: Math.cos(a.heading), z: -Math.sin(a.heading), extent: CAR.width / 2 }];
  const aa = axes(a), bb = axes(b), delta = { x: a.x - b.x, z: a.z - b.z };
  return [...aa, ...bb].every(u => Math.abs(delta.x * u.x + delta.z * u.z) < [...aa, ...bb].reduce((r, v) => r + Math.abs(v.x * u.x + v.z * u.z) * v.extent, 0) - 0.01);
}
function safe(sim) {
  for (const car of sim.cars) {
    assert.ok(Number.isFinite(car.x + car.z + car.speed + car.heading));
    assert.ok(isOnRoad(car.x, car.z));
    assert.ok(car.speed <= (speedZoneAt(car).mph * 0.44704) + 0.5);
    for (const other of sim.cars) if (other.id > car.id) assert.ok(!overlap(car, other), `${car.id} overlaps ${other.id} at ${sim.seconds}`);
  }
}

test('seeded routes follow shared lanes/connections and a single sedan completes a finite route', () => {
  for (const l of LANES.filter(l => l.streetId !== 'lot-access')) {
    const route = trafficRoute(l.id, 3);
    assert.deepEqual(route, trafficRoute(l.id, 3));
    for (let i = 1; i < route.length; i++) assert.ok(LANE_CONNECTIONS.some(c => c.incoming === route[i - 1] && c.outgoing === route[i]));
  }
  assert.throws(() => trafficRoute('missing'));
  const sim = new VehicleTraffic(); sim.density = 'off';
  const car = sim.add(trafficRoute('south-w:sw>south', 0, 4), 12);
  advance(sim, 160, undefined, safe);
  assert.equal(sim.completed, 1); assert.equal(sim.cars.length, 0);
  assert.ok(car.distanceTravelled > 200);
  assert.throws(() => sim.add(['middle-n:north>center', 'east-n:ne>east']));
});

test('following cars brake for a stationary player, keep spacing, and recover when the obstruction clears', () => {
  const sim = new VehicleTraffic(); loadTrafficScenario(sim, 'traffic-following');
  const player = { x: -28, z: 62.5, heading: -Math.PI / 2, speed: 0 };
  const cars = [...sim.cars];
  advance(sim, 30, player, s => { safe(s); for (const car of s.cars) assert.ok(!overlap(car, player)); });
  assert.ok(cars.every(c => c.speed === 0));
  assert.ok(cars[0].x <= player.x - CAR.length - TRAFFIC_TUNING.gap);
  assert.ok(cars[1].x <= cars[0].x - CAR.length - TRAFFIC_TUNING.gap);
  advance(sim, 160, undefined, safe);
  assert.equal(sim.completed, 2);
});

test('red and yellow stop behind the line; green admits and a changing signal lets a committed car clear', () => {
  const sim = new VehicleTraffic(); sim.density = 'off';
  const route = ['middle-s:south>center', 'middle-n:center>north'];
  const car = sim.add(route, 45, 6);
  for (let i = 0; i < 12 * 120; i++) sim.step(19); // NS red.
  assert.equal(car.speed, 0); assert.equal(car.connectionId, undefined);
  assert.ok(car.progress <= trafficStopProgress(lane(route[0])));
  for (let i = 0; i < 120; i++) sim.step(14); // NS yellow.
  assert.equal(car.connectionId, undefined);
  for (let i = 0; i < 3 * 120; i++) sim.step(0);
  assert.ok(car.connectionId);
  for (let i = 0; i < 12 * 120; i++) sim.step(19);
  assert.equal(car.laneId, route[1]); assert.equal(car.connectionId, undefined);
});

test('all-way stop uses full stops and right priority; four simultaneous arrivals resolve without a cycle', () => {
  const sim = new VehicleTraffic(); loadTrafficScenario(sim, 'traffic-stops');
  // The fourth approach starts at the lot entrance; useful as a tie-cycle fixture only.
  const fourth = ['lot-access:lot>north', 'middle-n:north>center', 'town-e:center>east'];
  sim.add(fourth, trafficStopProgress(lane(fourth[0])));
  const entered = [], seen = new Set();
  advance(sim, 120, undefined, s => {
    safe(s);
    for (const car of s.cars) if (car.connectionId && !seen.has(car.id)) {
      seen.add(car.id); entered.push(car.id); assert.ok(car.stoppedFor >= TRAFFIC_TUNING.stopDwell);
    }
  });
  assert.equal(entered[0], 0, 'cyclic right priority uses a stable tie break');
  assert.equal(seen.size, 4); assert.equal(sim.completed, 4);
  const pair = new VehicleTraffic(); pair.density = 'off';
  const west = ['north-w:nw>north', 'north-e:north>ne'];
  const north = ['middle-n:center>north', 'north-e:north>ne'];
  pair.add(west, trafficStopProgress(lane(west[0])));
  pair.add(north, trafficStopProgress(lane(north[0])));
  const order = [];
  advance(pair, 30, undefined, s => { for (const car of s.cars) if (car.connectionId && !order.includes(car.id)) order.push(car.id); });
  assert.equal(order[0], 1, 'the simultaneously arriving driver on the right proceeds first');
});

test('permissive left turns and minor approaches admit through traffic first', () => {
  for (const id of ['traffic-left', 'traffic-yield']) {
    const sim = new VehicleTraffic(); loadTrafficScenario(sim, id);
    const order = [], seen = new Set();
    advance(sim, 160, undefined, s => {
      safe(s);
      for (const car of s.cars) if (car.connectionId && !seen.has(car.id)) {
        seen.add(car.id); order.push(car.id);
        const approach = APPROACHES.find(a => a.laneId === car.laneId);
        if (approach.kind === 'signal') assert.equal(signalState(s.seconds - 1 / 120)[approach.signalGroup], 'green');
      }
    });
    assert.equal(order[0], 1, id); assert.equal(sim.completed, 2, id);
  }
});

test('blocked exits and a player occupying the junction prevent entry and recover after clearing', () => {
  const sim = new VehicleTraffic(); sim.density = 'off';
  const route = ['middle-s:south>center', 'middle-n:center>north'];
  const car = sim.add(route, trafficStopProgress(lane(route[0])));
  for (const player of [{ x: 0, z: 60, heading: 0, speed: 0 }, { x: 2.5, z: 38, heading: 0, speed: 0 }, { x: -30, z: 62.5, heading: -Math.PI / 2, speed: 8 }]) {
    for (let i = 0; i < 3 * 120; i++) sim.step(0, player);
    assert.equal(car.connectionId, undefined); assert.equal(car.speed, 0);
  }
  for (let i = 0; i < 3 * 120; i++) sim.step(0);
  assert.ok(car.connectionId);
});

test('density is bounded; safe spawns, lifecycle removal, reset, and repeatable fixtures leave no stale state', () => {
  const sim = new VehicleTraffic(); const player = { ...lane(LANES[0].id).start, heading: 0, speed: 0 };
  for (const density of ['busy', 'single', 'off', 'light']) {
    sim.setDensity(density, player);
    assert.ok(sim.cars.length <= TRAFFIC_DENSITIES[density]); safe(sim);
  }
  assert.throws(() => sim.setDensity('invalid'));
  sim.reset(player); const snapshot = JSON.stringify(sim.cars);
  advance(sim, 8, player); sim.reset(player); assert.equal(JSON.stringify(sim.cars), snapshot);
  for (const id of Object.keys(TRAFFIC_SCENARIOS)) {
    loadTrafficScenario(sim, id); const snapshot = JSON.stringify(sim.cars);
    advance(sim, 5); loadTrafficScenario(sim, id); assert.equal(JSON.stringify(sim.cars), snapshot); safe(sim);
  }
});

test('traffic, signals, spacing and route outcomes agree at 30/60/144 Hz; pausing does not catch up', () => {
  const snapshots = [30, 60, 144].map(fps => {
    const clock = new SimulationClock(), sim = new VehicleTraffic(); loadTrafficScenario(sim, 'traffic-left');
    for (let i = 0; i < fps * 60; i++) clock.advance(1 / fps, () => sim.step(sim.seconds));
    const snapshot = JSON.stringify({ cars: sim.cars, completed: sim.completed, seconds: sim.seconds });
    clock.reset(); assert.equal(snapshot, JSON.stringify({ cars: sim.cars, completed: sim.completed, seconds: sim.seconds }));
    return snapshot;
  });
  assert.equal(snapshots[0], snapshots[1]); assert.equal(snapshots[1], snapshots[2]);
});

test('busy traffic remains collision-free and completes routes during a sustained run; report simulation cost', t => {
  const sim = new VehicleTraffic(); sim.setDensity('busy');
  const start = performance.now(); let lastProgress = new Map();
  advance(sim, 600, undefined, s => {
    if (Math.round(s.seconds * 120) % 60 === 0) safe(s);
    if (Math.round(s.seconds * 120) === 360 * 120) lastProgress = new Map(s.cars.map(c => [c.id, c.distanceTravelled]));
  });
  assert.ok(sim.completed >= 8, `only ${sim.completed} completed routes`);
  for (const car of sim.cars) if (lastProgress.has(car.id)) assert.ok(car.distanceTravelled - lastProgress.get(car.id) > 10, `stuck car ${car.id}: ${car.reason}`);
  t.diagnostic(`16-car AI cost including sampled safety checks: ${((performance.now() - start) / (600 * 120)).toFixed(3)} ms/fixed step on this host`);
});

test('traffic bodies collide with the player, report vehicle damage, and are removed cleanly', async t => {
  const { createVehiclePhysics } = await import('../src/vehicle-physics.ts');
  const { TrafficPhysics } = await import('../src/traffic-physics.ts');
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true, spawn: { x: 2.5, z: 20, heading: 0 } });
  t.after(() => sim.dispose());
  const traffic = new VehicleTraffic(); traffic.density = 'off';
  const car = traffic.add(['middle-n:north>center'], 55);
  car.x = 2.5; car.z = 10; car.heading = 0;
  const bridge = new TrafficPhysics(sim); bridge.sync(traffic.cars);
  assert.equal(bridge.count, 1);
  sim.selectGear('N'); sim.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
  const events = [];
  for (let i = 0; i < 2 * 120; i++) {
    bridge.sync(traffic.cars); sim.step({ forward: false, reverse: false, left: false, right: false }); events.push(...sim.damage.drainEvents());
  }
  assert.ok(sim.state.z > 14, 'player cannot pass through the traffic body');
  assert.ok(events.some(e => e.kind === 'impact' && e.material === 'vehicle'));
  bridge.clear(); assert.equal(bridge.count, 0);
  sim.reset(); assert.equal(sim.damage.condition, 'undamaged');
  bridge.sync(traffic.cars); bridge.sync([]); assert.equal(bridge.count, 0);
});
