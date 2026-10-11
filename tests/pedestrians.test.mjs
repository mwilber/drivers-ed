import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { Pedestrians, PEDESTRIAN, crossingSafe, crossingPhase } from '../src/pedestrians.ts';
import { CROSSINGS } from '../src/road-network.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { TrafficPhysics } from '../src/traffic-physics.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { loadPedestrianScenario, PEDESTRIAN_SCENARIOS } from '../src/pedestrian-scenarios.ts';
import { createPedestrianVisuals } from '../src/pedestrian-visuals.ts';

const released = { forward: false, reverse: false, left: false, right: false };
async function world(t, options = {}) {
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: { x: 140, z: 210, heading: 0 }, ...options });
  const people = new Pedestrians(sim), traffic = new VehicleTraffic(), bridge = new TrafficPhysics(sim);
  traffic.density = 'off'; let ticks = 0;
  t.after(() => { people.clear(); bridge.clear(); sim.dispose(); });
  const step = (input = released) => {
    const seconds = ticks++ / 120;
    people.beforeStep(seconds, [...traffic.cars, sim.state]);
    traffic.step(seconds, sim.state, people.hazards(seconds), people.obstacles());
    bridge.sync(traffic.cars); sim.step(input); bridge.afterStep(traffic); people.afterStep();
  };
  const advance = seconds => { for (let i = 0; i < seconds * 120; i++) step(); };
  return { sim, people, traffic, bridge, step, advance };
}

test('crossing gap acceptance checks both directions, reverse movement, stationary blockage and signal clearance', () => {
  const c = CROSSINGS.find(c => c.id === 'north-middle-n');
  for (const actor of [
    { x: 2.5, z: -20, heading: 0, speed: 5 },
    { x: -2.5, z: -75, heading: Math.PI, speed: 5 },
    { x: 2.5, z: -20, heading: Math.PI, speed: -5 },
    { x: 2.5, z: -47, heading: 0, speed: 0 },
  ]) assert.equal(crossingSafe(c, [actor]), false);
  assert.equal(crossingSafe(c, [{ x: 2.5, z: -20, heading: Math.PI, speed: 5 }]), true, 'receding car');
  assert.equal(crossingSafe(c, [{ x: 2.5, z: -40, heading: 0, speed: 0 }]), true, 'stopped before crossing');
  const signal = CROSSINGS.find(c => c.id === 'center-middle-s');
  assert.equal(crossingPhase(signal, 0), false);
  assert.equal(crossingPhase(signal, 19), true);
  assert.equal(crossingPhase(signal, 23), false, 'not enough time to clear');
  assert.equal(crossingPhase(signal, 36), false, 'all-red is not a crossing invitation');
});

test('pedestrians remain upright, walk through flush ramps, clear both lanes and return without teleporting', async t => {
  const { people, step } = await world(t); people.reset();
  const previous = new Map(); let maxStep = 0;
  for (let i = 0; i < 55 * 120; i++) {
    step();
    for (const p of people.people) {
      assert.notEqual(p.state, 'fallen');
      const q = p.body.rotation(); assert.ok(1 - 2 * (q.x ** 2 + q.z ** 2) > 0.97);
      const old = previous.get(p.id); if (old) maxStep = Math.max(maxStep, Math.hypot(p.x - old.x, p.z - old.z));
      previous.set(p.id, { x: p.x, z: p.z });
      assert.ok(Math.abs(p.crossing.direction.x * (p.x - p.crossing.x) + p.crossing.direction.z * (p.z - p.crossing.z)) < 0.15);
    }
  }
  assert.equal(people.people.length, 3); assert.ok(people.completed >= 5); assert.ok(maxStep < 0.025);
  assert.equal(people.people.find(p => p.crossing.junctionId === 'center').side, 1, 'signalized pedestrian finishes the crossing');
});

test('a waiting pedestrian stays at the curb for an approaching non-yielding player', async t => {
  const { people, sim, advance } = await world(t); const p = people.add('north-middle-n');
  sim.state.x = 2.5; sim.state.z = -20; sim.state.heading = 0; sim.state.speed = 6;
  // Test the decision independently so the fixture remains a continuously approaching actor.
  for (let i = 0; i < 600; i++) people.beforeStep(0, [sim.state]);
  assert.equal(p.state, 'waiting'); assert.equal(p.x, -6.5);
  sim.state.speed = 0; sim.state.z = -40;
  people.beforeStep(0, [sim.state]); assert.equal(p.state, 'crossing');
  advance(12); assert.equal(people.completed, 1);
});

test('physical AI yields before an occupied crossing, then resumes without striking pedestrians', async t => {
  const { people, traffic, bridge, sim, step } = await world(t, { spawn: PEDESTRIAN_SCENARIOS['pedestrian-yield'].spawn });
  loadPedestrianScenario(people, traffic, 'pedestrian-yield'); bridge.sync(traffic.cars);
  let stopped = false, resumed = false;
  for (let i = 0; i < 24 * 120; i++) {
    step(); const car = traffic.cars[0];
    if (people.people[0].state === 'crossing') {
      assert.ok(car.z - 2.25 > -46, 'front bumper remains before the crossing');
      stopped ||= Math.abs(car.speed) < 0.05;
    }
    resumed ||= people.completed > 0 && car.z < -49;
    assert.equal(people.drainEvents().length, 0); assert.equal(sim.damage.condition, 'undamaged');
    assert.ok(!bridge.drainEvents().some(e => e.event.kind === 'impact'));
  }
  assert.ok(stopped); assert.ok(resumed);
});

