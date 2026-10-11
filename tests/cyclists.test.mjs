import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic, connectionPose, trafficRoute, trafficStopProgress } from '../src/vehicle-traffic.ts';
import { TrafficPhysics } from '../src/traffic-physics.ts';
import { CyclistPhysics } from '../src/cyclist-physics.ts';
import { CYCLIST } from '../src/cyclist-config.ts';
import { createCyclistVisuals } from '../src/cyclist-visuals.ts';
import { loadCyclistScenario, CYCLIST_SCENARIOS } from '../src/cyclist-scenarios.ts';
import { Pedestrians } from '../src/pedestrians.ts';
import { CAR } from '../src/vehicle-config.ts';
import { LANES, LANE_CONNECTIONS } from '../src/traffic-layout.ts';
import { SimulationClock } from '../src/simulation-clock.ts';

const released = { forward: false, reverse: false, left: false, right: false };
async function world(t, options = {}) {
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: { x: 140, z: 210, heading: 0 }, ...options });
  const traffic = new VehicleTraffic(); traffic.density = 'off'; traffic.weather = options.weather ?? 'dry';
  const cars = new TrafficPhysics(sim), bikes = new CyclistPhysics(sim, traffic), pedestrians = new Pedestrians(sim);
  t.after(() => { bikes.clear(); cars.clear(); pedestrians.clear(); sim.dispose(); });
  let ticks = 0;
  const step = (input = released, signalSeconds = ticks / 120) => {
    ticks++;
    pedestrians.beforeStep(signalSeconds, [...traffic.cars, ...bikes.obstacles(), sim.state]);
    traffic.step(signalSeconds, sim.state, pedestrians.hazards(signalSeconds), [...pedestrians.obstacles(), ...bikes.obstacles()]);
    bikes.sync(traffic.cars); cars.sync(traffic.cars); sim.step(input);
    bikes.afterStep(); cars.afterStep(traffic); pedestrians.afterStep();
  };
  const advance = (seconds, input = released, signal) => { for (let i = 0; i < seconds * 120; i++) step(input, signal); };
  return { sim, traffic, cars, bikes, pedestrians, step, advance };
}

test('a cyclist completes physical lane routes and turns, with an upright coupled rider and no pose snaps', async t => {
  for (const weather of ['dry', 'rain']) {
    const w = await world(t, { weather });
    const actor = w.traffic.add(trafficRoute('middle-n:center>north', 0, 3), 12, 0, 'cyclist');
    w.bikes.sync(w.traffic.cars); const body = w.bikes.getBody(actor.id);
    assert.ok(Math.abs(body.bicycle.mass() - CYCLIST.bicycleMass) < 1e-4); assert.equal(body.rider.mass(), CYCLIST.riderMass);
    assert.equal(w.cars.count, 0); assert.ok(body.joint);
    let old = body.bicycle.translation();
    for (let i = 0; i < 180 * 120 && w.bikes.count; i++) {
      w.step(); if (!w.bikes.count) break;
      const pose = body.bicycle.translation(), q = body.bicycle.rotation();
      assert.ok(Math.hypot(pose.x - old.x, pose.y - old.y, pose.z - old.z) < 0.08); old = pose;
      assert.ok(1 - 2 * (q.x ** 2 + q.z ** 2) > 0.95, 'stays upright on road and turns');
      assert.equal(body.state, 'riding'); assert.equal(w.bikes.drainEvents().length, 0);
    }
    assert.equal(w.traffic.completedCyclists, 1); assert.equal(w.bikes.count, 0);
    assert.equal(body.bicycle.isValid(), false); assert.equal(body.rider.isValid(), false);
  }
});

