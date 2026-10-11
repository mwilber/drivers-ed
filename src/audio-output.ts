import { AUDIO_BUDGET, AUDIO_CHANNELS, DEFAULT_AUDIO, noiseSamples, type AudioChannel, type AudioCue, type AudioLoop, type AudioSettings } from './driving-audio.ts';
import type { DamageVector } from './vehicle-damage.ts';

interface Voice {
  source: OscillatorNode | AudioBufferSourceNode; gain: GainNode; filter?: BiquadFilterNode; panner?: PannerNode;
  waveform: AudioLoop['waveform']; nodes: AudioNode[];
}
export interface AudioListenerPose { point: DamageVector; forward: DamageVector; up: DamageVector }
const smooth = (param: AudioParam, value: number, time: number, tau = 0.035) => {
  param.cancelScheduledValues(time);
  param.setTargetAtTime(value, time, tau);
};

/** Bounded procedural mixer; accepts OfflineAudioContext for actual DSP regression checks. */
export class AudioOutput {
  readonly master: GainNode;
  private channels: Record<AudioChannel, GainNode>;
  private noise: AudioBuffer;
  private loops = new Map<string, Voice>();
  private shots = new Set<Voice>();
  private retiring = new Set<Voice>();
  private outputNodes: AudioNode[];
  private context: BaseAudioContext;
  constructor(context: BaseAudioContext) {
    this.context = context;
    this.master = context.createGain(); this.master.gain.value = 0;
    this.channels = Object.fromEntries(AUDIO_CHANNELS.map(channel => {
      const gain = context.createGain(); gain.gain.value = 0; gain.connect(this.master); return [channel, gain];
    })) as Record<AudioChannel, GainNode>;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 6;
    compressor.attack.value = 0.003; compressor.release.value = 0.15;
    // A final smooth saturator provides a strict output ceiling even during simultaneous impacts.
    const limiter = context.createWaveShaper(), curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = 0.9 * Math.tanh((i / (curve.length - 1) * 2 - 1));
    limiter.curve = curve;
    this.master.connect(compressor); compressor.connect(limiter); limiter.connect(context.destination);
    this.outputNodes = [this.master, ...Object.values(this.channels), compressor, limiter];
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    this.noise.copyToChannel(noiseSamples(this.noise.length), 0);
  }
  get voiceCount(): number { return this.loops.size + this.shots.size + this.retiring.size; }
  settings(settings: AudioSettings): void {
    const time = this.context.currentTime;
    smooth(this.master.gain, settings.muted ? 0 : settings.master, time);
    for (const channel of AUDIO_CHANNELS) smooth(this.channels[channel].gain, settings[channel], time);
  }
  private position(panner: PannerNode, point: DamageVector): void {
    const time = this.context.currentTime;
    for (const axis of ['x', 'y', 'z'] as const) smooth(panner[`position${axis.toUpperCase() as 'X' | 'Y' | 'Z'}`], point[axis], time);
  }
  listener(pose: AudioListenerPose): void {
    const l = this.context.listener, time = this.context.currentTime;
    for (const [prefix, vector] of [['position', pose.point], ['forward', pose.forward], ['up', pose.up]] as const) {
      for (const axis of ['x', 'y', 'z'] as const) smooth(l[`${prefix}${axis.toUpperCase() as 'X' | 'Y' | 'Z'}`], vector[axis], time, 0.015);
    }
  }
  private createVoice(loop: AudioLoop): Voice {
    const context = this.context, gain = context.createGain(); gain.gain.value = 0;
    const source = loop.waveform === 'noise' ? context.createBufferSource() : context.createOscillator();
    let filter: BiquadFilterNode | undefined;
    const nodes: AudioNode[] = [source, gain];
    if ('buffer' in source) {
      source.buffer = this.noise; source.loop = true;
      filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.7;
      filter.frequency.value = loop.frequency; source.connect(filter); filter.connect(gain); nodes.push(filter);
    } else {
      const oscillator = source as OscillatorNode;
      oscillator.type = loop.waveform as OscillatorType; oscillator.frequency.value = loop.frequency; source.connect(gain);
    }
    let panner: PannerNode | undefined;
    if (loop.point) {
      panner = context.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
      panner.refDistance = 3; panner.maxDistance = AUDIO_BUDGET.radius; panner.rolloffFactor = 1.4;
      panner.positionX.value = loop.point.x; panner.positionY.value = loop.point.y; panner.positionZ.value = loop.point.z;
      gain.connect(panner); panner.connect(this.channels[loop.channel]); nodes.push(panner);
    } else gain.connect(this.channels[loop.channel]);
    source.start();
    return { source, gain, filter, panner, waveform: loop.waveform, nodes };
  }
  private stop(voice: Voice, fade: boolean): void {
    const time = this.context.currentTime;
    voice.source.onended = () => { voice.nodes.forEach(node => node.disconnect()); this.shots.delete(voice); this.retiring.delete(voice); };
    if (fade) {
      this.retiring.add(voice);
      voice.gain.gain.cancelAndHoldAtTime(time);
      voice.gain.gain.linearRampToValueAtTime(0, time + 0.04);
      voice.source.stop(time + 0.045);
    } else { voice.source.stop(); voice.nodes.forEach(node => node.disconnect()); }
  }
  update(loops: readonly AudioLoop[], cues: readonly AudioCue[]): void {
    const time = this.context.currentTime, active = new Set(loops.map(l => l.id));
    for (const [id, voice] of this.loops) if (!active.has(id)) { this.stop(voice, true); this.loops.delete(id); }
    for (const loop of loops.slice(0, AUDIO_BUDGET.loops)) {
      let voice = this.loops.get(loop.id);
      if (!voice) {
        if (this.loops.size + this.retiring.size >= AUDIO_BUDGET.loops) continue;
        voice = this.createVoice(loop); this.loops.set(loop.id, voice);
      }
      smooth(voice.gain.gain, loop.gain, time);
      if (voice.filter) smooth(voice.filter.frequency, loop.frequency, time);
      else smooth((voice.source as OscillatorNode).frequency, loop.frequency, time, 0.055);
      if (voice.panner && loop.point) this.position(voice.panner, loop.point);
    }
    for (const cue of cues) {
      if (this.shots.size >= AUDIO_BUDGET.oneShots) break;
      const voice = this.createVoice({ id: '', channel: cue.channel, waveform: cue.kind === 'impact' ? 'noise' : 'sine', frequency: cue.frequency, gain: cue.gain, point: cue.point });
      this.shots.add(voice);
      voice.gain.gain.setValueAtTime(0, time);
      voice.gain.gain.linearRampToValueAtTime(cue.gain, time + 0.004);
      voice.gain.gain.exponentialRampToValueAtTime(0.00001, time + cue.duration);
      voice.source.onended = () => { voice.nodes.forEach(node => node.disconnect()); this.shots.delete(voice); };
      voice.source.stop(time + cue.duration + 0.01);
    }
  }
  clear(): void {
    // Disconnect immediately as well as stopping: suspended contexts must never replay queued tails.
    this.master.gain.cancelScheduledValues(this.context.currentTime); this.master.gain.value = 0;
    for (const voice of [...this.loops.values(), ...this.shots, ...this.retiring]) this.stop(voice, false);
    this.loops.clear(); this.shots.clear(); this.retiring.clear();
  }
  dispose(): void { this.clear(); this.outputNodes.forEach(node => node.disconnect()); }
}

