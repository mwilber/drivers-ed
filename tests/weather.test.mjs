import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { DEFAULT_CONDITIONS, loadConditions, serializeConditions, RAIN, lightingGuidance } from '../src/driving-conditions.ts';
import { createDrivingLighting } from '../src/driving-lighting.ts';
import { WindshieldRain, WINDSHIELD, RAIN_BUDGET, rainStreak } from '../src/windshield-rain.ts';
import { createWeatherVisuals } from '../src/weather-visuals.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { TrafficPhysics } from '../src/traffic-physics.ts';
import { Pedestrians } from '../src/pedestrians.ts';
import { loadPedestrianScenario, PEDESTRIAN_SCENARIOS } from '../src/pedestrian-scenarios.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { IDLE, MPH } from '../scripts/handling-scenarios.mjs';
import { SUSPENSION, HANDLING, CAR } from '../src/vehicle-config.ts';

test('condition v1 migration preserves lighting; weather/wipers round-trip and corrupt v2 data falls back safely', () => {
  assert.deepEqual(loadConditions('{"version":1,"conditions":{"timeOfDay":"night"}}'), { ...DEFAULT_CONDITIONS, timeOfDay: 'night' });
  for (const weather of ['dry', 'rain']) for (const wipers of ['off', 'slow', 'fast']) {
    const settings = { timeOfDay: 'dusk', weather, wipers };
    assert.deepEqual(loadConditions(serializeConditions(settings)), settings);
  }
  for (const change of [{ weather: 'snow' }, { weather: null }, { wipers: 'auto' }, { wipers: 1 }, { timeOfDay: false }]) assert.deepEqual(loadConditions(serializeConditions({ ...DEFAULT_CONDITIONS, ...change })), DEFAULT_CONDITIONS);
  assert.match(lightingGuidance('day', false, 'rain'), /wet roads.*switch on headlights/);
});

test('rain reduces distant contrast consistently in day/dusk/night and Dry restores original fog and lighting', () => {
  const scene = new THREE.Scene(), light = createDrivingLighting(scene);
  for (const timeOfDay of ['day', 'dusk', 'night']) {
    light.update(timeOfDay, true, new THREE.Vector3(), new THREE.Quaternion());
    const dry = { sky: scene.background.getHex(), ambient: light.ambient.intensity, sun: light.sun.intensity, shadows: light.sun.castShadow };
    light.update(timeOfDay, true, new THREE.Vector3(), new THREE.Quaternion(), 'rain');
    const fog = scene.fog;
    assert.equal(fog.near, RAIN.fogNear); assert.equal(fog.far, RAIN.fogFar);
    assert.ok((80 - fog.near) / (fog.far - fog.near) >= 0.5, 'at least half the 80 m contrast is lost to authored rain fog');
    assert.ok(light.sun.intensity < dry.sun); assert.equal(light.sun.castShadow, false);
    light.update(timeOfDay, true, new THREE.Vector3(), new THREE.Quaternion(), 'dry');
    assert.equal(scene.fog.near, 150); assert.equal(scene.fog.far, 390);
    assert.deepEqual({ sky: scene.background.getHex(), ambient: light.ambient.intensity, sun: light.sun.intensity, shadows: light.sun.castShadow }, dry);
  }
});

test('wipers clear swept sectors; Fast keeps less water than Slow, Off accumulates, and water stays bounded', () => {
  const coverage = [];
  for (const mode of ['off', 'slow', 'fast']) {
    const rain = new WindshieldRain();
    for (let i = 0; i < 1200; i++) rain.step(1 / 120, 'rain', mode);
    assert.equal(rain.water.length, RAIN_BUDGET.windshieldCells);
    assert.ok(rain.water.every(water => water >= 0 && water <= 1));
    assert.ok(Math.abs(rain.angle) <= WINDSHIELD.sweep);
    coverage.push(rain.coverage);
  }
  assert.equal(coverage[0], 1);
  assert.ok(coverage[1] < coverage[0] * 0.6); assert.ok(coverage[2] < coverage[1] * 0.95);
  const rain = new WindshieldRain(); rain.step(0.3, 'rain', 'slow');
  const angle = rain.angle; rain.step(1 / 120, 'rain', 'fast');
  assert.ok(Math.abs(rain.angle - angle) < 0.1, 'changing speed preserves blade phase');
  for (let i = 0; i < 120; i++) rain.step(1 / 120, 'rain', 'off');
  assert.equal(rain.moving, false); assert.equal(rain.angle, -WINDSHIELD.sweep, 'Off finishes the cycle then parks');
  rain.step(1 / 120, 'dry', 'slow'); assert.equal(rain.coverage, 0);
  rain.reset(); assert.equal(rain.coverage, 0); assert.equal(rain.moving, false);
});

