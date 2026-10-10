import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROACHES, LANES, LANE_CONNECTIONS, ROAD_RULES, ROAD_SIGNS, ROAD_POSTS, SIGNAL_FIXTURES, speedZoneAt, STOP_DISTANCE, LANE_ARROWS } from '../src/traffic-layout.ts';
import { CROSSINGS, junction, STREETS, PARKING_SPACES } from '../src/road-network.ts';
import { TrafficSignals, signalState, movementRule, upcomingControl, controlGuidance, SIGNAL_CYCLE } from '../src/traffic-rules.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { isOnRoad } from '../src/world-layout.ts';

const facing = u => Math.atan2(-u.x, -u.z);
test('US lanes keep right, have valid connections and arrows describe only possible movements', () => {
  assert.equal(ROAD_RULES.jurisdiction, 'United States');
  assert.equal(ROAD_RULES.drivingSide, 'right');
  for (const lane of LANES) {
    const node = junction(lane.from), u = lane.direction;
    const rightOffset = -(lane.start.x - node.x) * u.z + (lane.start.z - node.z) * u.x;
    assert.equal(rightOffset, 2.5);
    if (lane.to !== 'lot') assert.ok(LANE_CONNECTIONS.some(c => c.incoming === lane.id));
  }
  for (const arrow of LANE_ARROWS) assert.ok(arrow.turns.length > 0 && isOnRoad(arrow.x, arrow.z));
  for (const space of PARKING_SPACES.filter(s => s.kind === 'parallel')) assert.equal(space.heading, 0, 'east-side bays face north with adjacent traffic');
});

test('each controlled approach has exactly one appropriate sign and lane-width transverse line', () => {
  assert.equal(APPROACHES.filter(a => a.kind === 'all-way-stop').length, 4);
  assert.equal(APPROACHES.filter(a => a.kind === 'signal').length, 4);
  assert.equal(APPROACHES.filter(a => a.kind === 'yield').length, 1);
  for (const approach of APPROACHES) {
    const sign = ROAD_SIGNS.filter(s => s.approachId === approach.id);
    if (approach.kind === 'priority') { assert.equal(approach.line, undefined); assert.equal(sign.length, 0); continue; }
    assert.equal(sign.length, 1);
    const expected = approach.kind === 'signal' ? 'no-turn-on-red' : approach.kind === 'yield' ? 'yield' : 'stop';
    assert.equal(sign[0].kind, expected);
    assert.deepEqual(sign[0].direction, approach.direction);
    assert.equal(sign[0].allWay, approach.kind === 'all-way-stop');
    const u = approach.direction, node = junction(approach.junctionId);
    assert.equal(-(approach.x - node.x) * u.x - (approach.z - node.z) * u.z, STOP_DISTANCE);
    assert.equal(approach.line.width, u.x ? 0.4 : 4.8);
    assert.equal(approach.line.depth, u.z ? 0.4 : 4.8);
    const crosswalk = CROSSINGS.find(c => c.junctionId === approach.junctionId && c.streetId === LANES.find(l => l.id === approach.laneId).streetId);
    if (crosswalk) {
      const crossDistance = -(crosswalk.x - node.x) * u.x - (crosswalk.z - node.z) * u.z;
      assert.ok(STOP_DISTANCE - 0.2 - crossDistance - 1 >= 1.22, 'stop bar stays at least 4 ft before crosswalk');
    }
    const lane = LANES.find(l => l.id === approach.laneId);
    const street = STREETS.find(s => s.id === lane.streetId);
    const signOffset = Math.abs(-(sign[0].x - node.x) * u.z + (sign[0].z - node.z) * u.x);
    assert.ok(signOffset >= street.width / 2 + 1, 'sign is on the right verge, outside travel lanes');
  }
  assert.equal(new Set(ROAD_POSTS.map(p => `${p.x},${p.z}`)).size, ROAD_POSTS.length, 'shared sign supports are not duplicated');
  assert.equal(SIGNAL_FIXTURES.length, 4);
});

