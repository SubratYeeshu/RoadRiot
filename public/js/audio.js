// All sound is synthesized at runtime with the Web Audio API - no audio files ship
// with the game. Engine note, impacts, pickups and the music loop are generated live.

const NOTE = { E2: 82.41, G2: 98, A2: 110, B2: 123.47, D3: 146.83, E3: 164.81, G3: 196, A3: 220, B3: 246.94, D4: 293.66 };

const RIFF = [
  NOTE.E2, NOTE.E2, NOTE.G2, NOTE.E2, NOTE.A2, NOTE.E2, NOTE.G2, NOTE.B2,
  NOTE.E2, NOTE.E2, NOTE.G2, NOTE.E2, NOTE.D3, NOTE.B2, NOTE.A2, NOTE.G2
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.engine = null;
    this.rivals = new Map();
    this.music = { playing: false, step: 0, nextTime: 0, timer: null };
    this.noiseBuffer = null;
  }

  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);

      this.engineBus = this.ctx.createGain();
      this.engineBus.gain.value = 0.5;
      this.engineBus.connect(this.master);

      this.noiseBuffer = this.makeNoise(2);
      this.ready = true;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return true;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // -------------------------------------------------------------- engine voices
  createEngineVoice(busGain) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;

    const pan = ctx.createStereoPanner();
    pan.pan.value = 0;

    const low = ctx.createOscillator();
    low.type = 'sawtooth';
    const high = ctx.createOscillator();
    high.type = 'square';
    high.detune.value = 8;

    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.55;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.18;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 6;

    const intake = ctx.createBufferSource();
    intake.buffer = this.noiseBuffer;
    intake.loop = true;
    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 1200;
    intakeFilter.Q.value = 1.1;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0.06;

    low.connect(lowGain).connect(filter);
    high.connect(highGain).connect(filter);
    intake.connect(intakeFilter).connect(intakeGain).connect(filter);
    filter.connect(out).connect(pan).connect(busGain);

    low.start();
    high.start();
    intake.start();

    return { out, pan, low, high, filter, intakeGain, gainTarget: 0 };
  }

  startEngine() {
    if (!this.ready || this.engine) return;
    this.engine = this.createEngineVoice(this.engineBus);
  }

  stopEngine() {
    for (const [, voice] of this.rivals) this.killVoice(voice);
    this.rivals.clear();
    if (!this.engine) return;
    this.killVoice(this.engine);
    this.engine = null;
  }

  killVoice(voice) {
    const t = this.now;
    voice.out.gain.setTargetAtTime(0, t, 0.05);
    try {
      voice.low.stop(t + 0.3);
      voice.high.stop(t + 0.3);
    } catch {
      /* already stopped */
    }
  }

  engineFreq(speedPercent) {
    const gears = 5;
    const p = Math.min(1, Math.max(0, speedPercent));
    const gear = Math.min(gears - 1, Math.floor(p * gears));
    const within = p * gears - gear;
    return 58 + within * 96 + gear * 7;
  }

  updateEngine(state) {
    if (!this.ready || !this.engine || this.muted) return;
    const t = this.now;
    const v = this.engine;
    const p = Math.min(1.25, state.speedPercent);
    const freq = this.engineFreq(p) * (state.boosting ? 1.16 : 1);
    const crashed = state.crashed ? 0.12 : 1;

    v.low.frequency.setTargetAtTime(freq, t, 0.04);
    v.high.frequency.setTargetAtTime(freq * 2.01, t, 0.04);
    v.filter.frequency.setTargetAtTime(520 + p * 2600 + (state.throttle ? 500 : 0), t, 0.05);
    v.intakeGain.gain.setTargetAtTime(state.offRoad ? 0.22 : 0.05 + p * 0.06, t, 0.06);
    v.out.gain.setTargetAtTime((0.1 + p * 0.5) * crashed, t, 0.05);
  }

  updateRivals(list) {
    if (!this.ready || this.muted) return;
    const keep = new Set();
    for (const r of list.slice(0, 3)) {
      keep.add(r.index);
      let voice = this.rivals.get(r.index);
      if (!voice) {
        voice = this.createEngineVoice(this.engineBus);
        this.rivals.set(r.index, voice);
      }
      const t = this.now;
      const freq = this.engineFreq(r.speedPercent);
      voice.low.frequency.setTargetAtTime(freq, t, 0.06);
      voice.high.frequency.setTargetAtTime(freq * 2.01, t, 0.06);
      voice.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.08);
      voice.out.gain.setTargetAtTime(Math.max(0, 0.24 * r.volume), t, 0.08);
    }
    for (const [index, voice] of this.rivals) {
      if (!keep.has(index)) {
        this.killVoice(voice);
        this.rivals.delete(index);
      }
    }
  }

  // -------------------------------------------------------------- one-shots
  burst({ duration = 0.22, type = 'bandpass', freq = 900, q = 1, gain = 0.5, sweepTo = null, pan = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter).connect(g).connect(panner).connect(this.sfxBus);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  tone({ freq = 440, duration = 0.18, type = 'square', gain = 0.22, sweepTo = null, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  playPunch(strength = 1, pan = 0) {
    this.burst({ duration: 0.13, type: 'bandpass', freq: 1500, q: 0.8, gain: 0.5 * strength, sweepTo: 320, pan });
    this.tone({ freq: 150, duration: 0.12, type: 'sine', gain: 0.3 * strength, sweepTo: 60 });
  }

  playClub(pan = 0) {
    this.burst({ duration: 0.2, type: 'bandpass', freq: 2600, q: 2.4, gain: 0.5, sweepTo: 600, pan });
    this.tone({ freq: 320, duration: 0.24, type: 'triangle', gain: 0.26, sweepTo: 90 });
  }

  playCrash() {
    this.burst({ duration: 0.85, type: 'lowpass', freq: 2600, q: 0.6, gain: 0.7, sweepTo: 180 });
    this.burst({ duration: 0.5, type: 'bandpass', freq: 3400, q: 3, gain: 0.35, sweepTo: 900 });
    this.tone({ freq: 120, duration: 0.6, type: 'sawtooth', gain: 0.3, sweepTo: 42 });
  }

  playScrape() {
    this.burst({ duration: 0.45, type: 'highpass', freq: 2200, q: 1, gain: 0.22 });
  }

  playPickup() {
    this.tone({ freq: 660, duration: 0.1, type: 'square', gain: 0.24 });
    this.tone({ freq: 990, duration: 0.14, type: 'square', gain: 0.22, delay: 0.09 });
  }

  playBoost() {
    this.tone({ freq: 180, duration: 0.5, type: 'sawtooth', gain: 0.2, sweepTo: 1300 });
    this.burst({ duration: 0.4, type: 'highpass', freq: 700, q: 0.7, gain: 0.2 });
  }

  playBeep(final = false) {
    this.tone({ freq: final ? 1180 : 620, duration: final ? 0.5 : 0.16, type: 'square', gain: 0.3 });
  }

  playFinish() {
    const notes = [NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4];
    notes.forEach((f, i) => this.tone({ freq: f, duration: 0.3, type: 'square', gain: 0.24, delay: i * 0.1 }));
  }

  say(text) {
    if (this.muted || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 0.8;
      utter.volume = 0.85;
      window.speechSynthesis.speak(utter);
    } catch {
      /* speech unavailable */
    }
  }

  // -------------------------------------------------------------- music loop
  startMusic() {
    if (!this.ready || this.music.playing) return;
    this.music.playing = true;
    this.music.step = 0;
    this.music.nextTime = this.now + 0.1;
    this.music.timer = setInterval(() => this.scheduleMusic(), 25);
  }

  stopMusic() {
    this.music.playing = false;
    if (this.music.timer) clearInterval(this.music.timer);
    this.music.timer = null;
  }

  scheduleMusic() {
    if (!this.music.playing || this.muted) return;
    const stepDur = 60 / 152 / 2; // eighth notes at 152 bpm
    while (this.music.nextTime < this.now + 0.18) {
      this.playStep(this.music.step, this.music.nextTime, stepDur);
      this.music.step = (this.music.step + 1) % 16;
      this.music.nextTime += stepDur;
    }
  }

  playStep(step, time, dur) {
    const ctx = this.ctx;

    // gritty bass riff
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(RIFF[step], time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, time);
    filter.frequency.exponentialRampToValueAtTime(420, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.28, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.95);
    osc.connect(filter).connect(g).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + dur);

    // kick
    if (step % 4 === 0) {
      const k = ctx.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(140, time);
      k.frequency.exponentialRampToValueAtTime(46, time + 0.14);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.5, time);
      kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      k.connect(kg).connect(this.musicBus);
      k.start(time);
      k.stop(time + 0.2);
    }

    // snare
    if (step % 8 === 4) {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer;
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass';
      sf.frequency.value = 1900;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.32, time);
      sg.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      s.connect(sf).connect(sg).connect(this.musicBus);
      s.start(time);
      s.stop(time + 0.18);
    }

    // hats
    const h = ctx.createBufferSource();
    h.buffer = this.noiseBuffer;
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 7200;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(step % 2 ? 0.05 : 0.1, time);
    hg.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    h.connect(hf).connect(hg).connect(this.musicBus);
    h.start(time);
    h.stop(time + 0.08);
  }
}
