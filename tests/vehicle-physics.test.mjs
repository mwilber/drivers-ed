import assert from 'node:assert/strict';
import test from 'node:test';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { FIXED_STEP, SimulationClock } from '../src/simulation-clock.ts';
import { IDLE, MPH } from '../scripts/handling-scenarios.mjs';
import { measurePhysics } from '../scripts/physics-scenarios.mjs';
import { CAR, SUSPENSION } from '../src/vehicle-config.ts';

function stepFor(sim, seconds, input = IDLE) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) sim.step(input);
}
function finite(sim) {
  for (const value of [...Object.values(sim.position), ...Object.values(sim.rotation), sim.state.speed]) assert.ok(Number.isFinite(value));
}
async function setup(t, options = {}) {
  const sim = await createVehiclePhysics(options);
  t.after(() => sim.dispose());
  return sim;
}

test('rigid-body sedan preserves acceleration, braking, top speed and parking maneuver targets', async () => {
  const result = await measurePhysics();
  assert.ok(result.zeroTo30Seconds >= 5 && result.zeroTo30Seconds <= 7);
  assert.ok(result.stoppingDistanceMetres >= 12 && result.stoppingDistanceMetres <= 17);
  assert.ok(result.coastSpeedAfter5SecondsMph >= 22 && result.coastSpeedAfter5SecondsMph <= 26);
  assert.ok(result.sustainedTopSpeedMph >= 110 && result.sustainedTopSpeedMph <= 115);
  assert.ok(result.lowSpeedTurnRadiusMetres >= 4.8 && result.lowSpeedTurnRadiusMetres <= 5.7);
  assert.deepEqual(result.launchGears, [1, 2, 3]);
});

test('four suspension contacts settle and remain stable on flat pavement', async t => {
  const sim = await setup(t);
  const initial = { ...sim.position };
  stepFor(sim, 20);
  finite(sim);
  assert.equal(sim.body.mass(), CAR.mass);
  assert.equal(sim.contacts, 4);
  assert.ok(Math.abs(sim.position.y - initial.y) < 0.005);
  assert.ok(Math.hypot(sim.position.x - initial.x, sim.position.z - initial.z) < 0.01);
  assert.ok(sim.up.y > 0.999);
  for (const wheel of sim.wheels) assert.ok(wheel.suspensionLength > 0.2 && wheel.suspensionLength < SUSPENSION.restLength);
});

test('the main street, intersection and parking-lot entrance remain flush and driveable', async t => {
  const sim = await setup(t);
  let reached = false;
  for (let i = 0; i < 60 / FIXED_STEP; i++) {
    sim.step({ ...IDLE, forward: sim.state.speed < 4 });
    finite(sim);
    assert.ok(sim.up.y > 0.99);
    assert.equal(sim.contacts, 4);
    if (sim.state.z < -125) { reached = true; break; }
  }
  assert.ok(reached, 'road/sidewalk colliders must not block the entrance');
});

test('the car climbs and descends the test ramp, pitches, and settles back on pavement', async t => {
  const sim = await setup(t, { spawn: { x: 84, z: -120, heading: 0 } });
  let maxHeight = 0, maxPitch = 0;
  for (let i = 0; i < 22 / FIXED_STEP; i++) {
    sim.step({ ...IDLE, forward: sim.state.speed < 2 });
    finite(sim);
    maxHeight = Math.max(maxHeight, sim.position.y);
    maxPitch = Math.max(maxPitch, Math.abs(sim.up.z));
    assert.ok(sim.up.y > 0.98);
    if (sim.state.z < -164) break; // Brake on the pad, before its north perimeter curb.
  }
  assert.ok(sim.state.z < -161);
  assert.ok(maxHeight > 1.8 && maxHeight < 2.05, 'body must climb the 1.2 m ramp');
  assert.ok(maxPitch > 0.07 && maxPitch < 0.2);
  stepFor(sim, 2, { ...IDLE, forward: true, reverse: true });
  assert.ok(sim.position.y < 0.72);
  assert.equal(sim.contacts, 4);
});

test('the rigid-body controls retain held steering and brake before changing direction', async t => {
  const sim = await setup(t, { environment: 'flat' });
  stepFor(sim, 2, { ...IDLE, forward: true, left: true });
  assert.equal(sim.state.steering, 0.5);
  assert.ok(sim.state.heading > 0 && sim.state.speed > 0);
  stepFor(sim, 1, { ...IDLE, left: true });
  assert.equal(sim.state.steering, 0.5);
  stepFor(sim, 0.1, { ...IDLE, reverse: true });
  assert.ok(sim.state.speed > 0 && sim.state.gear > 0);
  stepFor(sim, 3, { ...IDLE, reverse: true });
  assert.equal(sim.state.gear, -1);
  assert.ok(sim.state.speed < -1);
  assert.equal(sim.state.steering, 0);
  stepFor(sim, 3, { ...IDLE, forward: true });
  assert.ok(sim.state.speed > 0 && sim.state.gear > 0);
});

test('brakes hold the sedan on the shallow test slope', async t => {
  const sim = await setup(t, { spawn: { x: 84, z: -134, heading: 0 } });
  stepFor(sim, 1, { ...IDLE, forward: true, reverse: true });
  const initial = { ...sim.position };
  stepFor(sim, 8, { ...IDLE, forward: true, reverse: true });
  assert.ok(Math.abs(sim.position.z - initial.z) < 0.15);
  assert.ok(sim.up.y > 0.98);
  assert.equal(sim.contacts, 4);
});

