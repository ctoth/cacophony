import { beforeAll, describe, expect, it, vi } from "vitest";

import { FdnReverbBank, type FdnReverbParams, FdnReverbProcessor } from "./fdn-reverb-core";

const FS = 48000;
const BLOCK = 128;

/** Deterministic linear-congruential RNG in [0,1) so velvet noise is reproducible. */
function makeRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A bank whose channel cores are seeded per channel, so two banks are identical. */
function seededBank(): FdnReverbBank {
  return new FdnReverbBank(FS, (channel) => new FdnReverbProcessor(FS, 8, makeRng(channel + 1)));
}

const wetParams: FdnReverbParams = { decayTime: 1, preDelay: 0, damping: 0, diffusion: 0.5, mix: 1 };

function energy(buf: Float32Array): number {
  let e = 0;
  for (const x of buf) e += x * x;
  return e;
}

function noise(length: number, seed: number): Float32Array {
  const rng = makeRng(seed);
  return Float32Array.from({ length }, () => rng() * 2 - 1);
}

function stereoOutput(length: number): Float32Array[] {
  return [new Float32Array(length), new Float32Array(length)];
}

describe("FdnReverbBank channel handling (#255)", () => {
  it("renders a diffuse wet field for a hard-left input", () => {
    const n = FS / 2;
    const output = stereoOutput(n);
    seededBank().process([noise(n, 7), new Float32Array(n)], output, wetParams);
    const balance = energy(output[1]) / energy(output[0]);
    expect(balance).toBeGreaterThan(0.5);
    expect(balance).toBeLessThan(2);
    // Diffuse, not dual mono: the channels come from decorrelated cores.
    expect(output[0]).not.toEqual(output[1]);
  });

  it("keeps the dry signal on its own channel", () => {
    const n = 1024;
    const left = noise(n, 3);
    const output = stereoOutput(n);
    seededBank().process([left, new Float32Array(n)], output, { ...wetParams, mix: 0 });
    expect(output[0]).toEqual(left);
    expect(energy(output[1])).toBe(0);
  });

  it("feeds a mono input to every output channel", () => {
    const n = FS / 4;
    const output = stereoOutput(n);
    seededBank().process([noise(n, 5)], output, wetParams);
    expect(energy(output[0])).toBeGreaterThan(0);
    expect(energy(output[1])).toBeGreaterThan(0);
  });

  it("decays an absent input exactly as it decays silence", () => {
    const excite = [noise(BLOCK * 8, 9), noise(BLOCK * 8, 11)];
    const absent = seededBank();
    const silent = seededBank();
    absent.process(excite, stereoOutput(BLOCK * 8), wetParams);
    silent.process(excite, stereoOutput(BLOCK * 8), wetParams);

    const fromAbsent = stereoOutput(FS / 4);
    const fromSilence = stereoOutput(FS / 4);
    absent.process([], fromAbsent, wetParams);
    silent.process([new Float32Array(FS / 4), new Float32Array(FS / 4)], fromSilence, wetParams);
    for (const ch of [0, 1]) {
      expect(energy(fromAbsent[ch])).toBeGreaterThan(0);
      expect(fromAbsent[ch]).toEqual(fromSilence[ch]);
    }
  });
});

type Shell = {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};
type ShellClass = (new () => Shell) & { parameterDescriptors: { name: string; defaultValue?: number }[] };

/**
 * The worklet shells need AudioWorkletGlobalScope globals at import time, so
 * they are stubbed before a dynamic import. Every shell that carries a tail
 * belongs in this list: it must keep rendering once its input has no channels.
 */
describe("tail-bearing worklet shells keep rendering without input (#255)", () => {
  const shells: Record<string, { load: () => Promise<ShellClass>; overrides: Record<string, number> }> = {
    "fdn-reverb": {
      load: async () => (await import("./fdn-reverb")).FdnReverbWorkletProcessor as unknown as ShellClass,
      overrides: { mix: 1 },
    },
    "dattorro-reverb": {
      load: async () => (await import("./dattorro-reverb")).DattorroReverbProcessor as unknown as ShellClass,
      overrides: { wet: 1, dry: 0 },
    },
    "modulated-delay": {
      load: async () => (await import("./modulated-delay")).ModulatedDelayWorkletProcessor as unknown as ShellClass,
      overrides: { delayTime: 5, feedback: 0.8, blend: 0, feedforward: 1 },
    },
  };

  beforeAll(() => {
    vi.stubGlobal("AudioWorkletProcessor", class {});
    vi.stubGlobal("registerProcessor", () => {});
    vi.stubGlobal("sampleRate", FS);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  for (const [name, { load, overrides }] of Object.entries(shells)) {
    it(`${name} renders its tail on both channels after the input disappears`, async () => {
      const Processor = await load();
      const shell = new Processor();
      const parameters: Record<string, Float32Array> = {};
      for (const descriptor of Processor.parameterDescriptors) {
        parameters[descriptor.name] = Float32Array.of(overrides[descriptor.name] ?? descriptor.defaultValue ?? 0);
      }

      // Excite both channels for ~85 ms, then remove the input entirely.
      for (let block = 0; block < 32; block++) {
        shell.process([[noise(BLOCK, block + 1), noise(BLOCK, block + 101)]], [stereoOutput(BLOCK)], parameters);
      }
      const tail = [0, 0];
      for (let block = 0; block < 32; block++) {
        const output = stereoOutput(BLOCK);
        expect(shell.process([[]], [output], parameters)).toBe(true);
        tail[0] += energy(output[0]);
        tail[1] += energy(output[1]);
      }
      expect(tail[0]).toBeGreaterThan(0);
      expect(tail[1]).toBeGreaterThan(0);
    });
  }
});
