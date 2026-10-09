import assert from 'node:assert/strict';
import test from 'node:test';
import { createCar, stepCar, stopCar } from '../src/simulation.ts';
import { FIXED_STEP, SimulationClock } from '../src/simulation-clock.ts';
import { driveFor, IDLE, measureHandling, MPH } from '../scripts/handling-scenarios.mjs';

const measurements = measureHandling();
function between(value, min, max, label) {
  assert.ok(value >= min && value <= max, `${label}: ${value} should be in [${min}, ${max}]`);
}

test('sedan meets its authored flat-road acceleration, braking, and coast targets', () => {
  between(measurements.zeroTo30Seconds, 5, 7, '0–30 mph time');
  between(measurements.stoppingDistanceMetres, 12, 17, '30–0 mph stopping distance');
  between(measurements.stoppingTimeSeconds, 1.5, 2.2, '30–0 mph stopping time');
  between(measurements.coastSpeedAfter5SecondsMph, 22, 26, 'coasting speed after 5 seconds');
  assert.deepEqual(measurements.launchGears, [1, 2, 3]);
});

test('parking-speed full-lock turning radius stays around five metres', () => {
  between(measurements.lowSpeedTurnRadiusMetres, 4.7, 5.3, 'center-path radius');
});

test('holding either steering direction never unwinds the wheel as speed builds', () => {
  for (const reverse of [false, true]) {
    for (const left of [false, true]) {
      const car = createCar();
      const input = { ...IDLE, forward: !reverse, reverse, left, right: !left };
      let previousAngle = 0;
      for (let tick = 0; tick < 30 / FIXED_STEP; tick++) {
        const previousHeading = car.heading;
        stepCar(car, input, FIXED_STEP, [], true);
        const angle = Math.abs(car.steering);
        assert.ok(angle >= previousAngle, 'held steering must not self-center during acceleration or shifts');
        previousAngle = angle;
        if (Math.abs(car.speed) > 1) {
          const expectedYawSign = (left ? 1 : -1) * (reverse ? -1 : 1);
          assert.ok((car.heading - previousHeading) * expectedYawSign > 0, 'car continues turning in the commanded direction');
        }
      }
      between(previousAngle, 0.49, 0.51, 'held steering angle');
      driveFor(car, {}, 1);
      assert.equal(car.steering, 0, 'releasing the key still centers steering');
    }
  }
});

test('high-speed steering keeps full lock while tire grip limits cornering', () => {
  for (const left of [false, true]) {
    const car = { ...createCar(), speed: 115 / MPH, gear: 6 };
    for (let tick = 0; tick < 5 / FIXED_STEP; tick++) {
      stepCar(car, { ...IDLE, forward: true, left, right: !left }, FIXED_STEP, [], true);
      assert.ok(Math.hypot(car.acceleration, car.lateralAcceleration) <= 8.829 + 1e-8);
      assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.heading));
    }
    between(Math.abs(car.steering), 0.49, 0.51, 'high-speed held steering');
    assert.ok(Math.abs(car.lateralAcceleration) > 8, 'turn exercises grip saturation');
  }
});

test('sedan reaches 110–115 mph and can brake or collide from that speed', () => {
  between(measurements.sustainedTopSpeedMph, 110, 115, 'sustained top speed');
  const braking = { ...createCar(), speed: 115 / MPH, gear: 6 };
  const startZ = braking.z;
  driveFor(braking, { forward: true, reverse: true }, 8);
  assert.equal(braking.speed, 0);
  between(startZ - braking.z, 145, 185, '115 mph stopping distance');

  const collision = { ...createCar(), speed: 115 / MPH, gear: 6 };
  driveFor(collision, { forward: true }, 2, [{ x: 2.5, z: 20, halfWidth: 5, halfDepth: 1 }]);
  assert.equal(collision.speed, 0);
  assert.ok(collision.z >= 23.25, 'high-speed motion must not pass through the obstacle');
});