test('speed signs match the zone after passing them and every street has a displayed limit', () => {
  const speeds = new Set(ROAD_SIGNS.filter(s => s.kind === 'speed').map(s => s.mph));
  assert.deepEqual([...speeds].sort(), [10, 15, 25]);
  for (const sign of ROAD_SIGNS.filter(s => s.kind === 'speed')) {
    const center = { x: sign.x + sign.direction.z * 4 + sign.direction.x * 0.25, z: sign.z - sign.direction.x * 4 + sign.direction.z * 0.25 };
    assert.equal(speedZoneAt(center)?.mph, sign.mph, sign.id);
  }
  assert.equal(speedZoneAt({ x: 0, z: -125 }).mph, 10);
  assert.equal(speedZoneAt({ x: 102, z: -136 }).mph, 10);
  assert.equal(speedZoneAt({ x: 107, z: 116 }).mph, 15);
  for (const lane of LANES) for (let i = 0; i <= 10; i++) assert.ok(speedZoneAt({ x: lane.start.x + (lane.end.x - lane.start.x) * i / 10, z: lane.start.z + (lane.end.z - lane.start.z) * i / 10 }));
});

test('signals include yellow and all-red clearance, wrap correctly, and never release perpendicular approaches together', () => {
  for (const [time, ns, ew] of [[0, 'green', 'red'], [14, 'yellow', 'red'], [17, 'red', 'red'], [19, 'red', 'green'], [33, 'red', 'yellow'], [36, 'red', 'red'], [38, 'green', 'red']]) {
    assert.deepEqual([signalState(time).ns, signalState(time).ew], [ns, ew]);
  }
  for (let i = 0; i < SIGNAL_CYCLE * 100; i++) {
    const signal = signalState(i / 100);
    assert.ok(signal.ns === 'red' || signal.ew === 'red');
    assert.ok(signal.remaining > 0);
  }
  assert.deepEqual(signalState(3.5), signalState(3.5 + SIGNAL_CYCLE * 20));
});

test('red prohibits every turn, green left turns yield, and stop/yield priority metadata is consistent', () => {
  for (const approach of APPROACHES) {
    const connections = LANE_CONNECTIONS.filter(c => c.incoming === approach.laneId);
    for (const c of connections) {
      if (approach.kind === 'signal') {
        const greenTime = approach.signalGroup === 'ns' ? 0 : 19;
        const redTime = approach.signalGroup === 'ns' ? 19 : 0;
        assert.equal(movementRule(c.id, redTime, true).action, 'stop');
        assert.ok(movementRule(c.id, redTime).reasons.includes('No turn on red'));
        assert.equal(movementRule(c.id, greenTime).action, c.turn === 'left' ? 'yield' : 'proceed');
        if (c.turn === 'left') assert.ok(movementRule(c.id, greenTime).reasons.includes('Oncoming traffic'));
        assert.equal(movementRule(c.id, greenTime + 14).action, 'caution');
      } else if (approach.kind === 'all-way-stop' || approach.kind === 'stop') {
        assert.equal(movementRule(c.id, 0).action, 'stop');
        assert.equal(movementRule(c.id, 0, true).action, 'yield');
      } else if (approach.kind === 'yield') assert.equal(movementRule(c.id, 0).action, 'yield');
    }
  }
  assert.throws(() => movementRule('missing', 0), /Unknown lane connection/);
});