test('rain and wiper state agree at 30/60/144 Hz; pause freezes water/blades and reset clears the windshield', () => {
  const snapshots = [];
  for (const fps of [30, 60, 144]) {
    const clock = new SimulationClock(), rain = new WindshieldRain(); let ticks = 0;
    for (let i = 0; i < fps * 8; i++) clock.advance(1 / fps, dt => {
      rain.step(dt, 'rain', ticks++ < 240 ? 'off' : ticks < 600 ? 'slow' : 'fast');
    });
    snapshots.push({ water: [...rain.water], angle: rain.angle });
    clock.reset(); assert.deepEqual({ water: [...rain.water], angle: rain.angle }, snapshots.at(-1));
    rain.reset(); assert.ok(rain.water.every(value => value === 0));
  }
  for (const snapshot of snapshots) assert.deepEqual(snapshot, snapshots[0]);
  const p = { x: 17, y: 0.7, z: -20 };
  assert.ok(Math.abs(rainStreak(3, 1, p).x - rainStreak(3, 1, { ...p, x: p.x + 0.1 }).x) < 1e-10, 'nearby streaks do not ride with the moving car');
  assert.deepEqual(rainStreak(3, 1, p), rainStreak(3, 1, p), 'streak positions depend only on simulation time and pose');
});

test('weather toggles reuse bounded visuals; the forward windshield is car-local and omitted with the mirror shell', () => {
  const scene = new THREE.Scene(), shell = new THREE.Group(); scene.add(shell);
  const visuals = createWeatherVisuals(scene, shell), rain = new WindshieldRain();
  const geometry = visuals.rain.geometry, texture = visuals.texture;
  for (let i = 0; i < 100; i++) {
    rain.step(1 / 120, i % 2 ? 'rain' : 'dry', 'fast');
    visuals.update(i % 2 ? 'rain' : 'dry', i / 120, new THREE.Vector3(), rain);
    assert.equal(visuals.rain.geometry, geometry); assert.equal(visuals.texture, texture);
    assert.equal(scene.children.length, 2); assert.equal(shell.children.length, 3);
  }
  assert.equal(geometry.attributes.position.count, RAIN_BUDGET.streaks * 2);
  assert.equal(visuals.glass.parent, shell); assert.ok(visuals.glass.geometry.attributes.position.array.every(Number.isFinite));
  shell.visible = false;
  const visible = []; scene.traverseVisible(object => visible.push(object));
  assert.ok(visible.includes(visuals.rain)); assert.ok(!visible.includes(visuals.glass));
  rain.reset(); visuals.update('dry', 0, new THREE.Vector3(), rain);
  assert.equal(visuals.rain.visible, false); assert.equal(visuals.glass.visible, false);
  assert.ok(visuals.blades.every(blade => !blade.visible));
});