test('pedal response builds progressively and engine speed stays in a usable range', () => {
  const car = createCar();
  stepCar(car, { ...IDLE, forward: true }, FIXED_STEP, [], true);
  between(car.throttle, 0, 0.1, 'initial throttle');
  const firstAcceleration = car.acceleration;
  driveFor(car, { forward: true }, 0.5);
  assert.ok(car.acceleration > firstAcceleration + 2);
  between(car.engineRpm, 850, 6000, 'engine rpm');
  driveFor(car, { reverse: true }, FIXED_STEP);
  assert.equal(car.throttle, 0, 'braking cuts drive torque immediately');
  assert.ok(car.brake > 0 && car.brake < 1, 'brake pressure builds progressively');
});

test('reverse engages only after a complete stop and a stationary delay', () => {
  const car = createCar();
  driveFor(car, { forward: true }, 2);
  let stoppedAt;
  let reversedAt;
  for (let tick = 0; tick < 600; tick++) {
    const before = car.speed;
    stepCar(car, { ...IDLE, reverse: true }, FIXED_STEP, [], true);
    if (before > 0 && car.speed === 0) stoppedAt = tick;
    if (before > 0) assert.ok(car.gear > 0, 'must not select reverse while moving forward');
    if (car.speed < 0) { reversedAt = tick; break; }
  }
  assert.notEqual(stoppedAt, undefined);
  assert.notEqual(reversedAt, undefined);
  between((reversedAt - stoppedAt) * FIXED_STEP, 0.35, 0.65, 'stationary direction-change delay');
  assert.equal(car.gear, -1);
  driveFor(car, { reverse: true }, 6);
  between(car.speed, -5, -4.5, 'reverse speed limit');
  driveFor(car, { forward: true }, 3);
  assert.ok(car.speed > 0 && car.gear > 0, 'the same interlock works from reverse to drive');
});

test('releasing an opposite-direction request cancels the pending shift', () => {
  const car = { ...createCar(), gear: 1 };
  driveFor(car, { reverse: true }, 0.15);
  assert.ok(car.directionWait > 0);
  driveFor(car, {}, 1);
  assert.equal(car.pendingDirection, 0);
  assert.equal(car.directionWait, 0);
  assert.equal(car.gear, 1);
  assert.equal(car.speed, 0);
});

test('opposing pedals hold a stop in either direction without shifting', () => {
  for (const reverse of [false, true]) {
    const car = createCar();
    driveFor(car, { forward: !reverse, reverse }, 3);
    driveFor(car, { forward: true, reverse: true }, 4);
    assert.equal(car.speed, 0);
    assert.equal(Math.sign(car.gear), reverse ? -1 : 1);
    assert.equal(car.throttle, 0);
  }
});

test('automatic shifts reduce power, avoid hunting, and select first gear for a new launch', () => {
  const car = createCar();
  let sawShift = false;
  let lastGear;
  for (let tick = 0; tick < 180 / FIXED_STEP; tick++) {
    stepCar(car, { ...IDLE, forward: true }, FIXED_STEP, [], true);
    if (car.shiftRemaining > 0) {
      sawShift = true;
      assert.ok(car.acceleration <= 0, 'power is interrupted during a ratio change');
    }
    if (tick > 150 / FIXED_STEP) {
      if (lastGear !== undefined) assert.equal(car.gear, lastGear, 'steady cruise must not hunt between gears');
      lastGear = car.gear;
    }
    between(car.engineRpm, 850, 6000, 'engine rpm');
  }
  assert.ok(sawShift);
  assert.equal(car.gear, 6, 'high-speed cruising uses the upper ratios');
  driveFor(car, { forward: true, reverse: true }, 8);
  assert.equal(car.speed, 0);
  assert.equal(car.gear, 1);
  driveFor(car, { forward: true }, 1);
  assert.ok(car.speed > 1, 'can launch promptly after braking');
});

