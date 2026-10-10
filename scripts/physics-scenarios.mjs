import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { FIXED_STEP } from '../src/simulation-clock.ts';
import { IDLE, MPH } from './handling-scenarios.mjs';

export async function measurePhysics() {
  const sim = await createVehiclePhysics({ environment: 'flat' });
  try {
    let launchTicks = 0;
    const gears = [];
    while (sim.state.speed < 30 / MPH && launchTicks < 20 / FIXED_STEP) {
      const gear = sim.state.gear;
      sim.step({ ...IDLE, forward: true });
      launchTicks++;
      if (sim.state.gear !== gear) gears.push(sim.state.gear);
    }
    const launchSeconds = sim.state.speed >= 30 / MPH ? launchTicks * FIXED_STEP : Infinity;
    sim.reset();
    sim.state.gear = 3;
    sim.body.setLinvel({ x: 0, y: 0, z: -30 / MPH }, true);
    const startZ = sim.position.z;
    let brakeTicks = 0;
    do {
      sim.step({ ...IDLE, forward: true, reverse: true });
      brakeTicks++;
    } while (sim.state.speed > 0 && brakeTicks < 10 / FIXED_STEP);
    const stoppingDistance = sim.state.speed === 0 ? startZ - sim.position.z : Infinity;
    sim.reset();
    sim.state.gear = 3;
    sim.body.setLinvel({ x: 0, y: 0, z: -30 / MPH }, true);
    for (let i = 0; i < 5 / FIXED_STEP; i++) sim.step(IDLE);
    const coastMph = sim.state.speed * MPH;
    sim.reset();
    for (let i = 0; i < 180 / FIXED_STEP; i++) sim.step({ ...IDLE, forward: true });
    const topMph = sim.state.speed * MPH;
    sim.reset();
    let distance = 0, yaw = 0;
    for (let i = 0; i < 40 / FIXED_STEP; i++) {
      const before = { ...sim.position }, heading = sim.state.heading;
      sim.step({ ...IDLE, forward: sim.state.speed < 1, left: true });
      if (i >= 10 / FIXED_STEP) {
        distance += Math.hypot(sim.position.x - before.x, sim.position.z - before.z);
        yaw += sim.state.heading - heading;
      }
    }
    return {
      zeroTo30Seconds: launchSeconds, stoppingDistanceMetres: stoppingDistance,
      stoppingTimeSeconds: brakeTicks * FIXED_STEP, coastSpeedAfter5SecondsMph: coastMph,
      sustainedTopSpeedMph: topMph, lowSpeedTurnRadiusMetres: distance / yaw, launchGears: gears,
    };
  } finally { sim.dispose(); }
}
