import FFT from "fft.js";
import { describe, expect, it } from "vitest";

import { lfoShape, TREMOLO_DEFAULTS, type TremoloParams, TremoloProcessor } from "./tremolo-core";

const SAMPLE_RATE = 48000;

function tremoloParams(overrides: Partial<TremoloParams> = {}): TremoloParams {
  return {
    rate: 5,
    depth: 0.5,
    shape: "sine",
    stereoPhase: 0,
    ...overrides,
  };
}

/** Magnitude at FFT bin `bin` of a real signal of length N. */
function magAtBin(signal: Float32Array, bin: number): number {
  const N = signal.length;
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  return Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]);
}

describe("lfoShape — waveform generator (bipolar [-1, 1])", () => {
  it("sine matches Math.sin", () => {
    for (const phase of [0, 0.5, 1, 2, Math.PI, 5]) {
      expect(lfoShape(phase, "sine")).toBeCloseTo(Math.sin(phase), 12);
    }
  });

  it("triangle is bipolar, continuous, and peaks at +/-1", () => {
    // Triangle: +1 at phase pi/2, -1 at phase 3pi/2, 0 at 0 and pi.
    expect(lfoShape(0, "triangle")).toBeCloseTo(0, 6);
    expect(lfoShape(Math.PI / 2, "triangle")).toBeCloseTo(1, 6);
    expect(lfoShape(Math.PI, "triangle")).toBeCloseTo(0, 6);
    expect(lfoShape((3 * Math.PI) / 2, "triangle")).toBeCloseTo(-1, 6);
    // Bounded in [-1, 1] over a full period.
    for (let i = 0; i < 100; i++) {
      const v = lfoShape((2 * Math.PI * i) / 100, "triangle");
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });

  it("square is +1 on the first half-cycle and -1 on the second", () => {
    expect(lfoShape(0.1, "square")).toBe(1);
    expect(lfoShape(Math.PI - 0.1, "square")).toBe(1);
    expect(lfoShape(Math.PI + 0.1, "square")).toBe(-1);
    expect(lfoShape(2 * Math.PI - 0.1, "square")).toBe(-1);
  });

  it("all shapes are 2*pi periodic", () => {
    for (const shape of ["sine", "triangle", "square"] as const) {
      for (const phase of [0.3, 1.1, 2.7, 4.9]) {
        expect(lfoShape(phase + 2 * Math.PI, shape)).toBeCloseTo(lfoShape(phase, shape), 10);
      }
    }
  });
});

describe("TremoloProcessor — depth = 0 is an exact passthrough (g === 1)", () => {
  it("a signal is returned unchanged at depth 0", () => {
    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const N = 512;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 13 * i) / N) + 0.2 * (i % 7);
    const out = new Float32Array(N);
    proc.process(input, out, tremoloParams({ depth: 0, rate: 5 }));
    for (let i = 0; i < N; i++) expect(out[i]).toBeCloseTo(input[i], 6);
  });
});

describe("TremoloProcessor — gain stays in [1-depth, 1] and never negative", () => {
  it("the recovered per-sample gain is bounded and non-negative for depth = 1", () => {
    // Drive a DC input of 1 so output[i] == g[i] directly.
    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const N = SAMPLE_RATE; // 1 second -> several LFO cycles at 5 Hz
    const dc = new Float32Array(N).fill(1);
    const g = new Float32Array(N);
    proc.process(dc, g, tremoloParams({ depth: 1, rate: 5 }));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of g) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    // depth=1 => g swings (1-1)=0 .. 1. Never negative (that would be ring-mod).
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThan(0.05); // actually reaches ~0
    expect(max).toBeLessThanOrEqual(1.0001);
    expect(max).toBeGreaterThan(0.95); // actually reaches ~1
  });

  it("depth = 0.5 => g swings between 0.5 and 1", () => {
    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const N = SAMPLE_RATE;
    const dc = new Float32Array(N).fill(1);
    const g = new Float32Array(N);
    proc.process(dc, g, tremoloParams({ depth: 0.5, rate: 5 }));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of g) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeCloseTo(0.5, 2);
    expect(max).toBeCloseTo(1, 2);
  });
});

describe("TremoloProcessor — no zipper (per-sample gain is smooth)", () => {
  it("the adjacent-sample gain delta is tiny for a sine LFO", () => {
    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const N = SAMPLE_RATE;
    const dc = new Float32Array(N).fill(1);
    const g = new Float32Array(N);
    proc.process(dc, g, tremoloParams({ depth: 1, rate: 10, shape: "sine" }));
    // Max gain slope for a 10 Hz sine at depth 1: |dg/dn| <= depth*0.5*2*pi*rate/fs.
    const bound = 1 * 0.5 * 2 * Math.PI * 10 * 2; // generous 2x safety
    let maxDelta = 0;
    for (let i = 1; i < N; i++) maxDelta = Math.max(maxDelta, Math.abs(g[i] - g[i - 1]));
    expect(maxDelta).toBeLessThan(bound / SAMPLE_RATE);
  });
});

