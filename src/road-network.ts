/** Coordinates are metres: north is -Z. This module has no renderer/physics dependencies. */
export interface Point { x: number; z: number }
export interface RoadRect extends Point { width: number; depth: number }
export interface Junction extends Point { id: string; name: string; apronWidth?: number }
export interface Street { id: string; from: string; to: string; width: number; name: string; travelWidth?: number }
export const ROAD_WIDTH = 10;
export const WORLD_BOUNDS = { minX: -177, maxX: 277, minZ: -194, maxZ: 365 } as const;
export const JUNCTION_RADIUS = 18;
export const JUNCTIONS: readonly Junction[] = [
  { id: 'nw', name: 'Northwest bend', x: -100, z: -60 },
  { id: 'north', name: 'Lot crossroads', x: 0, z: -60 },
  { id: 'ne', name: 'Northeast bend', x: 100, z: -60 },
  { id: 'west', name: 'West junction', x: -100, z: 60 },
  { id: 'center', name: 'Town crossroads', x: 0, z: 60 },
  { id: 'east', name: 'East junction', x: 100, z: 60, apronWidth: 30 },
  { id: 'sw', name: 'Southwest bend', x: -100, z: 180 },
  { id: 'south', name: 'Garden junction', x: 0, z: 180 },
  { id: 'se', name: 'Southeast bend', x: 100, z: 180, apronWidth: 30 },
  { id: 'lot', name: 'Practice lot', x: 0, z: -110 },
  { id: 'park-w', name: 'Park west bend', x: -100, z: 300 },
  { id: 'park-e', name: 'Park east bend', x: 100, z: 300 },
  { id: 'mews-n', name: 'Mews north bend', x: 220, z: 60, apronWidth: 30 },
  { id: 'mews-s', name: 'Mews market bend', x: 220, z: 180, apronWidth: 30 },
];
const street = (id: string, from: string, to: string, name: string, width = ROAD_WIDTH): Street => ({ id, from, to, name, width });
export const STREETS: readonly Street[] = [
  street('north-w', 'nw', 'north', 'North Street'), street('north-e', 'north', 'ne', 'North Street'),
  street('west-n', 'nw', 'west', 'West Street'), street('middle-n', 'north', 'center', 'Center Street'), street('east-n', 'ne', 'east', 'East Street'),
  street('town-w', 'west', 'center', 'Town Street'), street('town-e', 'center', 'east', 'Town Street'),
  street('west-s', 'west', 'sw', 'Garden Drive'), street('middle-s', 'center', 'south', 'Garden Drive'), street('east-s', 'east', 'se', 'Garden Drive'),
  street('south-w', 'sw', 'south', 'Garden Street'), street('south-e', 'south', 'se', 'Garden Street'),
  // The lot has a wider paved apron around its original 10 m travel corridor.
  { ...street('lot-access', 'north', 'lot', 'Parking entrance', 16), travelWidth: ROAD_WIDTH },
  street('park-west', 'sw', 'park-w', 'Park Drive'),
  street('park-south', 'park-w', 'park-e', 'Park Avenue'),
  street('park-east', 'park-e', 'se', 'Park Drive'),
  street('mews-north', 'east', 'mews-n', 'Mews Lane', 8),
  street('mews-east', 'mews-n', 'mews-s', 'Mews Lane', 8),
  street('mews-south', 'mews-s', 'se', 'Market Lane', 8),
];
export function junction(id: string): Junction { return JUNCTIONS.find(node => node.id === id)!; }
export function streetSurface(s: Street): RoadRect {
  const a = junction(s.from), b = junction(s.to);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, width: a.x === b.x ? s.width : Math.abs(b.x - a.x) + s.width, depth: a.z === b.z ? s.width : Math.abs(b.z - a.z) + s.width };
}
export const STREET_SURFACES = STREETS.filter(s => s.id !== 'lot-access').map(streetSurface);
// Aprons give a sedan enough space for full-lock turns at every bend/junction.
export const JUNCTION_SURFACES: readonly RoadRect[] = JUNCTIONS.filter(j => j.id !== 'lot').map(j => ({ x: j.x, z: j.z, width: j.apronWidth ?? 24, depth: j.apronWidth ?? 24 }));
export interface ParkingSpace extends Point { id: string; width: number; depth: number; heading: number; kind: 'perpendicular' | 'parallel' }
export const PARKING_SPACES: ParkingSpace[] = [];
for (let x = -46.5; x < 48; x += 3) PARKING_SPACES.push({ id: `lot-n-${x}`, x, z: -164, width: 3, depth: 6, heading: 0, kind: 'perpendicular' });
for (const x of [-54, 54]) {
  for (let z = -152.4; z < -90; z += 3.2) PARKING_SPACES.push({ id: `lot-${x}-${z}`, x, z, width: 3.2, depth: 6, heading: x < 0 ? Math.PI / 2 : -Math.PI / 2, kind: 'perpendicular' });
}
for (const z of [108, 116, 124]) PARKING_SPACES.push({ id: `parallel-${z}`, x: 107, z, width: 3, depth: 8, heading: 0, kind: 'parallel' });
export const PARKING_LOT: Readonly<RoadRect> = { x: 0, z: -125, width: 120, depth: 90 };
export const PARKING_ENTRANCE: Readonly<RoadRect> = { x: 0, z: -72.5, width: 16, depth: 15 };
export const TEST_AREA: Readonly<RoadRect> = { x: 102, z: -136, width: 68, depth: 72 };
export const TEST_ENTRANCE: Readonly<RoadRect> = { x: 64, z: -106, width: 8, depth: 12 };
export const PARALLEL_PARKING: RoadRect = { x: 107, z: 116, width: 4, depth: 28 };
// Flush connections to the sidewalk at the ends of each crossing.
export const CROSSING_DISTANCE = 13;
export const CROSSING_WIDTH = 2;
export interface Crossing extends RoadRect { id: string; junctionId: string; streetId: string; direction: Point }
export const CROSSINGS: readonly Crossing[] = ['north', 'center', 'south'].flatMap(id => {
  const j = junction(id);
  return STREETS.filter(s => s.from === id || s.to === id).map(s => {
    const other = junction(s.from === id ? s.to : s.from);
    const length = Math.hypot(other.x - j.x, other.z - j.z);
    const direction = { x: (other.x - j.x) / length, z: (other.z - j.z) / length };
    return { id: `${id}-${s.id}`, junctionId: id, streetId: s.id, direction, x: j.x + direction.x * CROSSING_DISTANCE, z: j.z + direction.z * CROSSING_DISTANCE, width: direction.x ? CROSSING_WIDTH : s.width + 4, depth: direction.z ? CROSSING_WIDTH : s.width + 4 };
  });
});
export const CROSSING_RAMPS: readonly RoadRect[] = CROSSINGS;

