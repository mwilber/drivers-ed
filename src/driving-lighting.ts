import * as THREE from 'three';
import { LIGHTING, RAIN, type Weather, type TimeOfDay } from './driving-conditions.ts';
import { CAR, SUSPENSION } from './vehicle-config.ts';

/** Fixed light/shadow budget; mirror passes reuse the main pass's shadow maps. */
export const LIGHTING_BUDGET = { sunShadowSize: 2048, headlightCount: 2, headlightShadowSize: 512 } as const;
export const HEADLIGHTS = { intensity: 2200, range: 70, angle: 0.42, penumbra: 0.45, height: 0.63, targetHeight: 0, targetDistance: 35 } as const;

export function createDrivingLighting(scene: THREE.Scene) {
  const ambient = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(LIGHTING_BUDGET.sunShadowSize, LIGHTING_BUDGET.sunShadowSize);
  Object.assign(sun.shadow.camera, { left: -165, right: 165, top: 145, bottom: -145, near: 1, far: 350 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(ambient, sun);
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0, 150, 390);

  // Keep lamps outside the shell: hiding the player's body for mirrors must not
  // remove its illumination or invalidate the reused headlight shadow maps.
  const rig = new THREE.Group();
  scene.add(rig);
  const beams = [-0.68, 0.68].map(x => {
    const beam = new THREE.SpotLight(0xfff4ce, 0, HEADLIGHTS.range, HEADLIGHTS.angle, HEADLIGHTS.penumbra, 2);
    beam.position.set(x, HEADLIGHTS.height - SUSPENSION.centerOfMassHeight, -CAR.length / 2 - 0.08);
    beam.target.position.set(x, HEADLIGHTS.targetHeight - SUSPENSION.centerOfMassHeight, -HEADLIGHTS.targetDistance);
    beam.shadow.mapSize.set(LIGHTING_BUDGET.headlightShadowSize, LIGHTING_BUDGET.headlightShadowSize);
    beam.shadow.camera.near = 0.1;
    beam.shadow.camera.far = HEADLIGHTS.range;
    beam.shadow.bias = -0.0002;
    beam.shadow.normalBias = 0.025;
    rig.add(beam, beam.target);
    return beam;
  });
  let previous = '';
  const rainColor = new THREE.Color(0x657580);
  return {
    ambient, sun, rig, beams,
    update(timeOfDay: TimeOfDay, headlights: boolean, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }, weather: Weather = 'dry') {
      const key = `${timeOfDay}/${weather}`;
      if (previous !== key) {
        const preset = LIGHTING[timeOfDay];
        const raining = weather === 'rain';
        const sky = scene.background as THREE.Color, fog = scene.fog as THREE.Fog;
        sky.setHex(preset.sky);
        if (raining) sky.lerp(rainColor, timeOfDay === 'night' ? 0.08 : 0.4);
        fog.color.copy(sky);
        fog.near = raining ? RAIN.fogNear : 150;
        fog.far = raining ? RAIN.fogFar : 390;
        ambient.color.setHex(preset.skyLight);
        ambient.groundColor.setHex(preset.groundLight);
        ambient.intensity = preset.ambient * (raining ? 0.8 : 1);
        sun.color.setHex(preset.sunColor);
        sun.intensity = preset.sun * (raining ? 0.35 : 1);
        sun.position.set(-90, preset.sunHeight, 60);
        sun.castShadow = preset.sunShadows && !raining;
        previous = key;
      }
      rig.position.copy(position);
      rig.quaternion.copy(rotation);
      for (const beam of beams) {
        beam.intensity = headlights ? HEADLIGHTS.intensity : 0;
        beam.castShadow = headlights;
      }
    },
  };
}
