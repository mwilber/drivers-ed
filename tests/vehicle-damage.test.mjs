import assert from 'node:assert/strict';
import test from 'node:test';
import { VehicleDamage, damagePanelAt } from '../src/vehicle-damage.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { createDamageVisuals } from '../src/damage-visuals.ts';
import { CAR, DAMAGE, SUSPENSION } from '../src/vehicle-config.ts';
import { FIXED_STEP, SimulationClock } from '../src/simulation-clock.ts';
import { TEST_RAMP } from '../src/world-layout.ts';
import { IDLE } from '../scripts/handling-scenarios.mjs';

const wall = { x: 0, y: 3, z: 0, width: 30, height: 6, depth: 0.2 };
const spawn = { x: 0, z: 6, heading: 0 };
function stepFor(sim, seconds, input = IDLE) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) sim.step(input);
}
async function setup(t, options = {}) {
  const sim = await createVehiclePhysics({ environment: 'flat', spawn, boxes: [wall], ...options });
  t.after(() => sim.dispose());
  return sim;
}
function contact(overrides = {}) {
  return { obstacle: 1, point: { x: 0, y: 0.6, z: 0 }, localPoint: { x: -0.6, y: 0, z: -2.2 },
    normal: { x: 0, y: 0, z: -1 }, localNormal: { x: 0, y: 0, z: -1 },
    closingSpeed: 8, tangentSpeed: 0, impulse: CAR.mass * 8, material: 'concrete', ...overrides };
}

test('contact face distinguishes front/rear/side/roof, including front corners', () => {
  assert.equal(damagePanelAt({ x: 0.91, y: 0, z: -2.2 }, { x: 0, y: 0, z: -1 }), 'front');
  assert.equal(damagePanelAt({ x: 0, y: 0, z: 2.2 }), 'rear');
  assert.equal(damagePanelAt({ x: -0.9, y: 0, z: 0 }), 'left');
  assert.equal(damagePanelAt({ x: 0.9, y: 0, z: 0 }), 'right');
  assert.equal(damagePanelAt({ x: 0, y: 1, z: 0 }), 'roof');
});

test('same continuing collision damages once; a separate impact accumulates damage', () => {
  const damage = new VehicleDamage();
  for (let i = 0; i < 600; i++) damage.update([contact()], FIXED_STEP);
  assert.equal(damage.drainEvents().filter(e => e.kind === 'impact').length, 1);
  const first = damage.panels.front.dent;
  damage.update([], 0.5);
  damage.update([contact()], FIXED_STEP);
  assert.ok(damage.panels.front.dent > first);
  assert.equal(damage.drainEvents().filter(e => e.kind === 'impact').length, 1);
});

test('resting forces do no damage; moving scrapes are cosmetic and end on stop', () => {
  const damage = new VehicleDamage();
  const rest = contact({ closingSpeed: 0, tangentSpeed: 0, impulse: CAR.mass * 10 });
  for (let i = 0; i < 1200; i++) damage.update([rest], FIXED_STEP);
  assert.equal(damage.condition, 'undamaged');
  assert.deepEqual(damage.drainEvents(), []);
  const scrape = { ...rest, tangentSpeed: 4 };
  for (let i = 0; i < 120; i++) damage.update([scrape], FIXED_STEP);
  assert.ok(Math.abs(damage.panels.front.scratch - 4 * DAMAGE.scratchPerMetre) < 1e-9);
  assert.equal(damage.panels.front.dent, 0);
  assert.deepEqual(damage.effects, { power: 1, steeringBias: 0, suspension: [1, 1, 1, 1] });
  const events = damage.drainEvents();
  assert.equal(events[0].kind, 'scrape-start');
  assert.ok(events.length <= 5, 'scrape events are rate limited');
  damage.update([rest], FIXED_STEP);
  assert.equal(damage.drainEvents()[0].kind, 'scrape-end');
  const paint = structuredClone(damage.panels);
  for (let i = 0; i < 1200; i++) damage.update([rest], FIXED_STEP);
  assert.deepEqual(damage.panels, paint);
});

test('damage and effects stay bounded under repeated extreme impacts, and can be disabled', () => {
  const damage = new VehicleDamage();
  for (let i = 0; i < 100; i++) {
    damage.update([], 0.5);
    damage.update([contact({ closingSpeed: 60 })], FIXED_STEP);
  }
  assert.equal(damage.panels.front.dent, 1);
  assert.equal(damage.effects.power, 1 - DAMAGE.maximumPowerLoss);
  assert.ok(Math.abs(damage.effects.steeringBias) <= DAMAGE.maximumSteeringBias);
  assert.ok(damage.effects.suspension.every(value => value >= 1 - DAMAGE.maximumSuspensionLoss));
  const panels = structuredClone(damage.panels);
  damage.handlingEnabled = false;
  assert.deepEqual(damage.effects, { power: 1, steeringBias: 0, suspension: [1, 1, 1, 1] });
  assert.deepEqual(damage.panels, panels);
  assert.ok(damage.drainEvents().length <= 128);
});