test('bicycles stop at red signals, complete all-way stops, and yield to entered pedestrians', async t => {
  const w = await world(t);
  const signalLane = LANES.find(l => l.id === 'middle-s:south>center');
  const a = w.traffic.add([signalLane.id, 'middle-n:center>north'], 65, 4, 'cyclist');
  w.advance(12, released, 19);
  assert.equal(a.connectionId, undefined); assert.ok(Math.abs(a.speed) < 0.05);
  assert.ok(a.z - CYCLIST.length / 2 > 76, 'front wheel stays behind stop bar');
  w.advance(10, released, 0); assert.ok(a.z < 72);
  w.bikes.clear(); w.traffic.reset();
  const stopLane = LANES.find(l => l.id === 'middle-n:center>north');
  const b = w.traffic.add([stopLane.id, 'north-e:north>ne'], trafficStopProgress(stopLane, CYCLIST.length), 0, 'cyclist');
  w.advance(0.5); assert.equal(b.connectionId, undefined, 'full stop dwell');
  w.advance(5); assert.ok(b.connectionId, 'then enters the junction');
  w.bikes.clear(); w.traffic.reset();
  const c = w.traffic.add([stopLane.id, 'north-e:north>ne'], 65, 4, 'cyclist');
  const p = w.pedestrians.add('north-middle-n', 1, 2);
  let stopped = false;
  for (let i = 0; i < 18 * 120; i++) {
    w.step();
    if (p.state === 'crossing' && w.pedestrians.completed === 0) { assert.ok(c.z - CYCLIST.length / 2 > -46); stopped ||= Math.abs(c.speed) < 0.05; }
    assert.equal(w.bikes.drainEvents().length, 0); assert.equal(w.pedestrians.drainEvents().length, 0);
  }
  assert.ok(stopped); assert.ok(w.pedestrians.completed > 0); assert.ok(c.z < -46);
});

test('cars follow cyclists at a safe gap and shared reservations resolve an opposing left-turn conflict', async t => {
  const w = await world(t);
  const route = ['middle-n:center>north', 'north-e:north>ne'];
  const cyclist = w.traffic.add(route, 26, 2, 'cyclist'), car = w.traffic.add(route, 3, 6);
  for (let i = 0; i < 12 * 120; i++) {
    w.step(); assert.ok(car.z - cyclist.z > (car.length + cyclist.length) / 2 + 1);
    assert.equal(w.bikes.drainEvents().length, 0); assert.ok(!w.cars.drainEvents().some(e => e.event.kind === 'impact'));
  }
  w.bikes.clear(); w.cars.clear(); loadCyclistScenario(w.traffic, 'cyclist-turn');
  const through = w.traffic.cyclists[0], left = w.traffic.vehicles[0]; let admitted = false;
  for (let i = 0; i < 14 * 120; i++) {
    w.step(released, 0);
    if (through.connectionId) { admitted = true; assert.equal(left.connectionId, undefined, 'left waits for the cyclist to clear'); }
    assert.equal(w.bikes.drainEvents().length, 0); assert.ok(!w.cars.drainEvents().some(e => e.event.kind === 'impact'));
  }
  assert.ok(admitted);
  w.advance(15, released, 0); assert.ok(left.distanceTravelled > 5, 'left turn resumes');
});

test('a manual pass with lateral clearance leaves the rider and bicycle undisturbed; oncoming traffic blocks the passing space', async t => {
  const w = await world(t, { environment: 'flat', spawn: { x: -2.5, z: 30, heading: 0 } });
  const a = w.traffic.add(['middle-n:center>north'], 22, 2, 'cyclist'); w.sim.selectGear('N');
  w.sim.body.setLinvel({ x: 0, y: 0, z: -9 }, true); w.advance(3);
  assert.ok(w.sim.state.z < a.z, 'player passes'); assert.equal(w.bikes.getBody(a.id).state, 'riding');
  assert.equal(w.bikes.drainEvents().length, 0); assert.equal(w.sim.damage.condition, 'undamaged');
  w.bikes.clear(); loadCyclistScenario(w.traffic, 'cyclist-passing');
  assert.equal(w.traffic.cyclists.length, 1); assert.equal(w.traffic.vehicles.length, 1);
  assert.ok(w.traffic.vehicles[0].x < 0); assert.ok(Math.cos(w.traffic.vehicles[0].heading) < -0.9);
});

