import assert from 'node:assert/strict';
import test from 'node:test';
import { DrivingAudioModel, DEFAULT_AUDIO, AUDIO_BUDGET, loadAudio, serializeAudio, impactSound, noiseSamples } from '../src/driving-audio.ts';
import { DrivingAudio } from '../src/audio-output.ts';
import { VehicleDamage } from '../src/vehicle-damage.ts';
import { createCar } from '../src/simulation.ts';
import { SimulationClock, FIXED_STEP } from '../src/simulation-clock.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';

const sample = (car = createCar(), extra = {}) => ({ car, grounded: 1, paved: 1, lateralSpeed: 0, weather: 'dry', traffic: [], ...extra });
const event = (kind = 'impact', severity = 0.3, material = 'concrete', obstacle = 1) => ({ kind, severity, material, obstacle, time: 0, panel: 'front', point: { x: 0, y: 0.8, z: 0 }, normal: { x: 0, y: 0, z: 1 } });
const contact = extra => ({ obstacle: 1, point: { x: 0, y: 0.5, z: -2.25 }, localPoint: { x: 0, y: 0.5, z: -2.25 }, normal: { x: 0, y: 0, z: 1 }, material: 'metal', closingSpeed: 0, tangentSpeed: 0, impulse: 1000, ...extra });
const loop = (model, id) => model.loops.find(l => l.id === id);

test('volume preferences round-trip, preserve mute and zero volumes, and reject invalid saved data', () => {
  const settings = { muted: true, master: 0, vehicle: 0.4, effects: 1, environment: 0 };
  assert.deepEqual(loadAudio(serializeAudio(settings)), settings);
  for (const raw of [null, 'bad', '{}', 'null', '{"version":2}', ...[-1, 1.1, null, '0.5'].map(master => serializeAudio({ ...DEFAULT_AUDIO, master }))]) assert.deepEqual(loadAudio(raw), DEFAULT_AUDIO);
  assert.deepEqual(loadAudio(serializeAudio({ ...DEFAULT_AUDIO, muted: 'false' })), DEFAULT_AUDIO);
});

test('engine follows RPM/load and shift interruption; transmission responds to selected direction and speed', () => {
  const model = new DrivingAudioModel(), car = createCar();
  model.step(sample(car), FIXED_STEP);
  const idle = { ...loop(model, 'engine') };
  Object.assign(car, { engineRpm: 3000, throttle: 1, speed: 15, selectedGear: 'D', gear: 2 });
  model.step(sample(car), FIXED_STEP);
  assert.ok(loop(model, 'engine').frequency > idle.frequency);
  const accelerating = loop(model, 'engine').gain;
  car.gear = 3; car.shiftRemaining = 0.24;
  model.step(sample(car), FIXED_STEP);
  assert.ok(loop(model, 'engine').gain < accelerating);
  assert.equal(model.drainCues().filter(c => c.kind === 'shift').length, 2);
  const forwardWhine = loop(model, 'transmission').gain;
  car.gear = -1; car.selectedGear = 'R'; car.speed = -15;
  model.step(sample(car), FIXED_STEP);
  assert.ok(loop(model, 'transmission').gain > forwardWhine);
  car.gear = 0; model.step(sample(car), FIXED_STEP);
  assert.equal(loop(model, 'transmission').gain, 0);
});

test('rolling/skid sound distinguishes dry pavement, rain, grass, stopped and airborne wheels', () => {
  const model = new DrivingAudioModel(), car = { ...createCar(), speed: 15, lateralAcceleration: 6 };
  model.step(sample(car), FIXED_STEP);
  const dry = { ...loop(model, 'road') };
  assert.equal(loop(model, 'skid').gain, 0);
  model.step(sample(car, { weather: 'rain' }), FIXED_STEP);
  assert.ok(loop(model, 'road').gain > dry.gain); assert.ok(loop(model, 'road').frequency > dry.frequency);
  assert.ok(loop(model, 'skid').gain > 0); assert.ok(loop(model, 'rain').gain > 0);
  model.step(sample(car, { paved: 0, lateralSpeed: 5 }), FIXED_STEP);
  assert.ok(loop(model, 'road').frequency < dry.frequency); assert.ok(loop(model, 'skid').gain > 0);
  model.step(sample(car, { grounded: 0, lateralSpeed: 5, weather: 'rain' }), FIXED_STEP);
  assert.equal(loop(model, 'road').gain, 0); assert.equal(loop(model, 'skid').gain, 0);
  car.speed = 0; model.step(sample(car), FIXED_STEP);
  assert.equal(loop(model, 'road').gain, 0); assert.equal(loop(model, 'rain').gain, 0);
});