test('turning AI checks the outgoing crossing and resumes once it clears', async t => {
  const { sim, traffic, bridge } = await world(t);
  const car = traffic.add(['north-w:nw>north', 'middle-n:north>center'], 63);
  const c = CROSSINGS.find(c => c.id === 'north-middle-n');
  const step = (occupied = true) => {
    traffic.step(0, undefined, occupied ? [{ crossing: c }] : []);
    bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic);
  };
  for (let i = 0; i < 25 * 120; i++) step();
  assert.ok(car.connectionId); assert.ok(car.z < -50, 'does not enter the exit crossing'); assert.ok(Math.abs(car.speed) < 0.05);
  for (let i = 0; i < 6 * 120; i++) step(false);
  assert.ok(car.z > -44, 'resumes after crossing is clear');
});

async function impact(t, speed, lateral = 2.5, npc = false) {
  const w = await world(t, { environment: 'flat', spawn: { x: lateral, z: -43.5, heading: 0 } });
  const p = w.people.add('north-middle-n', 1, 9);
  if (npc) {
    w.sim.body.setTranslation({ x: 140, y: w.sim.position.y, z: 210 }, true);
    const car = w.traffic.add(['middle-n:center>north'], 85.5, speed); car.x = lateral; car.z = -43.5; car.parked = true;
    w.bridge.sync(w.traffic.cars);
  } else { w.sim.selectGear('N'); w.sim.body.setLinvel({ x: 0, y: 0, z: -speed }, true); }
  let maxSpeed = 0, minUp = 1;
  const step = () => { w.step(); maxSpeed = Math.max(maxSpeed, p.speed); const q = p.body.rotation(); minUp = Math.min(minUp, 1 - 2 * (q.x ** 2 + q.z ** 2)); };
  for (let i = 0; i < 3 * 120; i++) step();
  return { ...w, p, maxSpeed, minUp };
}

test('low/high player impacts and AI impacts transfer motion and topple a finite-mass pedestrian', async t => {
  const low = await impact(t, 2), high = await impact(t, 8), ai = await impact(t, 8, 2.5, true);
  for (const w of [low, high, ai]) {
    assert.equal(w.p.body.mass(), PEDESTRIAN.mass); assert.equal(w.p.body.isCcdEnabled(), true);
    assert.equal(w.p.state, 'fallen'); assert.ok(w.minUp < 0.4); assert.ok(w.p.z < -47.3);
    assert.equal(w.people.drainEvents().length, 1);
    const position = w.p.body.translation(), rotation = w.p.body.rotation(), velocity = w.p.body.linvel();
    w.people.beforeStep(0, []);
    assert.deepEqual(w.p.body.translation(), position); assert.deepEqual(w.p.body.rotation(), rotation); assert.deepEqual(w.p.body.linvel(), velocity);
    assert.deepEqual({ ...w.p.body.userForce() }, { x: 0, y: 0, z: 0 });
    w.advance(8); assert.equal(w.people.drainEvents().length, 0, 'resting contact never retriggers the impact');
  }
  assert.ok(high.maxSpeed > low.maxSpeed * 2); assert.ok(high.p.z < low.p.z - 3);
  assert.ok(high.sim.damage.panels.front.dent > 0);
});

test('glancing impacts retain tangential movement; CCD detects an impact at the sedan maximum speed', async t => {
  const glancing = await impact(t, 8, 1.4);
  assert.equal(glancing.p.state, 'fallen'); assert.ok(glancing.p.x > 2.7); assert.ok(glancing.sim.state.z < -48);
  const fast = await impact(t, 115 / 2.236936);
  assert.equal(fast.p.state, 'fallen'); assert.ok(fast.maxSpeed > 20); assert.equal(fast.people.drainEvents().length, 1);
  assert.ok(Number.isFinite(fast.p.x + fast.p.z + fast.p.body.translation().y));
});

test('occlusion fixture actually hides the curb-side pedestrian behind a dynamic parked sedan', async t => {
  const { sim, people, traffic, bridge, step } = await world(t, { spawn: PEDESTRIAN_SCENARIOS['pedestrian-occluded'].spawn });
  loadPedestrianScenario(people, traffic, 'pedestrian-occluded'); bridge.sync(traffic.cars);
  // Populate queries, then trace the driver's eye toward the upper torso.
  step(); const p = people.people[0], body = bridge.getBody(traffic.cars[0].id);
  const eye = { x: 2.15, y: 1.35, z: -22.65 }, target = { x: p.x, y: 1.35, z: p.z };
  const distance = Math.hypot(target.x - eye.x, target.z - eye.z);
  const hit = sim.world.castRay(new RAPIER.Ray(eye, { x: (target.x - eye.x) / distance, y: 0, z: (target.z - eye.z) / distance }), distance, true, undefined, undefined, undefined, sim.body);
  assert.equal(hit?.collider.parent()?.handle, body.handle);
  assert.ok(body.isDynamic()); assert.ok(body.mass() > 0);
  for (let i = 0; i < 3 * 120; i++) step();
  assert.equal(p.state, 'crossing'); assert.equal(people.drainEvents().length, 0);
});