async function stop(weather, fps = 120) {
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true, weather });
  try {
    sim.selectGear('D'); sim.state.gear = 3; sim.body.setLinvel({ x: 0, y: 0, z: -30 / MPH }, true);
    const clock = new SimulationClock(), start = sim.position.z; let distance, time, ticks = 0;
    for (let frame = 0; frame < fps * 4; frame++) clock.advance(1 / fps, dt => {
      sim.step({ ...IDLE, reverse: true }, dt); ticks++;
      if (distance === undefined && sim.state.speed === 0) { distance = start - sim.position.z; time = ticks / 120; }
    });
    return { distance, time, position: sim.position, rotation: sim.rotation };
  } finally { sim.dispose(); }
}
test('wet pavement measurably lengthens the 30 mph stop with identical 30/60/144 Hz outcomes', async t => {
  const dry = await stop('dry'); const wet = [];
  for (const fps of [30, 60, 144]) wet.push(await stop('rain', fps));
  assert.ok(dry.distance >= 12 && dry.distance <= 17);
  assert.ok(wet[0].distance >= 18 && wet[0].distance <= 22); assert.ok(wet[0].distance > dry.distance * 1.5);
  assert.ok(wet[0].time > dry.time);
  assert.deepEqual(wet[0], wet[1]); assert.deepEqual(wet[1], wet[2]);
  t.diagnostic(`30 mph dry: ${dry.distance.toFixed(2)} m / ${dry.time.toFixed(2)} s; rain: ${wet[0].distance.toFixed(2)} m / ${wet[0].time.toFixed(2)} s.`);
});

test('weather changes preserve body motion and damage; reset/repair retain rain and switching to Dry restores wheel tuning', async t => {
  const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true }); t.after(() => sim.dispose());
  sim.selectGear('D'); sim.body.setLinvel({ x: 1, y: 0, z: -8 }, true);
  sim.damage.panels.front.dent = 0.2;
  const before = { position: sim.body.translation(), rotation: sim.body.rotation(), velocity: sim.body.linvel() };
  sim.weather = 'rain';
  assert.deepEqual({ position: sim.body.translation(), rotation: sim.body.rotation(), velocity: sim.body.linvel() }, before);
  assert.equal(sim.damage.panels.front.dent, 0.2);
  sim.step(IDLE); sim.repair(); assert.equal(sim.weather, 'rain');
  sim.reset(); assert.equal(sim.weather, 'rain'); assert.equal(sim.state.selectedGear, 'P');
  sim.weather = 'dry'; sim.step(IDLE);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(sim.vehicle.wheelFrictionSlip(i) - SUSPENSION.tireFriction) < 1e-6);
  const restored = await stop('dry'); assert.ok(Math.abs(restored.distance - 12.32) < 0.01);
});

test('wet grip applies at each paved wheel, leaves grass tuning intact, and bounds forward/reverse drive and brakes', async t => {
  const sim = await createVehiclePhysics({ explicitControls: true, weather: 'rain' }); t.after(() => sim.dispose());
  sim.step(IDLE);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(sim.vehicle.wheelFrictionSlip(i) - SUSPENSION.tireFriction * RAIN.grip) < 1e-6);
  const limit = CAR.mass * HANDLING.gravity * HANDLING.dryGrip * RAIN.grip / 4;
  for (const gear of ['D', 'R']) {
    sim.reset(); sim.selectGear(gear);
    for (let i = 0; i < 240; i++) {
      sim.step({ ...IDLE, forward: true });
      for (let wheel = 0; wheel < 4; wheel++) assert.ok(Math.abs(sim.vehicle.wheelEngineForce(wheel)) <= limit + 1e-3);
    }
    sim.step({ ...IDLE, reverse: true });
    for (let wheel = 0; wheel < 4; wheel++) assert.ok(sim.vehicle.wheelBrake(wheel) <= limit / 120 + 1e-3);
  }
  sim.reset({ x: 500, z: 500, heading: 0 }); sim.step(IDLE);
  const grass = Array.from({ length: 4 }, (_, i) => sim.vehicle.wheelFrictionSlip(i));
  sim.weather = 'dry'; sim.step(IDLE);
  for (let i = 0; i < 4; i++) {
    assert.equal(sim.vehicle.wheelFrictionSlip(i), grass[i]);
    assert.ok(Math.abs(grass[i] - SUSPENSION.tireFriction * HANDLING.grassGrip / HANDLING.dryGrip) < 1e-6);
  }
});