test('horn is a held pair of tones; indicator edges click once per half cycle including hazards', () => {
  const model = new DrivingAudioModel(), car = createCar();
  car.horn = true; car.indicator = 'hazards';
  for (let i = 0; i < 240; i++) {
    car.indicatorTime = i * FIXED_STEP; model.step(sample(car), FIXED_STEP);
    assert.ok(loop(model, 'horn-low').gain > 0);
  }
  assert.deepEqual(model.drainCues().map(c => c.kind), ['indicator-on', 'indicator-off', 'indicator-on', 'indicator-off']);
  car.horn = false; car.indicator = 'off'; model.step(sample(car), FIXED_STEP);
  assert.equal(loop(model, 'horn-high').gain, 0); assert.deepEqual(model.drainCues(), []);
});

test('light/heavy impacts scale loudness and decay, with distinct material brightness and world position', () => {
  const light = impactSound(event('impact', 0.02, 'metal')), heavy = impactSound(event('impact', 0.9, 'metal'));
  assert.ok(heavy.gain > light.gain * 2); assert.ok(heavy.duration > light.duration * 3);
  assert.ok(impactSound(event('impact', 0.9, 'hedge')).gain < heavy.gain);
  assert.notEqual(impactSound(event('impact', 0.9, 'wood')).frequency, heavy.frequency);
  assert.deepEqual(heavy.point, event().point);
});

test('real damage latches prevent repeated resting impacts and repair/pause/reset end independent contact scrapes', () => {
  const damage = new VehicleDamage(), model = new DrivingAudioModel();
  damage.update([contact({ closingSpeed: 6 })], FIXED_STEP);
  model.damageEvents('player', damage.drainEvents());
  for (let i = 0; i < 120; i++) { damage.update([contact({})], FIXED_STEP); model.damageEvents('player', damage.drainEvents()); }
  assert.equal(model.drainCues().filter(c => c.kind === 'impact').length, 1);
  damage.update([contact({ tangentSpeed: 4 }), contact({ obstacle: 2, tangentSpeed: 5 })], FIXED_STEP);
  model.damageEvents('player', damage.drainEvents()); assert.equal(model.loops.length, 2);
  damage.update([contact({ obstacle: 2, tangentSpeed: 5 })], FIXED_STEP);
  model.damageEvents('player', damage.drainEvents()); assert.equal(model.loops.length, 1);
  damage.repair(); model.damageEvents('player', damage.drainEvents()); assert.equal(model.loops.length, 0);
  damage.update([contact({ tangentSpeed: 4 })], FIXED_STEP); model.damageEvents('player', damage.drainEvents());
  damage.pause(); model.damageEvents('player', damage.drainEvents()); assert.equal(model.loops.length, 0);
  model.damageEvents('player', [event('scrape-start')]); model.reset();
  assert.deepEqual(model.loops, []); assert.deepEqual(model.drainCues(), []);
});

