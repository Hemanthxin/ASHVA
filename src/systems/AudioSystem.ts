import { save } from './SaveSystem';

export type Mood = 'off' | 'calm' | 'tense' | 'boss' | 'sorrow';
export type Sfx =
  | 'ui' | 'jump' | 'land' | 'slide' | 'swing' | 'swingHeavy' | 'hit' | 'hitHeavy' | 'parry' | 'block'
  | 'hurt' | 'death' | 'dodge' | 'shadow' | 'pickup' | 'checkpoint' | 'alert' | 'telegraph' | 'slam'
  | 'wraith' | 'enemyDie' | 'relic' | 'bell' | 'thud' | 'crumble' | 'whoosh' | 'roar' | 'wallhit' | 'step';

/**
 * Fully procedural audio: a calm, pentatonic "shadow-garden" score (koto plucks, breathy flute,
 * soft taiko and a low drone) plus synthesized effects. Nothing is loaded from disk, and nothing
 * plays until a user gesture has unlocked the AudioContext.
 */

// Hirajoshi-flavoured pentatonic (semitones above the root).
const SCALE = [0, 2, 3, 7, 8];
const ROOT_MIDI = 50; // D3

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const degToMidi = (deg: number) => ROOT_MIDI + SCALE[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5);

interface MoodDef {
  bpm: number; // 8th-note = bpm*2 per minute
  pluckProb: number;
  fluteProb: number;
  drums: 0 | 1 | 2; // 0 none, 1 soft, 2 driving
  progression: number[]; // chord root degrees, one per bar
  droneGain: number;
  pluckOct: number;
}

const MOODS: Record<Exclude<Mood, 'off'>, MoodDef> = {
  calm: { bpm: 58, pluckProb: 0.5, fluteProb: 0.55, drums: 1, progression: [0, 3, 2, 3], droneGain: 0.5, pluckOct: 1 },
  sorrow: { bpm: 50, pluckProb: 0.32, fluteProb: 0.7, drums: 0, progression: [0, 2, 3, 0], droneGain: 0.6, pluckOct: 1 },
  tense: { bpm: 84, pluckProb: 0.72, fluteProb: 0.25, drums: 2, progression: [0, 0, 4, 3], droneGain: 0.7, pluckOct: 1 },
  boss: { bpm: 96, pluckProb: 0.8, fluteProb: 0.15, drums: 2, progression: [0, 2, 0, 4], droneGain: 0.9, pluckOct: 0 },
};

class AudioImpl {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;

  private mood: Mood = 'off';
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private drone: { nodes: AudioNode[]; gain: GainNode } | null = null;
  private rainNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private duck = 1;
  private lastSfx: Record<string, number> = {};

  constructor() {
    save.onSettings(() => this.applyVolumes());
  }

  /** Must be called from a user gesture (click / tap / key). Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      this.flushPending();
    } catch {
      this.ctx = null; // audio unsupported - game stays playable
    }
  }

  /** Debug helper: RMS level of the master output (0..1) - proves sound is being produced. */
  debugLevel(): number {
    if (!this.ctx) return -1;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    return Math.sqrt(s / buf.length);
  }
  private analyser: AnalyserNode | null = null;

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private build() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

    // Noise buffers.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }

