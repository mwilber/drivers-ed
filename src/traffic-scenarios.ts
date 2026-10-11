import { LANES } from './traffic-layout.ts';
import { trafficStopProgress, type VehicleTraffic } from './vehicle-traffic.ts';

const lane = (id: string) => LANES.find(l => l.id === id)!;
export const TRAFFIC_SCENARIOS = {
  'traffic-following': { label: 'Traffic: following and signals', spawn: { x: -80, z: 62.5, heading: -Math.PI / 2 } },
  'traffic-stops': { label: 'Traffic: simultaneous all-way stop', spawn: { x: 2.5, z: -12, heading: 0 } },
  'traffic-left': { label: 'Traffic: left turn yields', spawn: { x: 2.5, z: 120, heading: 0 } },
  'traffic-yield': { label: 'Traffic: through-route priority', spawn: { x: 42, z: 62.5, heading: -Math.PI / 2 } },
} as const;
export type TrafficScenario = keyof typeof TRAFFIC_SCENARIOS;
/** Finite fixtures do not replenish, so an obstruction can be isolated and repeated. */
export function loadTrafficScenario(traffic: VehicleTraffic, id: TrafficScenario): void {
  traffic.setDensity('off'); traffic.reset();
  if (id === 'traffic-following') {
    const route = ['town-w:west>center', 'town-e:center>east', 'east-s:east>se'];
    traffic.add(route, 39, 5); traffic.add(route, 12, 5);
  } else if (id === 'traffic-stops') {
    for (const route of [
      ['middle-n:center>north', 'north-e:north>ne', 'east-n:ne>east'],
      ['north-w:nw>north', 'middle-n:north>center', 'middle-s:center>south'],
      ['north-e:ne>north', 'north-w:north>nw', 'west-n:nw>west'],
    ]) traffic.add(route, trafficStopProgress(lane(route[0]!)));
  } else if (id === 'traffic-left') {
    const left = ['middle-s:south>center', 'town-w:center>west', 'west-n:west>nw'];
    const straight = ['middle-n:north>center', 'middle-s:center>south', 'south-e:south>se'];
    traffic.add(left, trafficStopProgress(lane(left[0]!)));
    traffic.add(straight, trafficStopProgress(lane(straight[0]!)) - 6, 4);
  } else {
    const minor = ['town-e:center>east', 'east-s:east>se', 'south-e:se>south'];
    const through = ['east-n:ne>east', 'east-s:east>se', 'south-e:se>south'];
    traffic.add(minor, trafficStopProgress(lane(minor[0]!)));
    traffic.add(through, trafficStopProgress(lane(through[0]!)) - 6, 4);
  }
}
