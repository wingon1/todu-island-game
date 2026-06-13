// Audio.js — all sound is synthesized via Web Audio API. No audio files.
// AudioContext must be created on the first user gesture (mobile autoplay rules).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.ambientGain = null;
    this.musicGain = null;
    this._musicTimer = null;
    this.ready = false;
  }

  // Call from a user-gesture handler (the Start button / first tap).
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // Programmatic reverb impulse response.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.6, 2.4);
    const reverbGain = this.ctx.createGain();
    reverbGain.gain.value = 0.35;
    this.reverb.connect(reverbGain);
    reverbGain.connect(this.master);

    this.ready = true;
    this._startAmbient();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // Generic tone helper.
  _tone({ freq = 440, type = 'sine', duration = 0.1, gain = 0.25, when = 0, sendReverb = false }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(this.master);
    if (sendReverb && this.reverb) g.connect(this.reverb);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // --- Sound effects -----------------------------------------------------

  harvestPop() {
    this._tone({ freq: 880, type: 'sine', duration: 0.08, gain: 0.22 });
  }

  coinRegister() {
    // "cha-ching": C5 then E5 with a small delay.
    this._tone({ freq: 523.25, type: 'sine', duration: 0.2, gain: 0.2 });
    this._tone({ freq: 659.25, type: 'sine', duration: 0.2, gain: 0.2, when: 0.03 });
  }

  stageUpgrade() {
    // Ascending major arpeggio C4 E4 G4 C5 with reverb.
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', duration: 0.12, gain: 0.24, when: i * 0.12, sendReverb: true });
    });
  }

  customerArrive() {
    this._tone({ freq: 330, type: 'sine', duration: 0.06, gain: 0.16 });
  }

  uiTap() {
    this._tone({ freq: 440, type: 'square', duration: 0.04, gain: 0.1 });
  }

  // --- Ambient island loop ----------------------------------------------

  _startAmbient() {
    if (!this.ready) return;
    this._startWaveNoise();
    this._startUkuleleChords();
  }

  _startWaveNoise() {
    const bufferSize = 4 * this.ctx.sampleRate;
    const noiseBuf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 360;
    lp.Q.value = 0.35;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.007;

    noise.connect(lp);
    lp.connect(this.ambientGain);
    this.ambientGain.connect(this.master);
    if (this.reverb) this.ambientGain.connect(this.reverb);

    // Slow swell on the gain to feel like small waves breathing in and out.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.085;
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientGain.gain);
    lfo.start();

    noise.start();
  }

  _startUkuleleChords() {
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 1.5;
    this.musicGain.connect(this.master);
    if (this.reverb) this.musicGain.connect(this.reverb);

    // 32s cozy island progression. Chords are played together (not arpeggio),
    // while a sparse melody sits on top.
    const progression = [
      [523.25, 659.25, 783.99, 587.33],
      [523.25, 698.46, 880.0, 659.25],
      [440.0, 523.25, 659.25, 783.99],
      [493.88, 587.33, 783.99, 659.25],
      [523.25, 659.25, 783.99, 987.77],
      [587.33, 698.46, 880.0, 1046.5],
      [440.0, 523.25, 659.25, 880.0],
      [392.0, 493.88, 587.33, 783.99],
      [523.25, 659.25, 783.99, 587.33],
      [659.25, 783.99, 987.77, 880.0],
      [587.33, 698.46, 880.0, 783.99],
      [493.88, 587.33, 783.99, 659.25],
      [440.0, 523.25, 659.25, 783.99],
      [523.25, 659.25, 880.0, 987.77],
      [587.33, 783.99, 880.0, 1046.5],
      [493.88, 587.33, 659.25, 783.99],
    ];
    const melody = [
      [0.5, 783.99, 0.42], [1.0, 880.0, 0.28], [1.5, 987.77, 0.5],
      [2.5, 987.77, 0.26], [3.0, 880.0, 0.42], [3.5, 783.99, 0.28],
      [4.5, 783.99, 0.42], [5.0, 880.0, 0.28], [5.5, 1046.5, 0.5],
      [6.5, 987.77, 0.26], [7.0, 880.0, 0.5], [7.5, 783.99, 0.28],
      [8.5, 698.46, 0.42], [9.0, 783.99, 0.28], [9.5, 880.0, 0.5],
      [10.5, 783.99, 0.26], [11.0, 659.25, 0.5], [11.5, 587.33, 0.28],
      [12.5, 783.99, 0.42], [13.0, 880.0, 0.28], [13.5, 987.77, 0.5],
      [14.5, 880.0, 0.26], [15.0, 698.46, 0.6], [15.5, 659.25, 0.28],
      [16.5, 783.99, 0.42], [17.0, 880.0, 0.28], [17.5, 987.77, 0.5],
      [18.5, 987.77, 0.26], [19.0, 1046.5, 0.5], [19.5, 987.77, 0.28],
      [20.5, 783.99, 0.42], [21.0, 698.46, 0.28], [21.5, 659.25, 0.5],
      [22.5, 698.46, 0.26], [23.0, 783.99, 0.6], [23.5, 880.0, 0.28],
      [24.5, 880.0, 0.42], [25.0, 987.77, 0.28], [25.5, 1046.5, 0.5],
      [26.5, 880.0, 0.26], [27.0, 783.99, 0.5], [27.5, 698.46, 0.28],
      [28.5, 698.46, 0.42], [29.0, 659.25, 0.28], [29.5, 587.33, 0.5],
      [30.5, 587.33, 0.26], [31.0, 523.25, 0.65], [31.5, 587.33, 0.28],
    ];
    const loopLen = 32.0;

    const scheduleLoop = () => {
      if (!this.ready || !this.ctx) return;
      const start = this.ctx.currentTime + 0.08;
      progression.forEach((chord, i) => {
        this._playChord(chord, start + i * 2.0);
      });
      melody.forEach(([offset, freq, dur]) => this._playMelodyNote(freq, start + offset, dur));
    };

    scheduleLoop();
    this._musicTimer = window.setInterval(scheduleLoop, loopLen * 1000);
  }

  _playChord(freqs, when) {
    freqs.forEach((freq, i) => {
      const t = when;
      const osc = this.ctx.createOscillator();
      const lp = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1150, t);
      lp.frequency.exponentialRampToValueAtTime(720, t + 0.55);
      lp.Q.value = 0.6;

      const peak = 0.021 * (1 - i * 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);

      osc.connect(lp);
      lp.connect(g);
      g.connect(this.musicGain);
      if (this.reverb) g.connect(this.reverb);

      osc.start(t);
      osc.stop(t + 1.65);
    });
  }

  _playMelodyNote(freq, when, duration = 0.45) {
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, when);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1650, when);
    lp.frequency.exponentialRampToValueAtTime(900, when + Math.max(0.22, duration));
    lp.Q.value = 0.45;

    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.048, when + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.musicGain);
    if (this.reverb) g.connect(this.reverb);

    osc.start(when);
    osc.stop(when + duration + 0.08);
  }
}

export const audio = new AudioEngine();
