import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { TrafficPhysics, TRAFFIC_COLLISIONS } from '../src/traffic-physics.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { CAR } from '../src/vehicle-config.ts';
import { createDamageVisuals } from '../src/damage-visuals.ts';
import { createTrafficVisuals } from '../src/traffic-visuals.ts';
import { VehicleDamage } from '../src/vehicle-damage.ts';
import * as THREE from 'three';

const released = { forward: false, reverse: false, left: false, right: false };
async function encounter(t, { spawn = { x: 2.5, z: 27, heading: 0 }, velocity = { x: 0, y: 0, z: -8 }, npcSpeed = 0 } = {}) {
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true, spawn });
  const traffic = new VehicleTraffic(); traffic.density = 'off';
  const car = traffic.add(['middle-n:center>north', 'north-e:north>ne'], 22, npcSpeed);
  const bridge = new TrafficPhysics(sim); bridge.sync(traffic.cars);
  sim.selectGear('N'); sim.body.setLinvel(velocity, true);
  t.after(() => { bridge.clear(); sim.dispose(); });
  const step = (drive = false, input = released) => {
    if (drive) traffic.step(traffic.seconds, sim.state);
    bridge.sync(traffic.cars); sim.step(input); bridge.afterStep(traffic);
  };
  const advance = (seconds, drive = false, input = released) => { for (let i = 0; i < seconds * 120; i++) step(drive, input); };
  return { sim, traffic, car, bridge, step, advance };
}

test('rear impacts transfer momentum to a finite-mass sedan and damage both participants proportionally', async t => {
  const results = [];
  for (const speed of [4, 10]) {
    const { sim, car, bridge, advance } = await encounter(t, { velocity: { x: 0, y: 0, z: -speed } });
    assert.equal(bridge.getBody(car.id).mass(), CAR.mass);
    advance(2);
    assert.ok(car.z < 19.9, 'other sedan moves forward');
    assert.ok(sim.state.z > car.z + CAR.length - 0.1, 'cars remain separated');
    assert.ok(sim.damage.panels.front.dent > 0); assert.ok(car.damage.panels.rear.dent > 0);
    const impacts = bridge.drainEvents().filter(e => e.event.kind === 'impact');
    assert.ok(impacts.some(e => e.event.panel === 'rear' && e.event.material === 'vehicle'));
    results.push({ movement: 20 - car.z, damage: car.damage.panels.rear.dent });
  }
  assert.ok(results[1].movement > results[0].movement + 2);
  assert.ok(results[1].damage > results[0].damage * 2);
});

test('side impacts push and rotate traffic, while head-on impacts damage both front panels', async t => {
  const side = await encounter(t, { spawn: { x: -8, z: 19, heading: -Math.PI / 2 }, velocity: { x: 8, y: 0, z: 0 } });
  side.advance(2);
  assert.ok(side.car.x > 4); assert.ok(Math.abs(side.car.heading) > 0.2);
  assert.ok(side.car.damage.panels.left.dent > 0); assert.ok(side.sim.damage.panels.front.dent > 0);
  const head = await encounter(t, { spawn: { x: 2.5, z: 8, heading: Math.PI }, velocity: { x: 0, y: 0, z: 8 } });
  head.advance(2);
  assert.ok(head.car.z > 22); assert.ok(head.car.damage.panels.front.dent > 0); assert.ok(head.sim.damage.panels.front.dent > 0);
});

test('a moving traffic car damages and nudges a stationary player using relative contact velocity', async t => {
  const { sim, car, advance } = await encounter(t, { spawn: { x: 2.5, z: 10, heading: 0 }, velocity: { x: 0, y: 0, z: 0 }, npcSpeed: 8 });
  advance(2);
  assert.ok(sim.state.z < 9, 'stationary player is nudged');
  assert.ok(sim.damage.panels.rear.dent > 0); assert.ok(car.damage.panels.front.dent > 0);
});

