import assert from 'node:assert/strict';
import test from 'node:test';
import { createCar, overlapsCar, stepCar } from '../src/simulation.ts';
import { FIXED_STEP } from '../src/simulation-clock.ts';
import { isOnRoad, OBSTACLES, PARKING_LOT } from '../src/world-layout.ts';

test('the starting lane connects to the parking lot through a clear paved entrance', () => {
  const car = createCar();
  for (let z = car.z; z >= PARKING_LOT.z; z -= 0.5) {
    for (const x of [car.x - 0.9, car.x, car.x + 0.9]) assert.ok(isOnRoad(x, z), `pavement gap at ${x}, ${z}`);
    assert.ok(OBSTACLES.every(obstacle => !overlapsCar(car.x, z, 0, obstacle)), `blocked entrance at ${z}`);
  }
});

test('parking maneuvering area is paved and clear of scenery and the old boundary', () => {
  for (let x = -55; x <= 55; x += 5) {
    for (let z = -165; z <= -85; z += 5) {
      assert.ok(isOnRoad(x, z));
      for (const heading of [0, Math.PI / 4, Math.PI / 2]) {
        assert.ok(OBSTACLES.every(obstacle => !overlapsCar(x, z, heading, obstacle)), `obstacle inside lot at ${x}, ${z}`);
      }
    }
  }
  assert.equal(isOnRoad(65, PARKING_LOT.z), false, 'adjacent grass retains its own surface');
});

test('the sedan can complete low-speed circles in both directions inside the lot', () => {
  for (const left of [false, true]) {
    const car = { ...createCar(), x: PARKING_LOT.x, z: PARKING_LOT.z };
    for (let tick = 0; tick < 30 / FIXED_STEP && Math.abs(car.heading) < Math.PI * 2; tick++) {
      stepCar(car, { forward: car.speed < 2, reverse: false, left, right: !left }, FIXED_STEP, OBSTACLES, isOnRoad(car.x, car.z));
      assert.ok(isOnRoad(car.x, car.z), 'practice circle should stay on pavement');
      assert.ok(OBSTACLES.every(obstacle => !overlapsCar(car.x, car.z, car.heading, obstacle)));
    }
    assert.ok(Math.abs(car.heading) >= Math.PI * 2, 'car must finish the full circle');
  }
});
