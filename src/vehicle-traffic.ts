import { APPROACHES, LANES, LANE_CONNECTIONS, speedZoneAt } from './traffic-layout.ts';
import { junction, type Lane, type LaneConnection, type Point } from './road-network.ts';
import { signalState } from './traffic-rules.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { CAR } from './vehicle-config.ts';

export const TRAFFIC_DENSITIES = { off: 0, single: 1, light: 6, busy: 16 } as const;
export type TrafficDensity = keyof typeof TRAFFIC_DENSITIES;
export const TRAFFIC_TUNING = { acceleration: 1.8, braking: 4.5, gap: 2.5, headway: 1.6, turnSpeed: 5, stopDwell: 0.7 } as const;
export interface TrafficActor extends Point { heading: number; speed: number }
export interface TrafficCar extends TrafficActor {
  id: number; laneId: string; connectionId?: string; progress: number; route: string[];
  routeIndex: number; stoppedFor: number; arrivedAt?: number; braking: boolean;
  indicator: 'left' | 'right' | 'off'; reason: string; distanceTravelled: number;
}
const lanes = new Map(LANES.map(l => [l.id, l]));
const connections = new Map(LANE_CONNECTIONS.map(c => [c.id, c]));
const approaches = new Map(APPROACHES.map(a => [a.laneId, a]));
const lengths = new Map(LANE_CONNECTIONS.map(c => [c.id, c.points.slice(1).reduce((sum, p, i) => sum + distance(p, c.points[i]!), 0)]));
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function laneLength(lane: Lane): number { return distance(lane.start, lane.end); }
// Center stops 0.4 m behind the bar with its front bumper; lanes end 2 m before it.
export function trafficStopProgress(lane: Lane): number { return laneLength(lane) - 0.65; }
export function connectionPose(c: LaneConnection, progress: number): TrafficActor {
  for (let i = 1; i < c.points.length; i++) {
    const a = c.points[i - 1]!, b = c.points[i]!, length = distance(a, b);
    if (progress <= length || i === c.points.length - 1) {
      const t = Math.min(1, Math.max(0, progress / length));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(a.x - b.x, a.z - b.z), speed: 0 };
    }
    progress -= length;
  }
  throw new Error('Empty lane connection');
}
/** Finite, seeded routes: no U-turns or practice-lot traffic in this increment. */
export function trafficRoute(laneId: string, seed = 0, count = 12): string[] {
  if (!lanes.has(laneId) || lanes.get(laneId)!.streetId === 'lot-access') throw new Error('Invalid traffic lane');
  const route = [laneId];
  for (let i = 1; i < count; i++) {
    const choices = LANE_CONNECTIONS.filter(c => c.incoming === route[i - 1] && lanes.get(c.outgoing)!.streetId !== 'lot-access');
    const choice = choices[(seed + i * 7) % choices.length]!;
    route.push(choice.outgoing);
  }
  return route;
}

/** Renderer-independent, fixed-step lane drivers. Junction reservations are deliberately conservative. */
export class VehicleTraffic {
  readonly cars: TrafficCar[] = [];
  density: TrafficDensity = 'light';
  completed = 0;
  private ticks = 0;
  private nextId = 0;
  private spawnCursor = 0;
  private reservations = new Map<string, number>();
  get seconds(): number { return this.ticks * FIXED_STEP; }

