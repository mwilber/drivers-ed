import assert from 'node:assert/strict';
import test from 'node:test';
import { DriverInput, DEFAULT_BINDINGS } from '../src/driver-input.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { indicatorLit } from '../src/simulation.ts';
import { FIXED_STEP, SimulationClock } from '../src/simulation-clock.ts';
import { IDLE } from '../scripts/handling-scenarios.mjs';

function stepFor(sim, seconds, input = IDLE) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) sim.step(input);
}
async function setup(t, options = {}) {
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true, ...options });
  t.after(() => sim.dispose());
  return sim;
}

test('explicit pedals launch only in D/R; S brakes without changing direction and wins over W', async t => {
  const sim = await setup(t);
  assert.equal(sim.state.selectedGear, 'P');
  const start = { ...sim.position };
  stepFor(sim, 2, { ...IDLE, forward: true });
  assert.equal(sim.state.gear, 0);
  assert.ok(Math.hypot(sim.position.x - start.x, sim.position.z - start.z) < 0.01);
  assert.equal(sim.selectGear('D'), true);
  stepFor(sim, 0.2, { ...IDLE, forward: true });
  assert.ok(Math.abs(sim.state.speed) < 0.03, 'selection has a short power interlock');
  stepFor(sim, 3, { ...IDLE, forward: true });
  assert.ok(sim.state.speed > 5);
  stepFor(sim, 3, { ...IDLE, reverse: true, forward: true });
  assert.equal(sim.state.speed, 0);
  assert.equal(sim.state.throttle, 0);
  assert.equal(sim.state.selectedGear, 'D');
  stepFor(sim, 1, { ...IDLE, left: true, right: true });
  assert.equal(sim.state.steering, 0, 'opposing steering cancels');
  stepFor(sim, 2, { ...IDLE, reverse: true });
  assert.equal(sim.state.speed, 0, 'S never engages reverse');
  assert.equal(sim.selectGear('R'), true);
  stepFor(sim, 2, { ...IDLE, forward: true });
  assert.ok(sim.state.speed < -1);
  stepFor(sim, 2, { ...IDLE, reverse: true });
  assert.equal(sim.state.speed, 0);
  assert.equal(sim.state.gear, -1);
});

test('unsafe gear requests reject immediately and never engage later; neutral can coast', async t => {
  const sim = await setup(t);
  sim.selectGear('D');
  stepFor(sim, 3, { ...IDLE, forward: true });
  const gear = sim.state.gear;
  assert.equal(sim.selectGear('R'), false);
  assert.equal(sim.selectGear('P'), false);
  assert.equal(sim.state.gear, gear);
  assert.equal(sim.state.selectedGear, 'D');
  assert.equal(sim.selectGear('N'), true);
  assert.equal(sim.state.throttle, 0);
  stepFor(sim, 0.5, { ...IDLE, forward: true });
  assert.equal(sim.state.gear, 0);
  assert.equal(sim.state.throttle, 0);
  assert.ok(sim.state.speed > 3, 'Neutral must not lock a moving car');
  assert.equal(sim.selectGear('D'), false, 'engaging from Neutral requires a stop');
  stepFor(sim, 3, { ...IDLE, reverse: true });
  assert.equal(sim.state.speed, 0);
  assert.equal(sim.state.selectedGear, 'N');
  assert.equal(sim.selectGear('R'), true);
  stepFor(sim, 2, { ...IDLE, forward: true });
  assert.equal(sim.selectGear('D'), false, 'reverse-to-drive has the same interlock');
  assert.equal(sim.selectGear('P'), false);
});

test('selector interlock checks lateral and airborne motion as well as signed speed', async t => {
  const sim = await setup(t);
  sim.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
  assert.equal(sim.selectGear('R'), false);
  assert.equal(sim.state.speed, 0);
  sim.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  assert.equal(sim.selectGear('D'), false);
  sim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  assert.equal(sim.selectGear('D'), true);
});

test('parking brake arrests motion, cuts power and permits launch after release', async t => {
  const sim = await setup(t);
  sim.selectGear('D');
  stepFor(sim, 3, { ...IDLE, forward: true });
  stepFor(sim, 4, { ...IDLE, forward: true, parkingBrake: true });
  assert.equal(sim.state.speed, 0);
  assert.equal(sim.state.throttle, 0);
  assert.equal(sim.state.selectedGear, 'D');
  assert.equal(sim.state.parkingBrake, true);
  stepFor(sim, 2, { ...IDLE, forward: true });
  assert.ok(sim.state.speed > 2);
});