test('steering at rest does not rotate the car and left/right maneuvers are symmetric', () => {
  const stationary = createCar();
  driveFor(stationary, { left: true }, 2);
  assert.equal(stationary.heading, 0);
  assert.equal(stationary.x, 2.5);
  assert.equal(stationary.z, 48);
  assert.ok(stationary.steering > 0.4);
  driveFor(stationary, {}, 1);
  assert.equal(stationary.steering, 0);

  const left = createCar();
  const right = createCar();
  driveFor(left, { forward: true, left: true }, 2);
  driveFor(right, { forward: true, right: true }, 2);
  assert.ok(Math.abs(left.heading + right.heading) < 1e-10);
  assert.ok(Math.abs((left.x - 2.5) + (right.x - 2.5)) < 1e-10);
  assert.ok(Math.abs(left.z - right.z) < 1e-10);
});

test('tire grip bounds cornering and combined braking forces', () => {
  for (const braking of [false, true]) {
    const car = { ...createCar(), speed: 18, gear: 3, steering: 0.5 };
    let peakLateral = 0;
    for (let tick = 0; tick < 90; tick++) {
      stepCar(car, { ...IDLE, left: true, forward: true, reverse: braking }, FIXED_STEP, [], true);
      const combined = Math.hypot(car.acceleration, car.lateralAcceleration);
      assert.ok(combined <= 8.829 + 1e-8, `combined acceleration exceeded dry grip: ${combined}`);
      peakLateral = Math.max(peakLateral, Math.abs(car.lateralAcceleration));
    }
    assert.ok(peakLateral > 4, 'scenario must exercise the cornering grip limit');
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.heading));
  }
});

test('leaving the road slows the car progressively, and coasting eventually stops', () => {
  const car = { ...createCar(), speed: 18, gear: 3 };
  stepCar(car, { ...IDLE, forward: true }, FIXED_STEP, [], false);
  assert.ok(car.speed > 17.9, 'surface change must not snap to the grass speed cap');
  driveFor(car, { forward: true }, 20, [], false);
  between(car.speed, 6, 7, 'grass speed');
  driveFor(car, {}, 40);
  assert.equal(car.speed, 0);
});

test('the browser clock gives equivalent maneuvers at 30, 60, 144 Hz and uneven frame times', () => {
  const sequence = [
    [3, { forward: true }], [2, { forward: true, left: true }],
    [1, {}], [3, { reverse: true }], [2, { reverse: true, right: true }],
  ];
  function run(frameTimes) {
    const clock = new SimulationClock();
    const car = createCar();
    let count = 0;
    let frame = 0;
    for (const [duration, controls] of sequence) {
      let remaining = duration;
      while (remaining > 1e-10) {
        const elapsed = Math.min(remaining, frameTimes[frame++ % frameTimes.length]);
        clock.advance(elapsed, dt => { stepCar(car, { ...IDLE, ...controls }, dt, [], true); count++; });
        remaining -= elapsed;
      }
    }
    return { car, count };
  }
  const reference = run([1 / 60]);
  assert.equal(reference.count, 11 * 120);
  for (const frames of [[1 / 30], [1 / 144], [0.009, 0.024, 0.011, 0.035]]) assert.deepEqual(run(frames), reference);
});

test('long frames are bounded and resets clear residual time and vehicle transients', () => {
  const clock = new SimulationClock();
  let ticks = 0;
  clock.advance(10, () => ticks++);
  assert.equal(ticks, 12);
  clock.advance(FIXED_STEP / 2, () => ticks++);
  clock.reset();
  clock.advance(FIXED_STEP / 2, () => ticks++);
  assert.equal(ticks, 12);
  const car = createCar();
  driveFor(car, { forward: true, left: true }, 2);
  const gear = car.gear;
  stopCar(car);
  assert.equal(car.speed, 0);
  assert.equal(car.yawRate, 0);
  assert.equal(car.throttle, 0);
  assert.equal(car.directionWait, 0);
  assert.equal(car.gear, gear);
  Object.assign(car, createCar());
  assert.deepEqual(car, createCar());
});
