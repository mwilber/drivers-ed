import { CAR, HANDLING, TRANSMISSION } from './vehicle-config.ts';

export { CAR } from './vehicle-config.ts';
type Direction = -1 | 0 | 1;
export type GearSelection = 'P' | 'R' | 'N' | 'D';
export type Indicator = 'off' | 'left' | 'right' | 'hazards';

/** Metres, seconds, radians. Heading zero points down the negative Z axis. */
export interface CarState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steering: number;
  /** -1 = reverse, 0 = neutral, 1–6 = automatic forward ratios. */
  gear: number;
  /** auto preserves the original direction-key interface for reference checks. */
  selectedGear: GearSelection | 'auto';
  parkingBrake: boolean;
  headlights: boolean;
  indicator: Indicator;
  indicatorTime: number;
  horn: boolean;
  engineRpm: number;
  throttle: number;
  brake: number;
  shiftRemaining: number;
  shiftCooldown: number;
  pendingDirection: Direction;
  directionWait: number;
  yawRate: number;
  acceleration: number;
  lateralAcceleration: number;
}

export interface DrivingInput {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
  parkingBrake?: boolean;
  headlights?: boolean;
  indicator?: Indicator;
  horn?: boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}

export const START: Readonly<CarState> = {
  x: 2.5, z: 48, heading: 0, speed: 0, steering: 0,
  gear: 0, engineRpm: TRANSMISSION.idleRpm, throttle: 0, brake: 0,
  selectedGear: 'auto', parkingBrake: false, headlights: false,
  indicator: 'off', indicatorTime: 0, horn: false,
  shiftRemaining: 0, shiftCooldown: 0, pendingDirection: 0, directionWait: 0,
  yawRate: 0, acceleration: 0, lateralAcceleration: 0,
};
export const createCar = (): CarState => ({ ...START });

/** Requests are accepted immediately or rejected, never queued until a later stop. */
export function selectGear(car: CarState, selection: GearSelection, motionSpeed = Math.abs(car.speed)): boolean {
  if (selection === car.selectedGear) return true;
  const direction = selection === 'D' ? 1 : selection === 'R' ? -1 : 0;
  if (selection !== 'N' && motionSpeed >= TRANSMISSION.selectionStopSpeed && (selection === 'P' || direction !== Math.sign(car.gear))) return false;
  car.selectedGear = selection;
  car.gear = direction;
  car.throttle = 0;
  car.pendingDirection = 0;
  car.directionWait = 0;
  car.shiftRemaining = direction ? TRANSMISSION.directionChangeDelay : 0;
  car.shiftCooldown = TRANSMISSION.shiftCooldown;
  return true;
}