test('fallen actors retire after a bounded interval; reset/disable release bodies and clear event state', async t => {
  const w = await impact(t, 8); const body = w.p.body;
  w.advance(PEDESTRIAN.retirementSeconds); assert.equal(w.people.people.length, 0); assert.equal(body.isValid(), false);
  for (let i = 0; i < 6; i++) {
    w.people.reset(); assert.equal(w.people.people.length, 3);
    const bodies = w.people.people.map(p => p.body); w.people.reset(false);
    assert.equal(w.people.people.length, 0); assert.ok(bodies.every(b => !b.isValid())); assert.equal(w.people.drainEvents().length, 0);
  }
  const count = w.sim.world.bodies.len(); w.people.reset(); w.people.clear(); assert.equal(w.sim.world.bodies.len(), count);
});

test('pedestrian collision state and events match at 30/60/144 Hz and visuals follow the physical fall', async t => {
  const snapshots = [];
  for (const fps of [30, 60, 144]) {
    const w = await world(t, { environment: 'flat', spawn: { x: 2.5, z: -43.5, heading: 0 } });
    const p = w.people.add('north-middle-n', 1, 9); w.sim.selectGear('N'); w.sim.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    const clock = new SimulationClock(); for (let i = 0; i < fps * 4; i++) clock.advance(1 / fps, () => w.step());
    snapshots.push(JSON.stringify({ pos: p.body.translation(), q: p.body.rotation(), v: p.body.linvel(), state: p.state,
      events: w.people.drainEvents(), player: w.sim.position, damage: w.sim.damage.panels }));
    const scene = new THREE.Scene(), visuals = createPedestrianVisuals(scene); visuals.update(w.people.people, 4);
    assert.equal(scene.children[0].position.y, p.body.translation().y);
    assert.equal(scene.children[0].quaternion.x, p.body.rotation().x);
    visuals.update([], 4); assert.equal(scene.children[0].visible, false);
    const saved = p.body.translation(); clock.reset(); assert.deepEqual(p.body.translation(), saved);
  }
  assert.equal(snapshots[0], snapshots[1]); assert.equal(snapshots[1], snapshots[2]);
});

test('Busy traffic and pedestrians remain stable during sustained shared-world operation', async t => {
  const w = await world(t); w.traffic.setDensity('busy'); w.people.reset();
  const start = performance.now();
  for (let i = 0; i < 600 * 120; i++) {
    w.step(); assert.equal(w.people.drainEvents().length, 0, 'no routine pedestrian collisions');
    assert.ok(!w.bridge.drainEvents().some(e => e.event.kind === 'impact'), 'no routine traffic collisions');
    for (const p of w.people.people) assert.ok(Number.isFinite(p.x + p.z + p.speed));
  }
  assert.equal(w.people.people.length, 3); assert.ok(w.people.completed >= 6); assert.ok(w.traffic.completed > 0);
  t.diagnostic(`Busy traffic, three pedestrians, player and neighborhood: ${((performance.now() - start) / (600 * 120)).toFixed(3)} ms/fixed step on this host`);
});


test('failure-to-yield example produces an impact with ordinary Drive and accelerator controls', async t => {
  const w = await world(t, { spawn: PEDESTRIAN_SCENARIOS['pedestrian-collision'].spawn });
  loadPedestrianScenario(w.people, w.traffic, 'pedestrian-collision');
  assert.ok(w.sim.selectGear('D'));
  for (let i = 0; i < 6 * 120; i++) w.step({ ...released, forward: true });
  assert.equal(w.people.people[0].state, 'fallen'); assert.equal(w.people.drainEvents().length, 1);
});

test('the occluding parked sedan remains finite-mass, moves and takes damage when struck, without route recovery snapping', async t => {
  const w = await world(t, { environment: 'flat', spawn: { x: 6.2, z: -34, heading: 0 } });
  loadPedestrianScenario(w.people, w.traffic, 'pedestrian-occluded'); w.people.clear();
  w.bridge.sync(w.traffic.cars); const car = w.traffic.cars[0], body = w.bridge.getBody(car.id);
  w.sim.selectGear('N'); w.sim.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
  w.advance(3);
  assert.ok(car.z < -45, 'parked prop is pushed down the road');
  assert.ok(car.damage.panels.rear.dent > 0); assert.ok(w.sim.damage.panels.front.dent > 0);
  const position = body.translation(), velocity = body.linvel();
  w.traffic.step(0); w.bridge.sync(w.traffic.cars);
  assert.deepEqual(body.translation(), position); assert.deepEqual(body.linvel(), velocity);
  w.advance(22); assert.equal(w.bridge.getBody(car.id), body, 'a parked scenario fixture does not retire as a failed route recovery');
});
