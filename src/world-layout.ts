import type { Obstacle } from './simulation.ts';
import { CROSSING_RAMPS, JUNCTION_SURFACES, PARALLEL_PARKING, parkingMarkings, PARKING_LOT, PARKING_ENTRANCE, TEST_AREA, TEST_ENTRANCE, WORLD_BOUNDS, STREET_SURFACES, STREETS, junction, JUNCTION_RADIUS } from './road-network.ts';
import { ROAD_POSTS } from './traffic-layout.ts';
export { PARKING_LOT, PARKING_ENTRANCE, TEST_AREA, TEST_ENTRANCE, WORLD_BOUNDS, ROAD_WIDTH } from './road-network.ts';

export interface Rect { x: number; z: number; width: number; depth: number }
export interface House extends Rect { height: number; color: number; roofColor: number; drivewayStreetId?: string }
export interface Tree { x: number; z: number; size: number }
export const PARK_PAVILION: House = { x: 0, z: 332, width: 22, depth: 14, height: 6, color: 0xd9cbb8, roofColor: 0x476a64 };
export const MEWS_MARKET: House = { x: 178, z: 208, width: 22, depth: 14, height: 5.5, color: 0xd9cbb8, roofColor: 0x476a64, drivewayStreetId: 'mews-south' };

// Lane geometry and physical pavement share the same street definitions.
export const ROADS: readonly Rect[] = STREET_SURFACES;

export const PAVED_SURFACES: readonly Rect[] = [...ROADS, ...JUNCTION_SURFACES, PARKING_ENTRANCE, PARKING_LOT, TEST_ENTRANCE, TEST_AREA, PARALLEL_PARKING, ...CROSSING_RAMPS];
export const ROAD_HEIGHT = 0.08;
export const SIDEWALK_HEIGHT = ROAD_HEIGHT + 0.15;
export const TEST_RAMP = { x: 84, z: -145, width: 10, depth: 32, height: 1.2, rampLength: 12 } as const;
export const TEST_CURB = { x: 111, z: -145, width: 10, depth: 16, height: 0.15 } as const;

// Authoritative space dimensions generate both lot and parallel-bay paint.
export const PARKING_MARKINGS: readonly Rect[] = parkingMarkings();

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

// Southern block preserves open sightlines at the new intersections.
for (const x of [-65, -35, 35, 65]) {
  for (const z of [112, 211]) HOUSES.push({ x, z, width: 13, depth: 12, height: 6, color: colors[HOUSES.length % colors.length]!, roofColor: 0x696a62 });
}

for (const x of [-60, -32, 32, 60]) {
  HOUSES.push({ x, z: 270, width: 13, depth: 12, height: 6, color: colors[HOUSES.length % colors.length]!, roofColor: 0x696a62 });
}
HOUSES.push(PARK_PAVILION);
for (const z of [85, 155]) for (const x of [151, 184]) {
  HOUSES.push({ x, z, width: 12, depth: 11, height: 5.5, color: colors[HOUSES.length % colors.length]!, roofColor: 0x696a62,
    drivewayStreetId: z < 120 ? 'mews-north' : 'mews-south' });
}
HOUSES.push(MEWS_MARKET);

/** An explicitly assigned street generates a perpendicular flush driveway from its paved width. */
export function drivewayToStreet(house: House, streetId: string): Rect {
  const street = STREETS.find(s => s.id === streetId);
  if (!street) throw new Error(`Unknown driveway street: ${streetId}`);
  const a = junction(street.from), b = junction(street.to);
  const horizontal = a.z === b.z;
  const axis = horizontal ? house.x + 3 : house.z + 3;
  const low = Math.min(horizontal ? a.x : a.z, horizontal ? b.x : b.z) + JUNCTION_RADIUS + 2;
  const high = Math.max(horizontal ? a.x : a.z, horizontal ? b.x : b.z) - JUNCTION_RADIUS - 2;
  if (axis < low || axis > high) throw new Error('Driveway must remain clear of the junction');
  const road = horizontal ? a.z : a.x, center = horizontal ? house.z : house.x;
  const towardRoad = Math.sign(road - center);
  const edge = center + towardRoad * (horizontal ? house.depth : house.width) / 2;
  const end = road - towardRoad * street.width / 2;
  if ((end - edge) * towardRoad <= 0) throw new Error('House must remain outside the street');
  return horizontal ? { x: axis, z: (edge + end) / 2, width: 3.8, depth: Math.abs(end - edge) }
    : { x: (edge + end) / 2, z: axis, width: Math.abs(end - edge), depth: 3.8 };
}
export const DRIVEWAYS: readonly Rect[] = HOUSES.filter(house => house.drivewayStreetId || Math.abs(house.x) < 100).map(house => {
  if (house.drivewayStreetId) return drivewayToStreet(house, house.drivewayStreetId);
  const roadZ = house.z > 245 ? 300 : house.z > 150 ? 180 : house.z < 0 ? -60 : 60;
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

for (const x of [-82, -18, 18, 82]) TREES.push({ x, z: 203, size: 1 });
for (const x of [-72, -42, 42, 72]) TREES.push({ x, z: 332, size: 1.2 });
for (const x of [-60, -30, 30, 60]) TREES.push({ x, z: 236, size: 1.1 });
for (const x of [155, 185]) for (const z of [106, 134]) TREES.push({ x, z, size: 0.95 });
for (const z of [83, 156]) TREES.push({ x: 239, z, size: 1.1 });

const boundaryCenterZ = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
const boundaryHalfDepth = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / 2;
const boundaryCenterX = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
const boundaryHalfWidth = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / 2;
export const BOUNDARY_OBSTACLES: readonly Obstacle[] = [
  { x: WORLD_BOUNDS.minX, z: boundaryCenterZ, halfWidth: 1, halfDepth: boundaryHalfDepth },
  { x: WORLD_BOUNDS.maxX, z: boundaryCenterZ, halfWidth: 1, halfDepth: boundaryHalfDepth },
  { x: boundaryCenterX, z: WORLD_BOUNDS.minZ, halfWidth: boundaryHalfWidth + 1, halfDepth: 1 },
  { x: boundaryCenterX, z: WORLD_BOUNDS.maxZ, halfWidth: boundaryHalfWidth + 1, halfDepth: 1 },
];

export const OBSTACLES: Obstacle[] = [
  ...HOUSES.map(house => ({ x: house.x, z: house.z, halfWidth: house.width / 2, halfDepth: house.depth / 2 })),
  ...TREES.map(tree => ({ x: tree.x, z: tree.z, halfWidth: 0.28 * tree.size, halfDepth: 0.28 * tree.size })),
  ...BOUNDARY_OBSTACLES,
  ...ROAD_POSTS.map(post => ({ x: post.x, z: post.z, halfWidth: post.width / 2, halfDepth: post.depth / 2 })),
];