export function indicatorLit(car: CarState): boolean {
  return car.indicator !== 'off' && car.indicatorTime % 1 < 0.5;
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

function gearRatio(gear: number): number {
  return gear < 0 ? TRANSMISSION.reverseRatio : gear > 0 ? TRANSMISSION.forwardRatios[gear - 1]! : 0;
}

function wheelRpm(speed: number, gear: number): number {
  return Math.abs(speed) / (2 * Math.PI * CAR.tireRadius) * 60 * gearRatio(gear) * TRANSMISSION.finalDrive;
}

function engineTorque(rpm: number): number {
  const curve = TRANSMISSION.torqueCurve;
  for (let i = 1; i < curve.length; i++) {
    const [rpmA, torqueA] = curve[i - 1]!;
    const [rpmB, torqueB] = curve[i]!;
    if (rpm <= rpmB) {
      const fraction = Math.max(0, (rpm - rpmA) / (rpmB - rpmA));
      return torqueA + (torqueB - torqueA) * fraction;
    }
  }
  return curve[curve.length - 1]![1];
}

/** Explicit pedals for the browser; retain direction keys for earlier reference checks. */
function updatePedals(car: CarState, input: DrivingInput, dt: number): void {
  if (car.selectedGear !== 'auto') {
    const brakeTarget = Number(input.reverse || car.selectedGear === 'P');
    const throttleTarget = Number(input.forward && !input.reverse && !car.parkingBrake && (car.selectedGear === 'D' || car.selectedGear === 'R'));
    car.throttle = brakeTarget || car.parkingBrake || car.gear === 0 ? 0 : approach(car.throttle, throttleTarget,
      dt * (throttleTarget > car.throttle ? HANDLING.throttleRiseRate : HANDLING.throttleFallRate));
    car.brake = approach(car.brake, brakeTarget, dt * (brakeTarget > car.brake ? HANDLING.brakeRiseRate : HANDLING.brakeFallRate));
    return;
  }
  const requested = (Number(input.forward) - Number(input.reverse)) as Direction;
  let throttleTarget = 0;
  let brakeTarget = Number(input.forward && input.reverse);
  if (requested === 0) {
    car.directionWait = 0;
    car.pendingDirection = 0;
  } else if (car.speed * requested < 0 || requested !== Math.sign(car.gear)) {
    brakeTarget = 1;
    if (car.pendingDirection !== requested) car.directionWait = 0;
    car.pendingDirection = requested;
    car.directionWait = car.speed === 0 ? car.directionWait + dt : 0;
    if (car.speed === 0 && (car.gear === 0 || car.directionWait >= TRANSMISSION.directionChangeDelay)) {
      car.gear = requested;
      car.directionWait = 0;
      car.pendingDirection = 0;
      car.shiftRemaining = 0;
      car.shiftCooldown = TRANSMISSION.shiftCooldown;
      brakeTarget = 0;
      throttleTarget = 1;
    }
  } else {
    car.directionWait = 0;
    car.pendingDirection = 0;
    throttleTarget = 1;
  }
  // Brake input cuts power immediately; normal throttle release is progressive.
  car.throttle = brakeTarget ? 0 : approach(car.throttle, throttleTarget,
    dt * (throttleTarget > car.throttle ? HANDLING.throttleRiseRate : HANDLING.throttleFallRate));
  car.brake = approach(car.brake, brakeTarget,
    dt * (brakeTarget > car.brake ? HANDLING.brakeRiseRate : HANDLING.brakeFallRate));
}

function updateTransmission(car: CarState, dt: number): void {
  car.shiftRemaining = Math.max(0, car.shiftRemaining - dt);
  car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
  // Select the launch ratio promptly after stopping, even during a shift cooldown.
  if (car.gear > 1 && Math.abs(car.speed) < 0.5) {
    car.gear = 1;
    car.shiftRemaining = 0;
    car.shiftCooldown = TRANSMISSION.shiftCooldown;
  }
  const rpm = wheelRpm(car.speed, car.gear);
  if (car.gear > 0 && car.shiftCooldown === 0) {
    let nextGear = car.gear;
    if (rpm > TRANSMISSION.upshiftRpm && car.gear < TRANSMISSION.forwardRatios.length) nextGear++;
    else if (rpm < TRANSMISSION.downshiftRpm && car.gear > 1) nextGear--;
    if (nextGear !== car.gear) {
      car.gear = nextGear;
      car.shiftRemaining = TRANSMISSION.shiftDuration;
      car.shiftCooldown = TRANSMISSION.shiftCooldown;
    }
  }
  // The simplified torque converter permits launch without stalling the engine.
  const launchRpm = TRANSMISSION.idleRpm + car.throttle * (TRANSMISSION.launchRpm - TRANSMISSION.idleRpm);
  const targetRpm = Math.min(TRANSMISSION.redlineRpm, Math.max(launchRpm, wheelRpm(car.speed, car.gear)));
  car.engineRpm += (targetRpm - car.engineRpm) * (1 - Math.exp(-dt / 0.12));
}

/** Shared input/drivetrain tuning for the rigid-body vehicle and planar reference checks. */
export function updateDriveForces(car: CarState, input: DrivingInput, dt: number, onRoad: boolean) {
  car.parkingBrake = input.parkingBrake ?? false;
  car.headlights = input.headlights ?? false;
  const indicator = input.indicator ?? 'off';
  car.indicatorTime = indicator === car.indicator ? car.indicatorTime + dt : 0;
  car.indicator = indicator;
  car.horn = input.horn ?? false;
  updatePedals(car, input, dt);
  if (car.parkingBrake) car.throttle = 0;
  updateTransmission(car, dt);
  const speedMagnitude = Math.abs(car.speed);
  const steeringInput = Number(input.left) - Number(input.right);
  // Speed changes how quickly keyboard steering builds, never the held angle.
  // A shrinking angle limit would unwind the wheel while the driver still holds it.
  const steeringRate = HANDLING.steeringRate / (1 + speedMagnitude / HANDLING.steeringRateSpeedScale);
  car.steering = approach(car.steering, steeringInput * HANDLING.steeringLock,
    dt * (steeringInput === 0 ? HANDLING.steeringReturnRate : steeringRate));

  const grip = (onRoad ? HANDLING.dryGrip : HANDLING.grassGrip) * HANDLING.gravity;
  const speedLimit = car.gear < 0 ? HANDLING.reverseSpeedLimit : onRoad ? HANDLING.forwardSpeedLimit : HANDLING.grassSpeedLimit;
  const governor = Math.max(0, Math.min(1, (speedLimit - speedMagnitude) / HANDLING.speedGovernorRange));
  const wheelForce = engineTorque(car.engineRpm) * gearRatio(car.gear) * TRANSMISSION.finalDrive * TRANSMISSION.efficiency / CAR.tireRadius;
  const driveAcceleration = car.shiftRemaining > 0 || car.brake > 0 ? 0 : car.throttle * wheelForce / CAR.mass * governor;
  const rolling = (onRoad ? HANDLING.rollingResistance : HANDLING.grassRollingResistance) * HANDLING.gravity;
  const drag = HANDLING.aerodynamicDrag * speedMagnitude ** 2 / CAR.mass;
  const engineDrag = car.gear === 0 ? 0 : (HANDLING.engineBraking + HANDLING.engineBrakingPerSpeed * speedMagnitude) * (1 - car.throttle);
  const resistance = rolling + drag + engineDrag + car.brake * HANDLING.brakeDeceleration;
  const parkingResistance = car.selectedGear === 'P' ? HANDLING.brakeDeceleration : car.parkingBrake ? HANDLING.parkingBrakeDeceleration : 0;
  return { driveAcceleration, resistance, grip, parkingResistance };
}

/** Phase 2 planar reference model retained for isolated drivetrain regression checks. */
export function stepCar(car: CarState, input: DrivingInput, dt: number, obstacles: readonly Obstacle[], onRoad: boolean): void {
  const { driveAcceleration, resistance, grip, parkingResistance } = updateDriveForces(car, input, dt, onRoad);
  const speedBefore = car.speed;
  // Resistance cannot push a stopped car backwards; only an engaged gear can launch it.
  const motionDirection = Math.sign(speedBefore) || Math.sign(car.gear);
  const signedDrive = Math.sign(car.gear) * driveAcceleration;
  const acceleration = Math.max(-grip, Math.min(grip, signedDrive - motionDirection * (resistance + parkingResistance)));
  let nextSpeed = speedBefore + acceleration * dt;
  if (motionDirection * nextSpeed < 0) nextSpeed = 0;
  car.acceleration = (nextSpeed - speedBefore) / dt;

  // Braking/acceleration consumes some of the available tire force. Saturation
  // widens a turn instead of allowing unlimited lateral acceleration. This is
  // an aggregate grip model, not individual tire slip or a suspension model.
  const availableLateral = Math.sqrt(Math.max(0, grip ** 2 - car.acceleration ** 2));
  const meanSpeed = (speedBefore + nextSpeed) / 2;
  const desiredYaw = meanSpeed / CAR.wheelbase * Math.tan(car.steering);
  car.yawRate += (desiredYaw - car.yawRate) * (1 - Math.exp(-dt / HANDLING.yawResponseTime));
  const yawLimit = Math.abs(meanSpeed) > 0.001 ? availableLateral / Math.abs(meanSpeed) : 0;
  car.yawRate = Math.max(-yawLimit, Math.min(yawLimit, car.yawRate));
  car.lateralAcceleration = meanSpeed * car.yawRate;
  const heading = car.heading + car.yawRate * dt;
  const midpointHeading = (car.heading + heading) / 2;
  const x = car.x - Math.sin(midpointHeading) * meanSpeed * dt;
  const z = car.z - Math.cos(midpointHeading) * meanSpeed * dt;
  if (obstacles.some(obstacle => overlapsCar(x, z, heading, obstacle))) {
    stopCar(car);
  } else {
    car.x = x;
    car.z = z;
    car.heading = heading;
    car.speed = nextSpeed;
  }
}

/** Stop transient motion on collision or page suspension without changing gear. */
export function stopCar(car: CarState): void {
  car.speed = 0;
  car.yawRate = 0;
  car.acceleration = 0;
  car.lateralAcceleration = 0;
  car.throttle = 0;
  car.horn = false;
  car.brake = 0;
  car.directionWait = 0;
  car.pendingDirection = 0;
  car.shiftRemaining = 0;
  car.engineRpm = TRANSMISSION.idleRpm;
}

/** Separating-axis test between the sedan footprint and axis-aligned scenery. */
export function overlapsCar(x: number, z: number, heading: number, obstacle: Obstacle): boolean {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dx = obstacle.x - x;
  const dz = obstacle.z - z;
  const halfWidth = CAR.width / 2;
  const halfLength = CAR.length / 2;
  return Math.abs(dx) < Math.abs(cos) * halfWidth + Math.abs(sin) * halfLength + obstacle.halfWidth
    && Math.abs(dz) < Math.abs(sin) * halfWidth + Math.abs(cos) * halfLength + obstacle.halfDepth
    && Math.abs(dx * cos - dz * sin) < halfWidth + obstacle.halfWidth * Math.abs(cos) + obstacle.halfDepth * Math.abs(sin)
    && Math.abs(dx * sin + dz * cos) < halfLength + obstacle.halfWidth * Math.abs(sin) + obstacle.halfDepth * Math.abs(cos);
}
