import { AudioOutput, DrivingAudio } from '../src/audio-output.ts';
import { DrivingAudioModel, AUDIO_BUDGET, DEFAULT_AUDIO, impactSound } from '../src/driving-audio.ts';
import { createCar } from '../src/simulation.ts';

const listener = { point: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
const loud = { muted: false, master: 1, vehicle: 1, effects: 1, environment: 1 };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function energy(data, start = 0, end = data.length) { let sum = 0; for (let i = start; i < end; i++) sum += data[i] ** 2; return Math.sqrt(sum / (end - start)); }
function peak(data, start = 0) { let max = 0; for (let i = start; i < data.length; i++) max = Math.max(max, Math.abs(data[i])); return max; }
async function render(loops, cues = [], change) {
  const context = new OfflineAudioContext(2, 48000, 48000), output = new AudioOutput(context);
  output.settings(loud); output.listener(listener); output.update(loops, cues);
  let pending;
  if (change) pending = context.suspend(0.25).then(() => { change(output); return context.resume(); });
  const buffer = await context.startRendering(); await pending;
  output.dispose(); return [buffer.getChannelData(0), buffer.getChannelData(1)];
}
document.querySelector('#run').addEventListener('click', async event => {
  event.target.disabled = true; document.querySelector('#results').replaceChildren();
  const results = document.querySelector('#results'); let failures = 0;
  const check = async (name, work) => {
    const row = document.createElement('li'); results.append(row);
    try { const detail = await work(); row.textContent = `PASS: ${name}${detail ? ` — ${detail}` : ''}`; }
    catch (error) { failures++; row.textContent = `FAIL: ${name} — ${error.message}`; }
  };
  // Activation happens synchronously in this button's trusted gesture, before offline awaits.
  let realContext;
  const audio = new DrivingAudio(() => (realContext = new AudioContext()));
  const activation = audio.activate();
  await check('Browser activation, mute, pause/resume, disposal and late-resume race', async () => {
    await activation; assert(audio.status === 'Sound on', audio.status);
    audio.setSettings({ ...DEFAULT_AUDIO, muted: true }); assert(audio.status === 'Sound muted', audio.status);
    audio.setSettings({ ...DEFAULT_AUDIO }); audio.setPaused(true);
    await realContext.suspend(); assert(audio.status === 'Sound paused', audio.status);
    audio.setPaused(false); await realContext.resume(); assert(audio.status === 'Sound on', audio.status);
    const lateResume = audio.activate(); audio.setPaused(true); await lateResume;
    assert(audio.status === 'Sound paused', 'late activation escaped pause');
    audio.dispose(); assert(audio.status === 'Enable sound', audio.status);
  });
  const model = new DrivingAudioModel(), car = { ...createCar(), x: 0, z: 0, speed: 30, engineRpm: 5500, throttle: 1, horn: true, lateralAcceleration: 12, gear: 3 };
  model.step({ car, grounded: 1, paved: 1, lateralSpeed: 5, weather: 'rain', traffic: Array.from({ length: 16 }, (_, id) => ({ id, x: 1 + id, z: -2, speed: 15 })) }, 1 / 120);
  const impact = { obstacle: 1, kind: 'impact', time: 0, severity: 1, material: 'metal', panel: 'front', point: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  for (let i = 0; i < 4; i++) model.damageEvents('player', [{ ...impact, obstacle: i, kind: 'scrape-start' }]);
  const cues = Array.from({ length: 24 }, () => impactSound(impact));
  await check('Worst-case Busy mix, held horn and heavy impacts stay finite below output ceiling', async () => {
    const channels = await render(model.loops, cues);
    const max = Math.max(...channels.map(data => peak(data)));
    assert(channels.every(data => data.every(Number.isFinite)), 'nonfinite samples');
    assert(max > 0.03 && max <= 0.901, `peak ${max}`);
    return `peak ${max.toFixed(4)}, ${model.loops.length} loops, at most ${AUDIO_BUDGET.oneShots} impacts`;
  });
  await check('Heavy impact has greater rendered energy and longer decay than a light impact', async () => {
    const light = (await render([], [impactSound({ ...impact, severity: 0.01 })]))[0];
    const heavy = (await render([], [impactSound(impact)]))[0];
    assert(energy(heavy) > energy(light) * 1.3, `heavy ${energy(heavy)}, light ${energy(light)}`);
    assert(energy(heavy, 12000, 18000) > energy(light, 12000, 18000) * 10, 'decay not distinct');
    return `RMS ${energy(light).toFixed(4)} light / ${energy(heavy).toFixed(4)} heavy`;
  });
  await check('Nearby source pans left/right and distant sources attenuate', async () => {
    const voice = x => ({ id: 'spatial', channel: 'environment', waveform: 'triangle', frequency: 160, gain: 0.1, point: { x, y: 1.2, z: -3 } });
    const left = await render([voice(-6)]), right = await render([voice(6)]), far = await render([voice(50)]);
    assert(energy(left[0]) > energy(left[1]) * 1.5, 'left source not left');
    assert(energy(right[1]) > energy(right[0]) * 1.5, 'right source not right');
    assert(energy(far[1]) < energy(right[1]) / 3, 'far source not attenuated');
  });
  await check('Mute fades to silence; pause/reset clears all loops and pending impact tails', async () => {
    const muted = await render(model.loops, cues, output => output.settings({ ...loud, muted: true }));
    assert(muted.every(data => peak(data, 36000) < 0.00001), 'mute continued sounding');
    const stopped = await render(model.loops, cues, output => { output.clear(); assert(output.voiceCount === 0, 'voices retained'); });
    assert(stopped.every(data => peak(data, 15000) < 0.000001), 'paused sounds or tails continued');
  });
  await check('Loop wrap and release avoid discontinuities; repeated traffic churn respects total voice cap', async () => {
    const context = new OfflineAudioContext(2, 48000 * 3, 48000), output = new AudioOutput(context);
    output.settings(loud); output.listener(listener);
    const noise = { id: 'road', channel: 'vehicle', waveform: 'noise', frequency: 800, gain: 0.1 };
    output.update([noise], []);
    const samples = (await context.startRendering()).getChannelData(0);
    assert(Math.abs(samples[96000] - samples[95999]) < 0.01, 'noise wrap discontinuity');
    output.dispose();
    const cappedContext = new OfflineAudioContext(2, 48000, 48000), capped = new AudioOutput(cappedContext);
    for (let i = 0; i < 100; i++) capped.update(model.loops.map(l => ({ ...l, id: `${i}:${l.id}` })), cues);
    assert(capped.voiceCount <= AUDIO_BUDGET.loops + AUDIO_BUDGET.oneShots, `voice cap exceeded: ${capped.voiceCount}`);
    const count = capped.voiceCount; capped.dispose(); return `churn capped at ${count} voices`;
  });
  document.querySelector('#status').textContent = failures ? `${failures} checks failed` : 'All 6 browser audio checks passed';
  event.target.disabled = false;
});
