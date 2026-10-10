import './style.css';
import { createScene } from './scene.ts';
import { createCar, type DrivingInput } from './simulation.ts';
import { createVehiclePhysics, type Spawn, type VehiclePhysics } from './vehicle-physics.ts';
import { SimulationClock } from './simulation-clock.ts';
import { HOUSES, isOnRoad, PARKING_LOT, PARKING_MARKINGS, PAVED_SURFACES, TEST_AREA, TEST_CURB, TEST_RAMP, TREES, WORLD_BOUNDS } from './world-layout.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const speed = document.querySelector<HTMLElement>('#speed')!;
const gear = document.querySelector<HTMLElement>('#gear')!;
const status = document.querySelector<HTMLElement>('#drive-status')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const map = document.querySelector<HTMLCanvasElement>('#map')!;
const context = map.getContext('2d')!;
let car = createCar();
let physics: VehiclePhysics | undefined;
const clock = new SimulationClock();
const keys = new Set<string>();
const touches = new Map<number, keyof DrivingInput>();
const bindings: Record<string, keyof DrivingInput> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'reverse', ArrowDown: 'reverse',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
let noticeTimeout: ReturnType<typeof setTimeout>;
function showNotice(message: string) {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  notice.classList.add('visible');
  noticeTimeout = setTimeout(() => notice.classList.remove('visible'), 2400);
}
function clearInput() {
  keys.clear();
  touches.clear();
  document.querySelectorAll('[data-drive]').forEach(button => button.classList.remove('pressed'));
}
function reset(spawn?: Spawn) {
  if (!physics) return;
  physics.reset(spawn);
  clock.reset();
  clearInput();
  showNotice(spawn ? 'Test area. Approach the ramp slowly.' : 'Back at the start. Take your time.');
}
document.querySelector('#reset')!.addEventListener('click', () => reset());
document.querySelector('#test-area')!.addEventListener('click', () => reset({ x: TEST_RAMP.x, z: -118, heading: 0 }));
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
  if (bindings[event.code]) {
    event.preventDefault();
    keys.add(event.code);
  }
  if (event.code === 'KeyR' && !event.repeat) reset();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  clearInput();
  // Freeze the car when the page is hidden; returning never causes a jump.
  if (document.hidden) { physics?.pause(); clock.reset(); }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, button.dataset.drive as keyof DrivingInput);
    button.classList.add('pressed');
  });
  const release = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    button.classList.remove('pressed');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function drawMap() {
  const c = context;
  c.clearRect(0, 0, 480, 320);
  c.save();
  const bounds = WORLD_BOUNDS;
  const scale = Math.min((map.width - 24) / (bounds.maxX - bounds.minX), (map.height - 24) / (bounds.maxZ - bounds.minZ));
  c.translate(map.width / 2, map.height / 2);
  c.scale(scale, scale);
  c.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minZ + bounds.maxZ) / 2);
  c.fillStyle = '#d4dbca';
  c.fillRect(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  c.fillStyle = '#f2f1e6';
  for (const road of PAVED_SURFACES) c.fillRect(road.x - road.width / 2, road.z - road.depth / 2, road.width, road.depth);
  c.fillStyle = '#b2bca6';
  for (const line of PARKING_MARKINGS) c.fillRect(line.x - line.width / 2, line.z - line.depth / 2, line.width, line.depth);
  c.fillStyle = '#526b55';
  c.font = 'bold 14px sans-serif';
  c.textAlign = 'center';
  c.fillText('P', PARKING_LOT.x, PARKING_LOT.z + 5);
  c.fillText('T', TEST_AREA.x, TEST_AREA.z + 31);
  c.fillStyle = '#b2aa8b';
  for (const feature of [TEST_RAMP, TEST_CURB]) c.fillRect(feature.x - feature.width / 2, feature.z - feature.depth / 2, feature.width, feature.depth);
  c.fillStyle = '#b2bca6';
  for (const house of HOUSES) c.fillRect(house.x - house.width / 2, house.z - house.depth / 2, house.width, house.depth);
  c.fillStyle = '#99ac85';
  for (const tree of TREES) {
    c.beginPath(); c.arc(tree.x, tree.z, 2.6 * tree.size, 0, Math.PI * 2); c.fill();
  }
  c.translate(car.x, car.z);
  c.rotate(-car.heading);
  c.fillStyle = '#264d3b22';
  c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#234f3d';
  c.strokeStyle = '#fffef2';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 4); c.lineTo(0, 2); c.lineTo(-4, 4); c.closePath(); c.fill(); c.stroke();
  c.restore();
}

function showError(message: string) {
  document.querySelector<HTMLElement>('#error')!.hidden = false;
  document.querySelector<HTMLElement>('#error-message')!.textContent = message;
}

async function start() {
  const scene = createScene(canvas);
  showNotice('Preparing the vehicle…');
  physics = await createVehiclePhysics();
  car = physics.state;
  clearInput();
  showNotice('Ready. Suspension test area: T on the map.');
  let lastTime = performance.now();
  let lostContext = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lostContext = true;
    clearInput();
    showError('The graphics connection was interrupted. Reload this page to restart.');
  });
  function frame(time: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (document.hidden || lostContext) { clock.reset(); return; }
    const input: DrivingInput = { forward: false, reverse: false, left: false, right: false };
    for (const key of keys) if (bindings[key]) input[bindings[key]] = true;
    for (const control of touches.values()) input[control] = true;
    clock.advance(dt, step => physics!.step(input, step));
    speed.textContent = String(Math.round(Math.abs(car.speed) * 2.236936));
    gear.textContent = car.gear < 0 ? 'R' : car.gear > 0 ? `D${car.gear}` : 'N';
    status.textContent = physics!.needsRecovery ? 'PRESS R TO RECOVER' : Math.abs(car.speed) < 0.05 ? 'READY WHEN YOU ARE' : !isOnRoad(car.x, car.z) ? 'OFF THE BEATEN PATH' : car.speed < 0 ? 'TAKING A STEP BACK' : 'A LITTLE FURTHER FROM HURRY';
    scene.render(car, physics!);
    drawMap();
  }
  requestAnimationFrame(frame);
}
void start().catch(error => {
  console.error(error);
  showError('The graphics or physics engine could not start. Use a browser with WebGL 2 and WebAssembly enabled, then reload.');
});
