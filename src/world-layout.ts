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

// Outside the north T-junction, directly ahead from the original starting lane.
export const PARKING_LOT: Readonly<Rect> = { x: 0, z: -125, width: 120, depth: 90 };
export const PARKING_ENTRANCE: Readonly<Rect> = { x: 0, z: -72.5, width: 16, depth: 15 };
export const TEST_AREA: Readonly<Rect> = { x: 102, z: -136, width: 68, depth: 72 };
export const TEST_ENTRANCE: Readonly<Rect> = { x: 64, z: -106, width: 8, depth: 12 };
export const PAVED_SURFACES: readonly Rect[] = [...ROADS, PARKING_ENTRANCE, PARKING_LOT, TEST_ENTRANCE, TEST_AREA];
export const ROAD_HEIGHT = 0.08;
export const SIDEWALK_HEIGHT = ROAD_HEIGHT + 0.15;
export const TEST_RAMP = { x: 84, z: -145, width: 10, depth: 32, height: 1.2, rampLength: 12 } as const;
export const TEST_CURB = { x: 111, z: -145, width: 10, depth: 16, height: 0.15 } as const;
export const WORLD_BOUNDS = { minX: -177, maxX: 177, minZ: -194, maxZ: 137 } as const;

// Perimeter spaces leave a large unobstructed center for circles and figure eights.
export const PARKING_MARKINGS: Rect[] = [];
for (let x = -48; x <= 48; x += 3) PARKING_MARKINGS.push({ x, z: -164, width: 0.12, depth: 6 });
PARKING_MARKINGS.push({ x: 0, z: -167, width: 96, depth: 0.12 });
for (const x of [-54, 54]) {
  for (let z = -154; z <= -90; z += 3.2) PARKING_MARKINGS.push({ x, z, width: 6, depth: 0.12 });
  PARKING_MARKINGS.push({ x: Math.sign(x) * 57, z: -122, width: 0.12, depth: 64 });
}

function occupiesParkingArea(rect: Rect): boolean {
  return [PARKING_LOT, PARKING_ENTRANCE].some(paved =>
    Math.abs(rect.x - paved.x) <= (rect.width + paved.width) / 2 + 3
    && Math.abs(rect.z - paved.z) <= (rect.depth + paved.depth) / 2 + 3);
}

/** All paved surfaces use road grip, including the parking lot and its entrance. */
export function isOnRoad(x: number, z: number): boolean {
  return [...PAVED_SURFACES, ...DRIVEWAYS].some(road => Math.abs(x - road.x) <= road.width / 2 && Math.abs(z - road.z) <= road.depth / 2);
}

const colors = [0xd9cbb8, 0xc5cfc8, 0xd7c3b5, 0xbdc9ce, 0xe3d8bf];
export const HOUSES: House[] = [];
for (const z of [-82, -39, 39, 82]) {
  for (const x of [-78, -51, -24, 24, 51, 78]) {
    const index = HOUSES.length;
    const house = { x, z, width: 12 + index % 3, depth: 11, height: 5.5 + index % 2, color: colors[index % colors.length]!, roofColor: index % 2 ? 0x696a62 : 0x756458 };
    if (!occupiesParkingArea(house)) HOUSES.push(house);
  }
}
for (const x of [-123, 123]) {
  for (const z of [-36, 0, 36]) HOUSES.push({ x, z, width: 12, depth: 15, height: 6, color: colors[HOUSES.length % colors.length]!, roofColor: 0x696a62 });
}

export const DRIVEWAYS: readonly Rect[] = HOUSES.filter(house => Math.abs(house.x) < 100).map(house => {
  const roadZ = house.z < 0 ? -60 : 60;
  const towardRoad = Math.sign(roadZ - house.z);
  const edge = house.z + towardRoad * house.depth / 2;
  const end = roadZ - towardRoad * 5;
  return { x: house.x + 3, z: (edge + end) / 2, width: 3.8, depth: Math.abs(end - edge) };
});

/** Rectangular subtraction creates real curb gaps at roads, entrances and driveways. */
function subtractRect(source: Rect, cut: Rect): Rect[] {
  const l = source.x - source.width / 2, r = source.x + source.width / 2;
  const t = source.z - source.depth / 2, b = source.z + source.depth / 2;
  const cl = Math.max(l, cut.x - cut.width / 2), cr = Math.min(r, cut.x + cut.width / 2);
  const ct = Math.max(t, cut.z - cut.depth / 2), cb = Math.min(b, cut.z + cut.depth / 2);
  if (cl >= cr || ct >= cb) return [source];
  return [[l, t, cl, b], [cr, t, r, b], [cl, t, cr, ct], [cl, cb, cr, b]]
    .filter(([x1, z1, x2, z2]) => x2 > x1 && z2 > z1)
    .map(([x1, z1, x2, z2]) => ({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, width: x2 - x1, depth: z2 - z1 }));
}
export const SIDEWALKS: Rect[] = [];
for (const surface of PAVED_SURFACES) {
  let pieces = [{ ...surface, width: surface.width + 4, depth: surface.depth + 4 }];
  for (const cut of [...PAVED_SURFACES, ...DRIVEWAYS, ...SIDEWALKS]) pieces = pieces.flatMap(piece => subtractRect(piece, cut));
  SIDEWALKS.push(...pieces);
}

/** Identical ramp vertices feed the renderer and the physics collider. */
export function rampVertices(): Float32Array {
  const r = TEST_RAMP;
  const points = [];
  for (const x of [-r.width / 2, r.width / 2]) {
    for (const [z, y] of [[-r.depth / 2, 0], [-r.depth / 2 + r.rampLength, r.height], [r.depth / 2 - r.rampLength, r.height], [r.depth / 2, 0]]) {
      points.push(x + r.x, y + ROAD_HEIGHT, z + r.z);
    }
  }
  return new Float32Array(points);
}

export const TREES: Tree[] = [];
for (const z of [-76, -45, 45, 76]) {
  for (const x of [-90, -64, -37, 37, 64, 90]) {
    if (!occupiesParkingArea({ x, z, width: 6, depth: 6 })) TREES.push({ x, z, size: 0.85 + (TREES.length % 4) * 0.12 });
  }
}
for (const x of [-113, -86, -15, 15, 86, 113]) {
  for (const z of [-22, 14, 29]) TREES.push({ x, z, size: 0.9 + (TREES.length % 3) * 0.15 });
}

const boundaryCenterZ = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
const boundaryHalfDepth = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / 2;
export const BOUNDARY_OBSTACLES: readonly Obstacle[] = [
  { x: WORLD_BOUNDS.minX, z: boundaryCenterZ, halfWidth: 1, halfDepth: boundaryHalfDepth },
  { x: WORLD_BOUNDS.maxX, z: boundaryCenterZ, halfWidth: 1, halfDepth: boundaryHalfDepth },
  { x: 0, z: WORLD_BOUNDS.minZ, halfWidth: WORLD_BOUNDS.maxX + 1, halfDepth: 1 },
  { x: 0, z: WORLD_BOUNDS.maxZ, halfWidth: WORLD_BOUNDS.maxX + 1, halfDepth: 1 },
];

export const OBSTACLES: Obstacle[] = [
  ...HOUSES.map(house => ({ x: house.x, z: house.z, halfWidth: house.width / 2, halfDepth: house.depth / 2 })),
  ...TREES.map(tree => ({ x: tree.x, z: tree.z, halfWidth: 0.28 * tree.size, halfDepth: 0.28 * tree.size })),
  ...BOUNDARY_OBSTACLES,
];