test('a low-angle glancing scrape marks both contacting sides without frontal impact dents', async t => {
  const { sim, car, bridge, advance } = await encounter(t, { spawn: { x: 0.55, z: 21, heading: -Math.atan(0.1) }, velocity: { x: 0.6, y: 0, z: -6 } });
  advance(1);
  assert.ok(sim.damage.panels.right.scratch > 0); assert.ok(car.damage.panels.left.scratch > 0);
  assert.equal(sim.damage.panels.front.dent, 0); assert.equal(car.damage.panels.left.dent, 0);
  const events = bridge.drainEvents();
  assert.ok(events.some(e => e.event.kind === 'scrape-start')); assert.ok(events.some(e => e.event.kind === 'scrape-end'));
});

test('the controller preserves collision pose and velocity, then recovers gradually toward its lane', async t => {
  const { sim, traffic, car, bridge, advance } = await encounter(t, { spawn: { x: -8, z: 19, heading: -Math.PI / 2 }, velocity: { x: 8, y: 0, z: 0 } });
  advance(1.5);
  const body = bridge.getBody(car.id), pose = body.translation(), rotation = body.rotation(), velocity = body.linvel();
  assert.ok(car.stunnedFor > 0);
  traffic.step(traffic.seconds, sim.state); bridge.sync(traffic.cars);
  assert.deepEqual(body.translation(), pose); assert.deepEqual(body.rotation(), rotation); assert.deepEqual(body.linvel(), velocity);
  // Remove the player as an obstruction to isolate the AI's route recovery.
  sim.body.setTranslation({ x: 140, y: sim.position.y, z: 210 }, true); sim.pause();
  let previous = body.translation(); let maxMovement = 0;
  for (let i = 0; i < 8 * 120; i++) {
    traffic.step(traffic.seconds, sim.state); bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic);
    const current = body.translation(); maxMovement = Math.max(maxMovement, Math.hypot(current.x - previous.x, current.z - previous.z)); previous = current;
  }
  assert.ok(maxMovement < 0.2, 'recovery never teleports the body');
  assert.ok(Math.abs(car.x - 2.5) < 0.3); assert.ok(Math.abs(car.heading) < 0.15);
  assert.equal(car.recovering, false); assert.ok(car.speed > 2);
  assert.ok(car.damage.panels.left.dent > 0, 'damage persists after recovery');
});

test('continued pushing/resting contact cannot repeatedly dent either sedan', async t => {
  const { sim, car, advance } = await encounter(t);
  advance(3); sim.selectGear('D');
  advance(4, false, { ...released, forward: true });
  const dents = [sim.damage.panels.front.dent, car.damage.panels.rear.dent];
  advance(10, false, { ...released, forward: true });
  assert.deepEqual([sim.damage.panels.front.dent, car.damage.panels.rear.dent], dents);
});

test('blocked recovery retires a displaced car and releases its junction reservation and damage registration', async t => {
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true, spawn: { x: 140, z: 210, heading: 0 },
    boxes: [{ x: 10, y: 1, z: 60, width: 0.5, height: 2, depth: 100 }] });
  const traffic = new VehicleTraffic(); traffic.density = 'off';
  const blocked = traffic.add(['middle-s:south>center', 'middle-n:center>north'], 82.9); blocked.x = 20;
  const waiting = traffic.add(['middle-n:north>center', 'middle-s:center>south'], 83.35);
  const bridge = new TrafficPhysics(sim); bridge.sync(traffic.cars); t.after(() => { bridge.clear(); sim.dispose(); });
  for (let i = 0; i < 30 * 120; i++) {
    traffic.step(0, sim.state); bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic);
  }
  assert.equal(bridge.getBody(blocked.id), undefined); assert.ok(!traffic.cars.includes(blocked));
  assert.ok(waiting.distanceTravelled > 10, 'following entry can resume after retirement');
  assert.ok(TRAFFIC_COLLISIONS.recoverySeconds < 30);
  bridge.clear(); traffic.reset(); sim.reset();
  assert.equal(bridge.count, 0); assert.equal(sim.damage.condition, 'undamaged');
});