  add(route: string[], progress = 0, speed = 0): TrafficCar {
    if (!route.length || route.some(id => !lanes.has(id))) throw new Error('Invalid traffic route');
    for (let i = 1; i < route.length; i++) if (!LANE_CONNECTIONS.some(c => c.incoming === route[i - 1] && c.outgoing === route[i])) throw new Error('Disconnected traffic route');
    const car: TrafficCar = { id: this.nextId++, laneId: route[0]!, route: [...route], routeIndex: 0, progress,
      x: 0, z: 0, heading: 0, speed, stoppedFor: 0, braking: false, indicator: 'off', reason: 'Cruising', distanceTravelled: 0 };
    this.pose(car); this.cars.push(car); return car;
  }
  reset(player?: TrafficActor): void {
    this.cars.length = 0; this.reservations.clear(); this.ticks = 0; this.nextId = 0; this.spawnCursor = 0; this.completed = 0;
    this.populate(player);
  }
  setDensity(density: TrafficDensity, player?: TrafficActor): void {
    if (!(density in TRAFFIC_DENSITIES)) throw new Error('Invalid traffic density');
    this.density = density;
    // Removing traffic releases both physical bodies (via the bridge) and reservations.
    while (this.cars.length > TRAFFIC_DENSITIES[density]) this.remove(this.cars[this.cars.length - 1]!);
    this.populate(player);
  }
  private remove(car: TrafficCar): void {
    this.cars.splice(this.cars.indexOf(car), 1);
    for (const [id, owner] of this.reservations) if (owner === car.id) this.reservations.delete(id);
  }
  private populate(player?: TrafficActor): void {
    const eligible = LANES.filter(l => l.streetId !== 'lot-access');
    for (let attempt = 0; this.cars.length < TRAFFIC_DENSITIES[this.density] && attempt < eligible.length; attempt++) {
      const seed = this.spawnCursor++, lane = eligible[(seed * 7) % eligible.length]!;
      const point = { x: lane.start.x + lane.direction.x * 12, z: lane.start.z + lane.direction.z * 12 };
      if ([...this.cars, ...(player ? [player] : [])].some(a => distance(a, point) < 18)) continue;
      this.add(trafficRoute(lane.id, seed), 12);
    }
  }
  private nextConnection(car: TrafficCar): LaneConnection | undefined {
    return LANE_CONNECTIONS.find(c => c.incoming === car.laneId && c.outgoing === car.route[car.routeIndex + 1]);
  }
  private pose(car: TrafficCar): void {
    if (car.connectionId) {
      const pose = connectionPose(connections.get(car.connectionId)!, car.progress);
      car.x = pose.x; car.z = pose.z; car.heading = pose.heading;
    } else {
      const lane = lanes.get(car.laneId)!;
      car.x = lane.start.x + lane.direction.x * car.progress; car.z = lane.start.z + lane.direction.z * car.progress;
      car.heading = Math.atan2(-lane.direction.x, -lane.direction.z);
    }
  }
  private outgoingClear(c: LaneConnection, player?: TrafficActor): boolean {
    const lane = lanes.get(c.outgoing)!;
    return ![...this.cars, ...(player ? [player] : [])].some(a => {
      const along = (a.x - lane.start.x) * lane.direction.x + (a.z - lane.start.z) * lane.direction.z;
      const across = Math.abs(-(a.x - lane.start.x) * lane.direction.z + (a.z - lane.start.z) * lane.direction.x);
      return along > -CAR.length && along < CAR.length + TRAFFIC_TUNING.gap + 3 && across < 2;
    });
  }
  private permitted(car: TrafficCar, c: LaneConnection, signalSeconds: number, player?: TrafficActor): boolean {
    const approach = approaches.get(car.laneId)!, node = junction(c.junctionId);
    if (this.reservations.has(c.junctionId)) return this.reservations.get(c.junctionId) === car.id;
    if (!this.outgoingClear(c, player)) { car.reason = 'Exit blocked'; return false; }
    if (player && Math.abs(player.x - node.x) < 16 && Math.abs(player.z - node.z) < 16) { car.reason = 'Yielding to player'; return false; }
    if (approach.kind === 'signal') {
      const color = signalState(signalSeconds)[approach.signalGroup];
      // At the admission point the car is stopped: yellow always allows a safe stop.
      if (color !== 'green') { car.reason = `${color} signal`; return false; }
    }
    if ((approach.kind === 'stop' || approach.kind === 'all-way-stop') && car.stoppedFor < TRAFFIC_TUNING.stopDwell) { car.reason = 'Complete stop'; return false; }
    const contenders = this.cars.filter(other => other !== car && other.laneId !== car.laneId && !other.connectionId && lanes.get(other.laneId)!.to === c.junctionId
      && !this.cars.some(leader => leader !== other && !leader.connectionId && leader.laneId === other.laneId && leader.progress > other.progress));
    if (approach.kind === 'all-way-stop') {
      const arrivals = [car, ...contenders].filter(a => a.arrivedAt !== undefined);
      const earliest = Math.min(...arrivals.map(a => a.arrivedAt!));
      const tied = arrivals.filter(a => a.arrivedAt! <= earliest + 0.05);
      const winners = tied.filter(a => !tied.some(b => {
        const u = lanes.get(a.laneId)!.direction, v = lanes.get(b.laneId)!.direction;
        return u.x * v.z - u.z * v.x < -0.5 || (u.x * v.x + u.z * v.z < -0.5 && this.nextConnection(a)?.turn === 'left' && this.nextConnection(b)?.turn !== 'left');
      }));
      // Four simultaneous arrivals form a right-priority cycle; stable ID breaks only that tie.
      const winner = (winners.length ? winners : tied).sort((a, b) => a.id - b.id)[0];
      if (winner && winner !== car) { car.reason = 'Arrival priority'; return false; }
    }
    for (const other of contenders) {
      const otherLane = lanes.get(other.laneId)!, otherApproach = approaches.get(other.laneId)!;
      const remaining = trafficStopProgress(otherLane) - other.progress;
      const imminent = remaining < Math.max(8, other.speed * 5);
      if (!imminent) continue;
      if (approach.kind === 'all-way-stop') {
        if (other.arrivedAt === undefined) continue;
        // Arrival/right-priority ordering was resolved as a group above.
      } else if ((approach.kind === 'stop' || approach.kind === 'yield') && otherApproach.kind === 'priority') { car.reason = 'Through traffic'; return false; }
      else if (c.turn === 'left' && otherLane.direction.x * approach.direction.x + otherLane.direction.z * approach.direction.z < -0.5 && this.nextConnection(other)?.turn !== 'left') { car.reason = 'Oncoming traffic'; return false; }
    }
    // A moving player approaching the junction gets a conservative gap, independent of their compliance.
    if (player && Math.abs(player.speed) > 0.3) {
      const u = { x: -Math.sin(player.heading), z: -Math.cos(player.heading) };
      const along = (node.x - player.x) * u.x + (node.z - player.z) * u.z;
      const across = Math.abs(-(node.x - player.x) * u.z + (node.z - player.z) * u.x);
      if (across < 6 && along > 0 && along < 18 + Math.abs(player.speed) * 4) { car.reason = 'Yielding to player'; return false; }
    }
    return true;
  }
  /** Distance to an actor's footprint along the upcoming path, including a turn and exit lane. */
  private obstacleDistance(car: TrafficCar, actors: readonly TrafficActor[]): number {
    const lane = lanes.get(car.laneId)!, c = car.connectionId ? connections.get(car.connectionId)! : this.nextConnection(car);
    const horizon = Math.max(15, car.speed ** 2 / (2 * TRAFFIC_TUNING.braking) + car.speed * TRAFFIC_TUNING.headway + 10);
    const nearby = actors.filter(actor => distance(car, actor) <= horizon + CAR.length);
    if (!nearby.length) return Infinity;
    let nearest = Infinity;
    for (let d = 0; d <= horizon; d += 1) {
      const progress = car.progress + d;
      let pose: TrafficActor;
      const onConnection = car.connectionId || progress > laneLength(lane);
      const cp = car.connectionId ? progress : progress - laneLength(lane);
      if (onConnection && c && cp <= lengths.get(c.id)!) pose = connectionPose(c, cp);
      else {
        const target = onConnection && c ? lanes.get(c.outgoing)! : lane;
        const p = onConnection && c ? cp - lengths.get(c.id)! : progress;
        pose = { x: target.start.x + target.direction.x * p, z: target.start.z + target.direction.z * p, heading: Math.atan2(-target.direction.x, -target.direction.z), speed: 0 };
      }
      for (const actor of nearby) {
        const dx = pose.x - actor.x, dz = pose.z - actor.z;
        // Actor-aligned rectangle expanded by the AI's half width, with a small margin.
        const along = Math.abs(-dx * Math.sin(actor.heading) - dz * Math.cos(actor.heading));
        const across = Math.abs(dx * Math.cos(actor.heading) - dz * Math.sin(actor.heading));
        if (along < CAR.length / 2 + 0.2 && across < CAR.width + 0.2) nearest = Math.min(nearest, d - CAR.length / 2 - 1); // Account for the 1 m sampling interval.
      }
      if (nearest !== Infinity) break;
    }
    return nearest;
  }
  step(signalSeconds: number, player?: TrafficActor): void {
    this.ticks++;
    // Following checks use pre-step poses; reservations admit cars in stable spawn order.
    const actors = this.cars.map(car => ({ ...car }));
    for (const car of this.cars) {
      if (!car.connectionId && car.speed < 0.05 && trafficStopProgress(lanes.get(car.laneId)!) - car.progress < 0.15) {
        car.arrivedAt ??= this.seconds; car.stoppedFor += FIXED_STEP;
      }
    }
    const finished: TrafficCar[] = [];
    for (const car of this.cars) {
      const lane = lanes.get(car.laneId)!, c = this.nextConnection(car);
      let target = Math.min(9, (speedZoneAt(car)?.mph ?? 25) * 0.44704);
      let available = Infinity;
      car.reason = 'Cruising';
      if (!car.connectionId) {
        const remaining = trafficStopProgress(lane) - car.progress;
        car.indicator = c && remaining < 30 && c.turn !== 'straight' ? c.turn : 'off';
        const reserved = this.reservations.get(lane.to) === car.id;
        if (c && !reserved) {
          if (remaining < 0.15 && car.speed < 0.05 && this.permitted(car, c, signalSeconds, player)) this.reservations.set(lane.to, car.id);
          else available = Math.max(0, remaining);
        } else if (!c) available = Math.max(0, laneLength(lane) - car.progress);
        if (remaining < 25 && c?.turn !== 'straight') target = Math.min(target, TRAFFIC_TUNING.turnSpeed);
      } else target = Math.min(target, TRAFFIC_TUNING.turnSpeed);
      const obstacle = this.obstacleDistance(car, [...actors.filter(a => a.id !== car.id), ...(player ? [player] : [])]);
      if (obstacle < available) { available = Math.max(0, obstacle - TRAFFIC_TUNING.gap); car.reason = 'Following / obstruction'; }
      target = Math.min(target, Math.sqrt(2 * TRAFFIC_TUNING.braking * Math.max(0, available - 0.04)));
      if (Number.isFinite(obstacle)) target = Math.min(target, Math.max(0, (obstacle - TRAFFIC_TUNING.gap) / TRAFFIC_TUNING.headway));
      const previous = car.speed;
      car.speed = Math.max(0, car.speed + Math.max(-TRAFFIC_TUNING.braking * FIXED_STEP, Math.min(TRAFFIC_TUNING.acceleration * FIXED_STEP, target - car.speed)));
      let movement = Math.min(available, (previous + car.speed) / 2 * FIXED_STEP);
      if (available <= 0.05) { car.speed = 0; movement = 0; }
      car.braking = car.speed < previous || car.speed < 0.05;
      car.progress += movement; car.distanceTravelled += movement;
      if (!car.connectionId && !c && laneLength(lane) - car.progress <= 0.05) { finished.push(car); continue; }
      if (!car.connectionId && car.progress >= laneLength(lane)) {
        if (!c) { finished.push(car); continue; }
        car.progress -= laneLength(lane); car.connectionId = c.id;
      }
      if (car.connectionId && car.progress >= lengths.get(car.connectionId)!) {
        const current = connections.get(car.connectionId)!;
        car.progress -= lengths.get(current.id)!; car.laneId = current.outgoing; car.routeIndex++;
        car.connectionId = undefined; car.arrivedAt = undefined; car.stoppedFor = 0; car.indicator = 'off';
        // Keep ownership until the rear bumper has cleared the outgoing lane start.
      }
      if (!car.connectionId && car.progress > CAR.length / 2 + 1) {
        for (const [id, owner] of this.reservations) if (owner === car.id && id === lanes.get(car.laneId)!.from) this.reservations.delete(id);
      }
      this.pose(car);
    }
    for (const car of finished) { this.completed++; this.remove(car); }
    if (this.ticks % 120 === 0) this.populate(player);
  }
}
