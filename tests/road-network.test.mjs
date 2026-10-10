import assert from 'node:assert/strict';
import test from 'node:test';
import { JUNCTIONS, STREETS, createLanes, createConnections, CROSSINGS, PARKING_SPACES } from '../src/road-network.ts';
import { isOnRoad, OBSTACLES, SIDEWALKS, WORLD_BOUNDS } from '../src/world-layout.ts';
import { overlapsCar } from '../src/simulation.ts';

function assertClear(point, direction, label) {
  const heading = Math.atan2(-direction.x, -direction.z);
  assert.ok(OBSTACLES.every(o => !overlapsCar(point.x, point.z, heading, o)), `obstacle: ${label}`);
  assert.ok(SIDEWALKS.every(o => !overlapsCar(point.x, point.z, heading, { ...o, halfWidth: o.width / 2, halfDepth: o.depth / 2 })), `curb: ${label}`);
  const right = { x: -direction.z, z: direction.x };
  for (const longitudinal of [-2.25, 0, 2.25]) for (const lateral of [-0.9, 0, 0.9]) {
    const x = point.x + direction.x * longitudinal + right.x * lateral;
    const z = point.z + direction.z * longitudinal + right.z * lateral;
    assert.ok(isOnRoad(x, z), `pavement: ${label} ${x},${z}`);
    assert.ok(x > WORLD_BOUNDS.minX && x < WORLD_BOUNDS.maxX && z > WORLD_BOUNDS.minZ && z < WORLD_BOUNDS.maxZ);
  }
}

test('both supported lane orientations and every intersection movement fit a complete sedan on clear pavement', () => {
  for (const side of ['left', 'right']) {
    const lanes = createLanes(side), connections = createConnections(lanes);
    for (const lane of lanes) {
      for (let t = 0; t <= 1; t += 0.02) assertClear({ x: lane.start.x + t * (lane.end.x - lane.start.x), z: lane.start.z + t * (lane.end.z - lane.start.z) }, lane.direction, lane.id);
      if (lane.to !== 'lot') assert.ok(connections.some(c => c.incoming === lane.id), `dead end ${lane.id}`);
    }
    for (const connection of connections) {
      const lane = lanes.find(l => l.id === connection.incoming), target = lanes.find(l => l.id === connection.outgoing);
      assert.deepEqual(connection.points[0], lane.end);
      assert.deepEqual(connection.points.at(-1), target.start);
      for (let i = 0; i < connection.points.length; i++) {
        const p = connection.points[i], before = connection.points[Math.max(0, i - 1)], after = connection.points[Math.min(connection.points.length - 1, i + 1)];
        const length = Math.hypot(after.x - before.x, after.z - before.z);
        assertClear(p, { x: (after.x - before.x) / length, z: (after.z - before.z) / length }, connection.id);
      }
    }
  }
});

test('every street and junction belongs to one connected town and the lot is reachable', () => {
  const reached = new Set(['north']);
  for (let i = 0; i < JUNCTIONS.length; i++) for (const s of STREETS) {
    if (reached.has(s.from)) reached.add(s.to);
    if (reached.has(s.to)) reached.add(s.from);
  }
  assert.equal(reached.size, JUNCTIONS.length);
  assert.equal(new Set(STREETS.map(s => s.id)).size, STREETS.length);
});

test('crossings have flush sidewalk openings and every parking space fits the sedan', () => {
  for (const crossing of CROSSINGS) {
    for (let t = -1; t <= 1; t += 0.1) {
      const p = { x: crossing.x + (crossing.width / 2 - 0.1) * t, z: crossing.z + (crossing.depth / 2 - 0.1) * t };
      assert.ok(isOnRoad(p.x, p.z));
      assert.ok(!SIDEWALKS.some(s => Math.abs(p.x - s.x) < s.width / 2 && Math.abs(p.z - s.z) < s.depth / 2));
    }
  }
  for (const space of PARKING_SPACES) {
    assert.ok(space.width >= 3 && space.depth >= 6);
    assertClear(space, { x: -Math.sin(space.heading), z: -Math.cos(space.heading) }, space.id);
  }
});

test('intersection curves maintain a turning radius achievable by the sedan', () => {
  for (const side of ['left', 'right']) for (const connection of createConnections(createLanes(side))) {
    const points = connection.points;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
      const twiceArea = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      const radius = twiceArea < 1e-10 ? Infinity : ab * bc * ca / (2 * twiceArea);
      assert.ok(radius >= 5.7, `${connection.id}: ${radius}m is below the sedan's full-lock radius`);
    }
  }
});

test('Rapier pavement and crossing openings match every rendered street and junction', async t => {
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const { createVehiclePhysics } = await import('../src/vehicle-physics.ts');
  const { ROAD_HEIGHT } = await import('../src/world-layout.ts');
  const sim = await createVehiclePhysics();
  t.after(() => sim.dispose());
  const points = [...JUNCTIONS, ...CROSSINGS.flatMap(c => [
    { x: c.x + c.width / 2 - 0.1, z: c.z }, { x: c.x - c.width / 2 + 0.1, z: c.z },
    { x: c.x, z: c.z + c.depth / 2 - 0.1 }, { x: c.x, z: c.z - c.depth / 2 + 0.1 },
  ])];
  for (const lane of createLanes('right')) for (let i = 0; i <= 10; i++) points.push({ x: lane.start.x + (lane.end.x - lane.start.x) * i / 10, z: lane.start.z + (lane.end.z - lane.start.z) * i / 10 });
  for (const point of points) {
    const hit = sim.world.castRay(new RAPIER.Ray({ x: point.x, y: 10, z: point.z }, { x: 0, y: -1, z: 0 }), 11, true);
    assert.ok(hit);
    assert.ok(Math.abs(10 - hit.timeOfImpact - ROAD_HEIGHT) < 1e-4, `height mismatch at ${point.x},${point.z}`);
  }
});
