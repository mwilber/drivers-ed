import * as THREE from 'three';
import { PAVED_SURFACES, SIDEWALKS, DRIVEWAYS, ROAD_HEIGHT, SIDEWALK_HEIGHT, type Rect } from './world-layout.ts';
import { ROAD_PAINT, YIELD_PAINT } from './road-paint.ts';
import { createAsphaltTexture } from './scenery-visuals.ts';
import type { Point } from './road-network.ts';
import type { Weather } from './driving-conditions.ts';

export const PAVEMENT_BUDGET = { drawCalls: 8, triangles: 15000, geometryBytes: 524288, textureBytes: 16384, detailIn: 100, detailOut: 115 } as const;
export interface SurfaceJoint extends Rect { elevation: number }
/** Flat joints inset from each authored piece, so curb/driveway gaps stay clear. */
export const SURFACE_JOINTS: SurfaceJoint[] = [
  ...SIDEWALKS.map(rect => ({ rect, elevation: SIDEWALK_HEIGHT + 0.002 })),
  ...DRIVEWAYS.map(rect => ({ rect, elevation: ROAD_HEIGHT + 0.002 })),
].flatMap(({ rect, elevation }) => {
  const horizontal = rect.width >= rect.depth;
  const length = horizontal ? rect.width : rect.depth, span = horizontal ? rect.depth : rect.width;
  if (span < 0.18) return [];
  const center = horizontal ? rect.x : rect.z, start = center - length / 2 + 0.15, end = center + length / 2 - 0.15;
  const joints: SurfaceJoint[] = [];
  for (let axis = Math.ceil(start / 2) * 2; axis <= end; axis += 2) joints.push({
    x: horizontal ? axis : rect.x, z: horizontal ? rect.z : axis,
    width: horizontal ? 0.018 : span - 0.12, depth: horizontal ? span - 0.12 : 0.018, elevation,
  });
  return joints;
});

/** Static surfaces/paint always persist. Only fine concrete joints use driver-based detail. */
export function createPavementVisuals(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'Pavement and road paint'; scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
  const pose = new THREE.Object3D();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x596168, roughness: 0.92, map: createAsphaltTexture() });
  // UVs use world metres after instancing, keeping a 2 m tile continuous across
  // differently sized streets, aprons and the lot without per-surface geometry.
  asphalt.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
        vec4 pavementPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          pavementPosition = instanceMatrix * pavementPosition;
        #endif
        vMapUv = (modelMatrix * pavementPosition).xz * 0.5;
      #endif`);
  };
  asphalt.customProgramCacheKey = () => 'world-pavement-uv-v1';
  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, count: number, castsShadow: boolean) {
    const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.name = name;
    mesh.castShadow = castsShadow; mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  function rectangles(name: string, rects: readonly Rect[], material: THREE.MeshStandardMaterial, height: number, elevation = height / 2, castsShadow = true) {
    const mesh = batch(name, cube, material, rects.length, castsShadow);
    rects.forEach((rect, i) => {
      pose.position.set(rect.x, elevation, rect.z); pose.scale.set(rect.width, height, rect.depth); pose.rotation.set(0, 0, 0); pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix);
    });
    mesh.computeBoundingSphere(); return mesh;
  }
  rectangles('Asphalt', PAVED_SURFACES, asphalt, ROAD_HEIGHT);
  rectangles('Sidewalks', SIDEWALKS, new THREE.MeshStandardMaterial({ color: 0xc9c8b9, roughness: 0.92 }), SIDEWALK_HEIGHT);
  rectangles('Driveways', DRIVEWAYS, new THREE.MeshStandardMaterial({ color: 0xb8b9aa, roughness: 0.92 }), ROAD_HEIGHT);
  for (const color of new Set(ROAD_PAINT.map(line => line.color))) {
    const lines = ROAD_PAINT.filter(line => line.color === color);
    const mesh = batch(`Paint ${color.toString(16)}`, cube, new THREE.MeshStandardMaterial({ color, roughness: 1 }), lines.length, false);
    lines.forEach((line, i) => {
      pose.position.set(line.x, ROAD_HEIGHT + line.elevation, line.z); pose.scale.set(line.width, 0.006, line.depth); pose.rotation.set(0, 0, 0); pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix);
    });
    mesh.computeBoundingSphere();
  }
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, -0.3, 0, -0.3, 0.3, 0, -0.3], 3)); triangle.computeVertexNormals();
  const yieldPaint = batch('Yield triangles', triangle, new THREE.MeshStandardMaterial({ color: 0xf3f1df, roughness: 1, side: THREE.DoubleSide }), YIELD_PAINT.length, false);
  YIELD_PAINT.forEach((line, i) => {
    pose.position.set(line.x, ROAD_HEIGHT + 0.012, line.z); pose.scale.set(1, 1, 1); pose.rotation.set(0, line.rotation, 0); pose.updateMatrix(); yieldPaint.setMatrixAt(i, pose.matrix);
  });
  yieldPaint.computeBoundingSphere();
  const joints = batch('Concrete joints', plane, new THREE.MeshStandardMaterial({ color: 0x8e9186, roughness: 1 }), SURFACE_JOINTS.length, false);
  const jointMatrices = SURFACE_JOINTS.map(joint => {
    pose.position.set(joint.x, joint.elevation, joint.z); pose.scale.set(joint.width, 1, joint.depth); pose.rotation.set(0, 0, 0); pose.updateMatrix(); return pose.matrix.clone();
  });
  jointMatrices.forEach((matrix, i) => joints.setMatrixAt(i, matrix)); joints.computeBoundingSphere();
  const visible = new Array<boolean>(SURFACE_JOINTS.length);
  function update(point: Point, weather: Weather) {
    asphalt.roughness = weather === 'rain' ? 0.42 : 0.92;
    asphalt.color.setHex(weather === 'rain' ? 0x444d55 : 0x596168);
    let changed = false;
    SURFACE_JOINTS.forEach((joint, i) => {
      const next = Math.hypot(point.x - joint.x, point.z - joint.z) <= (visible[i] ? PAVEMENT_BUDGET.detailOut : PAVEMENT_BUDGET.detailIn);
      if (next !== visible[i]) { visible[i] = next; changed = true; }
    });
    if (changed) {
      let count = 0;
      jointMatrices.forEach((matrix, i) => { if (visible[i]) joints.setMatrixAt(count++, matrix); });
      joints.count = count; joints.instanceMatrix.needsUpdate = true; joints.computeBoundingSphere();
    }
  }
  function stats() {
    const meshes = group.children as THREE.InstancedMesh[], geometries = new Set(meshes.map(m => m.geometry));
    const geometryBytes = [...geometries].reduce((sum, g) => sum + Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0), 0)
      + meshes.reduce((sum, m) => sum + m.instanceMatrix.array.byteLength, 0);
    return {
      drawCalls: meshes.filter(m => m.count > 0).length,
      triangles: meshes.reduce((sum, m) => sum + m.count * (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3, 0),
      geometryBytes, textureBytes: (asphalt.map!.image as { data: Uint8Array }).data.byteLength,
    };
  }
  return { group, asphalt, update, stats };
}
