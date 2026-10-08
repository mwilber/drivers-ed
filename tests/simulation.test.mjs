import assert from 'node:assert/strict';
import test from 'node:test';
import { createCar, overlapsCar, stepCar } from '../src/simulation.ts';
import { isOnRoad, OBSTACLES, ROADS } from '../src/world-layout.ts';

const idle = { forward: false, reverse: false, left: false, right: false };
function drive(car, input, seconds, obstacles = [], onRoad = true) {
  for (let i = 0; i < seconds * 120; i++) stepCar(car, { ...idle, ...input }, 1 / 120, obstacles, onRoad);
}

test('accelerates forward and brakes before engaging reverse', () => {
  const car = createCar();
  drive(car, { forward: true }, 2);
  assert.ok(car.speed > 5 && car.z < 48);
  drive(car, { reverse: true }, 0.25);
  assert.ok(car.speed > 0, 'opposite pedal first brakes');
  drive(car, { reverse: true }, 2);
  assert.ok(car.speed < 0 && car.speed >= -5);
});

test('steering turns left forward and changes yaw direction in reverse', () => {
  const forward = createCar();
  const reverse = createCar();
  drive(forward, { forward: true, left: true }, 2);
  drive(reverse, { reverse: true, left: true }, 2);
  assert.ok(forward.heading > 0 && forward.x < 2.5);
  assert.ok(reverse.heading < 0);
  drive(forward, {}, 1);
  assert.equal(forward.steering, 0);
});

test('limits road and grass speed and opposing inputs brake', () => {
  const road = createCar();
  const grass = createCar();
  drive(road, { forward: true }, 20);
  drive(grass, { forward: true }, 20, [], false);
  assert.equal(road.speed, 18);
  assert.equal(grass.speed, 7);
  drive(road, { forward: true, reverse: true }, 4);
  assert.equal(road.speed, 0);
});

test('sedan stops before an obstacle and can reverse away', () => {
  const car = createCar();
  const obstacle = { x: 2.5, z: 35, halfWidth: 3, halfDepth: 3 };
  drive(car, { forward: true }, 5, [obstacle]);
  assert.equal(car.speed, 0);
  assert.ok(car.z >= 40.25);
  const stoppedZ = car.z;
  drive(car, { reverse: true }, 2, [obstacle]);
  assert.ok(car.z > stoppedZ);
});

test('rotated footprint collision checks both sedan axes', () => {
  const obstacle = { x: 2.3, z: 0, halfWidth: 0.2, halfDepth: 0.2 };
  assert.equal(overlapsCar(0, 0, 0, obstacle), false);
  assert.equal(overlapsCar(0, 0, Math.PI / 2, obstacle), true);
});

test('road loop has the connecting street and a clear spawn', () => {
  assert.equal(ROADS.length, 5);
  for (const [x, z] of [[0, 0], [0, -60], [0, 60], [-100, 0], [100, 0]]) assert.ok(isOnRoad(x, z));
  assert.equal(isOnRoad(50, 0), false);
  const car = createCar();
  assert.ok(isOnRoad(car.x, car.z));
  assert.ok(OBSTACLES.every(obstacle => !overlapsCar(car.x, car.z, car.heading, obstacle)));
});
