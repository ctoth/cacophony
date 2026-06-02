import FFT from "fft.js";
import { describe, expect, it } from "vitest";

import {
  allpassStep,
  breakFreqToAllpassCoeff,
  PHASER_DEFAULTS,
  type PhaserParams,
  PhaserProcessor,
} from "./phaser-core";

const SAMPLE_RATE = 48000;

function phaserParams(overrides: Partial<PhaserParams> = {}): PhaserParams {
  return {
    frequency: 500,
    rate: 0,
    depth: 0,
    stages: 4,
    feedback: 0,
    mix: 0.5,
    ...overrides,
  };
}

/** Magnitude spectrum (power) of a real signal, length N power-of-two. */
function powerSpectrum(signal: Float32Array): Float64Array {
  const N = signal.length;
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  const out = new Float64Array(N / 2 + 1);
  for (let bin = 0; bin <= N / 2; bin++) {
    const re = spectrum[bin * 2];
    const im = spectrum[bin * 2 + 1];
    out[bin] = re * re + im * im;
  }
  return out;
}

describe("breakFreqToAllpassCoeff — bilinear/tan map (PASP Eq. 8.20)", () => {
  it("matches the closed form p = (1 - tan(pi*fb/fs))/(1 + tan(pi*fb/fs))", () => {
    for (const fb of [100, 500, 1000, 5000, 12000]) {
      const t = Math.tan((Math.PI * fb) / SAMPLE_RATE);
      const expected = (1 - t) / (1 + t);
      expect(breakFreqToAllpassCoeff(fb, SAMPLE_RATE)).toBeCloseTo(expected, 12);
    }
  });

  it("stays strictly inside the unit circle (|p| < 1) for fb in (0, fs/2)", () => {
    for (const fb of [1, 100, 1000, 10000, SAMPLE_RATE / 2 - 1]) {
      expect(Math.abs(breakFreqToAllpassCoeff(fb, SAMPLE_RATE))).toBeLessThan(1);
    }
  });

  it("p -> +1 as fb -> 0 (very low break frequency is near a pure delay-free pass)", () => {
    expect(breakFreqToAllpassCoeff(1e-3, SAMPLE_RATE)).toBeCloseTo(1, 4);
  });
});

describe("allpassStep — first-order allpass section is flat-magnitude (|H| ~= 1)", () => {
  it("a settled sine passes a single section at unity RMS for any break freq", () => {
    for (const fb of [200, 800, 3000]) {
      const p = breakFreqToAllpassCoeff(fb, SAMPLE_RATE);
      for (const cyclesPerBuffer of [12, 40, 130]) {
        const N = 8192;
        const input = new Float32Array(N);
        for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * cyclesPerBuffer * i) / N);
        const state = { z1: 0 };
        const out = new Float32Array(N);
        for (let i = 0; i < N; i++) out[i] = allpassStep(input[i], p, state);
        // RMS over the settled second half.
        let inSq = 0;
        let outSq = 0;
        for (let i = N / 2; i < N; i++) {
          inSq += input[i] * input[i];
          outSq += out[i] * out[i];
        }
        expect(Math.sqrt(outSq) / Math.sqrt(inSq)).toBeCloseTo(1, 2);
      }
    }
  });
});

describe("PhaserProcessor — mix endpoints", () => {
  it("mix=0 is an EXACT passthrough (y = x)", () => {
    const proc = new PhaserProcessor(SAMPLE_RATE);
    const N = 256;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 17 * i) / N) + 0.3 * (i % 5);
    const out = new Float32Array(N);
    proc.process(input, out, phaserParams({ mix: 0 }));
    for (let i = 0; i < N; i++) expect(out[i]).toBeCloseTo(input[i], 6);
  });
});

/**
 * Transfer-function magnitude |H(f)| via the impulse response: feed a unit
 * impulse, the FFT of the output IS H(e^jw). This is the clean, phase-correct
 * way to see the comb notches (a random-phase broadband sum does NOT give |H|
 * per bin because of inter-partial phase interference).
 */
function transferMagnitude(stages: number, mix: number, frequency = 1000): Float64Array {
  const N = 8192;
  const proc = new PhaserProcessor(SAMPLE_RATE);
  const input = new Float32Array(N);
  input[0] = 1;
  const out = new Float32Array(N);
  // Static (rate=0, depth=0) so the notch frequencies are fixed.
  proc.process(input, out, phaserParams({ frequency, rate: 0, depth: 0, stages, mix }));
  const p = powerSpectrum(out);
  const mag = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) mag[i] = Math.sqrt(p[i]);
  return mag;
}