test('yield approaches give through-route priority to both cyclists and sedans', async t => {
  for (const cyclistThrough of [false, true]) {
    const w = await world(t);
    const minorLane = LANES.find(l => l.id === 'town-e:center>east');
    const throughLane = LANES.find(l => l.id === 'east-n:ne>east');
    const minor = w.traffic.add([minorLane.id, 'east-s:east>se'], trafficStopProgress(minorLane, cyclistThrough ? CAR.length : CYCLIST.length), 0, cyclistThrough ? 'car' : 'cyclist');
    const through = w.traffic.add([throughLane.id, 'east-s:east>se'], trafficStopProgress(throughLane, cyclistThrough ? CYCLIST.length : CAR.length) - 6, 3, cyclistThrough ? 'cyclist' : 'car');
    let admitted = false;
    for (let i = 0; i < 30 * 120; i++) {
      w.step();
      if (through.connectionId) { admitted = true; assert.equal(minor.connectionId, undefined); }
      assert.equal(w.bikes.drainEvents().length, 0);
      assert.ok(!w.cars.drainEvents().some(e => e.event.kind === 'impact'));
    }
    assert.ok(admitted); assert.ok(minor.distanceTravelled > 8, 'minor route resumes after through traffic clears');
  }
});

test('a dry turning cyclist or sedan clears a late curb request before the pedestrian enters', async t => {
  for (const kind of ['car', 'cyclist']) {
    const w = await world(t);
    const route = ['middle-n:center>north', 'north-w:north>nw'];
    const connection = LANE_CONNECTIONS.find(c => c.incoming === route[0] && c.outgoing === route[1]);
    const actor = w.traffic.add(route, 0, 2, kind);
    Object.assign(actor, connectionPose(connection, 6.5), { progress: 6.5, connectionId: connection.id, speed: 2, driveSpeed: 2 });
    const person = w.pedestrians.add('north-middle-n', 1, 0, 0.2);
    let waited = false;
    for (let i = 0; i < 24 * 120; i++) {
      w.step(); waited ||= person.wait === 0 && person.state === 'waiting';
      assert.equal(w.bikes.drainEvents().length, 0); assert.equal(w.pedestrians.drainEvents().length, 0);
      assert.ok(!w.cars.drainEvents().some(e => e.event.kind === 'impact'));
    }
    assert.ok(waited); assert.ok(actor.distanceTravelled > 15); assert.ok(w.pedestrians.completed > 0);
  }
});

async function impact(t, speed, spawn = { x: 2.5, z: 30, heading: 0 }, velocity = { x: 0, y: 0, z: -speed }, npc = false) {
  const w = await world(t, { environment: 'flat', spawn });
  const actor = w.traffic.add(['middle-n:center>north'], 22, 0, 'cyclist'); actor.parked = true;
  w.bikes.sync(w.traffic.cars); const entry = w.bikes.getBody(actor.id);
  if (npc) {
    w.sim.body.setTranslation({ x: 140, y: w.sim.position.y, z: 210 }, true);
    const car = w.traffic.add(['middle-n:center>north'], 12, speed); car.parked = true; w.cars.sync(w.traffic.cars);
  } else { w.sim.selectGear('N'); w.sim.body.setLinvel(velocity, true); }
  let peak = 0;
  for (let i = 0; i < 4 * 120; i++) {
    w.step(); const v = entry.bicycle.linvel(); peak = Math.max(peak, Math.hypot(v.x, v.y, v.z));
  }
  return { ...w, entry, actor, peak };
}

test('rear and AI impacts separate rider and bicycle, retain physical momentum, and damage the contacting sedan', async t => {
  const low = await impact(t, 2), high = await impact(t, 8), npc = await impact(t, 8, undefined, undefined, true);
  for (const w of [low, high, npc]) {
    const e = w.entry; assert.equal(e.state, 'fallen'); assert.equal(e.joint, undefined); assert.ok(e.actor.fallen);
    assert.equal(w.bikes.drainEvents().length, 1);
    const before = [e.bicycle, e.rider].map(b => ({ pos: b.translation(), q: b.rotation(), v: b.linvel() }));
    w.traffic.step(0); w.bikes.sync(w.traffic.cars);
    for (const [i, b] of [e.bicycle, e.rider].entries()) {
      assert.deepEqual(b.translation(), before[i].pos); assert.deepEqual(b.rotation(), before[i].q); assert.deepEqual(b.linvel(), before[i].v);
      assert.deepEqual({ ...b.userForce() }, { x: 0, y: 0, z: 0 }); assert.deepEqual({ ...b.userTorque() }, { x: 0, y: 0, z: 0 });
    }
    w.advance(8); assert.equal(w.bikes.drainEvents().length, 0, 'resting contact never retriggers the fall');
  }
  assert.ok(high.peak > low.peak * 2); assert.ok(high.entry.bicycle.translation().z < low.entry.bicycle.translation().z - 5);
  for (const b of [high.entry.rider, high.entry.bicycle]) { const q = b.rotation(); assert.ok(1 - 2 * (q.x ** 2 + q.z ** 2) < 0.5, 'parts topple independently'); }
  assert.ok(high.sim.damage.panels.front.dent > 0); assert.ok(npc.traffic.vehicles[0].damage.panels.front.dent > 0);
});

