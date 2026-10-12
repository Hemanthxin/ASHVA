import { save } from './SaveSystem';

export type Mood = 'off' | 'calm' | 'tense' | 'boss' | 'sorrow';
export type Sfx =
  | 'ui' | 'hover' | 'jump' | 'land' | 'slide' | 'swing' | 'swingHeavy' | 'hit' | 'hitHeavy' | 'parry' | 'block'
  | 'hurt' | 'death' | 'dodge' | 'shadow' | 'pickup' | 'checkpoint' | 'alert' | 'telegraph' | 'slam'
  | 'wraith' | 'enemyDie' | 'relic' | 'bell' | 'thud' | 'crumble' | 'whoosh' | 'roar' | 'wallhit' | 'step'
  | 'rope' | 'dart' | 'pop' | 'rumble' | 'ambush' | 'click' | 'rockhit' | 'grab';

/**
 * Fully procedural audio. The score is a composed, looping 8-bar piece in D Hirajoshi (D E F A Bb):
 * a warm sine/triangle pad, a soft koto arpeggio, a breathy shakuhachi-style melody, a deep root note,
 * and occasional temple-bell sparkles. Nothing is loaded from disk and nothing plays before a user
 * gesture has unlocked the AudioContext.
 */

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---- harmony (MIDI note numbers). D=50(D3)  E=52  F=53  A=57  Bb=58
interface Chord {
  pad: number[];
  koto: number[]; // low -> high tones for arpeggios
  bass: number;
}
const DM: Chord = { pad: [50, 57, 62, 65], koto: [50, 57, 62, 65, 69], bass: 38 };
const BB: Chord = { pad: [46, 53, 58, 62], koto: [46, 53, 58, 62, 65], bass: 34 };
const FM: Chord = { pad: [53, 57, 62, 69], koto: [53, 57, 62, 65, 69], bass: 41 };
const DS: Chord = { pad: [50, 57, 64, 69], koto: [50, 57, 62, 64, 69], bass: 38 };

// ---- melody phrases: [bar, step(8th), midi, durationInSteps]
type Note = [number, number, number, number];
const MELODY: Note[] = [
  // phrase 1 (bars 0-3)
  [0, 0, 69, 3], [0, 3, 65, 1], [0, 4, 62, 4],
  [1, 0, 70, 3], [1, 3, 69, 1], [1, 4, 65, 4],
  [2, 0, 65, 2], [2, 2, 69, 2], [2, 4, 74, 4],
  [3, 0, 69, 2], [3, 2, 65, 1], [3, 3, 64, 1], [3, 4, 62, 4],
  // phrase 2 (bars 4-7)
  [4, 0, 74, 2], [4, 2, 69, 2], [4, 4, 65, 4],
  [5, 0, 70, 4], [5, 4, 69, 2], [5, 6, 65, 2],
  [6, 0, 69, 3], [6, 3, 70, 1], [6, 4, 69, 4],
  [7, 0, 65, 2], [7, 2, 64, 2], [7, 4, 62, 4],
];

// koto arpeggio patterns (index into chord.koto, -1 = rest)
const PAT_CALM_A = [0, -1, 2, -1, 3, -1, 1, -1];
const PAT_CALM_B = [0, -1, 1, -1, 3, -1, 4, -1];
const PAT_TENSE = [0, 2, 3, 2, 0, 2, 4, 3];
const PAT_BOSS = [0, 3, 2, 4, 0, 3, 2, 4];

interface MoodDef {
  bpm: number;
  progression: Chord[];
  pad: number; // pad gain
  koto: number; // koto gain (0 = none)
  patterns: number[][];
  flute: number; // flute gain (0 = none)
  bell: number; // chance per 4-bar cycle
  drums: 0 | 1 | 2 | 3;
  bass: number;
}