test('Park and parking brake each hold on the test ramp', async t => {
  for (const [parkingBrake, damaged] of [[false, false], [true, false], [true, true]]) {
    const sim = await setup(t, { environment: 'neighborhood', spawn: { x: 84, z: -134, heading: 0 } });
    if (parkingBrake) sim.selectGear('N');
    if (damaged) {
      sim.damage.panels.front.dent = 1;
      sim.damage.suspension.fill(1);
    }
    stepFor(sim, 1, { ...IDLE, parkingBrake });
    const position = { ...sim.position };
    stepFor(sim, 8, { ...IDLE, parkingBrake });
    assert.ok(Math.abs(sim.position.z - position.z) < 0.15);
    assert.ok(sim.up.y > 0.98);
    assert.equal(sim.contacts, 4);
  }
});

test('device overlap, opposite steering, repeat presses and interruption do not stick controls', () => {
  const input = new DriverInput();
  input.press('key:W', 'forward');
  input.press('pointer:1', 'forward');
  input.release('key:W');
  assert.equal(input.snapshot().forward, true);
  input.press('pointer:2', 'horn');
  input.press('key:Q', 'indicatorLeft');
  assert.equal(input.press('key:Q', 'indicatorLeft'), undefined);
  assert.equal(input.indicator, 'left');
  input.press('key:A', 'left');
  input.press('key:D', 'right');
  assert.equal(input.snapshot().left, true);
  assert.equal(input.snapshot().right, true);
  input.press('key:B', 'parkingBrake');
  input.press('key:H', 'headlights');
  input.clear();
  assert.deepEqual(input.snapshot(), { ...IDLE, horn: false, parkingBrake: true, headlights: true, indicator: 'left' });
  input.press('key:E', 'indicatorRight');
  assert.equal(input.indicator, 'right');
  input.release('key:E');
  input.press('key:E', 'indicatorRight');
  assert.equal(input.indicator, 'off');
  input.press('key:X', 'hazards');
  assert.equal(input.indicator, 'hazards');
  input.reset();
  assert.deepEqual(input.snapshot(), { ...IDLE, horn: false, parkingBrake: false, headlights: false, indicator: 'off' });
});

test('bindings round-trip, reject conflicts and reserved keys, clear held sources, and recover corrupt storage', () => {
  const input = new DriverInput();
  assert.ok(input.remap('horn', 'KeyW'));
  assert.ok(input.remap('horn', 'Escape'));
  assert.equal(input.actionForKey('Space'), 'horn');
  input.press('key:Space', 'horn');
  assert.equal(input.remap('horn', 'KeyU'), undefined);
  assert.equal(input.snapshot().horn, false);
  assert.equal(input.actionForKey('Space'), undefined);
  const restored = new DriverInput();
  restored.load(input.serialize());
  assert.deepEqual(restored.bindings, input.bindings);
  for (const corrupt of ['invalid', '{}', '{"version":2}', JSON.stringify({ version: 1, bindings: { ...DEFAULT_BINDINGS, horn: ['KeyW'] } })]) {
    restored.load(corrupt);
    assert.equal(restored.actionForKey('KeyU'), 'horn');
  }
  restored.restoreDefaults();
  assert.deepEqual(restored.bindings, DEFAULT_BINDINGS);
});

test('switches use simulation time, pause releases horn, repair preserves controls and reset clears them', async t => {
  const sim = await setup(t);
  const input = { ...IDLE, headlights: true, indicator: 'hazards', horn: true, parkingBrake: true };
  sim.step(input);
  assert.equal(indicatorLit(sim.state), true);
  stepFor(sim, 0.6, input);
  assert.equal(indicatorLit(sim.state), false);
  assert.equal(sim.state.headlights, true);
  assert.equal(sim.state.horn, true);
  sim.repair();
  assert.equal(sim.state.parkingBrake, true);
  assert.equal(sim.state.indicator, 'hazards');
  sim.pause();
  assert.equal(sim.state.horn, false);
  assert.equal(sim.state.throttle, 0);
  sim.reset();
  assert.equal(sim.state.selectedGear, 'P');
  assert.equal(sim.state.parkingBrake, false);
  assert.equal(sim.state.indicator, 'off');
  assert.equal(sim.state.headlights, false);
});

test('explicit controls, indicator timing and parking brake agree at 30/60/144 Hz', async () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true });
    const clock = new SimulationClock();
    try {
      sim.selectGear('D');
      for (const [seconds, input] of [[3, { ...IDLE, forward: true, headlights: true, indicator: 'left' }], [3, { ...IDLE, parkingBrake: true, indicator: 'hazards' }]]) {
        for (let frame = 0; frame < seconds * fps; frame++) clock.advance(1 / fps, dt => sim.step(input, dt));
      }
      results.push({ state: { ...sim.state }, position: { ...sim.position }, rotation: { ...sim.rotation } });
    } finally { sim.dispose(); }
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});