test('side, glancing and maximum-speed contacts displace parts without tunneling or erasing tangential car motion', async t => {
  const side = await impact(t, 8, { x: -5, z: 20.4, heading: -Math.PI / 2 }, { x: 8, y: 0, z: 0 });
  assert.equal(side.entry.state, 'fallen'); assert.ok(side.entry.bicycle.translation().x > 3.5);
  const glancing = await impact(t, 8, { x: 1.45, z: 26, heading: 0 });
  assert.equal(glancing.entry.state, 'fallen'); assert.ok(glancing.sim.state.z < 18); assert.ok(glancing.entry.bicycle.translation().x > 2.8);
  const fast = await impact(t, 115 / 2.236936);
  assert.equal(fast.entry.state, 'fallen'); assert.ok(fast.peak > 20); assert.equal(fast.bikes.drainEvents().length, 1);
  for (const b of [fast.entry.rider, fast.entry.bicycle]) { assert.ok(b.isCcdEnabled()); const p = b.translation(); assert.ok(Number.isFinite(p.x + p.y + p.z)); }
});

test('a bicycle striking a pedestrian disables both controllers and produces physical falls', async t => {
  const w = await world(t, { environment: 'flat' });
  const bike = w.traffic.add(['middle-n:center>north'], 87, 5, 'cyclist'); bike.parked = true;
  const person = w.pedestrians.add('north-middle-n', 1, 9); w.advance(3);
  assert.equal(w.bikes.getBody(bike.id).state, 'fallen'); assert.equal(person.state, 'fallen');
  assert.equal(w.bikes.drainEvents().length, 1); assert.equal(w.pedestrians.drainEvents().length, 1);
});

test('cyclist density is independent, spawns stay clear, and disable/reset/retirement remove both bodies and joints', async t => {
  const w = await world(t); w.traffic.setCyclists(true, w.sim.state); w.bikes.sync(w.traffic.cars);
  assert.equal(w.traffic.cyclists.length, 2); assert.equal(w.bikes.count, 2);
  const bodies = w.bikes.riders.flatMap(e => [e.bicycle, e.rider]), count = w.sim.world.bodies.len() - 4;
  w.traffic.setDensity('busy', w.sim.state); w.cars.sync(w.traffic.cars);
  assert.equal(w.traffic.vehicles.length, 16); assert.equal(w.traffic.cyclists.length, 2);
  for (const cyclist of w.traffic.cyclists) for (const car of w.traffic.vehicles) assert.ok(Math.hypot(cyclist.x - car.x, cyclist.z - car.z) >= 18);
  w.traffic.setDensity('off'); w.cars.sync(w.traffic.cars); assert.equal(w.bikes.count, 2);
  w.traffic.setCyclists(false); w.bikes.sync(w.traffic.cars);
  assert.equal(w.bikes.count, 0); assert.ok(bodies.every(b => !b.isValid())); assert.equal(w.sim.world.bodies.len(), count); assert.equal(w.sim.world.impulseJoints.len(), 0);
  const crashed = await impact(t, 8); const old = crashed.entry;
  crashed.advance(CYCLIST.retirementSeconds);
  assert.equal(crashed.bikes.count, 0); assert.ok(!crashed.traffic.cars.includes(crashed.actor));
  assert.equal(old.bicycle.isValid(), false); assert.equal(old.rider.isValid(), false);
  for (let i = 0; i < 5; i++) { w.traffic.setCyclists(true); w.bikes.sync(w.traffic.cars); w.bikes.clear(); w.traffic.reset(); }
  w.bikes.sync([]); assert.equal(w.sim.world.impulseJoints.len(), 0); assert.equal(w.sim.world.bodies.len(), count);
});

