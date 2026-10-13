import { createLanes, createConnections, junction, STREETS, PARKING_SPACES, ROAD_WIDTH, PARKING_LOT, PARKING_ENTRANCE, TEST_AREA, TEST_ENTRANCE, WORLD_BOUNDS, type Point, type RoadRect, type Lane, type Marking } from './road-network.ts';

export const ROAD_RULES = { jurisdiction: 'United States', drivingSide: 'right', speedUnit: 'mph' } as const;
export const LANES = createLanes(ROAD_RULES.drivingSide);
export const LANE_CONNECTIONS = createConnections(LANES);
export type ControlKind = 'all-way-stop' | 'stop' | 'yield' | 'signal' | 'priority';
export interface Approach extends Point {
  id: string; laneId: string; junctionId: string; kind: ControlKind; direction: Point;
  line: Marking | undefined; signalGroup: 'ns' | 'ew';
}
// 16 m from junction center: the near edge of the crossing is at 14 m.
// The 0.4 m stop bar leaves 1.8 m of clear pavement before that edge.
export const STOP_DISTANCE = 16;
export const APPROACHES: readonly Approach[] = LANES.filter(l => l.to !== 'lot').map(lane => {
  const node = junction(lane.to);
  const kind: ControlKind = node.id === 'north' ? 'all-way-stop' : node.id === 'center' ? 'signal'
    : node.id === 'south' && lane.streetId === 'middle-s' ? 'stop'
    : node.id === 'west' && lane.streetId === 'town-w' ? 'stop'
    : node.id === 'east' && lane.streetId === 'town-e' ? 'yield'
    : (node.id === 'sw' && lane.streetId === 'park-west') || (node.id === 'se' && lane.streetId === 'park-east')
      || (node.id === 'east' && lane.streetId === 'mews-north') || (node.id === 'se' && lane.streetId === 'mews-south') ? 'stop' : 'priority';
  const x = node.x - lane.direction.x * STOP_DISTANCE - lane.direction.z * lane.width / 2;
  const z = node.z - lane.direction.z * STOP_DISTANCE + lane.direction.x * lane.width / 2;
  const controlled = kind !== 'priority';
  return { id: lane.id, laneId: lane.id, junctionId: node.id, kind, x, z, direction: lane.direction,
    signalGroup: lane.direction.z ? 'ns' : 'ew',
    line: controlled ? { x, z, width: lane.direction.x ? 0.4 : lane.width - 0.2, depth: lane.direction.z ? 0.4 : lane.width - 0.2, color: 0xf3f1df } : undefined };
});
export interface SpeedZone { id: string; name: string; mph: number; areas: readonly RoadRect[] }
export const SPEED_ZONES: readonly SpeedZone[] = [
  { id: 'practice', name: 'Practice area', mph: 10, areas: [PARKING_LOT, { ...PARKING_ENTRANCE, z: -78, depth: 4 }, TEST_AREA, TEST_ENTRANCE] },
  { id: 'mews', name: 'Mews neighborhood', mph: 15, areas: [{ x: 203.5, z: 120, width: 147, depth: 236 }] },
  { id: 'park', name: 'Park neighborhood', mph: 15, areas: [{ x: 0, z: 305.5, width: 354, depth: 119 }] },
  { id: 'garden', name: 'Garden neighborhood', mph: 15, areas: [{ x: 0, z: 162, width: 300, depth: 168 }] },
  { id: 'town', name: 'Town neighborhood', mph: 25, areas: [{ x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, z: (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2, width: WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, depth: WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ }] },
];
export function speedZoneAt(point: Point): SpeedZone | undefined {
  return SPEED_ZONES.find(zone => zone.areas.some(r => Math.abs(point.x - r.x) <= r.width / 2 && Math.abs(point.z - r.z) <= r.depth / 2));
}
export interface RoadSign extends Point {
  id: string; kind: 'stop' | 'yield' | 'speed' | 'no-turn-on-red' | 'parking';
  direction: Point; mph?: number; allWay?: boolean; approachId?: string;
}
function roadside(lane: Lane, point: Point, width = ROAD_WIDTH): Point {
  const offset = width / 2 + 1.4 - lane.width / 2;
  return { x: point.x - lane.direction.z * offset, z: point.z + lane.direction.x * offset };
}
export const ROAD_SIGNS: RoadSign[] = APPROACHES.filter(a => a.kind !== 'priority').map(a => {
  const lane = LANES.find(l => l.id === a.laneId)!;
  const width = STREETS.find(s => s.id === lane.streetId)!.width;
  return { id: `control-${a.id}`, ...roadside(lane, a, width), kind: a.kind === 'signal' ? 'no-turn-on-red' : a.kind === 'yield' ? 'yield' : 'stop', direction: a.direction, allWay: a.kind === 'all-way-stop', approachId: a.id };
});
// Signs sit at zone boundaries on both directions of each connecting street.
for (const lane of LANES.filter(l => ['west-s', 'middle-s', 'east-s', 'lot-access'].includes(l.streetId))) {
  const isLot = lane.streetId === 'lot-access';
  const boundaryZ = isLot ? -76 : 78;
  const center: Point = { x: lane.start.x, z: boundaryZ };
  const point = roadside(lane, center, isLot ? 16 : ROAD_WIDTH);
  ROAD_SIGNS.push({ id: `speed-${lane.id}`, ...point, kind: 'speed', direction: lane.direction, mph: isLot ? (lane.to === 'lot' ? 10 : 25) : (lane.to === 'west' || lane.to === 'center' || lane.to === 'east' ? 25 : 15) });
}
// Repeat the town limit in each direction, at a consistent clear point on the original loop.
for (const lane of LANES.filter(l => ['west-n', 'east-n', 'middle-n', 'north-w', 'north-e', 'town-w', 'town-e'].includes(l.streetId))) {
  const point = { x: lane.start.x + lane.direction.x * 8, z: lane.start.z + lane.direction.z * 8 };
  ROAD_SIGNS.push({ id: `speed-${lane.id}`, ...roadside(lane, point), kind: 'speed', direction: lane.direction, mph: 25 });
}
ROAD_SIGNS.push(
  { id: 'test-speed', x: TEST_ENTRANCE.x, z: TEST_ENTRANCE.z + TEST_ENTRANCE.depth / 2 + 1.4, kind: 'speed', direction: { x: 1, z: 0 }, mph: 10 },
  { id: 'parallel-parking', x: 111, z: 131, kind: 'parking', direction: { x: 0, z: -1 } },
);
for (const lane of LANES.filter(l => l.streetId.startsWith('park-'))) {
  const point = { x: lane.start.x + lane.direction.x * 8, z: lane.start.z + lane.direction.z * 8 };
  ROAD_SIGNS.push({ id: `speed-${lane.id}`, ...roadside(lane, point), kind: 'speed', direction: lane.direction, mph: 15 });
}
for (const lane of LANES.filter(l => l.streetId.startsWith('mews-'))) {
  const s = STREETS.find(s => s.id === lane.streetId)!;
  // Both connecting streets change neighborhood at x=130, clear of the junction apron.
  const center = lane.streetId === 'mews-east'
    ? { x: lane.start.x + lane.direction.x * 8, z: lane.start.z + lane.direction.z * 8 }
    : { x: 130, z: lane.start.z };
  const after = { x: center.x + lane.direction.x * 0.25, z: center.z + lane.direction.z * 0.25 };
  ROAD_SIGNS.push({ id: `speed-${lane.id}`, ...roadside(lane, center, s.width), kind: 'speed', direction: lane.direction, mph: speedZoneAt(after)!.mph });
}
export interface SignalFixture extends Point { approachId: string; direction: Point; pole: Point }
export const SIGNAL_FIXTURES: readonly SignalFixture[] = APPROACHES.filter(a => a.kind === 'signal').map(a => {
  const node = junction(a.junctionId), u = a.direction;
  return { approachId: a.id, direction: u, x: node.x + u.x * 10 - u.z * ROAD_WIDTH / 4, z: node.z + u.z * 10 + u.x * ROAD_WIDTH / 4,
    pole: { x: node.x + u.x * 14 - u.z * 14, z: node.z + u.z * 14 + u.x * 14 } };
});
const posts = [
  ...ROAD_SIGNS.map(sign => ({ x: sign.x, z: sign.z, width: 0.12, depth: 0.12, height: 3.1 })),
  ...SIGNAL_FIXTURES.map(signal => ({ ...signal.pole, width: 0.22, depth: 0.22, height: 5.8 })),
];
export const ROAD_POSTS = [...new Map(posts.map(post => [`${post.x},${post.z}`, post])).values()];
export const LANE_ARROWS = LANES.filter(l => l.streetId !== 'lot-access').map(lane => ({
  x: lane.end.x - lane.direction.x * 12, z: lane.end.z - lane.direction.z * 12, direction: lane.direction,
  turns: LANE_CONNECTIONS.filter(c => c.incoming === lane.id).map(c => c.turn),
}));

function approachSpawn(junctionId: string, streetId: string, lead: number) {
  const a = APPROACHES.find(a => a.junctionId === junctionId && LANES.find(l => l.id === a.laneId)!.streetId === streetId)!;
  return { x: a.x - a.direction.x * lead, z: a.z - a.direction.z * lead, heading: Math.atan2(-a.direction.x, -a.direction.z) };
}
const parkingLane = LANES.find(l => l.streetId === 'east-s' && l.to === 'east')!;
export const ROAD_EXAMPLES = {
  mews: { x: 218, z: 130, heading: Math.PI },
  park: { x: -60, z: 302.5, heading: -Math.PI / 2 },
  signals: approachSpawn('center', 'middle-s', 36),
  stops: approachSpawn('north', 'middle-n', 32),
  garden: approachSpawn('south', 'middle-s', 39),
  yield: approachSpawn('east', 'town-e', 37),
  parking: { x: parkingLane.start.x, z: Math.max(...PARKING_SPACES.filter(s => s.kind === 'parallel').map(s => s.z)) + 24, heading: 0 },
} as const;
