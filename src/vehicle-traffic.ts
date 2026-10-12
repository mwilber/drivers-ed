import { APPROACHES, LANES, LANE_CONNECTIONS, speedZoneAt } from './traffic-layout.ts';
import { junction, type Lane, type LaneConnection, type Point } from './road-network.ts';
import { signalState } from './traffic-rules.ts';
import { FIXED_STEP } from './simulation-clock.ts';
import { CYCLIST } from './cyclist-config.ts';
import { CAR } from './vehicle-config.ts';
import { VehicleDamage } from './vehicle-damage.ts';
import type { CrossingHazard } from './pedestrians.ts';
import { pavedGrip, RAIN, type Weather } from './driving-conditions.ts';

export const TRAFFIC_DENSITIES = { off: 0, single: 1, light: 6, busy: 16 } as const;
export type TrafficDensity = keyof typeof TRAFFIC_DENSITIES;
export const TRAFFIC_TUNING = { acceleration: 1.8, braking: 4.5, gap: 2.5, headway: 1.6, turnSpeed: 5, stopDwell: 0.7 } as const;
export interface TrafficActor extends Point { heading: number; speed: number; length?: number; width?: number }
export interface TrafficCar extends TrafficActor {
  kind: 'car' | 'cyclist';
  parked?: boolean; fallen?: boolean;
  id: number; laneId: string; connectionId?: string; progress: number; route: string[];
  routeIndex: number; stoppedFor: number; arrivedAt?: number; braking: boolean;
  indicator: 'left' | 'right' | 'off'; reason: string; distanceTravelled: number;
  damage: VehicleDamage; physical: boolean; driveSpeed: number; stunnedFor: number; recovering: boolean;
}
const lanes = new Map(LANES.map(l => [l.id, l]));
const connections = new Map(LANE_CONNECTIONS.map(c => [c.id, c]));
const approaches = new Map(APPROACHES.map(a => [a.laneId, a]));
const lengths = new Map(LANE_CONNECTIONS.map(c => [c.id, c.points.slice(1).reduce((sum, p, i) => sum + distance(p, c.points[i]!), 0)]));
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function laneLength(lane: Lane): number { return distance(lane.start, lane.end); }
// Center stops 0.4 m behind the bar with its front bumper; lanes end 2 m before it.
// Short actors must stay before the lane boundary until junction admission.
export function trafficStopProgress(lane: Lane, length: number = CAR.length): number { return Math.min(laneLength(lane) - 0.05, laneLength(lane) + 1.6 - length / 2); }
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
  weather: Weather = 'dry';
  completed = 0;
  completedCyclists = 0;
  cyclistsEnabled = false;
  private cyclistCursor = 0;
  get vehicles(): TrafficCar[] { return this.cars.filter(c => c.kind === 'car'); }
  get cyclists(): TrafficCar[] { return this.cars.filter(c => c.kind === 'cyclist'); }
  private ticks = 0;
  private nextId = 0;
  private spawnCursor = 0;
  private reservations = new Map<string, number>();
  get seconds(): number { return this.ticks * FIXED_STEP; }
  private get braking(): number { return TRAFFIC_TUNING.braking * pavedGrip(this.weather); }
  private get headway(): number { return TRAFFIC_TUNING.headway * (this.weather === 'rain' ? RAIN.trafficHeadway : 1); }

  add(route: string[], progress = 0, speed = 0, kind: TrafficCar['kind'] = 'car'): TrafficCar {
    if (!route.length || route.some(id => !lanes.has(id))) throw new Error('Invalid traffic route');
    for (let i = 1; i < route.length; i++) if (!LANE_CONNECTIONS.some(c => c.incoming === route[i - 1] && c.outgoing === route[i])) throw new Error('Disconnected traffic route');
    const car: TrafficCar = { kind, length: kind === 'cyclist' ? CYCLIST.length : CAR.length, width: kind === 'cyclist' ? CYCLIST.width : CAR.width, id: this.nextId++, laneId: route[0]!, route: [...route], routeIndex: 0, progress,
      x: 0, z: 0, heading: 0, speed, stoppedFor: 0, braking: false, indicator: 'off', reason: 'Cruising', distanceTravelled: 0,
      damage: new VehicleDamage(), physical: false, driveSpeed: speed, stunnedFor: 0, recovering: false };
    this.pose(car); this.cars.push(car); return car;
  }
  reset(player?: TrafficActor): void {
    this.cars.length = 0; this.reservations.clear(); this.ticks = 0; this.nextId = 0; this.spawnCursor = 0; this.cyclistCursor = 0; this.completed = 0; this.completedCyclists = 0;
    this.populate(player);
  }
  setDensity(density: TrafficDensity, player?: TrafficActor): void {
    if (!(density in TRAFFIC_DENSITIES)) throw new Error('Invalid traffic density');
    this.density = density;
    // Removing traffic releases both physical bodies (via the bridge) and reservations.
    while (this.vehicles.length > TRAFFIC_DENSITIES[density]) this.remove(this.vehicles.at(-1)!);
    this.populate(player);
  }
  setCyclists(enabled: boolean, player?: TrafficActor): void {
    this.cyclistsEnabled = enabled;
    for (const cyclist of this.cyclists) this.remove(cyclist);
    this.populateCyclists(player);
  }
  releaseReservations(car: TrafficCar): void {
    for (const [id, owner] of this.reservations) if (owner === car.id) this.reservations.delete(id);
  }
  private remove(car: TrafficCar): void {
    this.cars.splice(this.cars.indexOf(car), 1); this.releaseReservations(car);
  }
  /** Retire a physically blocked driver without counting it as a completed route. */
  retire(car: TrafficCar): void { if (this.cars.includes(car)) this.remove(car); }

  /** Project the actual body onto its current route, preserving displacement in public poses. */
  reconcile(car: TrafficCar, pose: TrafficActor): number {
    const lane = lanes.get(car.laneId)!;
    let nearest: Point;
    if (car.connectionId) {
      const c = connections.get(car.connectionId)!;
      let best = Infinity, travelled = 0;
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1]!, b = c.points[i]!, length = distance(a, b);
        const t = Math.max(0, Math.min(1, ((pose.x - a.x) * (b.x - a.x) + (pose.z - a.z) * (b.z - a.z)) / length ** 2));
        const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        const deviation = distance(pose, point);
        if (deviation < best) { best = deviation; car.progress = travelled + t * length; }
        travelled += length;
      }
      nearest = connectionPose(c, car.progress);
    } else {
      car.progress = Math.max(0, (pose.x - lane.start.x) * lane.direction.x + (pose.z - lane.start.z) * lane.direction.z);
      nearest = { x: lane.start.x + lane.direction.x * car.progress, z: lane.start.z + lane.direction.z * car.progress };
    }
    Object.assign(car, pose);
    return distance(pose, nearest);
  }
  private populate(player?: TrafficActor): void {
    const eligible = LANES.filter(l => l.streetId !== 'lot-access');
    for (let attempt = 0; this.vehicles.length < TRAFFIC_DENSITIES[this.density] && attempt < eligible.length; attempt++) {
      const seed = this.spawnCursor++, lane = eligible[(seed * 7) % eligible.length]!;
      const point = { x: lane.start.x + lane.direction.x * 12, z: lane.start.z + lane.direction.z * 12 };
      if ([...this.cars, ...(player ? [player] : [])].some(a => distance(a, point) < 18)) continue;
      this.add(trafficRoute(lane.id, seed), 12);
    }
    this.populateCyclists(player);
  }
  private populateCyclists(player?: TrafficActor): void {
    if (!this.cyclistsEnabled) return;
    const eligible = LANES.filter(l => l.streetId !== 'lot-access');
    for (let attempt = 0; this.cyclists.length < 2 && attempt < eligible.length; attempt++) {
      const seed = this.cyclistCursor++, lane = eligible[(seed * 11 + 3) % eligible.length]!;
      const point = { x: lane.start.x + lane.direction.x * 30, z: lane.start.z + lane.direction.z * 30 };
      if ([...this.cars, ...(player ? [player] : [])].some(a => distance(a, point) < 18)) continue;
      this.add(trafficRoute(lane.id, seed, 6), 30, 0, 'cyclist');
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
    if (this.cars.some(other => other !== car && other.recovering && Math.abs(other.x - node.x) < 16 && Math.abs(other.z - node.z) < 16)) { car.reason = 'Collision ahead'; return false; }
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
      const remaining = trafficStopProgress(otherLane, other.length) - other.progress;
      const imminent = remaining < Math.max(8, other.speed * 5);
      if (!imminent) continue;
      if (approach.kind === 'all-way-stop') {
        if (other.arrivedAt === undefined) continue;
        // Arrival/right-priority ordering was resolved as a group above.
      } else if ((approach.kind === 'stop' || approach.kind === 'yield') && otherApproach.kind === 'priority') { car.reason = 'Through traffic'; return false; }
      // A priority-road left turn does not yield back to a stopped minor approach.
      // That mutual wait becomes possible where the park loop joins Garden Drive.
      else if (c.turn === 'left' && !(approach.kind === 'priority' && ['stop', 'yield', 'all-way-stop'].includes(otherApproach.kind))
        && otherLane.direction.x * approach.direction.x + otherLane.direction.z * approach.direction.z < -0.5 && this.nextConnection(other)?.turn !== 'left') { car.reason = 'Oncoming traffic'; return false; }
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
  private obstacleDistance(car: TrafficCar, actors: readonly TrafficActor[], crossings: readonly CrossingHazard[] = []): number {
    const length = car.length ?? CAR.length, width = car.width ?? CAR.width;
    const braking = car.kind === 'cyclist' ? CYCLIST.braking * pavedGrip(this.weather) : this.braking;
    // A late request from the curb must not trap an actor in
    // the same exclusion area that prevents the pedestrian from stepping out.
    // Let it finish clearing that area. Entered pedestrians always retain priority.
    const crossingRequests = crossings.filter(hazard => !(hazard.entered === false
      && Math.abs(car.x - hazard.crossing.x) < hazard.crossing.width / 2 + length / 2
      && Math.abs(car.z - hazard.crossing.z) < hazard.crossing.depth / 2 + length / 2));
    const lane = lanes.get(car.laneId)!, c = car.connectionId ? connections.get(car.connectionId)! : this.nextConnection(car);
    const horizon = Math.max(15, car.speed ** 2 / (2 * braking) + car.speed * this.headway + 10);
    const nearby = actors.filter(actor => distance(car, actor) <= horizon + CAR.length);
    if (!nearby.length && !crossingRequests.length) return Infinity;
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
      for (const { crossing } of crossingRequests) {
        // Scan the full upcoming path, including a turn and its outgoing crossing.
        const halfX = Math.abs(Math.sin(pose.heading)) * length / 2 + Math.abs(Math.cos(pose.heading)) * width / 2;
        const halfZ = Math.abs(Math.cos(pose.heading)) * length / 2 + Math.abs(Math.sin(pose.heading)) * width / 2;
        if (Math.abs(pose.x - crossing.x) < crossing.width / 2 + halfX + 0.5 && Math.abs(pose.z - crossing.z) < crossing.depth / 2 + halfZ + 0.5) nearest = Math.min(nearest, d);
      }
      for (const actor of nearby) {
        const dx = pose.x - actor.x, dz = pose.z - actor.z;
        // Actor-aligned rectangle expanded by the AI's half width, with a small margin.
        const along = Math.abs(-dx * Math.sin(actor.heading) - dz * Math.cos(actor.heading));
        const across = Math.abs(dx * Math.cos(actor.heading) - dz * Math.sin(actor.heading));
        const clearance = car.kind === 'cyclist' || actor.width === CYCLIST.width ? CYCLIST.passingClearance : 0.2;
        if (along < (actor.length ?? CAR.length) / 2 + 0.2 && across < (actor.width ?? CAR.width) / 2 + width / 2 + clearance) nearest = Math.min(nearest, d - length / 2 - 1); // Account for the 1 m sampling interval.
      }
      if (nearest !== Infinity) break;
    }
    return nearest;
  }
  step(signalSeconds: number, player?: TrafficActor, crossings: readonly CrossingHazard[] = [], pedestrians: readonly TrafficActor[] = []): void {
    this.ticks++;
    // Following checks use pre-step poses; reservations admit cars in stable spawn order.
    const actors = this.cars.map(car => ({ ...car }));
    for (const car of this.cars) {
      if (!car.connectionId && Math.abs(car.speed) < 0.05 && trafficStopProgress(lanes.get(car.laneId)!, car.length) - car.progress < (car.physical ? 1.5 : 0.15)) {
        car.arrivedAt ??= this.seconds; car.stoppedFor += FIXED_STEP;
      }
    }
    const finished: TrafficCar[] = [];
    for (const car of this.cars) {
      if (car.fallen) { car.driveSpeed = 0; car.braking = true; car.reason = 'Cyclist fallen'; continue; }
      if (car.parked) { car.driveSpeed = 0; car.braking = true; car.reason = 'Parked'; continue; }
      if (car.stunnedFor > 0) { car.driveSpeed = 0; car.braking = true; car.reason = 'Collision recovery'; continue; }
      const lane = lanes.get(car.laneId)!, c = this.nextConnection(car);
      const cycling = car.kind === 'cyclist';
      const braking = cycling ? CYCLIST.braking * pavedGrip(this.weather) : this.braking;
      const acceleration = cycling ? CYCLIST.acceleration : TRAFFIC_TUNING.acceleration;
      const turnSpeed = cycling ? CYCLIST.turnSpeed : TRAFFIC_TUNING.turnSpeed;
      let target = Math.min(cycling ? CYCLIST.speed : 9, (speedZoneAt(car)?.mph ?? 25) * 0.44704);
      if (this.weather === 'rain') target *= RAIN.trafficSpeed;
      if (car.recovering) target = Math.min(target, 2);
      let available = Infinity;
      car.reason = 'Cruising';
      if (!car.connectionId) {
        const remaining = trafficStopProgress(lane, car.length) - car.progress;
        car.indicator = c && remaining < 30 && c.turn !== 'straight' ? c.turn : 'off';
        const reserved = this.reservations.get(lane.to) === car.id;
        if (c && !reserved) {
          if (remaining < (car.physical ? 1.5 : 0.15) && Math.abs(car.speed) < 0.05 && this.permitted(car, c, signalSeconds, player)) this.reservations.set(lane.to, car.id);
          else available = Math.max(0, remaining);
        } else if (!c) available = Math.max(0, laneLength(lane) - car.progress);
        if (remaining < 25 && c?.turn !== 'straight') target = Math.min(target, turnSpeed * (this.weather === 'rain' ? RAIN.trafficSpeed : 1));
      } else target = Math.min(target, turnSpeed * (this.weather === 'rain' ? RAIN.trafficSpeed : 1));
      const obstacle = this.obstacleDistance(car, [...actors.filter(a => a.id !== car.id), ...(player ? [player] : []), ...pedestrians], crossings);
      if (obstacle < available) { available = Math.max(0, obstacle - TRAFFIC_TUNING.gap); car.reason = crossings.length ? 'Yielding / obstruction' : 'Following / obstruction'; }
      // Dynamic motors need stopping room for their response lag; never erase velocity to meet a stop target.
      // Wet motors have a lower combined force budget. Leave extra clearance
      // for physical lag around turns, so a stopped bumper cannot block the
      // pedestrian whose crossing request it is waiting to serve.
      const brakeMargin = car.physical ? this.weather === 'rain' ? 1.25 + Math.max(0, car.speed) * 0.55 : 0.4 + Math.max(0, car.speed) * 0.35 : 0.04;
      target = Math.min(target, Math.sqrt(2 * braking * Math.max(0, available - brakeMargin)));
      if (Number.isFinite(obstacle)) target = Math.min(target, Math.max(0, (obstacle - TRAFFIC_TUNING.gap) / this.headway));
      const previous = car.physical ? car.driveSpeed : car.speed;
      car.speed = Math.max(0, previous + Math.max(-braking * FIXED_STEP, Math.min(acceleration * pavedGrip(this.weather) * car.damage.effects.power * FIXED_STEP, target - previous)));
      let movement = Math.min(available, (previous + car.speed) / 2 * FIXED_STEP);
      if (available <= 0.05) { car.speed = 0; movement = 0; }
      car.driveSpeed = car.speed;
      car.braking = car.speed < previous || car.speed < 0.05;
      car.progress += movement; car.distanceTravelled += movement;
      // The wet motor parks farther behind a finite route's end. Use the same
      // arrival window as junction admission so it can finish rather than queue forever.
      if (!car.connectionId && !c && laneLength(lane) - car.progress <= (car.physical ? this.weather === 'rain' ? 1.5 : 0.6 : 0.05) && Math.abs(car.speed) < 0.1) { finished.push(car); continue; }
      if (!car.connectionId && car.progress >= laneLength(lane)) {
        if (!c) { finished.push(car); continue; }
        car.progress -= laneLength(lane); car.connectionId = c.id;
        // A collision can physically push a waiting car into a junction; reserve its clearance too.
        if (!this.reservations.has(lane.to)) this.reservations.set(lane.to, car.id);
      }
      if (car.connectionId && car.progress >= lengths.get(car.connectionId)!) {
        const current = connections.get(car.connectionId)!;
        car.progress -= lengths.get(current.id)!; car.laneId = current.outgoing; car.routeIndex++;
        car.connectionId = undefined; car.arrivedAt = undefined; car.stoppedFor = 0; car.indicator = 'off';
        // Keep ownership until the rear bumper has cleared the outgoing lane start.
      }
      if (!car.connectionId && car.progress > (car.length ?? CAR.length) / 2 + 1) {
        for (const [id, owner] of this.reservations) if (owner === car.id && id === lanes.get(car.laneId)!.from) this.reservations.delete(id);
      }
      this.pose(car);
    }
    for (const car of finished) { if (car.kind === 'cyclist') this.completedCyclists++; else this.completed++; this.remove(car); }
    if (this.ticks % 120 === 0) this.populate(player);
  }
}
