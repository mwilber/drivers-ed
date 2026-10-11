import { LANES } from './traffic-layout.ts';
import { trafficStopProgress, type VehicleTraffic } from './vehicle-traffic.ts';
import { CYCLIST } from './cyclist-config.ts';

export const CYCLIST_SCENARIOS = {
  'cyclist-passing': { label: 'Cyclists: following and passing', spawn: { x: 2.5, z: 37, heading: 0 } },
  'cyclist-turn': { label: 'Cyclists: left-turn conflict', spawn: { x: 2.5, z: 108, heading: 0 } },
  'cyclist-collision': { label: 'Cyclists: collision and fall', spawn: { x: 2.5, z: 30, heading: 0 } },
} as const;
export type CyclistScenario = keyof typeof CYCLIST_SCENARIOS;
export function loadCyclistScenario(traffic: VehicleTraffic, id: CyclistScenario): void {
  traffic.setCyclists(false); traffic.setDensity('off'); traffic.reset();
  if (id === 'cyclist-passing') {
    const route = ['middle-n:center>north', 'north-e:north>ne', 'east-n:ne>east'];
    traffic.add(route, 26, 2, 'cyclist');
    traffic.add(['middle-n:north>center', 'middle-s:center>south'], 32, 3);
  } else if (id === 'cyclist-turn') {
    const through = 'middle-n:north>center', left = 'middle-s:south>center';
    traffic.add([through, 'middle-s:center>south'], trafficStopProgress(LANES.find(l => l.id === through)!, CYCLIST.length) - 7, 3, 'cyclist');
    traffic.add([left, 'town-w:center>west'], trafficStopProgress(LANES.find(l => l.id === left)!));
  } else {
    const cyclist = traffic.add(['middle-n:center>north'], 22, 0, 'cyclist');
    cyclist.parked = true;
  }
}