export interface Lane { id: string; streetId: string; from: string; to: string; start: Point; end: Point; direction: Point; width: number }
export type DrivingSide = 'right' | 'left';
export function createLanes(side: DrivingSide): Lane[] {
  return STREETS.flatMap(s => [[s.from, s.to], [s.to, s.from]].map(([from, to]) => {
    const a = junction(from), b = junction(to), length = Math.hypot(b.x - a.x, b.z - a.z);
    const direction = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    const travelWidth = s.travelWidth ?? s.width;
    const offset = (side === 'right' ? 1 : -1) * travelWidth / 4;
    const point = (node: Point, trim: number): Point => ({ x: node.x + direction.x * trim - direction.z * offset, z: node.z + direction.z * trim + direction.x * offset });
    return { id: `${s.id}:${from}>${to}`, streetId: s.id, from, to, start: point(a, from === 'lot' ? 0 : JUNCTION_RADIUS), end: point(b, to === 'lot' ? 0 : -JUNCTION_RADIUS), direction, width: travelWidth / 2 };
  }));
}
export interface LaneConnection { id: string; junctionId: string; incoming: string; outgoing: string; turn: 'left' | 'right' | 'straight'; points: Point[] }
export function createConnections(lanes: readonly Lane[]): LaneConnection[] {
  return JUNCTIONS.filter(j => j.id !== 'lot').flatMap(j => lanes.filter(l => l.to === j.id).flatMap(incoming =>
    lanes.filter(l => l.from === j.id && l.to !== incoming.from).map(outgoing => {
      const a = incoming.end, b = outgoing.start, u = incoming.direction, v = outgoing.direction;
      const cross = u.x * v.z - u.z * v.x;
      // Lane endpoints determine turn radii (15.5/20.5 m between the original
      // 10 m streets). Cubic handles keep turns tangent across width changes.
      const turn = Math.abs(cross) < 0.5 ? 'straight' : cross > 0 ? 'right' : 'left';
      const handle = turn === 'straight' ? JUNCTION_RADIUS * 2 / 3 : (Math.abs((b.x - a.x) * u.x + (b.z - a.z) * u.z)) * 0.55228475;
      const c = { x: a.x + u.x * handle, z: a.z + u.z * handle };
      const d = { x: b.x - v.x * handle, z: b.z - v.z * handle };
      const points = Array.from({ length: 41 }, (_, i) => {
        const t = i / 40, r = 1 - t;
        return { x: r ** 3 * a.x + 3 * r ** 2 * t * c.x + 3 * r * t ** 2 * d.x + t ** 3 * b.x, z: r ** 3 * a.z + 3 * r ** 2 * t * c.z + 3 * r * t ** 2 * d.z + t ** 3 * b.z };
      });
      return { id: `${incoming.id}>${outgoing.id}`, junctionId: j.id, incoming: incoming.id, outgoing: outgoing.id, turn, points };
    })));
}
export interface Marking extends RoadRect { color: number }
export function parkingMarkings(): Marking[] {
  return PARKING_SPACES.flatMap(space => {
    const horizontal = Math.abs(Math.sin(space.heading)) > 0.5;
    const w = horizontal ? space.depth : space.width, d = horizontal ? space.width : space.depth;
    // Three-sided perpendicular bays remain open toward the maneuvering aisle.
    const edges = space.kind === 'parallel' ? [
      { x: space.x, z: space.z - d / 2, width: w, depth: 0.12 },
      { x: space.x + w / 2, z: space.z, width: 0.12, depth: d },
      { x: space.x, z: space.z + d / 2, width: w, depth: 0.12 },
    ] : horizontal ? [
      { x: space.x, z: space.z - d / 2, width: w, depth: 0.12 },
      { x: space.x, z: space.z + d / 2, width: w, depth: 0.12 },
      { x: space.x + Math.sign(space.x) * w / 2, z: space.z, width: 0.12, depth: d },
    ] : [
      { x: space.x - w / 2, z: space.z, width: 0.12, depth: d },
      { x: space.x + w / 2, z: space.z, width: 0.12, depth: d },
      { x: space.x, z: space.z - d / 2, width: w, depth: 0.12 },
    ];
    return edges.map(edge => ({ ...edge, color: 0xf3f1df }));
  });
}

export function centerMarkings(color = 0xe6d59d): Marking[] {
  return STREETS.filter(s => s.id !== 'lot-access').flatMap(s => {
    const a = junction(s.from), b = junction(s.to), length = Math.hypot(b.x - a.x, b.z - a.z);
    const u = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    return [-0.15, 0.15].map(offset => ({
      x: (a.x + b.x) / 2 - u.z * offset, z: (a.z + b.z) / 2 + u.x * offset,
      width: u.x ? length - JUNCTION_RADIUS * 2 : 0.1, depth: u.z ? length - JUNCTION_RADIUS * 2 : 0.1, color,
    }));
  });
}
