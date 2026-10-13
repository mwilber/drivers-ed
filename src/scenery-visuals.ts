import * as THREE from 'three';
import { HOUSES, PARK_PAVILION, MEWS_MARKET, TREES } from './world-layout.ts';
import type { Point } from './road-network.ts';

/** Increment budgets, independent of device speed; all geometry is generated once. */
export const SCENERY_BUDGET = { detailIn: 100, detailOut: 115, drawCalls: 24, triangles: 45000, geometryBytes: 1048576, textureBytes: 16384 } as const;

interface Instance { matrix: THREE.Matrix4; owner: Point }
interface Batch { mesh: THREE.InstancedMesh; instances: Instance[]; detail: boolean }

/** Shared instanced shells stay visible at every distance, including rear-view mirrors.
 * Only inset facade decoration and secondary foliage disappear with distance.
 * Distance is measured from the driver for all passes, with hysteresis at the boundary. */
export function createSceneryVisuals(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'Neighborhood scenery'; scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1); roof.rotateY(Math.PI / 4);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3.5, 7);
  const pending = new Map<string, { geometry: THREE.BufferGeometry; color: number; detail: boolean; instances: Instance[] }>();
  const pose = new THREE.Object3D();
  function add(geometry: THREE.BufferGeometry, color: number, owner: Point, x: number, y: number, z: number, w: number, h: number, d: number, detail = false) {
    const key = `${geometry.uuid}:${color}:${detail}`;
    if (!pending.has(key)) pending.set(key, { geometry, color, detail, instances: [] });
    pose.position.set(x, y, z); pose.scale.set(w, h, d); pose.updateMatrix();
    pending.get(key)!.instances.push({ matrix: pose.matrix.clone(), owner });
  }
  for (const house of HOUSES) {
    const { x, z, width: w, height: h, depth: d } = house;
    add(cube, house.color, house, x, h / 2, z, w, h, d);
    // Foundation stays within the collider's footprint; roof overhang remains overhead.
    add(cube, 0xb7b7a9, house, x, 0.12, z, w, 0.24, d);
    add(roof, house.roofColor, house, x, h + 1.75, z, (w + 1.6) / Math.SQRT2, 3.5, (d + 1.6) / Math.SQRT2);
    for (const side of [-1, 1]) {
      const face = z + side * (d / 2 + 0.006);
      // Thin planes of trim extend at most 2 cm: no new physical projections.
      add(cube, 0xf1ead8, house, x, 1.35, face, 1.35, 2.7, 0.014, true);
      add(cube, 0x476a64, house, x, 1.27, face + side * 0.009, 1.12, 2.5, 0.004, true);
      if (house === MEWS_MARKET && side === -1) continue; // Wider storefront windows below the fascia.
      for (const offset of [-w * 0.29, w * 0.29]) {
        add(cube, 0xf1ead8, house, x + offset, 3.2, face, 2.15, 1.9, 0.014, true);
        add(cube, 0x364b57, house, x + offset, 3.2, face + side * 0.009, 1.85, 1.6, 0.004, true);
        add(cube, 0xf1ead8, house, x + offset, 3.2, face + side * 0.012, 0.08, 1.65, 0.004, true);
      }
    }
  }
  for (const [i, tree] of TREES.entries()) {
    const { x, z, size: s } = tree;
    add(trunk, 0x776853, tree, x, 1.75 * s, z, s, s, s);
    const color = [0x587448, 0x6b8551, 0x78945c][i % 3]!;
    add(crown, color, tree, x, 4.7 * s, z, 2.7 * s, 3.2 * s, 2.5 * s);
    for (const side of [-1, 1]) add(crown, color, tree, x + side * 1.3 * s, 5.1 * s, z + side * 0.4 * s, 1.5 * s, 2.1 * s, 1.7 * s, true);
  }
  // Recognizable striped pavilion fascia, inside the existing building footprint.
  for (const side of [-1, 1]) for (let i = -4; i <= 4; i++) {
    add(cube, i % 2 ? 0x476a64 : 0xf1ead8, PARK_PAVILION, i * 2.3, 5.45, PARK_PAVILION.z + side * 7.01, 2.3, 0.8, 0.02);
  }
  // A striped storefront identifies the market. All decoration stays on its solid building shell.
  for (let i = -4; i <= 4; i++) add(cube, i % 2 ? 0x476a64 : 0xf1ead8, MEWS_MARKET,
    MEWS_MARKET.x + i * 2.3, 4.4, MEWS_MARKET.z - 7.01, 2.3, 0.8, 0.02);
  for (const side of [-1, 1]) {
    add(cube, 0xf1ead8, MEWS_MARKET, MEWS_MARKET.x + side * 6.8, 2.1, MEWS_MARKET.z - 7.006, 5.7, 2.6, 0.014, true);
    add(cube, 0x364b57, MEWS_MARKET, MEWS_MARKET.x + side * 6.8, 2.1, MEWS_MARKET.z - 7.015, 5.4, 2.3, 0.004, true);
  }
  const batches: Batch[] = [];
  for (const entry of pending.values()) {
    const mesh = new THREE.InstancedMesh(entry.geometry, new THREE.MeshStandardMaterial({ color: entry.color, roughness: 0.92 }), entry.instances.length);
    mesh.castShadow = !entry.detail; mesh.receiveShadow = true;
    entry.instances.forEach((instance, i) => mesh.setMatrixAt(i, instance.matrix));
    mesh.computeBoundingSphere(); group.add(mesh);
    batches.push({ mesh, instances: entry.instances, detail: entry.detail });
  }
  const owners = [...HOUSES, ...TREES];
  const detailBatches = batches.filter(b => b.detail);
  const visibility = new Map<Point, boolean>();
  function update(point: Point) {
    let changed = false;
    for (const owner of owners) {
      const previous = visibility.get(owner);
      const visible = Math.hypot(point.x - owner.x, point.z - owner.z) <= (previous ? SCENERY_BUDGET.detailOut : SCENERY_BUDGET.detailIn);
      if (previous !== visible) { visibility.set(owner, visible); changed = true; }
    }
    if (!changed) return;
    for (const batch of detailBatches) {
      let count = 0;
      for (const instance of batch.instances) if (visibility.get(instance.owner)) batch.mesh.setMatrixAt(count++, instance.matrix);
      batch.mesh.count = count;
      batch.mesh.instanceMatrix.needsUpdate = true;
      // Repacking changes the active bounds, including when returning from an empty batch.
      batch.mesh.computeBoundingSphere();
    }
  }
  function stats() {
    const geometries = new Set(batches.map(b => b.mesh.geometry));
    const geometryBytes = [...geometries].reduce((sum, g) => sum + Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0), 0)
      + batches.reduce((sum, b) => sum + b.mesh.instanceMatrix.array.byteLength, 0);
    return { drawCalls: batches.filter(b => b.mesh.count > 0).length, triangles: batches.reduce((sum, b) => sum + b.mesh.count * (b.mesh.geometry.index?.count ?? b.mesh.geometry.attributes.position!.count) / 3, 0), geometryBytes };
  }
  return { group, update, stats };
}

/** Seeded, tiny tile: surface detail does not change road geometry or grip. */
export function createAsphaltTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  let seed = 12;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = 220 + (seed >>> 27);
    data.set([shade, shade, shade, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
