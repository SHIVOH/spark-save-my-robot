// SPARK: Save My Robot — Zone 2 (Sensor Gardens)
// Zone 2 sounds, extending the shared synth engine: cyan ping chirps with echo,
// Flicker's nervous chirps (pitch up when startled), the kid's vine-swing
// giggle, the minecart, and a cooler ceremony arc that warms into the canon key.
import { AudioEngine } from '../audio';

const BASE = 261.63; // C4
const PENTA = [0, 2, 4, 7, 9];
function penta(step: number, octave = 0): number {
  const n = PENTA.length;
  const idx = ((step % n) + n) % n;
  const oct = Math.floor(step / n) + octave;
  return BASE * Math.pow(2, oct + PENTA[idx] / 12);
}

export class Zone2Audio extends AudioEngine {
  /** Bat Hollow tap ping: bright cyan sine chirp with two echoes. */
  pingChirp() {
    this.tone(1240, 0.22, 'sine', 0.14, 0, 1860);
    this.tone(1240, 0.18, 'sine', 0.055, 0.16, 1860);
    this.tone(1240, 0.15, 'sine', 0.025, 0.32, 1860);
  }

  /** The new verb: scan-ping — wider chirp with a long echo tail. */
  scanPing() {
    this.tone(880, 0.3, 'sine', 0.18, 0, 1760);
    this.tone(1320, 0.26, 'sine', 0.08, 0.2, 1980);
    this.tone(880, 0.22, 'sine', 0.04, 0.4, 1760);
    this.tone(1320, 0.18, 'sine', 0.02, 0.58, 1980);
  }

  /** Flicker's nervous chirps — pitch jumps up sharply when startled. */
  flickerChirp(startled = false) {
    if (startled) {
      this.tone(1400, 0.1, 'square', 0.06, 0, 2200);
      this.tone(1800, 0.12, 'square', 0.055, 0.09, 2600);
      this.tone(2100, 0.1, 'square', 0.04, 0.18, 2400);
    } else {
      this.tone(1100, 0.08, 'square', 0.035, 0, 1350);
      this.tone(1250, 0.08, 'square', 0.03, 0.11, 1150);
    }
  }

  /** Spark's giggle on a harmless wrong vine swing. */
  giggle() {
    for (let i = 0; i < 4; i++) {
      this.tone(900 + i * 130, 0.07, 'sine', 0.07, i * 0.08, 1180 + i * 130);
    }
  }

  /** A machine-flower blooming open. */
  bloomOpen() {
    this.tone(penta(0, 1), 0.3, 'triangle', 0.12);
    this.tone(penta(2, 1), 0.35, 'triangle', 0.12, 0.09);
    this.tone(penta(4, 1), 0.5, 'sine', 0.09, 0.18);
    this.tone(penta(4, 2), 0.6, 'sine', 0.04, 0.22);
  }

  /** Vine swing whoosh. */
  swing() {
    this.noise(0.35, 0.12, 500, 0, 1800);
  }

  /** Minecart rattle tick (call periodically while rolling). */
  rattle() {
    this.noise(0.05, 0.055, 480);
    this.tone(190, 0.05, 'triangle', 0.035);
  }

  /** Minecart brakes. */
  cartBrake() {
    this.noise(0.3, 0.09, 2400, 0, 500);
    this.tone(320, 0.28, 'square', 0.05, 0, 170);
  }

  /** Soft friendly bump (wrong sensor pick) — never punishment. */
  softBump() {
    this.tone(150, 0.14, 'sine', 0.12);
    this.noise(0.08, 0.05, 700);
    this.tone(520, 0.2, 'sine', 0.05, 0.12, 390);
  }

  /** Sensor module seats into Bolt's chassis. */
  moduleSeat() {
    this.tone(penta(0, 1), 0.12, 'square', 0.1);
    this.tone(penta(2, 1), 0.3, 'triangle', 0.14, 0.05);
    this.noise(0.06, 0.05, 3000, 0.02);
  }

  /**
   * Ceremony arc for Zone 2: same shape as Zone 1 (silence -> swell -> build ->
   * bloom) but starts in a cooler key (D minor-ish) and warms into the canon
   * C-major pentatonic bloom as Bolt's vision returns.
   */
  ceremonyCool() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + 0.3;
    // cool tonic swell (D3 -> D4 shimmer)
    const swell = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    swell.type = 'sine';
    swell.frequency.value = 146.83; // D3
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.linearRampToValueAtTime(0.2, t0 + 1.8);
    sg.gain.linearRampToValueAtTime(0.07, t0 + 3.2);
    swell.connect(sg).connect(this.master);
    swell.start(t0);
    swell.stop(t0 + 3.4);
    this.tone(293.66, 2.6, 'sine', 0.05, 0.5); // D4 cool shimmer
    // ostinato build: D minor pentatonic, warming
    const minor = [0, 3, 5, 7, 10];
    for (let i = 0; i < 16; i++) {
      const w = 2.4 + i * 0.22;
      const step = minor[i % 4 === 3 ? 2 : i % 4];
      const f = 293.66 * Math.pow(2, step / 12);
      this.tone(f, 0.16, 'triangle', 0.05 + i * 0.006, w);
      if (i % 4 === 0) this.tone(146.83, 0.5, 'sine', 0.055, w);
    }
    // full-ensemble bloom — resolves to the warm canon key
    const bloomT = 2.4 + 16 * 0.22;
    [0, 2, 4, 7, 9, 12].forEach((s, i) => {
      this.tone(penta(s, 1), 2.2, 'triangle', 0.1, bloomT + i * 0.06);
      this.tone(penta(s, 2), 1.8, 'sine', 0.04, bloomT + i * 0.06);
    });
    this.tone(penta(0, 0), 3.2, 'sine', 0.16, bloomT);
  }
}