describe("TremoloProcessor — AM sidebands appear at f_c +/- rate", () => {
  it("a pure carrier gains sidebands absent from the dry signal", () => {
    // Carrier at bin 200, tremolo at a rate equal to 10 bins so f_c +/- rate land
    // exactly on bins 190 and 210.
    const N = 8192;
    const carrierBin = 200;
    const sidebandBins = 10;
    const rateHz = (sidebandBins * SAMPLE_RATE) / N;

    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * carrierBin * i) / N);

    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const out = new Float32Array(N);
    proc.process(input, out, tremoloParams({ depth: 1, rate: rateHz, shape: "sine" }));

    // Dry has NO energy at the sideband bins; wet does (the AM sidebands).
    const dryLower = magAtBin(input, carrierBin - sidebandBins);
    const dryUpper = magAtBin(input, carrierBin + sidebandBins);
    const wetLower = magAtBin(out, carrierBin - sidebandBins);
    const wetUpper = magAtBin(out, carrierBin + sidebandBins);
    const carrier = magAtBin(out, carrierBin);

    expect(dryLower).toBeLessThan(carrier * 1e-3); // dry is clean at the sidebands
    expect(dryUpper).toBeLessThan(carrier * 1e-3);
    expect(wetLower).toBeGreaterThan(carrier * 0.05); // wet grew real sidebands
    expect(wetUpper).toBeGreaterThan(carrier * 0.05);
  });
});

describe("TremoloProcessor — stereoPhase = 180 makes L/R gains anti-phase", () => {
  it("the L and R gain envelopes are negatively correlated at stereoPhase 180", () => {
    const N = SAMPLE_RATE;
    const dc = new Float32Array(N).fill(1);
    const gL = new Float32Array(N);
    const gR = new Float32Array(N);
    const procL = new TremoloProcessor(SAMPLE_RATE, 0); // channelIndex 0
    const procR = new TremoloProcessor(SAMPLE_RATE, 1); // channelIndex 1
    const params = tremoloParams({ depth: 1, rate: 4, stereoPhase: 180 });
    procL.process(dc, gL, params);
    procR.process(dc, gR, params);
    // Correlate (gL - mean) with (gR - mean): anti-phase => strongly negative.
    let meanL = 0;
    let meanR = 0;
    for (let i = 0; i < N; i++) {
      meanL += gL[i];
      meanR += gR[i];
    }
    meanL /= N;
    meanR /= N;
    let cov = 0;
    let varL = 0;
    let varR = 0;
    for (let i = 0; i < N; i++) {
      const dL = gL[i] - meanL;
      const dR = gR[i] - meanR;
      cov += dL * dR;
      varL += dL * dL;
      varR += dR * dR;
    }
    const corr = cov / Math.sqrt(varL * varR);
    expect(corr).toBeLessThan(-0.9); // hard auto-pan: L loud when R quiet
  });

  it("stereoPhase = 0 makes both channels identical (mono tremolo)", () => {
    const N = 4096;
    const dc = new Float32Array(N).fill(1);
    const gL = new Float32Array(N);
    const gR = new Float32Array(N);
    new TremoloProcessor(SAMPLE_RATE, 0).process(dc, gL, tremoloParams({ depth: 1, rate: 4, stereoPhase: 0 }));
    new TremoloProcessor(SAMPLE_RATE, 1).process(dc, gR, tremoloParams({ depth: 1, rate: 4, stereoPhase: 0 }));
    for (let i = 0; i < N; i++) expect(gL[i]).toBeCloseTo(gR[i], 6);
  });
});

describe("TremoloProcessor — shape selection changes the modulation waveform", () => {
  it("sine and square produce different gain envelopes", () => {
    const N = SAMPLE_RATE;
    const dc = new Float32Array(N).fill(1);
    const gSine = new Float32Array(N);
    const gSquare = new Float32Array(N);
    new TremoloProcessor(SAMPLE_RATE, 0).process(dc, gSine, tremoloParams({ depth: 1, rate: 5, shape: "sine" }));
    new TremoloProcessor(SAMPLE_RATE, 0).process(dc, gSquare, tremoloParams({ depth: 1, rate: 5, shape: "square" }));
    let diff = 0;
    for (let i = 0; i < N; i++) diff += Math.abs(gSine[i] - gSquare[i]);
    expect(diff).toBeGreaterThan(0);
  });
});

describe("TremoloProcessor — reset clears the LFO phase", () => {
  it("reset() returns the LFO to its construction phase", () => {
    const proc = new TremoloProcessor(SAMPLE_RATE, 0);
    const N = 100;
    const dc = new Float32Array(N).fill(1);
    const g1 = new Float32Array(N);
    proc.process(dc, g1, tremoloParams({ depth: 1, rate: 5 }));
    proc.reset();
    const g2 = new Float32Array(N);
    proc.process(dc, g2, tremoloParams({ depth: 1, rate: 5 }));
    for (let i = 0; i < N; i++) expect(g2[i]).toBeCloseTo(g1[i], 6);
  });
});

describe("TREMOLO_DEFAULTS — pinned single source of truth", () => {
  it("matches the documented defaults", () => {
    expect(TREMOLO_DEFAULTS).toEqual({
      rate: 5,
      depth: 0.5,
      shape: "sine",
      stereoPhase: 0,
    });
  });
});