/** No AudioContext is created before an explicit trusted sound-button gesture. */
export class DrivingAudio {
  private context?: AudioContext;
  private output?: AudioOutput;
  private paused = false;
  private generation = 0;
  private failed = false;
  settings: AudioSettings = { ...DEFAULT_AUDIO };
  private createContext: () => AudioContext;
  constructor(createContext: () => AudioContext = () => new AudioContext()) { this.createContext = createContext; }
  get status(): string {
    if (this.failed) return 'Sound unavailable · retry';
    if (this.settings.muted) return 'Sound muted';
    if (!this.context) return 'Enable sound';
    if (this.paused) return 'Sound paused';
    return this.context.state === 'running' ? 'Sound on' : 'Resume sound';
  }
  async activate(): Promise<void> {
    const generation = ++this.generation;
    try {
      if (!this.context) { this.context = this.createContext(); this.output = new AudioOutput(this.context); }
      await this.context.resume();
      if (generation !== this.generation) return;
      if (this.paused || this.settings.muted) { this.output?.clear(); return; }
      this.failed = false;
      // Gain stays at zero until fresh simulation state is provided by update().
    } catch {
      if (generation !== this.generation) return;
      this.failed = true; this.output?.dispose(); this.output = undefined;
      void this.context?.close().catch(() => {}); this.context = undefined;
    }
  }
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused; this.generation++;
    if (paused) {
      this.output?.clear();
      void this.context?.suspend().catch(() => { this.failed = true; });
    } else if (this.context && !this.settings.muted) void this.activate();
  }
  setSettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (settings.muted) { this.generation++; this.output?.clear(); }
    else if (!this.paused) this.output?.settings(settings);
  }
  update(loops: readonly AudioLoop[], cues: readonly AudioCue[], listener: AudioListenerPose): void {
    if (!this.output || this.paused || this.settings.muted || this.context?.state !== 'running') return;
    this.output.settings(this.settings); this.output.listener(listener); this.output.update(loops, cues);
  }
  clear(): void { this.output?.clear(); }
  dispose(): void {
    this.generation++; this.output?.dispose(); this.output = undefined;
    void this.context?.close().catch(() => {}); this.context = undefined;
  }
}