test('repair terminates a consumed scrape and drops pending impact events', () => {
  const damage = new VehicleDamage();
  damage.update([contact({ tangentSpeed: 5 })], FIXED_STEP);
  assert.ok(damage.drainEvents().some(event => event.kind === 'scrape-start'));
  damage.repair();
  assert.deepEqual(damage.drainEvents().map(event => event.kind), ['scrape-end']);
  assert.equal(damage.condition, 'undamaged');
  damage.update([contact()], FIXED_STEP);
  damage.repair();
  assert.deepEqual(damage.drainEvents(), []);
  damage.update([contact({ tangentSpeed: 5 })], FIXED_STEP);
  damage.drainEvents();
  damage.pause();
  damage.repair();
  assert.deepEqual(damage.drainEvents().map(event => event.kind), ['scrape-end'], 'repair preserves an undelivered pause termination');
});

test('maximum handling damage remains finite and driveable; disabling it reproduces the baseline', async t => {
  const baseline = await setup(t, { boxes: [] });
  const disabled = await setup(t, { boxes: [], damageHandling: false });
  const damaged = await setup(t, { boxes: [] });
  for (const sim of [disabled, damaged]) {
    for (let i = 0; i < 8; i++) {
      sim.damage.update([], 0.5);
      sim.damage.update([contact({ closingSpeed: 60 })], FIXED_STEP);
    }
  }
  for (const sim of [baseline, disabled, damaged]) {
    stepFor(sim, 8, { ...IDLE, forward: true });
    assert.ok(sim.state.speed > 5);
    assert.ok(sim.up.y > 0.98);
    for (const value of [...Object.values(sim.position), ...Object.values(sim.rotation), sim.state.speed]) assert.ok(Number.isFinite(value));
  }
  assert.deepEqual(disabled.position, baseline.position);
  assert.deepEqual(disabled.rotation, baseline.rotation);
  assert.equal(disabled.state.speed, baseline.state.speed);
  assert.ok(damaged.state.speed < baseline.state.speed);
  stepFor(damaged, 3, { ...IDLE, forward: true, reverse: true });
  assert.ok(Math.abs(damaged.state.speed) < 0.1);
  damaged.repair();
  assert.deepEqual(damaged.damage.effects, { power: 1, steeringBias: 0, suspension: [1, 1, 1, 1] });
});

test('real light and heavy frontal impacts produce proportional damage and localized events', async t => {
  const dents = [];
  for (const speed of [2, 8, 25]) {
    const sim = await setup(t);
    sim.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    stepFor(sim, 4);
    const events = sim.damage.drainEvents().filter(event => event.kind === 'impact');
    assert.equal(events.length, 1);
    assert.equal(events[0].panel, 'front');
    assert.equal(events[0].material, 'concrete');
    assert.ok(Math.abs(events[0].point.z - 0.1) < 0.05);
    assert.equal(sim.damage.panels.rear.dent, 0);
    dents.push(sim.damage.panels.front.dent);
    if (speed === 2) assert.deepEqual(sim.damage.effects, { power: 1, steeringBias: 0, suspension: [1, 1, 1, 1] });
    if (speed === 25) assert.ok(sim.damage.effects.power < 0.8);
  }
  assert.ok(dents[0] < dents[1] && dents[1] < dents[2]);
});

test('rear impacts and side glancing scrapes damage the contacting panels', async t => {
  const rear = await setup(t, { spawn: { ...spawn, heading: Math.PI } });
  rear.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
  stepFor(rear, 2);
  assert.ok(rear.damage.panels.rear.dent > 0.2);
  assert.equal(rear.damage.panels.front.dent, 0);
  const heading = -0.2;
  const side = await setup(t, { spawn: { x: -3, z: 20, heading }, boxes: [{ ...wall, width: 0.2, depth: 200 }] });
  side.body.setLinvel({ x: -Math.sin(heading) * 12, y: 0, z: -Math.cos(heading) * 12 }, true);
  stepFor(side, 2);
  assert.ok(side.damage.panels.right.scratch > 0.1);
  assert.equal(side.damage.panels.left.scratch, 0);
  assert.ok(side.body.linvel().z < -4, 'glancing damage preserves tangential motion');
  const events = side.damage.drainEvents();
  assert.ok(events.some(e => e.kind === 'scrape-start' && e.panel === 'right'));
  side.pause();
  assert.ok(side.damage.drainEvents().some(e => e.kind === 'scrape-end'));
  const stopped = structuredClone(side.damage.panels);
  stepFor(side, 10);
  assert.deepEqual(side.damage.panels, stopped);
});