test('collision example works with ordinary controls; rider/bicycle state and events agree at 30/60/144 Hz', async t => {
  const snapshots = [];
  for (const fps of [30, 60, 144]) {
    const w = await world(t, { spawn: CYCLIST_SCENARIOS['cyclist-collision'].spawn });
    loadCyclistScenario(w.traffic, 'cyclist-collision'); w.bikes.sync(w.traffic.cars);
    const entry = w.bikes.riders[0]; assert.ok(w.sim.selectGear('D'));
    const clock = new SimulationClock();
    for (let i = 0; i < fps * 6; i++) clock.advance(1 / fps, () => w.step({ ...released, forward: true }));
    assert.equal(entry.state, 'fallen');
    snapshots.push(JSON.stringify({ bodies: [entry.rider, entry.bicycle].map(b => ({ p: b.translation(), q: b.rotation(), v: b.linvel() })), events: w.bikes.drainEvents(), player: w.sim.position, damage: w.sim.damage.panels }));
    const saved = entry.rider.translation(); clock.reset(); assert.deepEqual(entry.rider.translation(), saved);
  }
  assert.equal(snapshots[0], snapshots[1]); assert.equal(snapshots[1], snapshots[2]);
});

test('pooled visuals follow each physical body, disable pedaling after a fall, and expose lamps at night/in rain', async t => {
  const w = await impact(t, 8); const scene = new THREE.Scene(), visuals = createCyclistVisuals(scene);
  visuals.update(w.bikes.riders, 4, 'night');
  for (const [i, b] of [w.entry.bicycle, w.entry.rider].entries()) {
    assert.equal(scene.children[i].position.y, b.translation().y); assert.equal(scene.children[i].quaternion.x, b.rotation().x);
  }
  const legs = scene.children[1].children.filter(c => c.isGroup); assert.ok(legs.every(l => l.rotation.x === 0));
  const lamps = scene.children[0].children.filter(c => c.isMesh && c.material.emissiveIntensity === 2);
  assert.ok(lamps.every(l => l.visible)); visuals.update(w.bikes.riders, 5, 'day'); assert.ok(lamps.every(l => !l.visible));
  visuals.update(w.bikes.riders, 6, 'day', 'rain'); assert.ok(lamps.every(l => l.visible));
  visuals.update([], 6); assert.ok(scene.children.every(g => !g.visible));
});

test('Busy traffic, cyclists and pedestrians complete shared-world routes in dry and rain without routine impacts', async t => {
  for (const weather of ['dry', 'rain']) {
    const w = await world(t, { weather }); w.traffic.setDensity('busy'); w.traffic.setCyclists(true); w.pedestrians.reset();
    const start = performance.now(); let maxBikes = 0, earlierProgress;
    for (let i = 0; i < 600 * 120; i++) {
      w.step(); maxBikes = Math.max(maxBikes, w.bikes.count);
      if (i === 360 * 120) earlierProgress = new Map(w.traffic.cars.map(a => [a.id, a.distanceTravelled]));
      assert.equal(w.bikes.drainEvents().length, 0, `routine cyclist collision in ${weather} at ${i / 120}`);
      assert.equal(w.pedestrians.drainEvents().length, 0);
      assert.ok(!w.cars.drainEvents().some(e => e.event.kind === 'impact'), `routine car collision in ${weather} at ${i / 120}`);
      for (const e of w.bikes.riders) { assert.equal(e.state, 'riding'); const p = e.rider.translation(); assert.ok(Number.isFinite(p.x + p.y + p.z)); }
    }
    assert.equal(maxBikes, 2); assert.ok(w.traffic.completedCyclists >= 2); assert.ok(w.traffic.completed >= 8); assert.ok(w.pedestrians.completed >= 30);
    for (const actor of w.traffic.cars) if (earlierProgress.has(actor.id)) {
      assert.ok(actor.distanceTravelled - earlierProgress.get(actor.id) > 5, `surviving ${actor.kind} ${actor.id} makes progress over the final four minutes`);
    }
    t.diagnostic(`${weather}: ${w.traffic.completed} car routes, ${w.traffic.completedCyclists} bicycle routes, ${w.pedestrians.completed} crossings; ${((performance.now() - start) / (600 * 120)).toFixed(3)} ms/shared step on this host`);
  }
});
