import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_CONDITIONS, LIGHTING, TIMES_OF_DAY, loadConditions, serializeConditions, lightingGuidance } from '../src/driving-conditions.ts';
import { createDrivingLighting, HEADLIGHTS, LIGHTING_BUDGET } from '../src/driving-lighting.ts';
import { createTrafficVisuals } from '../src/traffic-visuals.ts';
import { createVehiclePhysics } from '../src/vehicle-physics.ts';
import { VehicleTraffic } from '../src/vehicle-traffic.ts';
import { SimulationClock } from '../src/simulation-clock.ts';
import { IDLE, MPH } from '../scripts/handling-scenarios.mjs';

const position = new THREE.Vector3(0, 0.7, 0), rotation = new THREE.Quaternion();
test('lighting preferences round-trip and reject malformed, older, missing and unsupported conditions', () => {
  for (const timeOfDay of TIMES_OF_DAY) assert.deepEqual(loadConditions(serializeConditions({ ...DEFAULT_CONDITIONS, timeOfDay })), { ...DEFAULT_CONDITIONS, timeOfDay });
  for (const raw of [null, 'broken', '{}', 'null', '{"version":2,"conditions":{"timeOfDay":"night"}}', '{"version":1}', ...[null, {}, 'rain', 2, false].map(timeOfDay => serializeConditions({ timeOfDay }))]) {
    assert.deepEqual(loadConditions(raw), DEFAULT_CONDITIONS);
  }
  assert.match(lightingGuidance('night', false), /switch on headlights/);
  assert.doesNotMatch(lightingGuidance('night', true), /switch on/);
  assert.doesNotMatch(lightingGuidance('day', false), /switch on/);
});

test('day/dusk/night reduce scene illumination and switching back restores the exact daytime baseline', () => {
  const scene = new THREE.Scene(), lighting = createDrivingLighting(scene);
  const snapshots = [];
  for (const timeOfDay of [...TIMES_OF_DAY, 'day']) {
    lighting.update(timeOfDay, false, position, rotation);
    snapshots.push({ sky: scene.background.getHex(), fog: scene.fog.color.getHex(), ambient: lighting.ambient.intensity, sun: lighting.sun.intensity, sunColor: lighting.sun.color.getHex(), position: lighting.sun.position.toArray(), shadows: lighting.sun.castShadow });
  }
  assert.deepEqual(snapshots[0], snapshots[3]);
  assert.equal(snapshots[0].ambient, 2.5); assert.equal(snapshots[0].sun, 3.1);
  assert.ok(snapshots[0].ambient > snapshots[1].ambient && snapshots[1].ambient > snapshots[2].ambient);
  assert.ok(snapshots[0].sun > snapshots[1].sun && snapshots[1].sun > snapshots[2].sun);
  assert.ok(new THREE.Color(LIGHTING.night.sky).r < new THREE.Color(LIGHTING.day.sky).r);
  assert.equal(scene.fog.near, 150); assert.equal(scene.fog.far, 390);
});

test('headlights cover both lane edges 10–40 m ahead and follow the full physical chassis pose', () => {
  const scene = new THREE.Scene(), lighting = createDrivingLighting(scene);
  for (const heading of [0, Math.PI / 2, -2]) {
    const pose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, heading, -0.04, 'YXZ'));
    lighting.update('night', true, position, pose);
    scene.updateMatrixWorld(true);
    assert.deepEqual(lighting.rig.quaternion.toArray(), pose.toArray());
    for (const x of [-2.5, 0, 2.5]) for (const distance of [10, 20, 40]) {
      // Keep the roadway level while the physical chassis pitches and rolls.
      const roadHeading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      const point = new THREE.Vector3(x, -position.y, -distance).applyQuaternion(roadHeading).add(position);
      assert.ok(lighting.beams.some(beam => {
        const origin = beam.getWorldPosition(new THREE.Vector3());
        const target = beam.target.getWorldPosition(new THREE.Vector3());
        const delta = point.clone().sub(origin);
        return delta.length() < beam.distance && delta.normalize().dot(target.sub(origin).normalize()) > Math.cos(beam.angle);
      }), `headlight cone covers x=${x}, distance=${distance}, heading=${heading}`);
    }
  }
  lighting.update('night', false, position, rotation);
  assert.ok(lighting.beams.every(beam => beam.intensity === 0 && !beam.castShadow));
  lighting.update('dusk', true, position, rotation);
  assert.ok(lighting.beams.every(beam => beam.intensity === HEADLIGHTS.intensity && beam.castShadow));
});