test('pushing into the wall at rest does not accumulate repeated collision damage', async t => {
  const sim = await setup(t);
  sim.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
  stepFor(sim, 3);
  // The collision bounces the car away slightly; drive back into contact before measuring rest.
  stepFor(sim, 3, { ...IDLE, forward: true });
  sim.damage.drainEvents();
  const panels = structuredClone(sim.damage.panels);
  stepFor(sim, 15, { ...IDLE, forward: true });
  assert.deepEqual(sim.damage.panels, panels);
  assert.deepEqual(sim.damage.drainEvents(), []);
});

test('in-place repair preserves motion and clears damage, events and wheel effects immediately', async t => {
  const sim = await setup(t);
  sim.damage.update([contact()], FIXED_STEP);
  stepFor(sim, 0.1, { ...IDLE, reverse: true });
  const pose = { ...sim.position }, velocity = sim.body.linvel(), gear = sim.state.gear;
  sim.repair();
  assert.deepEqual({ ...sim.position }, pose);
  assert.deepEqual(sim.body.linvel(), velocity);
  assert.equal(sim.state.gear, gear);
  assert.equal(sim.damage.condition, 'undamaged');
  assert.deepEqual(sim.damage.drainEvents(), []);
  for (let i = 0; i < 4; i++) assert.equal(sim.vehicle.wheelSuspensionStiffness(i), SUSPENSION.stiffness);
  assert.equal(sim.damage.effects.power, 1);
  assert.equal(sim.damage.effects.steeringBias, 0);
});

test('neighborhood and test-area resets clear damage and restore a stable vehicle', async t => {
  const sim = await setup(t, { environment: 'neighborhood', boxes: [] });
  for (const target of [undefined, { x: TEST_RAMP.x, z: -118, heading: 0 }]) {
    sim.damage.update([contact()], FIXED_STEP);
    sim.damage.handlingEnabled = false;
    sim.reset(target);
    assert.equal(sim.damage.condition, 'undamaged');
    assert.deepEqual(sim.damage.drainEvents(), []);
    assert.equal(sim.damage.handlingEnabled, false, 'reset preserves the setting');
    assert.equal(sim.contacts, 4);
    assert.equal(sim.state.speed, 0);
    assert.ok(sim.up.y > 0.999);
  }
});

test('impact damage, scrape events and physical state match at 30/60/144 rendering Hz', async () => {
  for (const scenario of ['impact', 'scrape']) {
    const outcomes = [];
    for (const fps of [30, 60, 144]) {
      const heading = -0.2;
      const sim = await createVehiclePhysics(scenario === 'impact' ? { environment: 'flat', spawn, boxes: [wall] }
        : { environment: 'flat', spawn: { x: -3, z: 20, heading }, boxes: [{ ...wall, width: 0.2, depth: 200 }] });
      try {
        sim.body.setLinvel(scenario === 'impact' ? { x: 0, y: 0, z: -25 } : { x: -Math.sin(heading) * 12, y: 0, z: -Math.cos(heading) * 12 }, true);
        const clock = new SimulationClock(), events = [];
        for (let frame = 0; frame < fps * 3; frame++) {
          clock.advance(1 / fps, dt => sim.step(IDLE, dt));
          events.push(...sim.damage.drainEvents());
        }
        outcomes.push({ panels: structuredClone(sim.damage.panels), effects: sim.damage.effects, events,
          position: { ...sim.position }, rotation: { ...sim.rotation }, speed: sim.state.speed });
      } finally { sim.dispose(); }
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.deepEqual(outcomes[1], outcomes[2]);
  }
});

test('repair restores every panel geometry, paint color and scratch visibility without stale transforms', () => {
  const damage = new VehicleDamage(), visuals = createDamageVisuals();
  const meshes = [];
  visuals.group.traverse(node => { if (node.isMesh && node.geometry.type === 'BoxGeometry') meshes.push(node); });
  visuals.update(damage);
  const original = meshes.map(mesh => ({ positions: Array.from(mesh.geometry.attributes.position.array), color: mesh.material.color.getHex() }));
  for (let cycle = 0; cycle < 3; cycle++) {
    damage.update([contact({ closingSpeed: 25 })], FIXED_STEP);
    visuals.update(damage);
    assert.ok(meshes.some((mesh, i) => mesh.material.color.getHex() !== original[i].color));
    assert.ok(meshes.some((mesh, i) => Array.from(mesh.geometry.attributes.position.array).some((v, j) => v !== original[i].positions[j])));
    damage.repair();
    visuals.update(damage);
    assert.deepEqual(meshes.map(mesh => ({ positions: Array.from(mesh.geometry.attributes.position.array), color: mesh.material.color.getHex() })), original);
    for (const child of visuals.group.children.filter(node => node.isGroup)) assert.equal(child.visible, false);
  }
});
