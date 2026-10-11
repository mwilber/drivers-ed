import './style.css';
import { createScene } from './scene.ts';
import { createCar, indicatorLit, type GearSelection } from './simulation.ts';
import { ACTIONS, ACTION_LABELS, DriverInput, keyLabel, type Action } from './driver-input.ts';
import { createVehiclePhysics, type Spawn, type VehiclePhysics } from './vehicle-physics.ts';
import { TrafficSignals, upcomingControl, controlGuidance } from './traffic-rules.ts';
import { VehicleTraffic, type TrafficDensity } from './vehicle-traffic.ts';
import { CyclistPhysics } from './cyclist-physics.ts';
import { CYCLIST_SCENARIOS, loadCyclistScenario, type CyclistScenario } from './cyclist-scenarios.ts';
import { Pedestrians } from './pedestrians.ts';
import { PEDESTRIAN_SCENARIOS, loadPedestrianScenario, type PedestrianScenario } from './pedestrian-scenarios.ts';
import { TrafficPhysics } from './traffic-physics.ts';
import { TRAFFIC_SCENARIOS, loadTrafficScenario, type TrafficScenario } from './traffic-scenarios.ts';
import { ROAD_RULES, ROAD_EXAMPLES, APPROACHES, speedZoneAt } from './traffic-layout.ts';
import { SimulationClock } from './simulation-clock.ts';
import { DAMAGE_PANELS, type DamageEvent } from './vehicle-damage.ts';
import { DEFAULT_VIEW, HeadLook, loadView, serializeView, type ViewSettings } from './cockpit.ts';
import { loadConditions, serializeConditions, lightingGuidance, WIPERS, type DrivingConditions } from './driving-conditions.ts';
import { WindshieldRain } from './windshield-rain.ts';
import { RenderProfile } from './render-profile.ts';
import { DrivingAudioModel, AUDIO_CHANNELS, loadAudio, serializeAudio, type AudioSettings } from './driving-audio.ts';
import { DrivingAudio } from './audio-output.ts';
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
const trafficSignals = new TrafficSignals();
const traffic = new VehicleTraffic();
const windshield = new WindshieldRain();
let trafficPhysics: TrafficPhysics | undefined;
let pedestrians: Pedestrians | undefined;
let cyclists: CyclistPhysics | undefined;
const cyclistsEnabled = document.querySelector<HTMLInputElement>('#cyclists-enabled')!;
const pedestriansEnabled = document.querySelector<HTMLInputElement>('#pedestrians-enabled')!;
const trafficDensity = document.querySelector<HTMLSelectElement>('#traffic-density')!;
const roadContext = document.querySelector<HTMLElement>('#road-context')!;
const roadControl = document.querySelector<HTMLElement>('#road-control')!;
const driverInput = new DriverInput();
const headLook = new HeadLook();
const audioModel = new DrivingAudioModel();
const audio = new DrivingAudio();
const audioStorageKey = 'drivers-ed.audio.v1';
let audioSettings: AudioSettings = loadAudio(null);
try { audioSettings = loadAudio(localStorage.getItem(audioStorageKey)); } catch { /* Audio works without storage. */ }
audio.setSettings(audioSettings);
const soundButton = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
const audioDialog = document.querySelector<HTMLDialogElement>('#audio-dialog')!;
const audioMessage = document.querySelector<HTMLElement>('#audio-message')!;
const viewStorageKey = 'drivers-ed.view.v1';
let view: ViewSettings = { ...DEFAULT_VIEW };
try { view = loadView(localStorage.getItem(viewStorageKey)); } catch { /* Session defaults work without storage. */ }
const conditionsStorageKey = 'drivers-ed.conditions.v1';
let conditions: DrivingConditions = loadConditions(null);
try { conditions = loadConditions(localStorage.getItem(conditionsStorageKey)); } catch { /* Daytime works without storage. */ }
const lightingSelect = document.querySelector<HTMLSelectElement>('#conditions-timeOfDay')!;
const weatherSelect = document.querySelector<HTMLSelectElement>('#conditions-weather')!;
const wiperSelect = document.querySelector<HTMLSelectElement>('#conditions-wipers')!;
const wiperButton = document.querySelector<HTMLButtonElement>('#wipers')!;
lightingSelect.value = conditions.timeOfDay;
weatherSelect.value = conditions.weather;
wiperSelect.value = conditions.wipers;
document.querySelector<HTMLElement>('#app')!.dataset.lighting = conditions.timeOfDay;
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
  trafficPhysics?.pause();
  audioModel.reset();
  audio.setPaused(true);
  clock.reset();
}
function reset(spawn?: Spawn) {
  if (!physics) return;
  audioModel.reset();
  audio.clear();
  trafficPhysics?.clear();
  pedestrians?.clear();
  cyclists?.clear();
  physics.reset(spawn);
  windshield.reset();
  trafficSignals.reset();
  if (trafficDensity.value === 'scenario') { traffic.density = 'light'; trafficDensity.value = 'light'; }
  traffic.cyclistsEnabled = cyclistsEnabled.checked;
  traffic.reset(car);
  pedestrians?.reset(pedestriansEnabled.checked);
  trafficPhysics?.sync(traffic.cars);
  cyclists?.sync(traffic.cars);
  clock.reset();
  driverInput.reset();
  clearInput();
  showNotice(spawn ? 'Ready at the practice position. Select Drive to begin.' : 'Back at the start. Select Drive to begin.');
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
function renderAudioSettings() {
  soundButton.textContent = audio.status;
  soundButton.setAttribute('aria-pressed', String(!audioSettings.muted && audio.status === 'Sound on'));
  document.querySelector<HTMLInputElement>('#audio-muted')!.checked = audioSettings.muted;
  for (const channel of ['master', ...AUDIO_CHANNELS] as const) {
    document.querySelector<HTMLInputElement>(`#audio-${channel}`)!.value = String(audioSettings[channel]);
    document.querySelector<HTMLOutputElement>(`#audio-value-${channel}`)!.value = `${Math.round(audioSettings[channel] * 100)}%`;
  }
}
function saveAudio() {
  audio.setSettings(audioSettings);
  try { localStorage.setItem(audioStorageKey, serializeAudio(audioSettings)); audioMessage.textContent = 'Sound preferences saved.'; }
  catch { audioMessage.textContent = 'Sound preferences apply for this session; browser storage is unavailable.'; }
  renderAudioSettings();
}
renderAudioSettings();
soundButton.addEventListener('click', () => {
  if (audio.status === 'Sound on') { audioSettings.muted = true; saveAudio(); }
  else {
    audioSettings.muted = false; saveAudio();
    void audio.activate().then(renderAudioSettings);
  }
  canvas.focus({ preventScroll: true });
});
document.querySelector('#audio-settings')!.addEventListener('click', () => {
  suspended = true; interrupt(); renderAudioSettings(); audioDialog.showModal();
});
document.querySelector('#close-audio')!.addEventListener('click', () => audioDialog.close());
audioDialog.addEventListener('close', () => {
  suspended = false; interrupt(); canvas.focus({ preventScroll: true });
});
document.querySelector<HTMLInputElement>('#audio-muted')!.addEventListener('change', event => {
  audioSettings.muted = (event.target as HTMLInputElement).checked; saveAudio();
});
for (const channel of ['master', ...AUDIO_CHANNELS] as const) {
  document.querySelector<HTMLInputElement>(`#audio-${channel}`)!.addEventListener('input', event => {
    audioSettings[channel] = Number((event.target as HTMLInputElement).value); saveAudio();
  });
}
document.querySelector('#default-audio')!.addEventListener('click', () => { audioSettings = loadAudio(null); saveAudio(); });
function renderViewSettings() {
  for (const key of ['fov', 'eyeHeight', 'seatZ'] as const) {
    document.querySelector<HTMLInputElement>(`#view-${key}`)!.value = String(view[key]);
    document.querySelector<HTMLOutputElement>(`#value-${key}`)!.value = key === 'fov' ? `${view[key]}°` : `${view[key].toFixed(2)} m`;
  }
  for (const key of ['followBody', 'smoothLook'] as const) document.querySelector<HTMLInputElement>(`#view-${key}`)!.checked = view[key];
  document.querySelector<HTMLSelectElement>('#view-mirrors')!.value = view.mirrors;
}
renderViewSettings();
function saveConditions() {
  lightingSelect.value = conditions.timeOfDay;
  weatherSelect.value = conditions.weather;
  wiperSelect.value = conditions.wipers;
  if (physics) physics.weather = conditions.weather;
  traffic.weather = conditions.weather;
  document.querySelector<HTMLElement>('#app')!.dataset.lighting = conditions.timeOfDay;
  const message = document.querySelector('#conditions-message')!;
  try {
    localStorage.setItem(conditionsStorageKey, serializeConditions(conditions));
    message.textContent = 'Driving conditions saved.';
  } catch { message.textContent = 'Conditions apply for this session; browser storage is unavailable.'; }
}
for (const select of [lightingSelect, weatherSelect, wiperSelect]) select.addEventListener('change', () => {
  conditions = loadConditions(serializeConditions({ timeOfDay: lightingSelect.value as DrivingConditions['timeOfDay'], weather: weatherSelect.value as DrivingConditions['weather'], wipers: wiperSelect.value as DrivingConditions['wipers'] }));
  saveConditions();
});
wiperButton.addEventListener('click', () => {
  conditions.wipers = WIPERS[(WIPERS.indexOf(conditions.wipers) + 1) % WIPERS.length]!;
  saveConditions();
  canvas.focus({ preventScroll: true });
});
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
  conditions = loadConditions(null);
  renderViewSettings();
  saveView();
  saveConditions();
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
document.querySelector('#road-example')!.addEventListener('change', event => {
  const select = event.target as HTMLSelectElement;
  const spawn = ROAD_EXAMPLES[select.value as keyof typeof ROAD_EXAMPLES];
  if (spawn) reset(spawn);
  const scenario = TRAFFIC_SCENARIOS[select.value as TrafficScenario];
  if (scenario) {
    reset(scenario.spawn);
    trafficPhysics?.clear();
    cyclists?.clear();
    traffic.setCyclists(false);
    pedestrians?.reset(false);
    loadTrafficScenario(traffic, select.value as TrafficScenario);
    trafficDensity.value = 'scenario';
    trafficPhysics?.sync(traffic.cars);
    showNotice('Repeatable traffic scenario ready. Select Drive, or watch the encounter.');
  }
  const pedestrianScenario = PEDESTRIAN_SCENARIOS[select.value as PedestrianScenario];
  if (pedestrianScenario && pedestrians) {
    reset(pedestrianScenario.spawn);
    trafficPhysics?.clear();
    cyclists?.clear();
    traffic.setCyclists(false);
    loadPedestrianScenario(pedestrians, traffic, select.value as PedestrianScenario);
    pedestriansEnabled.checked = true;
    trafficDensity.value = 'scenario';
    trafficPhysics?.sync(traffic.cars);
    showNotice('Pedestrian encounter ready. Watch the crossing and yield before entering.');
  }
  const cyclistScenario = CYCLIST_SCENARIOS[select.value as CyclistScenario];
  if (cyclistScenario && cyclists) {
    reset(cyclistScenario.spawn);
    trafficPhysics?.clear(); cyclists.clear(); pedestrians?.reset(false);
    loadCyclistScenario(traffic, select.value as CyclistScenario);
    cyclistsEnabled.checked = true;
    trafficDensity.value = 'scenario';
    trafficPhysics?.sync(traffic.cars); cyclists.sync(traffic.cars);
    showNotice('Cyclist encounter ready. Leave passing space and yield at turns.');
  }
  select.value = ''; canvas.focus();
});
cyclistsEnabled.addEventListener('change', () => {
  cyclists?.clear(); traffic.setCyclists(cyclistsEnabled.checked, car); cyclists?.sync(traffic.cars); canvas.focus();
});
pedestriansEnabled.addEventListener('change', () => {
  pedestrians?.reset(pedestriansEnabled.checked); canvas.focus();
});
trafficDensity.addEventListener('change', () => {
  traffic.setDensity(trafficDensity.value as TrafficDensity, car);
  trafficPhysics?.sync(traffic.cars);
  canvas.focus();
});
repairButton.addEventListener('click', () => {
  physics?.repair();
  audioModel.clearSource('player');
  audio.clear();
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
  const hornText = car.horn ? 'HORN ACTIVE' : 'Horn ready';
  if (hornState.textContent !== hornText) hornState.textContent = hornText;
  document.querySelector('#switch-state')!.textContent = `${car.parkingBrake ? 'Parking brake ON' : 'Parking brake OFF'} · Lights ${car.headlights ? 'ON' : 'OFF'}`;
  const conditionStatus = document.querySelector('#conditions-status')!;
  const guidance = lightingGuidance(conditions.timeOfDay, car.headlights, conditions.weather);
  if (conditionStatus.textContent !== guidance) conditionStatus.textContent = guidance;
  const wiperText = conditions.weather === 'dry' ? 'Wipers parked' : `Wipers: ${conditions.wipers}`;
  if (wiperButton.textContent !== wiperText) wiperButton.textContent = wiperText;
  wiperButton.disabled = conditions.weather === 'dry';
  const look = driverInput.lookSnapshot();
  for (const button of document.querySelectorAll<HTMLElement>('.look-controls [data-drive]')) {
    const active = button.dataset.drive === 'lookLeft' ? look.left : button.dataset.drive === 'lookRight' ? look.right : look.back;
    button.setAttribute('aria-pressed', String(active));
  }
  document.querySelector('#view-state')!.textContent = look.back ? 'Looking back' : look.left && !look.right ? 'Left shoulder' : look.right && !look.left ? 'Right shoulder' : 'Looking forward';
}

function drawMap() {
  const c = context;
  c.clearRect(0, 0, map.width, map.height);
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
  for (const approach of APPROACHES) {
    if (approach.kind === 'priority') continue;
    c.fillStyle = approach.kind === 'signal' ? { red: '#bb4131', yellow: '#c28e17', green: '#267849' }[trafficSignals.color(approach.id)!] : approach.kind === 'yield' ? '#ba7d21' : '#b44737';
    c.beginPath(); c.arc(approach.x, approach.z, 2.2, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#526b55'; c.font = 'bold 9px sans-serif';
  c.fillText('15 MPH', -50, 160);
  c.fillText('25 MPH', -50, 4);
  c.fillText('P', 107, 118);
  for (const vehicle of traffic.vehicles) {
    c.save(); c.translate(vehicle.x, vehicle.z); c.rotate(-vehicle.heading);
    c.fillStyle = vehicle.damage.condition === 'undamaged' ? '#577a96' : '#b56a38'; c.fillRect(-1.8, -3, 3.6, 6); c.restore();
  }
  for (const rider of cyclists?.riders ?? []) {
    c.fillStyle = rider.state === 'fallen' ? '#b54d38' : '#2b9aa4';
    c.save(); c.translate(rider.actor.x, rider.actor.z); c.rotate(-rider.actor.heading); c.fillRect(-1, -2.5, 2, 5); c.restore();
  }
  for (const p of pedestrians?.people ?? []) {
    c.fillStyle = p.state === 'fallen' ? '#b54d38' : '#e5a534';
    c.beginPath(); c.arc(p.x, p.z, 1.8, 0, Math.PI * 2); c.fill();
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
  physics = await createVehiclePhysics({ explicitControls: true, weather: conditions.weather });
  traffic.weather = conditions.weather;
  physics.damage.handlingEnabled = damageHandling.checked;
  car = physics.state;
  trafficPhysics = new TrafficPhysics(physics);
  pedestrians = new Pedestrians(physics);
  cyclists = new CyclistPhysics(physics, traffic);
  traffic.cyclistsEnabled = cyclistsEnabled.checked;
  pedestrians.reset(pedestriansEnabled.checked);
  traffic.reset(car);
  trafficPhysics.sync(traffic.cars);
  cyclists.sync(traffic.cars);
  clearInput();
  document.querySelector('#road-jurisdiction')!.textContent = `${ROAD_RULES.jurisdiction} · keep right`;
  showNotice(`Ready. Select Drive (${driverInput.bindings.drive.map(keyLabel).join(' / ')}), then accelerate (${driverInput.bindings.forward.map(keyLabel).join(' / ')}).`);
  let lastTime = performance.now();
  let lostContext = false;
  let damageRevision = -1;
  let handlingEnabled = damageHandling.checked;
  const profile = import.meta.env.DEV && new URLSearchParams(location.search).get('profile') === '1' ? new RenderProfile() : undefined;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lostContext = true;
    interrupt();
    showError('The graphics connection was interrupted. Reload this page to restart.');
  });
  function frame(time: number) {
    requestAnimationFrame(frame);
    const frameStart = performance.now();
    const intervalMs = time - lastTime;
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (document.hidden || suspended || windowBlurred || lostContext) { audio.setPaused(true); clock.reset(); profile?.pause(); return; }
    audio.setPaused(false);
    if (soundButton.textContent !== audio.status) renderAudioSettings();
    const input = driverInput.snapshot();
    headLook.update(driverInput.lookSnapshot(), dt, view.smoothLook);
    const damageEvents: DamageEvent[] = [];
    clock.advance(dt, step => {
      windshield.step(step, conditions.weather, conditions.wipers);
      pedestrians!.beforeStep(trafficSignals.seconds, [...traffic.cars, ...cyclists!.obstacles(), car], step);
      traffic.step(trafficSignals.seconds, car, pedestrians!.hazards(trafficSignals.seconds), [...pedestrians!.obstacles(), ...cyclists!.obstacles()]);
      trafficPhysics!.sync(traffic.cars);
      cyclists!.sync(traffic.cars);
      physics!.step(input, step);
      trafficPhysics!.afterStep(traffic, step);
      pedestrians!.afterStep(step);
      cyclists!.afterStep(step);
      trafficSignals.step();
      let grounded = 0, paved = 0;
      for (let i = 0; i < physics!.wheels.length; i++) {
        if (!physics!.wheels[i]!.contact) continue;
        grounded++;
        const point = physics!.vehicle.wheelContactPoint(i);
        if (point && isOnRoad(point.x, point.z)) paved++;
      }
      const velocity = physics!.body.linvel();
      audioModel.step({ car, grounded: grounded / 4, paved: grounded ? paved / grounded : 0,
        lateralSpeed: velocity.x * Math.cos(car.heading) - velocity.z * Math.sin(car.heading), weather: conditions.weather, traffic: traffic.vehicles }, step);
      const events = physics!.damage.drainEvents();
      damageEvents.push(...events);
      audioModel.damageEvents('player', events);
      for (const { carId, event } of trafficPhysics!.drainEvents()) audioModel.damageEvents(`traffic:${carId}`, [event]);
    });
    document.querySelector('#pedestrian-status')!.textContent = `${pedestrians!.people.length} pedestrians · ${pedestrians!.completed} crossings completed`;
    document.querySelector('#cyclist-status')!.textContent = `${cyclists!.count} cyclists · ${traffic.completedCyclists} routes completed`;
    const cyclistImpacts = cyclists!.drainEvents();
    const pedestrianImpacts = pedestrians!.drainEvents();
    const damagedTraffic = traffic.vehicles.filter(car => car.damage.condition !== 'undamaged').length;
    document.querySelector('#traffic-status')!.textContent = `${traffic.vehicles.length} vehicles · ${traffic.completed} routes completed${damagedTraffic ? ` · ${damagedTraffic} damaged` : ''}`;
    const damage = physics!.damage;
    const impacts = damageEvents.filter(event => event.kind === 'impact');
    if (impacts.length) {
      const impact = impacts.reduce((strongest, event) => event.severity > strongest.severity ? event : strongest);
      showNotice(`${impact.severity > 0.2 ? 'Strong' : 'Light'} impact · ${impact.panel} panel. Repair is available.`);
    }
    if (cyclistImpacts.length) showNotice('Cyclist collision. Stop and reset the encounter.');
    if (pedestrianImpacts.length) showNotice('Pedestrian collision. Stop and reset the encounter.');
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
    const zone = isOnRoad(car.x, car.z) ? speedZoneAt(car) : undefined;
    roadContext.textContent = zone ? `${zone.mph} MPH LIMIT · ${zone.name}` : 'Off road · return to a street';
    roadControl.textContent = controlGuidance(upcomingControl(car, car.heading), trafficSignals);
    scene.render(car, physics!, view, headLook.yaw, time, trafficSignals.seconds, traffic.cars, pedestrians!.people, conditions.timeOfDay, conditions.weather, windshield, cyclists!.riders);
    audio.update(audioModel.loops, audioModel.drainCues(), scene.audioListenerPose());
    drawMap();
    profile?.record(`${conditions.timeOfDay}, ${conditions.weather}, wipers ${conditions.wipers}, lights ${car.headlights ? 'on' : 'off'}, mirrors ${view.mirrors}, traffic ${trafficDensity.value}, pedestrians ${pedestriansEnabled.checked ? 'on' : 'off'}, cyclists ${cyclists!.count}`, intervalMs, performance.now() - frameStart);
  }
  requestAnimationFrame(frame);
}
window.addEventListener('pagehide', () => { audioModel.reset(); audio.dispose(); });
void start().catch(error => {
  console.error(error);
  showError('The graphics or physics engine could not start. Use a browser with WebGL 2 and WebAssembly enabled, then reload.');
});
