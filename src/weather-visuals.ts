import * as THREE from 'three';
import type { Weather } from './driving-conditions.ts';
import { RAIN_BUDGET, WINDSHIELD, WindshieldRain, rainStreak } from './windshield-rain.ts';

/** One world rain draw per view, one windshield draw and two blades in the cockpit. */
export function createWeatherVisuals(scene: THREE.Scene, car: THREE.Group) {
  const positions = new Float32Array(RAIN_BUDGET.streaks * 6);
  const rainGeometry = new THREE.BufferGeometry();
  const rainPositions = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  rainGeometry.setAttribute('position', rainPositions);
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xaebfc9, transparent: true, opacity: 0.3, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);

  const waterBytes = new Uint8Array(RAIN_BUDGET.windshieldCells);
  const texture = new THREE.DataTexture(waterBytes, WINDSHIELD.columns, WINDSHIELD.rows, THREE.RedFormat);
  texture.needsUpdate = true;
  const glassGeometry = new THREE.BufferGeometry();
  // The actual forward windshield, above the hood and between the A-pillars.
  // Head checks naturally look away from it; it is omitted with the shell in mirrors.
  glassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.825, 1.02, -1.06, 0.825, 1.02, -1.06, -0.825, 1.57, -0.64, 0.825, 1.57, -0.64,
  ], 3));
  glassGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  glassGeometry.setIndex([0, 1, 2, 2, 1, 3]);
  const glass = new THREE.Mesh(glassGeometry, new THREE.ShaderMaterial({
    uniforms: { water: { value: texture } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 glassUv; void main() { glassUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D water; varying vec2 glassUv;
      void main() {
        vec2 cell = floor(glassUv * vec2(32.0, 16.0));
        vec2 local = fract(glassUv * vec2(32.0, 16.0));
        float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 center = vec2(0.25 + seed * 0.5, 0.35 + fract(seed * 7.0) * 0.3);
        float shape = length((local - center) / vec2(0.18 + seed * 0.1, 0.3));
        float droplet = 1.0 - smoothstep(0.65, 1.0, shape);
        float amount = texture2D(water, (cell + 0.5) / vec2(32.0, 16.0)).r;
        gl_FragColor = vec4(vec3(0.62, 0.7, 0.75), amount * (0.08 + 0.48 * droplet));
      }`,
  }));
  car.add(glass);
  const bladeGeometry = new THREE.BoxGeometry(0.014, WINDSHIELD.bladeLength, 0.018);
  const bladePaint = new THREE.MeshStandardMaterial({ color: 0x182225, roughness: 0.65 });
  const blades = [-0.33, 0.33].map(x => {
    const blade = new THREE.Mesh(bladeGeometry, bladePaint);
    blade.userData.pivot = x;
    car.add(blade); return blade;
  });
  const direction = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let revision = -1;
  return {
    rain, glass, blades, texture,
    update(weather: Weather, seconds: number, position: { x: number; y: number; z: number }, windshield: WindshieldRain) {
      rain.visible = glass.visible = weather === 'rain';
      for (const blade of blades) blade.visible = weather === 'rain' || windshield.moving;
      if (weather === 'rain') {
        for (let i = 0; i < RAIN_BUDGET.streaks; i++) {
          const point = rainStreak(i, seconds, position), offset = i * 6;
          positions[offset] = point.x; positions[offset + 1] = point.y; positions[offset + 2] = point.z;
          positions[offset + 3] = point.x + 0.12; positions[offset + 4] = point.y + 0.9; positions[offset + 5] = point.z;
        }
        rainPositions.needsUpdate = true;
        if (revision !== windshield.revision) {
          for (let i = 0; i < waterBytes.length; i++) waterBytes[i] = Math.round(windshield.water[i]! * 255);
          texture.needsUpdate = true; revision = windshield.revision;
        }
      }
      direction.set(Math.sin(windshield.angle), Math.cos(windshield.angle) * 0.55 / WINDSHIELD.height, Math.cos(windshield.angle) * 0.42 / WINDSHIELD.height);
      for (const blade of blades) {
        blade.position.set(blade.userData.pivot, 1.02 + 0.02 * 0.55 / WINDSHIELD.height, -1.06 + 0.02 * 0.42 / WINDSHIELD.height - 0.015).addScaledVector(direction, WINDSHIELD.bladeLength / 2);
        blade.quaternion.setFromUnitVectors(up, direction);
      }
    },
  };
}