test('curb traversal moves individual suspension points and produces body roll', async t => {
  const sim = await setup(t, { spawn: { x: 106.1, z: -128, heading: 0 } });
  let maxRoll = 0, maxTravelDifference = 0, lowestContacts = 4;
  for (let i = 0; i < 20 / FIXED_STEP; i++) {
    sim.step({ ...IDLE, forward: sim.state.speed < 2 });
    finite(sim);
    maxRoll = Math.max(maxRoll, Math.abs(sim.up.x));
    maxTravelDifference = Math.max(maxTravelDifference, Math.abs(sim.wheels[0].suspensionLength - sim.wheels[1].suspensionLength));
    lowestContacts = Math.min(lowestContacts, sim.contacts);
  }
  assert.ok(sim.state.z < -158);
  assert.ok(maxRoll > 0.05 && maxRoll < 0.2);
  assert.ok(maxTravelDifference > 0.05);
  assert.ok(lowestContacts >= 2);
  assert.equal(sim.contacts, 4);
  assert.ok(sim.up.y > 0.999);
});

test('an airborne vehicle loses wheel contact and lands without invalid state', async t => {
  const sim = await setup(t, { environment: 'flat' });
  sim.body.setTranslation({ x: 2.5, y: 4, z: 48 }, true);
  stepFor(sim, 0.1, { ...IDLE, forward: true });
  assert.equal(sim.contacts, 0);
  assert.ok(Math.abs(sim.state.speed) < 0.05, 'airborne wheels must not propel the car');
  stepFor(sim, 4);
  finite(sim);
  assert.equal(sim.contacts, 4);
  assert.ok(sim.position.y > 0.65 && sim.position.y < 0.73);
  assert.ok(sim.up.y > 0.99);
});

test('continuous collision detection stops tunneling through a thin wall at 115 mph', async t => {
  const sim = await setup(t, { environment: 'flat', spawn: { x: 0, z: 20, heading: 0 },
    boxes: [{ x: 0, y: 5, z: 0, width: 30, height: 10, depth: 0.2 }] });
  sim.body.setLinvel({ x: 0, y: 0, z: -115 / MPH }, true);
  for (let i = 0; i < 240; i++) {
    sim.step(IDLE);
    finite(sim);
    assert.ok(sim.position.z > 0.1, 'chassis must remain on the approach side');
  }
  assert.ok(Math.abs(sim.state.speed) < 3, 'impact must dissipate the approach speed');
  const stoppedZ = sim.position.z;
  stepFor(sim, 3, { ...IDLE, reverse: true });
  assert.ok(sim.position.z > stoppedZ + 3, 'can reverse away after an impact');
});

test('a glancing impact retains motion along the wall instead of zeroing all velocity', async t => {
  const heading = -0.2;
  const sim = await setup(t, { environment: 'flat', spawn: { x: -3, z: 20, heading },
    boxes: [{ x: 0, y: 3, z: 0, width: 0.2, height: 6, depth: 200 }] });
  sim.body.setLinvel({ x: -Math.sin(heading) * 12, y: 0, z: -Math.cos(heading) * 12 }, true);
  stepFor(sim, 2);
  finite(sim);
  assert.ok(sim.position.x < -0.9 && sim.position.x > -1.5, 'car is alongside the wall');
  assert.ok(sim.position.z < 5 && sim.body.linvel().z < -4, 'tangential motion survives contact');
  assert.ok(sim.up.y > 0.98);
});

test('reset recovers an overturned vehicle and clears all motion and suspension state', async t => {
  const sim = await setup(t);
  stepFor(sim, 2, { ...IDLE, forward: true, left: true });
  sim.body.setTranslation({ x: 20, y: 3, z: 20 }, true);
  sim.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
  sim.step(IDLE);
  assert.ok(sim.needsRecovery);
  for (let reset = 0; reset < 3; reset++) {
    sim.reset();
    assert.equal(sim.state.gear, 0);
    assert.equal(sim.state.speed, 0);
    assert.equal(sim.state.steering, 0);
    assert.equal(sim.contacts, 4);
    assert.equal(sim.needsRecovery, false);
    assert.ok(Math.abs(sim.position.x - 2.5) < 0.01 && Math.abs(sim.position.z - 48) < 0.01);
    assert.ok(sim.up.y > 0.999);
  }
});

test('real physics follows the same timed inputs across rendering frame rates', async () => {
  const poses = [];
  for (const fps of [30, 60, 144]) {
    const sim = await createVehiclePhysics({ environment: 'flat' });
    const clock = new SimulationClock();
    try {
      for (const [seconds, input] of [[2, { ...IDLE, forward: true }], [2, { ...IDLE, forward: true, left: true }], [2, { ...IDLE, reverse: true }]]) {
        for (let frame = 0; frame < seconds * fps; frame++) clock.advance(1 / fps, dt => sim.step(input, dt));
      }
      poses.push({ position: { ...sim.position }, rotation: { ...sim.rotation }, speed: sim.state.speed });
    } finally { sim.dispose(); }
  }
  assert.deepEqual(poses[0], poses[1]);
  assert.deepEqual(poses[1], poses[2]);
});
