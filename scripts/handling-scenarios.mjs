import { createCar, stepCar } from '../src/simulation.ts';
import { FIXED_STEP } from '../src/simulation-clock.ts';

export const MPH = 2.236936;
export const IDLE = { forward: false, reverse: false, left: false, right: false };

export function driveFor(car, input, seconds, obstacles = [], onRoad = true) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) {
    stepCar(car, { ...IDLE, ...input }, FIXED_STEP, obstacles, onRoad);
  }
}

/** An obstacle-free, flat test pad; the game's neighborhood is unchanged. */
export function measureHandling() {
  const launch = createCar();
  const shifts = [];
  let launchTicks = 0;
  while (launch.speed < 30 / MPH && launchTicks < 20 / FIXED_STEP) {
    const previousGear = launch.gear;
    stepCar(launch, { ...IDLE, forward: true }, FIXED_STEP, [], true);
    launchTicks++;
    if (launch.gear !== previousGear) shifts.push(launch.gear);
  }

  const braking = { ...createCar(), speed: 30 / MPH, gear: 3 };
  const startZ = braking.z;
  let brakeTicks = 0;
  while (braking.speed > 0 && brakeTicks < 10 / FIXED_STEP) {
    stepCar(braking, { ...IDLE, forward: true, reverse: true }, FIXED_STEP, [], true);
    brakeTicks++;
  }

  const coasting = { ...createCar(), speed: 30 / MPH, gear: 3 };
  driveFor(coasting, {}, 5);

  const topSpeed = createCar();
  driveFor(topSpeed, { forward: true }, 180);

  const turning = createCar();
  let distance = 0;
  let yaw = 0;
  for (let i = 0; i < 40 / FIXED_STEP; i++) {
    const before = { ...turning };
    // Feather the existing accelerator around walking speed; no forced pose/speed.
    stepCar(turning, { ...IDLE, forward: turning.speed < 1, left: true }, FIXED_STEP, [], true);
    if (i >= 10 / FIXED_STEP) {
      distance += Math.hypot(turning.x - before.x, turning.z - before.z);
      yaw += turning.heading - before.heading;
    }
  }
  return {
    zeroTo30Seconds: launch.speed >= 30 / MPH ? launchTicks * FIXED_STEP : Infinity,
    stoppingDistanceMetres: braking.speed === 0 ? startZ - braking.z : Infinity,
    stoppingTimeSeconds: brakeTicks * FIXED_STEP,
    coastSpeedAfter5SecondsMph: coasting.speed * MPH,
    sustainedTopSpeedMph: topSpeed.speed * MPH,
    lowSpeedTurnRadiusMetres: distance / yaw,
    launchGears: shifts,
  };
}
