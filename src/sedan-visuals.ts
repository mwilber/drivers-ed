import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './vehicle-config.ts';

/** Decorative sedan parts only: metres above the road, forward along -Z. */
export const SEDAN_DETAIL = { enter: 45, leave: 60 } as const;
export const TRAFFIC_VISUAL_BUDGET = { cars: 16, drawCalls: 640, triangles: 60_000, geometryBytes: 2 * 1024 * 1024 } as const;

function box(width: number, height: number, depth: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}
function beam(start: THREE.Vector3, end: THREE.Vector3, width: number) {
  const geometry = new THREE.BoxGeometry(width, start.distanceTo(end), width);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()));
  return geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
}
function merge(parts: THREE.BufferGeometry[]) {
  const result = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  result.computeBoundingSphere();
  return result;
}

/** One set per scene; every pooled sedan and the player reuse these buffers/materials. */
export function createSedanResources() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x273237, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa5afaf, roughness: 0.4, metalness: 0.55 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x242b2b, roughness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x364b57, roughness: 0.28, metalness: 0.15, side: THREE.DoubleSide });
  const trimGeometry = merge([
    ...[-1, 1].map(side => box(1.68, 0.13, 0.045, 0, 0.38, side * 2.225)),
    ...[-1, 1].map(side => box(0.015, 0.06, 1.9, side * 0.897, 0.325, 0)),
  ]);
  const seams = [box(0.82, 0.17, 0.004, 0, 0.6, -2.249)];
  const bright = [box(0.4, 0.1, 0.004, 0, 0.47, 2.249)];
  for (const x of [-0.902, 0.902]) {
    for (const z of [-0.8, 0.15, 1.1]) seams.push(box(0.004, 0.37, 0.008, x, 0.515, z));
    seams.push(box(0.004, 0.008, 1.9, x, 0.705, 0.15));
    for (const z of [-0.06, 0.89]) bright.push(box(0.009, 0.045, 0.17, x, 0.65, z));
  }
  for (const y of [0.55, 0.6, 0.65]) bright.push(box(0.76, 0.014, 0.006, 0, y, -2.249));
  const seamGeometry = merge(seams), brightGeometry = merge(bright);

  // Four sloped window faces replace the old opaque cuboid. The existing roof remains a damage panel.
  const windowGeometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  function quad(a: number[], b: number[], c: number[], d: number[]) { vertices.push(...a, ...b, ...c, ...a, ...c, ...d); }
  quad([-0.8, 0.91, -1], [0.8, 0.91, -1], [0.8, 1.565, -0.6], [-0.8, 1.565, -0.6]);
  quad([0.8, 0.91, 1.35], [-0.8, 0.91, 1.35], [-0.8, 1.565, 1.2], [0.8, 1.565, 1.2]);
  for (const x of [-0.8, 0.8]) quad([x, 0.91, -1], [x, 0.91, 1.35], [x, 1.565, 1.2], [x, 1.565, -0.6]);
  windowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  windowGeometry.computeVertexNormals(); windowGeometry.computeBoundingSphere();
  const frameParts: THREE.BufferGeometry[] = [], pillarParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.82, 0.82]) {
    frameParts.push(beam(new THREE.Vector3(x, 0.85, -1), new THREE.Vector3(x, 1.6, -0.6), 0.075));
    frameParts.push(beam(new THREE.Vector3(x, 0.85, 1.35), new THREE.Vector3(x, 1.6, 1.2), 0.08));
    frameParts.push(box(0.07, 0.1, 2.35, x, 0.88, 0.175));
    pillarParts.push(box(0.055, 0.655, 0.075, x, 1.2375, 0.25));
  }
  const frameGeometry = merge(frameParts), pillarGeometry = merge(pillarParts);
  const tireGeometry = new THREE.CylinderGeometry(CAR.tireRadius, CAR.tireRadius, 0.18, 16);
  tireGeometry.rotateZ(Math.PI / 2);
  const hubParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.092, 0.092]) {
    const disk = new THREE.CylinderGeometry(0.08, 0.08, 0.008, 12);
    disk.rotateZ(Math.PI / 2); disk.translate(x, 0, 0); hubParts.push(disk);
    for (let i = 0; i < 5; i++) {
      const spoke = box(0.008, 0.18, 0.035, 0, 0.1, 0);
      spoke.rotateX(i * Math.PI * 2 / 5); spoke.translate(x, 0, 0); hubParts.push(spoke);
    }
    const rim = new THREE.TorusGeometry(CAR.tireRadius * 0.67, 0.018, 4, 16);
    rim.rotateY(Math.PI / 2); rim.translate(x, 0, 0); hubParts.push(rim);
  }
  const hubGeometry = merge(hubParts);
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
    const result = new THREE.Mesh(geometry, material);
    result.name = name; result.castShadow = result.receiveShadow = true;
    return result;
  }
  return {
    exterior() {
      const group = new THREE.Group(), detail = new THREE.Group();
      group.name = 'sedan exterior'; detail.name = 'sedan close detail';
      group.add(mesh(trimGeometry, dark, 'bumpers and sills'));
      detail.add(mesh(seamGeometry, dark, 'door seams and grille'), mesh(brightGeometry, metal, 'handles and grille trim'));
      group.add(detail);
      return { group, detail };
    },
    cabin(paint: number) {
      const group = new THREE.Group(); group.name = 'traffic cabin';
      group.add(mesh(windowGeometry, glass, 'sloped windows'));
      group.add(mesh(frameGeometry, new THREE.MeshStandardMaterial({ color: paint, roughness: 0.7 }), 'window frames'));
      const pillars = mesh(pillarGeometry, dark, 'window dividers'); group.add(pillars);
      return { group, pillars };
    },
    wheel() {
      const group = new THREE.Group(); group.name = 'sedan wheel';
      group.add(mesh(tireGeometry, tire, 'tire'), mesh(hubGeometry, metal, 'wheel rim and spokes'));
      return group;
    },
  };
}

/** Counts authored draws per view and retained buffers, including hidden pool entries. Excludes materials and GPU driver overhead. */
export function visualStats(roots: readonly THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  let drawCalls = 0, triangles = 0, geometryBytes = 0;
  function visit(node: THREE.Object3D, visible: boolean) {
    visible &&= node.visible;
    if (node instanceof THREE.Mesh) {
      geometries.add(node.geometry);
      if (node instanceof THREE.InstancedMesh) geometryBytes += node.instanceMatrix.array.byteLength;
      if (visible) { drawCalls++; triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3 * (node instanceof THREE.InstancedMesh ? node.count : 1); }
    }
    node.children.forEach(child => visit(child, visible));
  }
  roots.forEach(root => visit(root, true));
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) geometryBytes += attribute.array.byteLength;
    geometryBytes += geometry.index?.array.byteLength ?? 0;
  }
  return { drawCalls, triangles, geometryBytes };
}