const MOODS: Record<Exclude<Mood, 'off'>, MoodDef> = {
  calm: { bpm: 60, progression: [DM, BB, FM, DS], pad: 1, koto: 1, patterns: [PAT_CALM_A, PAT_CALM_B], flute: 1, bell: 0.6, drums: 1, bass: 1 },
  sorrow: { bpm: 50, progression: [DM, BB, FM, DS], pad: 1.2, koto: 0.45, patterns: [PAT_CALM_B], flute: 1, bell: 0.8, drums: 0, bass: 1 },
  tense: { bpm: 80, progression: [DM, DM, BB, DS], pad: 0.8, koto: 1.2, patterns: [PAT_TENSE], flute: 0, bell: 0.2, drums: 2, bass: 1.2 },
  boss: { bpm: 92, progression: [DM, BB, DM, DS], pad: 0.9, koto: 1.3, patterns: [PAT_BOSS], flute: 0.5, bell: 0, drums: 3, bass: 1.4 },
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
  private rainNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private duck = 1;
  private lastSfx: Record<string, number> = {};
  private analyser: AnalyserNode | null = null;
  private pendingRain = 0;
  private rainLevel = 0;

  constructor() {
    save.onSettings(() => {
      this.applyVolumes();
      this.updateRain();
    });
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

  /** Debug helper: RMS level of the master output (0..1). */
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
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

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

    // Soft, dark generated reverb tail.
    const irLen = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.35; // low-pass the noise so the tail is warm, not hissy
        d[i] = lp * Math.pow(1 - i / irLen, 2.4);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.6;
    this.reverbSend.connect(this.reverb);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
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
    this.musicBus.gain.setTargetAtTime(s.music * 0.8 * this.duck, t, 0.15);
    this.sfxBus.gain.setTargetAtTime(s.sfx * 1.35, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.sfx * 0.7, t, 0.2);
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
    if (m === 'off') this.stopMusicLoop();
    else this.startMusicLoop();
  }

  private startMusicLoop() {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'off') return;
    if (this.timer === null) {
      this.nextTime = ctx.currentTime + 0.2;
      this.step = 0;
      this.bar = 0;
      this.timer = window.setInterval(() => this.tick(), 90);
    }
  }

  private stopMusicLoop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'off' || ctx.state !== 'running') return;
    const def = MOODS[this.mood as Exclude<Mood, 'off'>];
    const stepDur = 60 / def.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.4) {
      this.playStep(this.nextTime, def, this.step % 8, this.bar, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 8 === 0) this.bar++;
    }
  }

  private playStep(t: number, def: MoodDef, s: number, bar: number, stepDur: number) {
    const chord = def.progression[bar % def.progression.length];
    const barDur = stepDur * 8;
    const cycleBar = bar % 8;

    if (s === 0) {
      // Pad + root note once per bar.
      if (def.pad > 0) this.padChord(t, chord, barDur, 0.03 * def.pad);
      if (def.bass > 0) this.bassNote(t, chord.bass, barDur, 0.07 * def.bass);
      // Temple bell sparkle at the start of some 4-bar cycles.
      if (def.bell > 0 && bar % 4 === 0 && ((bar * 7919) % 100) / 100 < def.bell) this.bell(t + stepDur * 2, 86 - ((bar >> 2) % 2) * 5, 0.05);
    }

    // Koto arpeggio, with a fixed (not random) pattern so the ear can follow it.
    if (def.koto > 0) {
      const pat = def.patterns[Math.floor(bar / 2) % def.patterns.length];
      const idx = pat[s];
      if (idx >= 0) {
        const accent = s === 0 ? 1.25 : s % 4 === 0 ? 1 : 0.8;
        this.pluck(t, chord.koto[idx], 0.1 * def.koto * accent, def.drums >= 2 ? 0.9 : 1.6);
      }
    }

    // Shakuhachi-style melody from the composed phrase table.
    if (def.flute > 0) {
      for (const n of MELODY) {
        if (n[0] === cycleBar && n[1] === s) this.flute(t, n[2], n[3] * stepDur, 0.07 * def.flute);
      }
    }

    // Percussion.
    if (def.drums === 1) {
      if (s === 0 && bar % 4 === 0) this.taiko(t, 0.25);
    } else if (def.drums === 2) {
      if (s === 0) this.taiko(t, 0.55);
      if (s === 4) this.taiko(t, 0.3);
      if (s % 2 === 1) this.tick1(t, 0.035);
    } else if (def.drums === 3) {
      if (s === 0 || s === 4) this.taiko(t, 0.75);
      if (s === 6) this.taiko(t, 0.4);
      if (s % 2 === 1) this.tick1(t, 0.05);
    }
  }

  // ----- instruments -------------------------------------------------------
  private padChord(t: number, chord: Chord, dur: number, vol: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(1.4, dur * 0.35));
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.4;
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    const end = t + dur + 1.7;
    for (const m of chord.pad) {
      for (const [type, det, k] of [['sine', -4, 1], ['triangle', 5, 0.5]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = k;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
  }

  private bassNote(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.6);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.7);
  }

  private pluck(t: number, midi: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const f = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2600, t);
    filt.frequency.exponentialRampToValueAtTime(700, t + dur * 0.7);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(f * 1.008, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
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

  private flute(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const f = midiHz(midi);
    const g = ctx.createGain();
    const att = Math.min(0.18, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol * 0.9, t + Math.max(att, dur * 0.75));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.8;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(6, t + Math.min(0.8, dur * 0.8)); // vibrato blooms after the attack
    vib.connect(vg).connect(o.detune);
    // a little breath noise
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2.2;
    bp.Q.value = 5;
    const ng = ctx.createGain();
    ng.gain.value = 0.09;
    n.connect(bp).connect(ng).connect(lp);
    o.connect(lp);
    // second, quieter partial for body
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o2.connect(g2).connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    const end = t + dur + 0.5;
    for (const x of [o, o2, vib, n]) {
      x.start(t);
      x.stop(end);
    }
  }

  private bell(t: number, midi: number, vol: number) {
    const ctx = this.ctx!;
    const f = midiHz(midi);
    for (const [mult, v, d] of [[1, 1, 3.2], [2.76, 0.35, 1.8], [5.4, 0.12, 0.9]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0004, t + d);
      o.connect(g);
      g.connect(this.musicBus);
      g.connect(this.reverbSend);
      o.start(t);
      o.stop(t + d + 0.1);
    }
  }

  private taiko(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.85);
  }

  private tick1(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.06);
  }

  // ---------------------------------------------------------------- ambience
  /** level 0..1 (0 = off). The rain is a very soft, low-passed bed - never a hiss. */
  setRain(on: boolean, level = 1) {
    this.rainLevel = on ? level : 0;
    if (!this.ctx) {
      this.pendingRain = this.rainLevel;
      return;
    }
    this.updateRain();
  }

  private updateRain() {
    const ctx = this.ctx;
    if (!ctx) return;
    const pref = save.settings.rain === 'off' ? 0 : save.settings.rain === 'light' ? 0.45 : 1;
    const level = this.rainLevel * pref;
    if (level > 0.001) {
      if (!this.rainNode) {
        const src = ctx.createBufferSource();
        src.buffer = this.brownBuf; // brown noise = soft rumble rather than white hiss
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 350;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(hp).connect(lp).connect(g).connect(this.ambBus);
        src.start();
        this.rainNode = { src, gain: g };
      }
      this.rainNode.gain.gain.setTargetAtTime(0.05 * level, ctx.currentTime, 0.8);
    } else if (this.rainNode) {
      const r = this.rainNode;
      r.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      window.setTimeout(() => r.src.stop(), 2500);
      this.rainNode = null;
    }
  }

  /** Call after unlock() to start anything requested earlier. */
  flushPending() {
    if (this.ctx && this.pendingRain > 0) {
      this.rainLevel = this.pendingRain;
      this.pendingRain = 0;
      this.updateRain();
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
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.2);
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
    const minGap = name === 'step' ? 0.1 : name === 'rope' ? 0.12 : 0.035;
    if (this.lastSfx[name] !== undefined && now - this.lastSfx[name] < minGap) return;
    this.lastSfx[name] = now;
    const t = now + 0.005;
    switch (name) {
      case 'ui': this.tone(t, 'triangle', 660 * pitch, 880 * pitch, 0.12, 0.2); this.tone(t, 'sine', 1320 * pitch, 1320 * pitch, 0.16, 0.06, 0.004, true); break;
      case 'hover': this.tone(t, 'sine', 520, 560, 0.05, 0.06); break;
      case 'click': this.tone(t, 'square', 300, 180, 0.05, 0.12); break;
      case 'jump': this.noise(t, 0.2, 'bandpass', 500, 1700, 0.2, 1.2, 0.02); this.tone(t, 'sine', 220, 380, 0.14, 0.12); break;
      case 'land': this.noise(t, 0.16, 'lowpass', 700, 120, 0.4); this.tone(t, 'sine', 100, 48, 0.16, 0.38); break;
      case 'slide': this.noise(t, 0.45, 'bandpass', 1500, 450, 0.18, 0.8, 0.05); break;
      case 'step': this.noise(t, 0.05, 'lowpass', 800 * pitch, 300, 0.1); this.tone(t, 'sine', 120 * pitch, 70, 0.05, 0.08); break;
      case 'swing': this.noise(t, 0.2, 'bandpass', 900 * pitch, 3200 * pitch, 0.3, 1.5, 0.03); this.tone(t, 'sawtooth', 320, 140, 0.12, 0.05); break;
      case 'swingHeavy': this.noise(t, 0.34, 'bandpass', 500, 2400, 0.42, 1.2, 0.08); this.tone(t, 'sine', 150, 70, 0.3, 0.22); break;
      case 'hit':
        this.noise(t, 0.1, 'highpass', 1800, 900, 0.5);
        this.tone(t, 'sine', 200 * pitch, 60, 0.14, 0.5);
        this.tone(t, 'square', 760, 380, 0.05, 0.1);
        break;
      case 'hitHeavy':
        this.noise(t, 0.22, 'lowpass', 2800, 200, 0.7);
        this.tone(t, 'sine', 130, 38, 0.34, 0.8);
        this.tone(t, 'square', 600, 200, 0.08, 0.14);
        break;
      case 'parry':
        this.tone(t, 'triangle', 2200, 2100, 0.6, 0.34, 0.001, true);
        this.tone(t, 'square', 3300, 3250, 0.22, 0.1, 0.001);
        this.tone(t, 'sine', 1100, 1090, 0.5, 0.2, 0.001, true);
        this.noise(t, 0.1, 'highpass', 4000, 3000, 0.35);
        break;
      case 'block': this.tone(t, 'square', 600, 300, 0.12, 0.18); this.noise(t, 0.1, 'bandpass', 2000, 1000, 0.3); this.tone(t, 'sine', 140, 80, 0.12, 0.3); break;
      case 'hurt': this.tone(t, 'sawtooth', 260, 110, 0.28, 0.32); this.noise(t, 0.18, 'lowpass', 1800, 300, 0.5); break;
      case 'death': this.tone(t, 'sawtooth', 200, 40, 1.3, 0.4, 0.01, true); this.noise(t, 1.0, 'lowpass', 1200, 80, 0.5); break;
      case 'dodge': this.noise(t, 0.24, 'bandpass', 700, 2600, 0.24, 1, 0.03); this.tone(t, 'sine', 300, 150, 0.16, 0.1); break;
      case 'shadow':
        this.tone(t, 'sawtooth', 90, 700, 0.2, 0.18, 0.01);
        this.tone(t + 0.12, 'sine', 700, 70, 0.45, 0.34, 0.005, true);
        this.noise(t, 0.4, 'bandpass', 300, 3000, 0.3, 2, 0.08);
        break;
      case 'pickup':
        this.tone(t, 'triangle', 880, 880, 0.4, 0.3, 0.004, true);
        this.tone(t + 0.08, 'triangle', 1318, 1318, 0.55, 0.26, 0.004, true);
        break;
      case 'grab': this.noise(t, 0.08, 'bandpass', 1200, 700, 0.2); this.tone(t, 'sine', 180, 120, 0.08, 0.18); break;
      case 'relic':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.1, 'triangle', 440 * Math.pow(1.5, i * 0.5), 440 * Math.pow(1.5, i * 0.5), 1.3, 0.26, 0.01, true);
        break;
      case 'checkpoint':
        this.tone(t, 'sine', 523, 523, 1.7, 0.3, 0.005, true);
        this.tone(t, 'sine', 1046, 1046, 1.3, 0.14, 0.005, true);
        this.tone(t + 0.15, 'sine', 784, 784, 1.7, 0.24, 0.005, true);
        break;
      case 'bell':
        this.tone(t, 'sine', 220, 220, 3, 0.5, 0.003, true);
        this.tone(t, 'sine', 553, 553, 2.2, 0.26, 0.003, true);
        this.tone(t, 'sine', 912, 912, 1.4, 0.14, 0.003, true);
        break;
      case 'alert': this.tone(t, 'square', 520, 780, 0.14, 0.16); this.tone(t + 0.1, 'square', 780, 1040, 0.12, 0.12); break;
      case 'telegraph': this.tone(t, 'sawtooth', 120, 320, 0.45, 0.14, 0.05); this.noise(t, 0.4, 'bandpass', 600, 1800, 0.12, 2, 0.1); break;
      case 'slam': this.tone(t, 'sine', 90, 28, 0.8, 0.9); this.noise(t, 0.6, 'lowpass', 1400, 80, 0.8); break;
      case 'wraith': this.tone(t, 'sine', 300, 180, 0.55, 0.16, 0.1, true); this.noise(t, 0.45, 'bandpass', 800, 300, 0.14, 3, 0.1); break;
      case 'enemyDie': this.noise(t, 0.55, 'lowpass', 1500, 100, 0.5); this.tone(t, 'sawtooth', 180, 50, 0.55, 0.26); break;
      case 'thud': this.tone(t, 'sine', 80, 40, 0.24, 0.55); this.noise(t, 0.1, 'lowpass', 400, 100, 0.2); break;
      case 'crumble': this.noise(t, 0.8, 'lowpass', 1000, 100, 0.6, 1, 0.02); this.tone(t, 'sine', 70, 40, 0.5, 0.3); break;
      case 'whoosh': this.noise(t, 0.45, 'bandpass', 400, 2000, 0.26, 1, 0.12); break;
      case 'roar': this.tone(t, 'sawtooth', 70, 45, 1.3, 0.55, 0.05, true); this.noise(t, 1.2, 'bandpass', 300, 120, 0.5, 2, 0.1); break;
      case 'wallhit': this.noise(t, 0.08, 'lowpass', 900, 300, 0.2); break;
      case 'rope': this.noise(t, 0.09, 'bandpass', 1800, 1100, 0.14, 2); this.tone(t, 'triangle', 140, 110, 0.07, 0.07); break;
      case 'dart': this.noise(t, 0.14, 'highpass', 3000, 5000, 0.3); this.tone(t, 'sawtooth', 900, 1800, 0.12, 0.1); break;
      case 'pop': this.tone(t, 'square', 200, 90, 0.1, 0.3); this.noise(t, 0.12, 'bandpass', 1500, 500, 0.4); this.tone(t, 'sine', 1200, 600, 0.08, 0.14); break;
      case 'rumble': this.noise(t, 0.7, 'lowpass', 300, 60, 0.55, 1, 0.1); this.tone(t, 'sine', 60, 38, 0.7, 0.4, 0.1); break;
      case 'rockhit': this.noise(t, 0.35, 'lowpass', 1800, 150, 0.8); this.tone(t, 'sine', 100, 34, 0.5, 0.8); break;
      case 'ambush': this.tone(t, 'sawtooth', 140, 520, 0.4, 0.26, 0.02, true); this.noise(t, 0.5, 'bandpass', 500, 2500, 0.34, 2, 0.05); this.tone(t + 0.1, 'sine', 90, 45, 0.5, 0.5); break;
    }
  }
}

export const audio = new AudioImpl();
