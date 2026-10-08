import type { Obstacle } from './simulation.ts';

export interface Rect { x: number; z: number; width: number; depth: number }
export interface House extends Rect { height: number; color: number; roofColor: number }
export interface Tree { x: number; z: number; size: number }

// The north and south roads are the longer sides; the middle road connects them.
export const ROAD_WIDTH = 10;
export const ROADS: readonly Rect[] = [
  { x: 0, z: -60, width: 210, depth: ROAD_WIDTH },
  { x: 0, z: 60, width: 210, depth: ROAD_WIDTH },
  { x: -100, z: 0, width: ROAD_WIDTH, depth: 120 },
  { x: 100, z: 0, width: ROAD_WIDTH, depth: 120 },
  { x: 0, z: 0, width: ROAD_WIDTH, depth: 120 },
];

export function isOnRoad(x: number, z: number): boolean {
  return ROADS.some(road => Math.abs(x - road.x) <= road.width / 2 && Math.abs(z - road.z) <= road.depth / 2);
}

const colors = [0xd9cbb8, 0xc5cfc8, 0xd7c3b5, 0xbdc9ce, 0xe3d8bf];
export const HOUSES: House[] = [];
for (const z of [-82, -39, 39, 82]) {
  for (const x of [-78, -51, -24, 24, 51, 78]) {
    const index = HOUSES.length;
    HOUSES.push({ x, z, width: 12 + index % 3, depth: 11, height: 5.5 + index % 2, color: colors[index % colors.length]!, roofColor: index % 2 ? 0x696a62 : 0x756458 });
  }
}
for (const x of [-123, 123]) {
  for (const z of [-36, 0, 36]) HOUSES.push({ x, z, width: 12, depth: 15, height: 6, color: colors[HOUSES.length % colors.length]!, roofColor: 0x696a62 });
}

export const TREES: Tree[] = [];
for (const z of [-76, -45, 45, 76]) {
  for (const x of [-90, -64, -37, 37, 64, 90]) TREES.push({ x, z, size: 0.85 + (TREES.length % 4) * 0.12 });
}
for (const x of [-113, -86, -15, 15, 86, 113]) {
  for (const z of [-22, 14, 29]) TREES.push({ x, z, size: 0.9 + (TREES.length % 3) * 0.15 });
}

export const OBSTACLES: Obstacle[] = [
  ...HOUSES.map(house => ({ x: house.x, z: house.z, halfWidth: house.width / 2, halfDepth: house.depth / 2 })),
  ...TREES.map(tree => ({ x: tree.x, z: tree.z, halfWidth: 0.28 * tree.size, halfDepth: 0.28 * tree.size })),
  // A distant boundary keeps the phase-one sandbox finite.
  { x: -177, z: 0, halfWidth: 1, halfDepth: 137 },
  { x: 177, z: 0, halfWidth: 1, halfDepth: 137 },
  { x: 0, z: -137, halfWidth: 177, halfDepth: 1 },
  { x: 0, z: 137, halfWidth: 177, halfDepth: 1 },
];