test('traffic collision/damage/recovery outcomes are identical at 30/60/144 Hz and reset clears them', async t => {
  const snapshots = [];
  for (const fps of [30, 60, 144]) {
    const { sim, car, bridge, step } = await encounter(t);
    const clock = new SimulationClock();
    for (let i = 0; i < fps * 5; i++) clock.advance(1 / fps, () => step());
    const snapshot = { player: sim.position, other: bridge.getBody(car.id).translation(), rotation: bridge.getBody(car.id).rotation(),
      velocity: bridge.getBody(car.id).linvel(), playerDamage: sim.damage.panels, trafficDamage: car.damage.panels, events: bridge.drainEvents() };
    snapshots.push(JSON.stringify(snapshot));
    bridge.pause(); clock.reset(); assert.deepEqual(bridge.getBody(car.id).translation(), snapshot.other);
    bridge.clear(); assert.equal(bridge.count, 0);
    sim.reset(); assert.equal(sim.damage.condition, 'undamaged');
  }
  assert.equal(snapshots[0], snapshots[1]); assert.equal(snapshots[1], snapshots[2]);
});

test('damage visuals restore geometry and paint when a pool slot is reused for another car with the same revision', () => {
  const damage = new VehicleDamage(); damage.panels.rear.dent = 0.8; damage.panels.rear.scratch = 0.5;
  const visual = createDamageVisuals(0x577a96);
  visual.update(damage);
  const rear = visual.group.children.find(m => m.isMesh && m.position.z === 1.6);
  const damaged = new Float32Array(rear.geometry.attributes.position.array);
  const clean = new VehicleDamage(); assert.equal(clean.revision, damage.revision);
  visual.update(clean);
  assert.equal(rear.material.color.getHex(), 0x577a96);
  assert.notDeepEqual(new Float32Array(rear.geometry.attributes.position.array), damaged);
  const scene = new THREE.Scene(), trafficVisuals = createTrafficVisuals(scene), traffic = new VehicleTraffic(); traffic.density = 'off';
  const first = traffic.add(['middle-n:center>north']); first.damage.panels.rear.scratch = 0.8;
  trafficVisuals.update([first], 0);
  const second = traffic.add(['middle-n:center>north']); trafficVisuals.update([second], 0);
  const marks = scene.children[0].children[0].children.filter(m => m.isGroup);
  assert.ok(marks.every(m => !m.visible), 'new car cannot inherit the previous car’s scratches');
});

test('dynamic Busy traffic completes routes without routine impacts and reports shared-world step cost', async t => {
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: { x: 140, z: 210, heading: 0 } });
  const traffic = new VehicleTraffic(); traffic.setDensity('busy'); const bridge = new TrafficPhysics(sim);
  t.after(() => { bridge.clear(); sim.dispose(); });
  const start = performance.now(); let count = 0;
  for (let i = 0; i < 600 * 120; i++) {
    traffic.step(traffic.seconds, sim.state); bridge.sync(traffic.cars); sim.step(released); bridge.afterStep(traffic);
    assert.ok(!bridge.drainEvents().some(e => e.event.kind === 'impact'), `routine traffic collision at ${traffic.seconds}`);
    for (const car of traffic.cars) assert.ok(Number.isFinite(car.x + car.z + car.heading + car.speed));
    count = Math.max(count, bridge.count);
  }
  assert.equal(count, 16); assert.ok(traffic.completed >= 8, `${traffic.completed} completed routes`);
  t.diagnostic(`16 dynamic traffic cars, player, AI and neighborhood physics: ${((performance.now() - start) / (600 * 120)).toFixed(3)} ms/fixed step on this host`);
});
