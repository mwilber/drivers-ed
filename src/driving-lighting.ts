import * as THREE from 'three';
import { LIGHTING, type TimeOfDay } from './driving-conditions.ts';
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
  let previous: TimeOfDay | undefined;
  return {
    ambient, sun, rig, beams,
    update(timeOfDay: TimeOfDay, headlights: boolean, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }) {
      if (previous !== timeOfDay) {
        const preset = LIGHTING[timeOfDay];
        (scene.background as THREE.Color).setHex(preset.sky);
        (scene.fog as THREE.Fog).color.setHex(preset.sky);
        ambient.color.setHex(preset.skyLight);
        ambient.groundColor.setHex(preset.groundLight);
        ambient.intensity = preset.ambient;
        sun.color.setHex(preset.sunColor);
        sun.intensity = preset.sun;
        sun.position.set(-90, preset.sunHeight, 60);
        sun.castShadow = preset.sunShadows;
        previous = timeOfDay;
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
