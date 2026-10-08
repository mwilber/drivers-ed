/** Metres, seconds, radians. Heading zero points down the negative Z axis. */
export interface CarState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steering: number;
}

export interface DrivingInput {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}

export const CAR = { width: 1.8, length: 4.5, wheelbase: 2.7, eyeHeight: 1.22 };
export const START: Readonly<CarState> = { x: 2.5, z: 48, heading: 0, speed: 0, steering: 0 };
export const createCar = (): CarState => ({ ...START });

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

/** A planar bicycle model: acceleration, drag, steering angle and reverse steering. */
export function stepCar(car: CarState, input: DrivingInput, dt: number, obstacles: readonly Obstacle[], onRoad: boolean): void {
  const direction = Number(input.forward) - Number(input.reverse);
  const steeringInput = Number(input.left) - Number(input.right);
  // Reduce steering lock with speed to keep keyboard inputs manageable.
  const steeringLimit = 0.53 / (1 + Math.abs(car.speed) * 0.065);
  car.steering = approach(car.steering, steeringInput * steeringLimit, dt * 1.15);
  const braking = (direction !== 0 && direction * car.speed < 0) || (input.forward && input.reverse);
  if (braking) {
    car.speed = approach(car.speed, 0, 7.5 * dt);
  } else if (direction !== 0) {
    const maxSpeed = direction > 0 ? (onRoad ? 18 : 7) : 5;
    car.speed = approach(car.speed, direction * maxSpeed, (direction > 0 ? 2.8 : 2) * dt);
  } else {
    car.speed = approach(car.speed, 0, (0.35 + car.speed * car.speed * 0.008 + (onRoad ? 0 : 1.3)) * dt);
  }

  const heading = car.heading + (car.speed / CAR.wheelbase) * Math.tan(car.steering) * dt;
  const x = car.x - Math.sin(heading) * car.speed * dt;
  const z = car.z - Math.cos(heading) * car.speed * dt;
  if (obstacles.some(obstacle => overlapsCar(x, z, heading, obstacle))) {
    car.speed = 0;
  } else {
    car.x = x;
    car.z = z;
    car.heading = heading;
  }
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
