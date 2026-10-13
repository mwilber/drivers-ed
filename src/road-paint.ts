import { centerMarkings, CROSSINGS, STREETS, JUNCTION_RADIUS, junction, parkingMarkings, type Marking } from './road-network.ts';
import { APPROACHES } from './traffic-layout.ts';

/** Authored rectangles retain the previous paint dimensions and offsets above pavement. */
export interface PaintRect extends Marking { elevation: number }
export const ROAD_PAINT: PaintRect[] = centerMarkings().map(line => ({ ...line, elevation: 0.005 }));
for (const crossing of CROSSINGS) {
  const horizontal = !!crossing.direction.x;
  const length = (horizontal ? crossing.depth : crossing.width) - 4;
  for (let offset = -length / 2 + 0.5; offset < length / 2; offset += 1) ROAD_PAINT.push({
    x: crossing.x + (horizontal ? 0 : offset), z: crossing.z + (horizontal ? offset : 0),
    width: horizontal ? 2 : 0.5, depth: horizontal ? 0.5 : 2, color: 0xf3f1df, elevation: 0.005,
  });
}
for (const street of STREETS.filter(s => s.id !== 'lot-access')) {
  const a = junction(street.from), b = junction(street.to), length = Math.hypot(b.x - a.x, b.z - a.z);
  const u = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  for (const side of [-1, 1]) ROAD_PAINT.push({
    x: (a.x + b.x) / 2 - u.z * side * (street.width / 2 - 0.15),
    z: (a.z + b.z) / 2 + u.x * side * (street.width / 2 - 0.15),
    width: u.x ? length - JUNCTION_RADIUS * 2 : 0.1, depth: u.z ? length - JUNCTION_RADIUS * 2 : 0.1,
    color: 0xf3f1df, elevation: 0.005,
  });
}
for (const approach of APPROACHES) if (approach.line && approach.kind !== 'yield') ROAD_PAINT.push({ ...approach.line, elevation: 0.005 });
ROAD_PAINT.push(...parkingMarkings().map(line => ({ ...line, color: 0xe9e7da, elevation: 0.004 })));

export const YIELD_PAINT = APPROACHES.filter(a => a.kind === 'yield').flatMap(approach => {
  const u = approach.direction;
  return [-1.7, -0.85, 0, 0.85, 1.7].map(offset => ({
    x: approach.x - u.z * offset, z: approach.z + u.x * offset, rotation: Math.atan2(u.x, u.z),
  }));
});
