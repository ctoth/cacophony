import FFT from "fft.js";
import { beforeAll, describe, expect, it } from "vitest";

class FakeAudioWorkletProcessor {
  port = { postMessage() {}, addEventListener() {} } as unknown as MessagePort;
  constructor(_options?: unknown) {}
}
const globals = globalThis as unknown as {
  AudioWorkletProcessor: unknown;
  registerProcessor: unknown;
  sampleRate: number;
};
globals.AudioWorkletProcessor = FakeAudioWorkletProcessor;
globals.registerProcessor = () => {};
globals.sampleRate = 48000;

const { HarmonizerWorkletProcessor } = await import("./harmonizer");
const N = 256;

function params(): Record<string, Float32Array> {
  return {
    semitonesA: new Float32Array([12]),
    semitonesB: new Float32Array([24]),
    gainA: new Float32Array([1]),
    gainB: new Float32Array([1]),
    dry: new Float32Array([1]),
  };
}

function magnitude(signal: Float32Array, bin: number): number {
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  return Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]);
}

describe("Laroche-Dolson single-pass harmonizer", () => {
  beforeAll(() => expect(typeof HarmonizerWorkletProcessor).toBe("function"));

  it("produces dry, octave, and two-octave peaks from one analysis frame", () => {
    const processor = new HarmonizerWorkletProcessor({ processorOptions: { blockSize: N } });
    let output = new Float32Array(N);
    for (let frame = 0; frame < 5; frame++) {
      const input = new Float32Array(N);
      for (let i = 0; i < N; i++) input[i] = Math.cos((2 * Math.PI * 16 * i) / N);
      output = new Float32Array(N);
      processor.processOLA([[input]], [[output]], params());
    }
    expect(magnitude(output, 16)).toBeGreaterThan(1);
    expect(magnitude(output, 32)).toBeGreaterThan(1);
    expect(magnitude(output, 64)).toBeGreaterThan(1);
    expect(magnitude(output, 32)).toBeGreaterThan(magnitude(output, 24) * 5);
  });
});
