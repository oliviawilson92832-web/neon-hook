/**
 * Fully synthesized audio (no assets): SFX + a small synthwave sequencer.
 */
type MusicMode = 'off' | 'menu' | 'game' | 'paused' | 'over';

const BPM = 124;
const STEP = 60 / BPM / 4;
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [
  { root: 45, arp: [69, 72, 76, 81] }, // Am
  { root: 41, arp: [65, 69, 72, 77] }, // F
  { root: 48, arp: [64, 67, 72, 76] }, // C
  { root: 43, arp: [67, 71, 74, 79] }, // G
];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 2, 1, 3, 2, 3, 1, 2];
const PENTA = [0, 2, 4, 7, 9];

interface ToneOpts {
  slide?: number;
  delay?: number;
  attack?: number;
  dest?: AudioNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private mode: MusicMode = 'off';
  private intensity = 0;
  sfxOn = true;
  musicOn = true;
  /** Forced silence imposed from outside (video ads) — independent of user settings. */
  private ducked = false;

  unlock() {
    if (this.ducked) return; // never resume audio underneath a playing ad
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  /**
   * CrazyGames requires the game to be silent while a video ad plays.
   * Ramps the master bus to zero and suspends the context entirely.
   */
  setDucked(on: boolean) {
    this.ducked = on;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 0.0001 : 0.85, t, 0.015);
      if (on) {
        window.setTimeout(() => {
          if (this.ducked && this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
        }, 120);
      } else if (ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {
      /* ignore */
    }
  }

  destroy() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }

  private init() {
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
    this.sfxBus.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2800;
    this.musicFilter.Q.value = 0.8;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.42 : 0;
    this.musicFilter.connect(this.musicBus);
    this.musicBus.connect(this.master);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(this.musicFilter);

    const len = Math.floor(ctx.sampleRate * 1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  // ───────────────────────── settings ─────────────────────────
  setSfx(on: boolean) {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.05);
  }

  setMode(mode: MusicMode) {
    this.mode = mode;
    const ctx = this.ctx;
    if (!ctx) return;
    const f = this.musicFilter.frequency;
    const t = ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(mode === 'game' ? 16000 : mode === 'paused' ? 520 : mode === 'over' ? 900 : 2800, t, 0.12);
  }

  setIntensity(v: number) {
    this.intensity = v;
  }

  // ───────────────────────── primitives ─────────────────────────
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, o: ToneOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t0 + dur);
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.dest ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noiseHit(dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, slide = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
  }

  // ───────────────────────── SFX ─────────────────────────
  shoot() {
    this.tone(1400, 0.06, 'square', 0.05, { slide: 2600 });
    this.noiseHit(0.05, 0.12, 'highpass', 5000);
  }
  attach() {
    this.tone(260, 0.1, 'triangle', 0.32, { slide: 110 });
    this.noiseHit(0.045, 0.25, 'bandpass', 2600, 2);
  }
  miss() {
    this.tone(520, 0.14, 'sawtooth', 0.05, { slide: 180 });
  }
  release(speed: number) {
    const v = Math.min(1, speed / 1600);
    this.noiseHit(0.22, 0.1 + v * 0.14, 'bandpass', 500, 1.4, 1800 + v * 1400);
  }
  perfect() {
    this.tone(1318, 0.09, 'sine', 0.12);
    this.tone(1976, 0.14, 'sine', 0.1, { delay: 0.045 });
  }
  gem(streak: number) {
    const i = Math.min(streak - 1, 12);
    const m = 76 + PENTA[i % 5] + 12 * Math.floor(i / 5);
    const f = midi(m);
    this.tone(f, 0.16, 'triangle', 0.2);
    this.tone(f * 2, 0.09, 'sine', 0.08, { delay: 0.01 });
  }
  prism() {
    [0, 4, 7, 12].forEach((s, k) => this.tone(midi(84 + s), 0.18, 'triangle', 0.16, { delay: k * 0.045 }));
  }
  nearMiss() {
    this.noiseHit(0.16, 0.22, 'highpass', 2500, 1, 7000);
    this.tone(1600, 0.1, 'sine', 0.1, { slide: 2800 });
  }
  multUp(m: number) {
    const base = 67 + Math.min(m, 8) * 2;
    [0, 4, 7].forEach((s, k) => this.tone(midi(base + s), 0.1, 'square', 0.06, { delay: k * 0.05 }));
  }
  comboLost() {
    this.tone(330, 0.2, 'triangle', 0.08, { slide: 160 });
  }
  overdrive() {
    this.noiseHit(0.8, 0.18, 'bandpass', 300, 2, 6000);
    [0, 7, 12, 16, 19, 24].forEach((s, k) => this.tone(midi(64 + s), 0.3, 'sawtooth', 0.05, { delay: k * 0.06 }));
  }
  overdriveEnd() {
    this.tone(700, 0.35, 'sawtooth', 0.05, { slide: 200 });
  }
  smash() {
    this.noiseHit(0.3, 0.4, 'lowpass', 3500, 1, 300);
    this.tone(160, 0.25, 'sine', 0.4, { slide: 50 });
  }
  bounce() {
    this.tone(180, 0.2, 'sine', 0.3, { slide: 620 });
  }
  milestone() {
    this.tone(midi(88), 0.4, 'sine', 0.12);
    this.tone(midi(95), 0.5, 'sine', 0.09, { delay: 0.08 });
  }
  death() {
    this.noiseHit(0.9, 0.55, 'lowpass', 4000, 0.7, 80);
    this.tone(220, 0.7, 'sawtooth', 0.22, { slide: 35 });
    this.tone(90, 0.5, 'sine', 0.5, { slide: 30 });
  }
  click() {
    this.tone(1200, 0.035, 'square', 0.04);
  }
  countdown(final: boolean) {
    this.tone(final ? 1320 : 880, final ? 0.22 : 0.1, 'square', 0.07);
  }
  launch() {
    this.noiseHit(0.35, 0.25, 'bandpass', 300, 1.2, 3000);
    this.tone(200, 0.3, 'sawtooth', 0.08, { slide: 900 });
  }

  // ───────────────────────── music ─────────────────────────
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.mode === 'off' || !this.musicOn || ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 64;
      this.nextTime += STEP;
    }
  }

  private playStep(step: number, t: number) {
    const chord = CHORDS[(step >> 4) & 3];
    const s = step & 15;
    const drums = this.mode === 'game';
    if (s % 2 === 0) this.mBass(midi(chord.root + (s % 4 === 2 ? 12 : 0)), t);
    if (drums && s % 4 === 0) this.mKick(t);
    if (drums && (s === 4 || s === 12)) this.mSnare(t);
    if (drums && s % 2 === 1) this.mHat(t, s % 4 === 3 ? 0.06 : 0.035);
    if (s % 2 === 0 || this.intensity > 0 || this.mode === 'menu') {
      const note = chord.arp[ARP[s]] + (this.intensity > 0 && s % 4 === 1 ? 12 : 0);
      this.mArp(midi(note), t, this.mode === 'menu' ? 0.035 : 0.03);
    }
    if (s === 0) this.mPad(chord.arp, t);
  }

  private mBass(f: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(1100, t);
    flt.frequency.exponentialRampToValueAtTime(220, t + STEP * 1.6);
    flt.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 1.8);
    o.connect(flt);
    flt.connect(g);
    g.connect(this.musicFilter);
    o.start(t);
    o.stop(t + STEP * 2);
  }

  private mKick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(this.musicFilter);
    o.start(t);
    o.stop(t + 0.3);
  }

  private mNoise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicFilter);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private mSnare(t: number) {
    this.mNoise(t, 0.16, 0.3, 'bandpass', 1900);
  }
  private mHat(t: number, vol: number) {
    this.mNoise(t, 0.045, vol, 'highpass', 8000);
  }

  private mArp(f: number, t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = this.intensity > 0 ? 5200 : 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 0.9);
    o.connect(flt);
    flt.connect(g);
    g.connect(this.musicFilter);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + STEP);
  }

  private mPad(notes: number[], t: number) {
    const ctx = this.ctx!;
    const dur = STEP * 16;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 900;
    const g = ctx.createGain();
    const vol = this.mode === 'game' ? 0.018 : 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.5);
    g.gain.setValueAtTime(vol, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    flt.connect(g);
    g.connect(this.musicFilter);
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(notes[i] - 12);
        o.detune.value = k ? 9 : -9;
        o.connect(flt);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }
}
