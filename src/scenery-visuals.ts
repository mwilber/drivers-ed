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
  cube.name = 'Facade and foundation';
  const siding = new THREE.PlaneGeometry(1, 1); siding.name = 'Siding';
  const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1); roof.rotateY(Math.PI / 4);
  roof.name = 'Hipped roof';
  // Closed triangular prism, with the same eaves/ridge envelope as the hip roof.
  const gable = new THREE.BufferGeometry(); gable.name = 'Gabled roof';
  gable.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5, 0, 0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0, 0.5, 0.5,
    -0.5, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
    0.5, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5,
    0.5, -0.5, -0.5, 0, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  ], 3));
  gable.computeVertexNormals();
  const crown = new THREE.IcosahedronGeometry(1, 1);
  crown.name = 'Tree crown';
  // Matching positions share the same deformation/shade, including triangle seams.
  // Keep every vertex inside the old unit sphere; no foliage expands the world envelope.
  const foliageColors = [];
  const vertex = new THREE.Vector3();
  for (let i = 0; i < crown.attributes.position!.count; i++) {
    vertex.fromBufferAttribute(crown.attributes.position!, i);
    const patch = (Math.round(vertex.x * 1000) * 17 + Math.round(vertex.y * 1000) * 31 + Math.round(vertex.z * 1000) * 13) >>> 0;
    const shade = 0.78 + (patch % 19) / 100 + Math.max(0, vertex.y) * 0.04;
    foliageColors.push(shade, shade, shade);
    vertex.multiplyScalar(0.9 + (patch % 11) / 100);
    crown.attributes.position!.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  crown.setAttribute('color', new THREE.Float32BufferAttribute(foliageColors, 3));
  crown.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3.5, 7);
  trunk.name = 'Tree trunk and branches';
  const barkColors = [];
  for (let i = 0; i < trunk.attributes.position!.count; i++) {
    vertex.fromBufferAttribute(trunk.attributes.position!, i);
    const shade = 0.72 + 0.2 * (0.5 + 0.5 * Math.cos(Math.atan2(vertex.z, vertex.x) * 3 + vertex.y * 0.7));
    barkColors.push(shade, shade, shade);
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(barkColors, 3));
  const pending = new Map<string, { geometry: THREE.BufferGeometry; color: number; detail: boolean; instances: Instance[] }>();
  const pose = new THREE.Object3D();
  function add(geometry: THREE.BufferGeometry, color: number, owner: Point, x: number, y: number, z: number, w: number, h: number, d: number, detail = false, rotationY = 0, rotationZ = 0) {
    const key = `${geometry.uuid}:${color}:${detail}`;
    if (!pending.has(key)) pending.set(key, { geometry, color, detail, instances: [] });
    pose.position.set(x, y, z); pose.scale.set(w, h, d); pose.rotation.set(0, rotationY, rotationZ); pose.updateMatrix();
    pending.get(key)!.instances.push({ matrix: pose.matrix.clone(), owner });
  }
  for (const [index, house] of HOUSES.entries()) {
    const { x, z, width: w, height: h, depth: d } = house;
    add(cube, house.color, house, x, h / 2, z, w, h, d);
    // Foundation stays within the collider's footprint; roof overhang remains overhead.
    add(cube, 0xb7b7a9, house, x, 0.12, z, w, 0.24, d);
    const gabled = house !== PARK_PAVILION && house !== MEWS_MARKET && index % 3 === 0;
    const span = gabled ? 1 : Math.SQRT2;
    add(gabled ? gable : roof, house.roofColor, house, x, h + 1.75, z, (w + 1.6) / span, 3.5, (d + 1.6) / span);
    // Persistent eaves identify the roof edge from cockpit and mirror views.
    // Their undersides are at the existing wall height, above the drivable envelope.
    for (const side of [-1, 1]) {
      add(cube, 0xf1ead8, house, x, h + 0.05, z + side * (d / 2 + 0.72), w + 1.6, 0.1, 0.16);
      add(cube, 0xf1ead8, house, x + side * (w / 2 + 0.72), h + 0.05, z, 0.16, 0.1, d + 1.6);
    }
    for (const side of [-1, 1]) {
      const face = z + side * (d / 2 + 0.006);
      for (const corner of [-1, 1]) add(cube, 0xf1ead8, house, x + corner * (w / 2 - 0.09), h / 2, face, 0.18, h, 0.014, true);
      for (let y = 0.6; y < h - 0.3; y += 0.6) {
        add(siding, 0xf1ead8, house, x, y, face, w - 0.36, 0.035, 1, true, side === -1 ? Math.PI : 0);
        add(siding, 0xf1ead8, house, x + side * (w / 2 + 0.006), y, z, d - 0.36, 0.035, 1, true, side * Math.PI / 2);
      }
      // Side windows stay on the shell; no shutters or other low projections.
      const sideFace = x + side * (w / 2 + 0.006);
      for (const offset of [-d * 0.27, d * 0.27]) {
        add(cube, 0xf1ead8, house, sideFace, 3.2, z + offset, 0.014, 1.9, 2.15, true);
        add(cube, 0x364b57, house, sideFace + side * 0.009, 3.2, z + offset, 0.004, 1.6, 1.85, true);
        add(cube, 0xf1ead8, house, sideFace + side * 0.012, 3.2, z + offset, 0.004, 1.65, 0.08, true);
      }
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
    const yaw = i * 2.399963229728653; // Stable variation around the street, without random allocation.
    for (const side of [-1, 1]) {
      const reach = side * 1.05, rise = 2.05;
      add(trunk, 0x776853, tree,
        x + Math.cos(yaw) * reach * s / 2, 3.625 * s, z - Math.sin(yaw) * reach * s / 2,
        0.4 * s, Math.hypot(reach, rise) * s / 3.5, 0.4 * s, false, yaw, -Math.atan2(reach, rise));
    }
    const color = [0x587448, 0x6b8551, 0x78945c][i % 3]!;
    // Broad, upright and rounded crowns keep a complete silhouette at distance.
    const shape = [
      { y: 5.75, width: 1.8, height: 2.1, reach: 0.95, lower: 4.6, lobe: 1.5 },
      { y: 5.35, width: 1.35, height: 2.4, reach: 0.85, lower: 4.4, lobe: 1.25 },
      { y: 5.5, width: 2, height: 2.35, reach: 0.85, lower: 4.7, lobe: 1.6 },
    ][Math.floor(i / 3) % 3]!;
    add(crown, color, tree, x, shape.y * s, z, shape.width * s, shape.height * s, shape.width * s, false, yaw);
    for (const side of [-1, 1]) add(crown, color, tree,
      x + Math.cos(yaw) * side * shape.reach * s, shape.lower * s, z - Math.sin(yaw) * side * shape.reach * s,
      shape.lobe * s, 1.65 * s, shape.lobe * s, true, yaw);
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
    const mesh = new THREE.InstancedMesh(entry.geometry, new THREE.MeshStandardMaterial({ color: entry.color, roughness: 0.92, vertexColors: entry.geometry.hasAttribute('color') }), entry.instances.length);
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