test('guidance uses front-bumper distance and ignores other lanes, departing cars, and head direction', () => {
  const approach = APPROACHES.find(a => a.junctionId === 'center' && a.direction.z === -1);
  const u = approach.direction, position = { x: approach.x - u.x * 22.25, z: approach.z - u.z * 22.25 };
  const control = upcomingControl(position, facing(u));
  assert.equal(control.approach.id, approach.id);
  assert.equal(control.distance, 20);
  assert.equal(upcomingControl({ x: position.x + 8, z: position.z }, facing(u)), undefined);
  assert.equal(upcomingControl({ x: approach.x + u.x * 8, z: approach.z + u.z * 8 }, facing(u)), undefined);
  const signals = new TrafficSignals();
  assert.match(controlGuidance(control, signals), /GREEN.*20 m/);
  for (let i = 0; i < 14 * 120; i++) signals.step();
  assert.match(controlGuidance(control, signals), /YELLOW.*stop if safe/);
});

test('fixed-step signals are identical at 30/60/144 Hz and pause/reset without catching up', () => {
  const values = [30, 60, 144].map(fps => {
    const clock = new SimulationClock(), signals = new TrafficSignals();
    const colors = [];
    for (let frame = 0; frame < fps * 76; frame++) clock.advance(1 / fps, () => { signals.step(); colors.push(signalState(signals.seconds)); });
    const paused = signals.seconds;
    clock.reset();
    assert.equal(signals.seconds, paused);
    assert.equal(signals.color(APPROACHES.find(a => a.kind === 'stop').id), undefined);
    signals.reset(); assert.equal(signals.seconds, 0);
    assert.equal(signals.color(APPROACHES.find(a => a.kind === 'signal' && a.signalGroup === 'ns').id), 'green');
    return colors;
  });
  assert.deepEqual(values[0], values[1]); assert.deepEqual(values[1], values[2]);
});

test('road example starts are paved, obstacle-free, and point toward their advertised controls', async () => {
  const { ROAD_EXAMPLES } = await import('../src/traffic-layout.ts');
  const { OBSTACLES, SIDEWALKS } = await import('../src/world-layout.ts');
  const { overlapsCar } = await import('../src/simulation.ts');
  const expected = { signals: 'signal', stops: 'all-way-stop', garden: 'stop', yield: 'yield' };
  for (const [id, spawn] of Object.entries(ROAD_EXAMPLES)) {
    assert.ok(isOnRoad(spawn.x, spawn.z));
    assert.ok(OBSTACLES.every(o => !overlapsCar(spawn.x, spawn.z, spawn.heading, o)));
    assert.ok(SIDEWALKS.every(s => !overlapsCar(spawn.x, spawn.z, spawn.heading, { ...s, halfWidth: s.width / 2, halfDepth: s.depth / 2 })));
    if (id !== 'parking') assert.equal(upcomingControl(spawn, spawn.heading).approach.kind, expected[id]);
  }
});

test('rendered sign posts have physical metal colliders and produce a real vehicle impact', async t => {
  const { createVehiclePhysics } = await import('../src/vehicle-physics.ts');
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const sign = ROAD_SIGNS.find(s => s.kind === 'stop' && s.direction.z === -1 && s.x > 0);
  const sim = await createVehiclePhysics({ explicitControls: true, spawn: { x: sign.x, z: sign.z + 7, heading: 0 } });
  t.after(() => sim.dispose());
  for (const post of ROAD_POSTS) {
    const hit = sim.world.castRay(new RAPIER.Ray({ x: post.x, y: post.height + 1, z: post.z }, { x: 0, y: -1, z: 0 }), post.height + 2, true);
    assert.ok(hit && Math.abs(post.height + 1 - hit.timeOfImpact - post.height) < 1e-4, `missing collider at ${post.x},${post.z}`);
  }
  sim.selectGear('N');
  sim.body.setLinvel({ x: 0, y: 0, z: -5 }, true);
  const events = [];
  for (let i = 0; i < 2 * 120; i++) {
    sim.step({ forward: false, reverse: false, left: false, right: false });
    events.push(...sim.damage.drainEvents());
  }
  assert.ok(events.some(e => e.kind === 'impact' && e.material === 'metal'), 'car must hit the visible sign support');
  assert.ok(sim.state.z > sign.z + 1.5, 'body cannot pass through the sign');
});
