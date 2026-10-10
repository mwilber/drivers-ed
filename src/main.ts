import './style.css';
import { createScene } from './scene.ts';
import { createCar, indicatorLit, type GearSelection } from './simulation.ts';
import { ACTIONS, ACTION_LABELS, DriverInput, keyLabel, type Action } from './driver-input.ts';
import { createVehiclePhysics, type Spawn, type VehiclePhysics } from './vehicle-physics.ts';
import { SimulationClock } from './simulation-clock.ts';
import { DAMAGE_PANELS } from './vehicle-damage.ts';
import { DEFAULT_VIEW, HeadLook, loadView, serializeView, type ViewSettings } from './cockpit.ts';
import { HOUSES, isOnRoad, PARKING_LOT, PARKING_MARKINGS, PAVED_SURFACES, TEST_AREA, TEST_CURB, TEST_RAMP, TREES, WORLD_BOUNDS } from './world-layout.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const speed = document.querySelector<HTMLElement>('#speed')!;
const gear = document.querySelector<HTMLElement>('#gear')!;
const status = document.querySelector<HTMLElement>('#drive-status')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const damageCondition = document.querySelector<HTMLElement>('#damage-condition')!;
const damageEffects = document.querySelector<HTMLElement>('#damage-effects')!;
const repairButton = document.querySelector<HTMLButtonElement>('#repair')!;
const damageHandling = document.querySelector<HTMLInputElement>('#damage-handling')!;
const panelIndicators = DAMAGE_PANELS.map(panel => ({ panel, element: document.querySelector<HTMLElement>(`[data-panel="${panel}"]`)! }));
const map = document.querySelector<HTMLCanvasElement>('#map')!;
const context = map.getContext('2d')!;
let car = createCar();
let physics: VehiclePhysics | undefined;
const clock = new SimulationClock();
const driverInput = new DriverInput();
const headLook = new HeadLook();
const viewStorageKey = 'drivers-ed.view.v1';
let view: ViewSettings = { ...DEFAULT_VIEW };
try { view = loadView(localStorage.getItem(viewStorageKey)); } catch { /* Session defaults work without storage. */ }
const bindingStorageKey = 'drivers-ed.bindings.v1';
try { driverInput.load(localStorage.getItem(bindingStorageKey)); } catch { /* Storage may be unavailable. */ }
const settings = document.querySelector<HTMLDialogElement>('#bindings-dialog')!;
const viewDialog = document.querySelector<HTMLDialogElement>('#view-dialog')!;
const viewMessage = document.querySelector<HTMLElement>('#view-message')!;
const bindingMessage = document.querySelector<HTMLElement>('#binding-message')!;
let remapping: Action | undefined;
let suspended = false;
let windowBlurred = false;
const pointerButtons = new Map<number, HTMLButtonElement>();
const gearActions: Partial<Record<Action, GearSelection>> = { park: 'P', gearReverse: 'R', neutral: 'N', drive: 'D' };
let noticeTimeout: ReturnType<typeof setTimeout>;
function showNotice(message: string) {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  notice.classList.add('visible');
  noticeTimeout = setTimeout(() => notice.classList.remove('visible'), 2400);
}
function clearInput() {
  driverInput.clear();
  headLook.reset();
  pointerButtons.clear();
  document.querySelectorAll('[data-drive]').forEach(button => button.classList.remove('pressed'));
}
function interrupt() {
  clearInput();
  physics?.pause();
  clock.reset();
}
function reset(spawn?: Spawn) {
  if (!physics) return;
  physics.reset(spawn);
  clock.reset();
  driverInput.reset();
  clearInput();
  showNotice(spawn ? 'Test area. Select Drive to approach the ramp.' : 'Back at the start. Select Drive to begin.');
}
function activate(action: Action) {
  const selection = gearActions[action];
  if (selection && physics && !physics.selectGear(selection)) showNotice('Stop completely, then select the gear again.');
  if (action === 'reset') reset();
}
function saveBindings() {
  try { localStorage.setItem(bindingStorageKey, driverInput.serialize()); }
  catch { bindingMessage.textContent = 'Bindings apply for this session; browser storage is unavailable.'; }
}
function renderBindings() {
  const rows = document.querySelector('#binding-rows')!;
  rows.replaceChildren();
  for (const action of ACTIONS) {
    const label = document.createElement('span');
    label.textContent = ACTION_LABELS[action];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = driverInput.bindings[action].map(keyLabel).join(' / ');
    button.setAttribute('aria-label', `Remap ${ACTION_LABELS[action]}, currently ${button.textContent}`);
    button.addEventListener('click', () => {
      remapping = action;
      bindingMessage.textContent = `Press a key for ${ACTION_LABELS[action]}. Escape cancels.`;
    });
    rows.append(label, button);
  }
  for (const label of document.querySelectorAll<HTMLElement>('[data-binding-label]')) {
    label.textContent = driverInput.bindings[label.dataset.bindingLabel as Action].map(keyLabel).join(' / ');
  }
}
renderBindings();
function renderViewSettings() {
  for (const key of ['fov', 'eyeHeight', 'seatZ'] as const) {
    document.querySelector<HTMLInputElement>(`#view-${key}`)!.value = String(view[key]);
    document.querySelector<HTMLOutputElement>(`#value-${key}`)!.value = key === 'fov' ? `${view[key]}°` : `${view[key].toFixed(2)} m`;
  }
  for (const key of ['followBody', 'smoothLook'] as const) document.querySelector<HTMLInputElement>(`#view-${key}`)!.checked = view[key];
  document.querySelector<HTMLSelectElement>('#view-mirrors')!.value = view.mirrors;
}
renderViewSettings();
function saveView() {
  try { localStorage.setItem(viewStorageKey, serializeView(view)); viewMessage.textContent = 'View preferences saved.'; }
  catch { viewMessage.textContent = 'Preferences apply for this session; browser storage is unavailable.'; }
}
document.querySelector('#view-settings')!.addEventListener('click', () => {
  suspended = true;
  interrupt();
  viewDialog.showModal();
});
for (const key of ['fov', 'eyeHeight', 'seatZ'] as const) {
  document.querySelector<HTMLInputElement>(`#view-${key}`)!.addEventListener('input', event => {
    view[key] = Number((event.target as HTMLInputElement).value);
    renderViewSettings();
    saveView();
  });
}
for (const key of ['followBody', 'smoothLook'] as const) {
  document.querySelector<HTMLInputElement>(`#view-${key}`)!.addEventListener('change', event => {
    view[key] = (event.target as HTMLInputElement).checked;
    saveView();
  });
}
document.querySelector('#view-mirrors')!.addEventListener('change', event => {
  view.mirrors = (event.target as HTMLSelectElement).value as ViewSettings['mirrors'];
  saveView();
});
document.querySelector('#default-view')!.addEventListener('click', () => {
  view = { ...DEFAULT_VIEW };
  renderViewSettings();
  saveView();
});
document.querySelector('#close-view')!.addEventListener('click', () => viewDialog.close());
viewDialog.addEventListener('close', () => {
  suspended = false;
  interrupt();
  canvas.focus({ preventScroll: true });
});
document.querySelector('#settings')!.addEventListener('click', () => {
  suspended = true;
  interrupt();
  settings.showModal();
});
settings.addEventListener('close', () => {
  remapping = undefined;
  suspended = false;
  interrupt();
  canvas.focus({ preventScroll: true });
});
document.querySelector('#close-bindings')!.addEventListener('click', () => settings.close());
document.querySelector('#default-bindings')!.addEventListener('click', () => {
  remapping = undefined;
  driverInput.restoreDefaults();
  bindingMessage.textContent = 'Default bindings restored.';
  saveBindings();
  renderBindings();
});
document.querySelector('#reset')!.addEventListener('click', () => { reset(); canvas.focus(); });
document.querySelector('#test-area')!.addEventListener('click', () => { reset({ x: TEST_RAMP.x, z: -118, heading: 0 }); canvas.focus(); });
repairButton.addEventListener('click', () => {
  physics?.repair();
  canvas.focus();
  showNotice('Car repaired. Appearance and handling restored.');
});
damageHandling.addEventListener('change', () => {
  if (physics) physics.damage.handlingEnabled = damageHandling.checked;
  canvas.focus();
});
window.addEventListener('keydown', event => {
  if (settings.open) {
    if (!remapping) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape') { remapping = undefined; bindingMessage.textContent = 'Remapping canceled.'; return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const error = driverInput.remap(remapping, event.code);
    if (error) { bindingMessage.textContent = error; return; }
    remapping = undefined;
    bindingMessage.textContent = 'Binding updated.';
    saveBindings();
    renderBindings();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || suspended || !physics) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable]')) return;
  const action = driverInput.actionForKey(event.code);
  if (!action) return;
  event.preventDefault();
  if (event.repeat) return;
  const activated = driverInput.press(`key:${event.code}`, action);
  if (activated) activate(activated);
});
window.addEventListener('keyup', event => driverInput.release(`key:${event.code}`));
window.addEventListener('blur', () => { windowBlurred = true; interrupt(); });
window.addEventListener('focus', () => { windowBlurred = false; interrupt(); });
document.addEventListener('visibilitychange', interrupt);
document.addEventListener('focusin', event => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable]')) clearInput();
});
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  button.addEventListener('click', () => {
    if (suspended || !physics) return;
    const action = button.dataset.action as Action;
    const activated = driverInput.press('button', action);
    if (activated) activate(activated);
    driverInput.release('button');
    canvas.focus({ preventScroll: true });
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
  button.addEventListener('keydown', event => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (suspended || !physics || event.repeat) return;
    const action = driverInput.press(`button:${button.dataset.drive}:${event.code}`, button.dataset.drive as Action);
    if (action) activate(action);
    button.classList.add('pressed');
  });
  button.addEventListener('keyup', event => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    driverInput.release(`button:${button.dataset.drive}:${event.code}`);
    button.classList.remove('pressed');
  });
  button.addEventListener('blur', clearInput);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (suspended || !physics) return;
    canvas.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
    pointerButtons.set(event.pointerId, button);
    const action = driverInput.press(`pointer:${event.pointerId}`, button.dataset.drive as Action);
    if (action) activate(action);
    button.classList.add('pressed');
  });
  const release = (event: PointerEvent) => {
    driverInput.release(`pointer:${event.pointerId}`);
    pointerButtons.delete(event.pointerId);
    if (![...pointerButtons.values()].includes(button)) button.classList.remove('pressed');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function updateControlDisplay() {
  const switchStates: Partial<Record<Action, boolean>> = {
    parkingBrake: driverInput.parkingBrake, headlights: driverInput.headlights,
    indicatorLeft: driverInput.indicator === 'left', indicatorRight: driverInput.indicator === 'right',
    hazards: driverInput.indicator === 'hazards',
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    const action = button.dataset.action as Action;
    const selected = gearActions[action];
    const active = selected ? car.selectedGear === selected : switchStates[action] ?? false;
    if (button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
  }
  const lit = indicatorLit(car);
  document.querySelector('#indicator-left')!.classList.toggle('lit', lit && (car.indicator === 'left' || car.indicator === 'hazards'));
  document.querySelector('#indicator-right')!.classList.toggle('lit', lit && (car.indicator === 'right' || car.indicator === 'hazards'));
  const hornState = document.querySelector('#horn-state')!;
  const hornText = car.horn ? 'HORN ACTIVE' : 'Horn ready · sound in phase 11';
  if (hornState.textContent !== hornText) hornState.textContent = hornText;
  document.querySelector('#switch-state')!.textContent = `${car.parkingBrake ? 'Parking brake ON' : 'Parking brake OFF'} · Lights ${car.headlights ? 'ON' : 'OFF'}`;
  const look = driverInput.lookSnapshot();
  for (const button of document.querySelectorAll<HTMLElement>('.look-controls [data-drive]')) {
    const active = button.dataset.drive === 'lookLeft' ? look.left : button.dataset.drive === 'lookRight' ? look.right : look.back;
    button.setAttribute('aria-pressed', String(active));
  }
  document.querySelector('#view-state')!.textContent = look.back ? 'Looking back' : look.left && !look.right ? 'Left shoulder' : look.right && !look.left ? 'Right shoulder' : 'Looking forward';
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
  physics = await createVehiclePhysics({ explicitControls: true });
  physics.damage.handlingEnabled = damageHandling.checked;
  car = physics.state;
  clearInput();
  showNotice(`Ready. Select Drive (${driverInput.bindings.drive.map(keyLabel).join(' / ')}), then accelerate (${driverInput.bindings.forward.map(keyLabel).join(' / ')}).`);
  let lastTime = performance.now();
  let lostContext = false;
  let damageRevision = -1;
  let handlingEnabled = damageHandling.checked;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lostContext = true;
    interrupt();
    showError('The graphics connection was interrupted. Reload this page to restart.');
  });
  function frame(time: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (document.hidden || suspended || windowBlurred || lostContext) { clock.reset(); return; }
    const input = driverInput.snapshot();
    headLook.update(driverInput.lookSnapshot(), dt, view.smoothLook);
    clock.advance(dt, step => physics!.step(input, step));
    const damage = physics!.damage;
    const impacts = damage.drainEvents().filter(event => event.kind === 'impact');
    if (impacts.length) {
      const impact = impacts.reduce((strongest, event) => event.severity > strongest.severity ? event : strongest);
      showNotice(`${impact.severity > 0.2 ? 'Strong' : 'Light'} impact · ${impact.panel} panel. Repair is available.`);
    }
    if (damageRevision !== damage.revision || handlingEnabled !== damage.handlingEnabled) {
      damageRevision = damage.revision;
      handlingEnabled = damage.handlingEnabled;
      damageCondition.textContent = damage.condition === 'undamaged' ? 'Undamaged' : damage.condition === 'heavy' ? 'Heavy damage' : 'Dents / scratches';
      repairButton.disabled = damage.condition === 'undamaged';
      for (const { panel, element } of panelIndicators) {
        const severity = Math.max(damage.panels[panel].dent, damage.panels[panel].scratch);
        element.style.setProperty('--damage', String(severity));
        element.title = `${panel}: ${Math.round(damage.panels[panel].dent * 100)}% dent, ${Math.round(damage.panels[panel].scratch * 100)}% scratch`;
        element.setAttribute('aria-label', element.title);
      }
      const effects = damage.effects;
      const feedback = [];
      if (effects.power < 0.999) feedback.push(`Power −${Math.round((1 - effects.power) * 100)}%`);
      if (Math.abs(effects.steeringBias) > 0.001) feedback.push(`Steering pulls ${effects.steeringBias > 0 ? 'left' : 'right'}`);
      if (effects.suspension.some(value => value < 0.999)) feedback.push('Suspension weakened');
      damageEffects.textContent = !damage.handlingEnabled ? 'Handling effects off' : feedback.length ? feedback.join(' · ') : 'Original handling';
    }
    speed.textContent = String(Math.round(Math.abs(car.speed) * 2.236936));
    gear.textContent = car.selectedGear === 'D' ? `D${car.gear}` : car.selectedGear;
    document.querySelector('#rpm')!.textContent = `${(car.engineRpm / 1000).toFixed(1)}k RPM`;
    document.querySelector<HTMLMeterElement>('#throttle-meter')!.value = car.throttle;
    document.querySelector<HTMLMeterElement>('#brake-meter')!.value = car.brake;
    updateControlDisplay();
    status.textContent = physics!.needsRecovery ? 'PRESS R TO RECOVER' : car.selectedGear === 'P' ? 'PARK · SELECT DRIVE TO BEGIN' : car.parkingBrake ? 'PARKING BRAKE ON' : Math.abs(car.speed) < 0.05 ? 'READY WHEN YOU ARE' : !isOnRoad(car.x, car.z) ? 'OFF THE BEATEN PATH' : car.speed < 0 ? 'TAKING A STEP BACK' : 'A LITTLE FURTHER FROM HURRY';
    scene.render(car, physics!, view, headLook.yaw, time);
    drawMap();
  }
  requestAnimationFrame(frame);
}
void start().catch(error => {
  console.error(error);
  showError('The graphics or physics engine could not start. Use a browser with WebGL 2 and WebAssembly enabled, then reload.');
});