    // Cheap generated reverb impulse.
    const irLen = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.musicBus);

    this.applyVolumes();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    if (this.mood !== 'off') this.startMusicLoop();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = save.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.85 * this.duck, t, 0.15);
    this.sfxBus.gain.setTargetAtTime(s.sfx * 0.8, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.sfx * 0.5, t, 0.2);
  }

  /** Lower the music (e.g. while paused). */
  setDuck(v: number) {
    this.duck = v;
    this.applyVolumes();
  }

  // ------------------------------------------------------------------ music
  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    if (!this.ctx) return;
    if (m === 'off') {
      this.stopMusicLoop();
      return;
    }
    this.startMusicLoop();
  }

  private startMusicLoop() {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'off') return;
    if (this.timer === null) {
      this.nextTime = ctx.currentTime + 0.15;
      this.step = 0;
      this.bar = 0;
      this.timer = window.setInterval(() => this.tick(), 90);
    }
    this.ensureDrone();
  }

  private stopMusicLoop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.drone && this.ctx) {
      const d = this.drone;
      d.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
      window.setTimeout(() => d.nodes.forEach((n) => (n as any).stop?.()), 2500);
      this.drone = null;
    }
  }

  private ensureDrone() {
    const ctx = this.ctx!;
    const def = MOODS[this.mood as Exclude<Mood, 'off'>];
    if (this.drone) {
      this.drone.gain.gain.setTargetAtTime(0.05 * def.droneGain, ctx.currentTime, 1.2);
      return;
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05 * def.droneGain, ctx.currentTime, 1.5);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(filt.frequency);
    const nodes: AudioNode[] = [lfo];
    for (const [mult, type, det] of [[0.5, 'sawtooth', -6], [0.5, 'sawtooth', 7], [0.75, 'sine', 0]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(ROOT_MIDI) * mult;
      o.detune.value = det;
      o.connect(filt);
      o.start();
      nodes.push(o);
    }
    lfo.start();
    filt.connect(g).connect(this.musicBus);
    g.connect(this.reverbSend);
    this.drone = { nodes, gain: g };
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'off' || ctx.state !== 'running') return;
    const def = MOODS[this.mood as Exclude<Mood, 'off'>];
    const stepDur = 60 / def.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.35) {
      this.playStep(this.nextTime, def, this.step % 8, this.bar);
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 8 === 0) this.bar++;
    }
    this.ensureDrone();
  }

  private playStep(t: number, def: MoodDef, s: number, bar: number) {
    const rootDeg = def.progression[bar % def.progression.length];
    const tones = [rootDeg, rootDeg + 2, rootDeg + 3, rootDeg + 5, rootDeg + 7];
    // Koto arpeggio: strong root on 0, scattered chord tones elsewhere.
    if (s === 0) this.pluck(t, degToMidi(rootDeg - 5 + (def.pluckOct ? 0 : -5)) + 12, 0.34, 2.2);
    else if (Math.random() < def.pluckProb * (s % 2 === 0 ? 1 : 0.6)) {
      const deg = tones[Math.floor(Math.random() * tones.length)] + 5 * def.pluckOct;
      this.pluck(t, degToMidi(deg), 0.16 + Math.random() * 0.08, 1.4);
    }
    // Flute phrase every other bar.
    if (s === 0 && bar % 2 === 1 && Math.random() < def.fluteProb) {
      const start = rootDeg + 5 + Math.floor(Math.random() * 3);
      const stepDur = 60 / def.bpm / 2;
      const seq = [0, 1, -1, 2, 0, -2].slice(0, 3 + Math.floor(Math.random() * 3));
      let tt = t + stepDur * 1;
      for (let i = 0; i < seq.length; i++) {
        const len = stepDur * (i === seq.length - 1 ? 4 : 2 + (i % 2));
        this.flute(tt, degToMidi(start + seq[i]), len);
        tt += len;
      }
    }
    // Percussion.
    if (def.drums === 1) {
      if (s === 0 && bar % 2 === 0) this.taiko(t, 0.35);
    } else if (def.drums === 2) {
      if (s === 0) this.taiko(t, 0.7);
      if (s === 4) this.taiko(t, 0.45);
      if (s === 6 && bar % 2 === 1) this.taiko(t, 0.3);
      if (s % 2 === 1) this.tick1(t, 0.07);
    }
  }

  private pluck(t: number, midi: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const f = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(4200, t);
    filt.frequency.exponentialRampToValueAtTime(900, t + dur * 0.6);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(f * 1.012, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.28;
    o1.connect(filt);
    o2.connect(g2).connect(filt);
    filt.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  private flute(t: number, midi: number, dur: number) {
    const ctx = this.ctx!;
    const f = midiHz(midi + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + Math.min(0.25, dur * 0.4));
    g.gain.setValueAtTime(0.075, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.5);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.value = 7;
    vib.connect(vg).connect(o.detune);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 6;
    const ng = ctx.createGain();
    ng.gain.value = 0.22;
    n.connect(bp).connect(ng).connect(g);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    o.start(t);
    vib.start(t);
    n.start(t);
    const end = t + dur + 0.6;
    o.stop(end);
    vib.stop(end);
    n.stop(end);
  }

  private taiko(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.75);
  }

  private tick1(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.05);
  }

  // ---------------------------------------------------------------- ambience
  setRain(on: boolean, level = 1) {
    const ctx = this.ctx;
    if (!ctx) {
      this.pendingRain = on ? level : 0;
      return;
    }
    if (on) {
      if (!this.rainNode) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 900;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(hp).connect(lp).connect(g).connect(this.ambBus);
        src.start();
        this.rainNode = { src, gain: g };
      }
      this.rainNode.gain.gain.setTargetAtTime(0.16 * level, ctx.currentTime, 0.8);
    } else if (this.rainNode) {
      const r = this.rainNode;
      r.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      window.setTimeout(() => r.src.stop(), 2500);
      this.rainNode = null;
    }
  }
  private pendingRain = 0;

  /** Call after unlock() to start anything requested earlier. */
  flushPending() {
    if (this.ctx && this.pendingRain > 0) {
      this.setRain(true, this.pendingRain);
      this.pendingRain = 0;
    }
  }

  thunder(delay = 0.4) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 4);
    src.connect(lp).connect(g).connect(this.ambBus);
    src.start(t);
    src.stop(t + 4.2);
  }

  // --------------------------------------------------------------------- sfx
  private noise(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1, attack = 0.005) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(filt).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, attack = 0.004, rev = false) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfxBus);
    if (rev) g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  sfx(name: Sfx, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Rate-limit identical effects so rapid events never stack into noise.
    const minGap = name === 'step' ? 0.1 : 0.035;
    if (this.lastSfx[name] !== undefined && now - this.lastSfx[name] < minGap) return;
    this.lastSfx[name] = now;
    const t = now + 0.005;
    switch (name) {
      case 'ui': this.tone(t, 'triangle', 660 * pitch, 880 * pitch, 0.09, 0.12); break;
      case 'jump': this.noise(t, 0.16, 'bandpass', 500, 1500, 0.1, 1.2, 0.02); break;
      case 'land': this.noise(t, 0.12, 'lowpass', 500, 120, 0.22); this.tone(t, 'sine', 90, 50, 0.12, 0.2); break;
      case 'slide': this.noise(t, 0.4, 'bandpass', 1400, 500, 0.08, 0.8, 0.05); break;
      case 'step': this.noise(t, 0.04, 'lowpass', 700 * pitch, 300, 0.045); break;
      case 'swing': this.noise(t, 0.16, 'bandpass', 900 * pitch, 2800 * pitch, 0.16, 1.5, 0.03); break;
      case 'swingHeavy': this.noise(t, 0.3, 'bandpass', 500, 2200, 0.24, 1.2, 0.08); this.tone(t, 'sine', 140, 70, 0.28, 0.12); break;
      case 'hit': this.noise(t, 0.09, 'highpass', 1800, 900, 0.3); this.tone(t, 'sine', 180 * pitch, 60, 0.12, 0.3); break;
      case 'hitHeavy': this.noise(t, 0.18, 'lowpass', 2500, 200, 0.45); this.tone(t, 'sine', 120, 38, 0.3, 0.5); break;
      case 'parry':
        this.tone(t, 'triangle', 2200, 2100, 0.5, 0.2, 0.001, true);
        this.tone(t, 'square', 3300, 3250, 0.2, 0.06, 0.001);
        this.noise(t, 0.08, 'highpass', 4000, 3000, 0.2);
        break;
      case 'block': this.tone(t, 'square', 600, 300, 0.1, 0.1); this.noise(t, 0.08, 'bandpass', 2000, 1000, 0.16); break;
      case 'hurt': this.tone(t, 'sawtooth', 260, 110, 0.25, 0.2); this.noise(t, 0.15, 'lowpass', 1800, 300, 0.3); break;
      case 'death': this.tone(t, 'sawtooth', 200, 40, 1.2, 0.25, 0.01, true); this.noise(t, 0.9, 'lowpass', 1200, 80, 0.3); break;
      case 'dodge': this.noise(t, 0.2, 'bandpass', 700, 2500, 0.12, 1, 0.03); break;
      case 'shadow':
        this.tone(t, 'sawtooth', 90, 700, 0.18, 0.1, 0.01);
        this.tone(t + 0.12, 'sine', 700, 70, 0.4, 0.2, 0.005, true);
        this.noise(t, 0.35, 'bandpass', 300, 3000, 0.16, 2, 0.08);
        break;
      case 'pickup':
        this.tone(t, 'triangle', 880, 880, 0.35, 0.16, 0.004, true);
        this.tone(t + 0.08, 'triangle', 1318, 1318, 0.5, 0.14, 0.004, true);
        break;
      case 'relic':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.1, 'triangle', 440 * Math.pow(1.5, i * 0.5), 440 * Math.pow(1.5, i * 0.5), 1.2, 0.14, 0.01, true);
        break;
      case 'checkpoint':
        this.tone(t, 'sine', 523, 523, 1.6, 0.18, 0.005, true);
        this.tone(t, 'sine', 1046, 1046, 1.2, 0.08, 0.005, true);
        this.tone(t + 0.15, 'sine', 784, 784, 1.6, 0.14, 0.005, true);
        break;
      case 'bell':
        this.tone(t, 'sine', 220, 220, 3, 0.3, 0.003, true);
        this.tone(t, 'sine', 553, 553, 2.2, 0.15, 0.003, true);
        this.tone(t, 'sine', 912, 912, 1.4, 0.08, 0.003, true);
        break;
      case 'alert': this.tone(t, 'square', 520, 780, 0.12, 0.09); break;
      case 'telegraph': this.tone(t, 'sawtooth', 120, 300, 0.4, 0.07, 0.05); break;
      case 'slam': this.tone(t, 'sine', 90, 28, 0.7, 0.6); this.noise(t, 0.5, 'lowpass', 1200, 80, 0.5); break;
      case 'wraith': this.tone(t, 'sine', 300, 180, 0.5, 0.08, 0.1, true); this.noise(t, 0.4, 'bandpass', 800, 300, 0.06, 3, 0.1); break;
      case 'enemyDie': this.noise(t, 0.5, 'lowpass', 1500, 100, 0.3); this.tone(t, 'sawtooth', 180, 50, 0.5, 0.15); break;
      case 'thud': this.tone(t, 'sine', 80, 40, 0.2, 0.35); break;
      case 'crumble': this.noise(t, 0.7, 'lowpass', 900, 100, 0.35, 1, 0.02); break;
      case 'whoosh': this.noise(t, 0.4, 'bandpass', 400, 2000, 0.14, 1, 0.12); break;
      case 'roar': this.tone(t, 'sawtooth', 70, 45, 1.2, 0.35, 0.05, true); this.noise(t, 1.1, 'bandpass', 300, 120, 0.3, 2, 0.1); break;
      case 'wallhit': this.noise(t, 0.06, 'lowpass', 900, 300, 0.1); break;
    }
  }
}

export const audio = new AudioImpl();