describe("PhaserProcessor — additive comb notches (non-vacuous)", () => {
  it("a static phaser carves a deep spectral notch (|H| -> 0 at a notch freq)", () => {
    // y = x + mix*A(x) with |A|=1; where A's phase = pi, A = -1, so |H| = |1-mix|.
    // At mix=1 the notch is (near) infinitely deep: min |H| << the dry level (1).
    const mag = transferMagnitude(4, 1);
    let minMag = Number.POSITIVE_INFINITY;
    for (let bin = 5; bin < mag.length - 5; bin++) minMag = Math.min(minMag, mag[bin]);
    // A passthrough (|H|=1 everywhere) or a crossfade of a flat-magnitude allpass
    // (|H|=1) would NEVER dip. A real additive notch drops |H| close to 0.
    expect(minMag).toBeLessThan(0.1);
  });

  it("a crossfade-style guard: the DC and Nyquist ends are NOT notched (sum, not bypass)", () => {
    // At DC the allpass phase is 0 (A=+1), so |H(0)| = 1+mix = 2 (the Smith [0,2]
    // gain envelope), proving the output is an ADDITIVE sum, not a wet/dry blend
    // (a blend would give |H(0)| <= 1 everywhere).
    const mag = transferMagnitude(4, 1);
    expect(mag[1]).toBeGreaterThan(1.5);
  });

  it("more stages (sections) produce more notches in [0, fs/2]", () => {
    const countNotches = (stages: number): number => {
      const mag = transferMagnitude(stages, 1);
      // A notch = |H| dipping below 0.3; count falling edges into that band.
      let notches = 0;
      let below = false;
      for (let bin = 3; bin < mag.length; bin++) {
        if (mag[bin] < 0.3 && !below) {
          notches++;
          below = true;
        } else if (mag[bin] >= 0.3) {
          below = false;
        }
      }
      return notches;
    };
    const n2 = countNotches(2);
    const n8 = countNotches(8);
    // 2 sections -> 1 notch, 8 sections -> 4 notches (2 sections per notch).
    expect(n8).toBeGreaterThan(n2);
  });
});

describe("PhaserProcessor — feedback stays finite/bounded", () => {
  it("does not blow up over a long run at feedback near the limit", () => {
    const proc = new PhaserProcessor(SAMPLE_RATE);
    const N = 16384;
    const input = new Float32Array(N);
    input[0] = 1; // impulse
    const out = new Float32Array(N);
    proc.process(input, out, phaserParams({ frequency: 800, rate: 2, depth: 1, feedback: 0.95, mix: 1 }));
    let max = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      max = Math.max(max, Math.abs(v));
    }
    // Smith: overall structure gain bounded; with feedback it stays well-behaved.
    expect(max).toBeLessThan(20);
  });
});

describe("PhaserProcessor — LFO sweep moves the notches", () => {
  it("the notch tracks the break frequency: deep at fb-up's freq, NOT at fb-down's", () => {
    const N = 8192;
    // rate=0 freezes the LFO at its seed phase; depth>0 so the seed shifts the
    // break frequency multiplicatively (fb = frequency * 2^(depth*lfo)).
    // frequency 2000, depth 1 -> lfo=+1: fb=4000 Hz, lfo=-1: fb=1000 Hz.
    const magAtSeed = (seedPhase: number): Float64Array => {
      const proc = new PhaserProcessor(SAMPLE_RATE, seedPhase);
      const input = new Float32Array(N);
      input[0] = 1;
      const out = new Float32Array(N);
      proc.process(input, out, phaserParams({ frequency: 2000, rate: 0, depth: 1, stages: 2, mix: 1 }));
      const p = powerSpectrum(out);
      const mag = new Float64Array(p.length);
      for (let i = 0; i < p.length; i++) mag[i] = Math.sqrt(p[i]);
      return mag;
    };
    const binAt = (hz: number) => Math.round((hz * N) / SAMPLE_RATE);
    const up = magAtSeed(Math.PI / 2); // fb = 4000 Hz
    const down = magAtSeed(-Math.PI / 2); // fb = 1000 Hz

    // At the lfo=+1 setting the notch sits at ~4000 Hz, so |H(4000)| is deep
    // while |H(1000)| is NOT; the lfo=-1 setting is the mirror. This pins the
    // notch MOVING with the break frequency (not merely "the output changed").
    expect(up[binAt(4000)]).toBeLessThan(up[binAt(1000)]);
    expect(down[binAt(1000)]).toBeLessThan(down[binAt(4000)]);
    // And the notch genuinely moved: 4000 Hz is much more attenuated under fb-up.
    expect(up[binAt(4000)]).toBeLessThan(down[binAt(4000)]);
  });
});

describe("PhaserProcessor — quadrature stereo seeding", () => {
  it("two cores seeded pi/2 apart produce different outputs from the same input", () => {
    const N = 4096;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 60 * i) / N);
    const left = new Float32Array(N);
    const right = new Float32Array(N);
    const procL = new PhaserProcessor(SAMPLE_RATE, 0);
    const procR = new PhaserProcessor(SAMPLE_RATE, Math.PI / 2);
    const params = phaserParams({ frequency: 800, rate: 1, depth: 1.5, stages: 4, mix: 1 });
    procL.process(input, left, params);
    procR.process(input, right, params);
    let diff = 0;
    for (let i = 0; i < N; i++) diff += Math.abs(left[i] - right[i]);
    expect(diff).toBeGreaterThan(0);
  });
});

describe("PhaserProcessor — reset clears section + feedback + LFO state", () => {
  it("reset() returns the processor to a silent rest state", () => {
    const proc = new PhaserProcessor(SAMPLE_RATE);
    const N = 256;
    const burst = new Float32Array(N);
    for (let i = 0; i < N; i++) burst[i] = Math.sin((2 * Math.PI * 30 * i) / N);
    const scratch = new Float32Array(N);
    proc.process(burst, scratch, phaserParams({ feedback: 0.9, mix: 1 }));
    proc.reset();
    const out = new Float32Array(N);
    proc.process(new Float32Array(N), out, phaserParams({ feedback: 0.9, mix: 1 }));
    for (const v of out) expect(v).toBeCloseTo(0, 6);
  });
});

describe("PHASER_DEFAULTS — pinned single source of truth", () => {
  it("matches the documented defaults", () => {
    expect(PHASER_DEFAULTS).toEqual({
      frequency: 500,
      rate: 0.5,
      depth: 1.5,
      stages: 4,
      feedback: 0,
      mix: 0.5,
    });
  });
});
