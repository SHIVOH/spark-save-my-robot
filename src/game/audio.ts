// SPARK: Save My Robot — Zone 1 Slice
// Fully synthesized WebAudio engine. No audio assets.
// Canon: pentatonic plucks in a warm major key, soft pings, pickup chimes,
// kazoo-ish wrong-port buzz, charge hum, Bolt's three-beeps-and-a-squeak laugh,
// and the ceremony arc: silence -> tonic swell -> ostinato build -> full bloom.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps
const BASE = 261.63; // C4

function penta(step: number, octave = 0): number {
  const n = PENTA.length;
  const idx = ((step % n) + n) % n;
  const oct = Math.floor(step / n) + octave;
  return BASE * Math.pow(2, oct + PENTA[idx] / 12);
}

export class AudioEngine {
  protected ctx: AudioContext | null = null;
  protected master: GainNode | null = null;
  private humNodes: { osc: OscillatorNode; gain: GainNode } | null = null;
  protected noiseBuf: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('spark-muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture at least once. */
  ensure() {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      // shared noise buffer
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Release the AudioContext (browsers cap how many can be open). */
  dispose() {
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('spark-muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  protected tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    when = 0,
    glideTo?: number,
  ) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  protected noise(dur: number, vol: number, filterFreq: number, when = 0, sweepTo?: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** Soft idle ping for interactables. */
  ping() {
    this.tone(penta(4, 1), 0.5, 'sine', 0.06);
    this.tone(penta(4, 2), 0.35, 'sine', 0.02);
  }

  /** In-key pentatonic pluck for generic interactions. step rotates so play is musical. */
  pluck(step: number) {
    this.tone(penta(step, 1), 0.28, 'triangle', 0.16);
    this.tone(penta(step, 2), 0.18, 'sine', 0.05);
  }

  /** Low knock for "I heard you; nothing here." */
  knock() {
    this.tone(110, 0.12, 'sine', 0.12);
    this.noise(0.06, 0.04, 900);
  }

  /** Pickup chime: bright two-note sparkle. */
  pickup() {
    this.tone(penta(2, 1), 0.16, 'triangle', 0.18);
    this.tone(penta(4, 1), 0.22, 'triangle', 0.18, 0.07);
    this.tone(penta(4, 2), 0.35, 'sine', 0.08, 0.1);
  }

  /** Snap chime for seating / connecting (pairs with 60ms hit-stop). */
  snapChime() {
    this.tone(penta(0, 1), 0.12, 'square', 0.1);
    this.tone(penta(4, 1), 0.4, 'triangle', 0.2, 0.03);
  }

  /** Kazoo-ish wrong-port buzz. Friendly, never scary. */
  wrongBuzz() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.linearRampToValueAtTime(120, t0 + 0.35);
    lfo.frequency.value = 28; // kazoo wobble
    lfoG.gain.value = 18;
    lfo.connect(lfoG).connect(osc.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    osc.connect(f).connect(g).connect(this.master);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + 0.45);
    lfo.stop(t0 + 0.45);
  }

  /** Looping charge hum while a recharge flower fills the gauge. */
  chargeHumStart() {
    if (!this.ctx || !this.master || this.humNodes) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 90;
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.09, this.ctx.currentTime, 0.2);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.frequency.linearRampToValueAtTime(150, this.ctx.currentTime + 1.4);
    this.humNodes = { osc, gain: g };
  }

  chargeHumStop() {
    if (!this.ctx || !this.humNodes) return;
    const { osc, gain } = this.humNodes;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
    osc.stop(this.ctx.currentTime + 0.6);
    this.humNodes = null;
  }

  /** Bolt's laugh: three beeps and a squeak. weak = pitch-dropped. */
  boltLaugh(weak = false) {
    const drop = weak ? 0.62 : 1;
    const b = (f: number, w: number, d = 0.11) =>
      this.tone(f * drop, d, 'square', weak ? 0.05 : 0.08, w);
    b(660, 0);
    b(780, 0.13);
    b(660, 0.26);
    // the squeak
    this.tone(1400 * drop, 0.28, 'sine', weak ? 0.04 : 0.09, 0.42, 2100 * drop);
  }

  /** Small acknowledgment chirp. */
  chirp(up = true, weak = false) {
    const drop = weak ? 0.6 : 1;
    if (up) this.tone(520 * drop, 0.16, 'square', 0.06, 0, 760 * drop);
    else this.tone(760 * drop, 0.16, 'square', 0.06, 0, 520 * drop);
  }

  /** Three-rung celebration stinger ladder (used sparingly). */
  stinger(rungs = 3) {
    for (let i = 0; i < rungs; i++) {
      this.tone(penta(i * 2, 1), 0.3, 'triangle', 0.16, i * 0.11);
      this.tone(penta(i * 2, 2), 0.25, 'sine', 0.05, i * 0.11);
    }
  }

  /** Dash whoosh. */
  dash() {
    this.noise(0.3, 0.2, 500, 0, 2400);
    this.tone(220, 0.25, 'sawtooth', 0.05, 0, 440);
  }

  jump() {
    this.tone(300, 0.18, 'sine', 0.08, 0, 520);
  }

  land() {
    this.noise(0.08, 0.1, 300);
    this.tone(140, 0.1, 'sine', 0.1);
  }

  /** Pitch-varied footstep (±5%). */
  footstep() {
    const v = 1 + (Math.random() * 0.1 - 0.05);
    this.noise(0.05, 0.05, 700 * v);
    this.tone(180 * v, 0.05, 'triangle', 0.05);
  }

  /** Dyna's soft generator hum phrase. */
  dynaHum() {
    this.tone(98, 0.9, 'sine', 0.07);
    this.tone(147, 0.9, 'sine', 0.05, 0.05);
    this.tone(penta(0, 1), 0.4, 'triangle', 0.06, 0.55);
    this.tone(penta(2, 1), 0.5, 'triangle', 0.06, 0.85);
  }

  /** Dyna's cheerful cheer. */
  dynaCheer() {
    this.tone(penta(0, 1), 0.2, 'triangle', 0.12);
    this.tone(penta(2, 1), 0.2, 'triangle', 0.12, 0.1);
    this.tone(penta(4, 1), 0.35, 'triangle', 0.14, 0.2);
  }

  /**
   * Ceremony arc: silence -> tonic swell -> ostinato build -> full-ensemble bloom.
   * Call once; internally scheduled over ~9 seconds.
   */
  ceremony() {
    if (!this.ctx || !this.master) return;
    // tonic swell
    const t0 = this.ctx.currentTime + 0.3;
    const swell = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    swell.type = 'sine';
    swell.frequency.value = penta(0, 0);
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.linearRampToValueAtTime(0.22, t0 + 1.8);
    sg.gain.linearRampToValueAtTime(0.08, t0 + 3.2);
    swell.connect(sg).connect(this.master);
    swell.start(t0);
    swell.stop(t0 + 3.4);
    // ostinato build
    for (let i = 0; i < 16; i++) {
      const w = 2.4 + i * 0.22;
      const step = [0, 2, 4, 2][i % 4];
      this.tone(penta(step, 1), 0.16, 'triangle', 0.05 + i * 0.006, w);
      if (i % 4 === 0) this.tone(penta(0, 0), 0.5, 'sine', 0.06, w);
    }
    // full-ensemble bloom chord
    const bloomT = 2.4 + 16 * 0.22;
    [0, 2, 4, 7, 9, 12].forEach((s, i) => {
      this.tone(penta(s, 1), 2.2, 'triangle', 0.1, bloomT + i * 0.06);
      this.tone(penta(s, 2), 1.8, 'sine', 0.04, bloomT + i * 0.06);
    });
    this.tone(penta(0, 0), 3.2, 'sine', 0.16, bloomT);
  }

  /** Ambient meadow pad — call occasionally, very quiet. */
  ambient() {
    const s = Math.floor(Math.random() * 5);
    this.tone(penta(s, 1), 2.4, 'sine', 0.025);
    this.tone(penta((s + 2) % 5, 0), 2.8, 'sine', 0.02, 0.4);
  }
}