test('headlight illumination survives hiding the player shell for mirrors and light/shadow resources stay bounded', () => {
  const scene = new THREE.Scene(), lighting = createDrivingLighting(scene);
  const shell = new THREE.Group(); scene.add(shell); shell.visible = false;
  const lights = [];
  for (let i = 0; i < 1000; i++) lighting.update(TIMES_OF_DAY[i % 3], !!(i % 2), position, rotation);
  scene.traverseVisible(object => { if (object.isLight) lights.push(object); });
  assert.equal(lights.length, 4);
  assert.equal(lights.filter(light => light.isSpotLight).length, 2);
  assert.equal(lighting.rig.parent, scene);
  assert.equal(lighting.sun.shadow.mapSize.x, LIGHTING_BUDGET.sunShadowSize);
  for (const beam of lighting.beams) {
    assert.equal(beam.shadow.mapSize.x, LIGHTING_BUDGET.headlightShadowSize);
    assert.ok(beam.position.z < -2.25, 'light originates ahead of the body to avoid self-shadowing');
  }
  lighting.update('night', true, position, rotation);
  assert.equal(lights.filter(light => light.castShadow).length, 2, 'night has only the two headlight shadow passes');
});

test('traffic front/tail lamps light at dusk/night, braking is brighter and pooled cars restore daytime lamps', () => {
  const scene = new THREE.Scene(), visuals = createTrafficVisuals(scene);
  const traffic = new VehicleTraffic(); traffic.density = 'off';
  const car = traffic.add(['middle-n:center>north', 'north-e:north>ne'], 22, 0);
  visuals.update(traffic.cars, 0, 'night');
  const lamps = () => scene.children[0].children.filter(mesh => mesh.isMesh && Math.abs(mesh.position.x) === 0.65);
  const fronts = lamps().filter(mesh => mesh.position.z < -2);
  const rears = lamps().filter(mesh => mesh.position.z > 2);
  assert.equal(fronts.length, 2); assert.equal(rears.length, 2);
  assert.ok(fronts.every(mesh => mesh.material.emissiveIntensity === 2));
  const tailIntensity = rears[0].material.emissiveIntensity;
  assert.ok(tailIntensity > 0);
  car.braking = true; visuals.update(traffic.cars, 0, 'night');
  assert.ok(rears.every(mesh => mesh.material.emissiveIntensity > tailIntensity));
  car.braking = false; visuals.update([], 0, 'day');
  assert.equal(scene.children[0].visible, false);
  visuals.update(traffic.cars, 0, 'day');
  assert.ok(lamps().every(mesh => mesh.material.emissive.getHex() === 0));
  visuals.update(traffic.cars, 0, 'dusk');
  assert.ok(fronts.every(mesh => mesh.material.emissiveIntensity === 2));
  let lightCount = 0; scene.traverse(object => { lightCount += Number(!!object.isLight); });
  assert.equal(lightCount, 0, 'AI lamps add no lighting/shadow passes at Busy density');
});

test('lighting and headlight changes preserve vehicle state, dry 30 mph stopping distance and 30/60/144 Hz outcomes', async t => {
  const results = [];
  for (const timeOfDay of TIMES_OF_DAY) for (const fps of [30, 60, 144]) {
    const sim = await createVehiclePhysics({ environment: 'flat', explicitControls: true });
    t.after(() => sim.dispose());
    sim.selectGear('D'); sim.state.gear = 3;
    sim.body.setLinvel({ x: 0, y: 0, z: -30 / MPH }, true);
    const clock = new SimulationClock();
    const lighting = createDrivingLighting(new THREE.Scene());
    const start = sim.position.z;
    let stopped;
    for (let frame = 0; frame < fps * 3; frame++) {
      clock.advance(1 / fps, step => {
        sim.step({ ...IDLE, forward: true, reverse: true }, step);
        if (stopped === undefined && sim.state.speed === 0) stopped = start - sim.position.z;
      });
      const state = structuredClone(sim.state), velocity = sim.body.linvel();
      lighting.update(frame % 2 ? timeOfDay : 'day', frame % 2 === 0, sim.position, sim.rotation);
      assert.deepEqual(sim.state, state); assert.deepEqual(sim.body.linvel(), velocity);
    }
    assert.ok(stopped >= 12 && stopped <= 17, `${timeOfDay} dry-road stop: ${stopped} m`);
    results.push({ stopped, position: sim.position, rotation: sim.rotation, speed: sim.state.speed });
  }
  for (const result of results) assert.deepEqual(result, results[0]);
  t.diagnostic(`All lighting presets: ${results[0].stopped.toFixed(2)} m dry-road stop from 30 mph; identical 30/60/144 Hz state.`);
});
