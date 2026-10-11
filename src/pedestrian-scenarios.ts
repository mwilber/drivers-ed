import type { Pedestrians } from './pedestrians.ts';
import type { VehicleTraffic } from './vehicle-traffic.ts';

export const PEDESTRIAN_SCENARIOS = {
  'pedestrian-yield': { spawn: { x: 2.5, z: -8, heading: 0 }, label: 'Pedestrians: crossing and yielding' },
  'pedestrian-occluded': { spawn: { x: 2.5, z: -23, heading: 0 }, label: 'Pedestrians: partially hidden crossing' },
  'pedestrian-collision': { spawn: { x: 2.5, z: -33, heading: 0 }, label: 'Pedestrians: failure to yield' },
} as const;
export type PedestrianScenario = keyof typeof PEDESTRIAN_SCENARIOS;
export function loadPedestrianScenario(people: Pedestrians, traffic: VehicleTraffic, id: PedestrianScenario): void {
  people.reset(false); traffic.setDensity('off'); traffic.reset();
  if (id === 'pedestrian-collision') people.add('north-middle-n', 1, 5, 0);
  else people.add('north-middle-n', id === 'pedestrian-occluded' ? -1 : 1);
  if (id === 'pedestrian-yield') traffic.add(['middle-n:center>north', 'north-w:north>nw'], 64, 5);
  if (id === 'pedestrian-occluded') {
    // A parked finite-mass sedan on the east verge masks the first part of the crossing.
    const car = traffic.add(['middle-n:center>north'], 85.5);
    car.x = 6.2; car.z = -43.5;
    // Keep this finite fixture parked; impact detection can still push, rotate and damage it.
    car.parked = true;
  }
}