async function wetWorld(t, spawn = { x: 140, z: 210, heading: 0 }) {
  const sim = await createVehiclePhysics({ explicitControls: true, spawn, weather: 'rain' });
  const traffic = new VehicleTraffic(); traffic.weather = 'rain'; traffic.density = 'off';
  const bridge = new TrafficPhysics(sim), people = new Pedestrians(sim);
  t.after(() => { people.clear(); bridge.clear(); sim.dispose(); });
  const step = () => {
    people.beforeStep(traffic.seconds, [...traffic.cars, sim.state]);
    traffic.step(traffic.seconds, sim.state, people.hazards(traffic.seconds), people.obstacles());
    bridge.sync(traffic.cars); sim.step(IDLE); bridge.afterStep(traffic); people.afterStep();
  };
  return { sim, traffic, bridge, people, step };
}
test('wet-road AI physically yields to an entered crossing, then resumes without impacts', async t => {
  const { traffic, bridge, people, sim, step } = await wetWorld(t, PEDESTRIAN_SCENARIOS['pedestrian-yield'].spawn);
  loadPedestrianScenario(people, traffic, 'pedestrian-yield'); bridge.sync(traffic.cars);
  let stopped = false, resumed = false;
  // Exercise the first encounter, before the pedestrian begins its return trip.
  for (let i = 0; i < 24 * 120; i++) {
    step(); const car = traffic.cars[0];
    if (people.people[0].state === 'crossing') {
      assert.ok(car.z - 2.25 > -46); stopped ||= Math.abs(car.speed) < 0.05;
    }
    resumed ||= people.completed > 0 && car.z < -49;
    assert.equal(people.drainEvents().length, 0); assert.equal(sim.damage.condition, 'undamaged');
    assert.ok(!bridge.drainEvents().some(e => e.event.kind === 'impact'));
  }
  assert.ok(stopped); assert.ok(resumed);
});
test('sustained wet Busy traffic with pedestrians completes routes/crossings without routine impacts', async t => {
  const { traffic, bridge, people, step } = await wetWorld(t);
  traffic.setDensity('busy'); people.reset(); let count = 0;
  const start = performance.now();
  for (let i = 0; i < 600 * 120; i++) {
    step(); count = Math.max(count, bridge.count);
    assert.equal(people.drainEvents().length, 0);
    assert.ok(!bridge.drainEvents().some(e => e.event.kind === 'impact'), `rain collision at ${traffic.seconds}`);
    assert.ok(traffic.cars.every(car => Number.isFinite(car.x + car.z + car.heading + car.speed)));
  }
  assert.equal(count, 16); assert.ok(traffic.completed >= 2, `${traffic.completed} routes completed`); assert.ok(people.completed >= 10);
  t.diagnostic(`Wet Busy / three pedestrians: ${traffic.completed} routes, ${people.completed} crossings; ${((performance.now() - start) / (600 * 120)).toFixed(3)} ms/shared step on this host.`);
});
test('a physical wet car finishes a finite route after stopping with its larger braking margin', async t => {
  const { traffic, bridge, step } = await wetWorld(t);
  traffic.add(['town-w:west>center'], 58, 2); bridge.sync(traffic.cars);
  for (let i = 0; i < 15 * 120; i++) step();
  assert.equal(traffic.completed, 1); assert.equal(traffic.cars.length, 0); assert.equal(bridge.count, 0);
});
test('a wet driver already in the crossing exclusion area clears a late curb request so the pedestrian can enter', async t => {
  const { traffic, people, bridge, step } = await wetWorld(t);
  const car = traffic.add(['middle-n:center>north', 'north-w:north>nw'], 82, 4);
  const person = people.add('north-middle-n', 1, 0, 0.8);
  bridge.sync(traffic.cars);
  let cleared = false, waited = false;
  for (let i = 0; i < 24 * 120; i++) {
    step();
    waited ||= person.wait === 0 && person.state === 'waiting';
    cleared ||= car.z + 2.25 < -48;
    assert.equal(people.drainEvents().length, 0);
    assert.ok(!bridge.drainEvents().some(e => e.event.kind === 'impact'));
  }
  assert.ok(waited); assert.ok(cleared); assert.ok(people.completed > 0);
});
