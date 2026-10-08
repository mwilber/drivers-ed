import './style.css';
import { createScene } from './scene.ts';
import { createCar, stepCar, type DrivingInput } from './simulation.ts';
import { HOUSES, isOnRoad, OBSTACLES, ROADS, TREES } from './world-layout.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const speed = document.querySelector<HTMLElement>('#speed')!;
const gear = document.querySelector<HTMLElement>('#gear')!;
const status = document.querySelector<HTMLElement>('#drive-status')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const map = document.querySelector<HTMLCanvasElement>('#map')!;
const context = map.getContext('2d')!;
const car = createCar();
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
function reset() {
  Object.assign(car, createCar());
  clearInput();
  showNotice('Back at the start. Take your time.');
}
document.querySelector('#reset')!.addEventListener('click', reset);
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
  if (document.hidden) car.speed = 0;
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
  c.translate(240, 160);
  c.scale(1.65, 1.65);
  c.fillStyle = '#d4dbca';
  c.fillRect(-150, -100, 300, 200);
  c.fillStyle = '#f2f1e6';
  for (const road of ROADS) c.fillRect(road.x - road.width / 2 - 1, road.z - road.depth / 2 - 1, road.width + 2, road.depth + 2);
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

try {
  const scene = createScene(canvas);
  let lastTime = performance.now();
  let accumulator = 0;
  let lostContext = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lostContext = true;
    clearInput();
    showError('The graphics connection was interrupted. Reload this page to restart.');
  });
  const fixedStep = 1 / 120;
  function frame(time: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (document.hidden || lostContext) { accumulator = 0; return; }
    const input: DrivingInput = { forward: false, reverse: false, left: false, right: false };
    for (const key of keys) if (bindings[key]) input[bindings[key]] = true;
    for (const control of touches.values()) input[control] = true;
    accumulator += dt;
    while (accumulator >= fixedStep) {
      stepCar(car, input, fixedStep, OBSTACLES, isOnRoad(car.x, car.z));
      accumulator -= fixedStep;
    }
    speed.textContent = String(Math.round(Math.abs(car.speed) * 2.236936));
    gear.textContent = car.speed < -0.05 ? 'R' : car.speed > 0.05 ? 'D' : 'N';
    status.textContent = Math.abs(car.speed) < 0.05 ? 'READY WHEN YOU ARE' : !isOnRoad(car.x, car.z) ? 'OFF THE BEATEN PATH' : car.speed < 0 ? 'TAKING A STEP BACK' : 'A LITTLE FURTHER FROM HURRY';
    scene.render(car);
    drawMap();
  }
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  showError('WebGL could not start. Use a browser with WebGL 2 and hardware acceleration enabled, then reload.');
}