test('traffic voices use physical positions and nearest selection; retirement, timeouts, and repair release scrapes', () => {
  const model = new DrivingAudioModel(), car = createCar();
  const traffic = Array.from({ length: 16 }, (_, id) => ({ id, x: car.x + id * 3, z: car.z, speed: 8 }));
  model.step(sample(car, { traffic }), FIXED_STEP);
  assert.equal(model.loops.filter(l => l.id.startsWith('traffic:')).length, AUDIO_BUDGET.traffic);
  assert.deepEqual(loop(model, 'traffic:0').point, { x: car.x, y: 0.8, z: car.z });
  model.damageEvents('traffic:0', [event('scrape-start')]);
  model.damageEvents('player', [event('scrape-start')]);
  model.step(sample(car), FIXED_STEP);
  assert.equal(model.loops.filter(l => l.id.includes('scrape')).length, 1);
  model.clearSource('player'); assert.equal(model.loops.filter(l => l.id.includes('scrape')).length, 0);
  model.damageEvents('player', [event('scrape-start')]); model.step(sample(car), 1);
  assert.equal(model.loops.filter(l => l.id.includes('scrape')).length, 0);
  model.damageEvents('traffic:9', [{ ...event(), point: { x: car.x + 100, y: 1, z: car.z } }]);
  assert.deepEqual(model.drainCues(), [], 'remote collisions cannot consume nearby effect voices');
});

test('Busy voices, scrape storms, and impact bursts have explicit resource bounds', () => {
  const model = new DrivingAudioModel(), car = { ...createCar(), horn: true };
  model.step(sample(car, { traffic: Array.from({ length: 16 }, (_, id) => ({ id, x: car.x, z: car.z, speed: 15 })) }), FIXED_STEP);
  model.damageEvents('player', Array.from({ length: 100 }, (_, i) => event('scrape-start', 1, 'metal', i)));
  model.damageEvents('player', Array.from({ length: 100 }, () => event('impact', 1)));
  assert.equal(model.loops.length, AUDIO_BUDGET.loops);
  assert.equal(model.drainCues().length, AUDIO_BUDGET.queuedCues);
  assert.ok(model.loops.every(l => Number.isFinite(l.frequency) && l.gain <= 0.14));
});

test('indicator/shift/impact event sequences and audio state agree at 30/60/144 rendering Hz', () => {
  const run = fps => {
    const model = new DrivingAudioModel(), clock = new SimulationClock(), car = createCar();
    const cues = []; let ticks = 0;
    for (let frame = 0; frame < fps * 4; frame++) {
      clock.advance(1 / fps, step => {
        car.indicator = 'left'; car.indicatorTime = ticks * step; car.gear = ticks >= 120 ? 2 : 1;
        car.engineRpm = 900 + ticks; car.speed = ticks / 20; car.horn = ticks > 60 && ticks < 100;
        model.step(sample(car), step);
        if (ticks === 140) model.damageEvents('player', [event()]); ticks++;
      });
      cues.push(...model.drainCues());
    }
    return { cues, loops: model.loops, ticks };
  };
  assert.deepEqual(run(30), run(60)); assert.deepEqual(run(60), run(144));
});

test('physical engine and contact state drives sound without modifying driving state', async t => {
  const physics = await createVehiclePhysics({ environment: 'flat', explicitControls: true });
  t.after(() => physics.dispose());
  const model = new DrivingAudioModel(); physics.selectGear('D');
  for (let i = 0; i < 360; i++) {
    physics.step({ forward: true, reverse: false, left: false, right: false }, FIXED_STEP);
    const before = structuredClone(physics.state);
    model.step(sample(physics.state, { grounded: physics.contacts / 4 }), FIXED_STEP);
    assert.deepEqual(physics.state, before);
  }
  assert.ok(loop(model, 'engine').frequency > 30); assert.ok(loop(model, 'road').gain > 0);
});

test('periodic noise is deterministic, bounded and zero at the loop seam', () => {
  const noise = noiseSamples(96000);
  assert.deepEqual(noiseSamples(96000), noise); assert.equal(noise[0], 0); assert.equal(noise.at(-1), 0);
  assert.ok(noise.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
});

test('audio activation stays lazy and unavailable audio permits retry without throwing', async () => {
  let calls = 0;
  const audio = new DrivingAudio(() => { calls++; throw new Error('No audio device'); });
  assert.equal(audio.status, 'Enable sound'); assert.equal(calls, 0);
  audio.setPaused(true); audio.setPaused(false); assert.equal(calls, 0);
  await audio.activate(); assert.equal(audio.status, 'Sound unavailable · retry');
  await audio.activate(); assert.equal(calls, 2);
  audio.dispose();
});
