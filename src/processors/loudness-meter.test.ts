/**
 * Tests for the `loudness-meter` AudioWorkletProcessor SHELL — specifically the
 * gated-integrated-loudness path that lives in the worklet (not in the
 * context-free core). The math cores are tested in `../meters/*-core.test.ts`;
 * here we drive the actual processor through render quanta and assert its gated
 * integrated loudness MATCHES the one-shot core for the same signal, which is
 * what BS.1770-5 Annex 1 requires (eq.3: a gating block is a set of CONTIGUOUS
 * samples) — and which only holds if render quanta are split at the 100 ms
 * sub-block boundary.
 *
 * The worklet relies on the AudioWorklet globals (`AudioWorkletProcessor`,
 * `registerProcessor`, `sampleRate`); we stub them before importing the module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SAMPLE_RATE = 48_000;

interface PostedReport {
  type: "loudness";
  momentary: number;
  shortTerm: number;
  integrated: number;
  truePeak: number;
}

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: PostedReport[] = [];
  postMessage(data: unknown): void {
    this.posted.push(data as PostedReport);
  }
}

interface ProcessorLike {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/**
 * Dynamically imports the processor module with the AudioWorklet globals stubbed
 * and returns a freshly-constructed processor instance plus its fake port.
 */
async function makeProcessor(sampleRate = SAMPLE_RATE): Promise<{ processor: ProcessorLike; port: FakePort }> {
  let captured: { ctor: new (options?: unknown) => ProcessorLike } | null = null;

  class StubAudioWorkletProcessor {
    readonly port = new FakePort();
  }
  vi.stubGlobal("AudioWorkletProcessor", StubAudioWorkletProcessor);
  vi.stubGlobal("sampleRate", sampleRate);
  vi.stubGlobal("registerProcessor", (_name: string, ctor: new (options?: unknown) => ProcessorLike) => {
    captured = { ctor };
  });

  // Fresh module each call so the registerProcessor side effect re-runs.
  vi.resetModules();
  await import("./loudness-meter");
  if (!captured) {
    throw new Error("registerProcessor was not called");
  }
  const processor = new captured.ctor();
  return { processor, port: processor.port };
}

/** A 997 Hz sine at amplitude `amp` (1 = 0 dBFS), `seconds` long, at `sampleRate`. */
function sine(amp: number, seconds: number, sampleRate = SAMPLE_RATE, frequencyHz = 997): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  }
  return out;
}

/** Feed a mono signal to the processor in 128-sample render quanta. */
function feedMono(processor: ProcessorLike, signal: Float32Array): void {
  const QUANTUM = 128;
  for (let i = 0; i < signal.length; i += QUANTUM) {
    const block = signal.subarray(i, Math.min(i + QUANTUM, signal.length));
    const input = [Float32Array.from(block)];
    const output = [new Float32Array(block.length)];
    processor.process([input], [output]);
  }
}

function lastIntegrated(port: FakePort): number {
  const reports = port.posted.filter((p) => p && p.type === "loudness");
  return reports[reports.length - 1]?.integrated ?? Number.NaN;
}

describe("loudness-meter worklet — gated integrated loudness", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("worklet integrated loudness MATCHES the one-shot core (render quanta split at the sub-block boundary)", async () => {
    // A 0 dBFS 997 Hz sine, several seconds long, so many 400 ms gating blocks
    // form. 128-sample quanta straddle the 4800-sample (100 ms @ 48 kHz)
    // sub-block boundary; without the split fix the worklet misplaces the tail
    // samples and its integrated reading diverges from the core.
    const { integratedLoudness } = await import("../meters/loudness-core");
    const seconds = 2.0;
    const signal = sine(1.0, seconds);

    const expected = integratedLoudness([{ channel: "L", samples: signal }], SAMPLE_RATE);

    const { processor, port } = await makeProcessor();
    feedMono(processor, signal);

    const worklet = lastIntegrated(port);
    expect(Number.isFinite(worklet)).toBe(true);
    expect(Number.isFinite(expected)).toBe(true);
    // Power-domain gating identity: must agree tightly (sub-block boundary split).
    expect(worklet).toBeCloseTo(expected, 4);
  });

  it("matches the core for a varying-level signal too (gating actually selects blocks)", async () => {
    // Loud first half, quiet second half: the relative gate excludes the quiet
    // blocks, so a boundary mis-placement would shift block membership and the
    // result. Exercises the full two-stage gate end-to-end.
    const { integratedLoudness } = await import("../meters/loudness-core");
    const loud = sine(1.0, 1.5);
    const quiet = sine(0.05, 1.5);
    const signal = new Float32Array(loud.length + quiet.length);
    signal.set(loud, 0);
    signal.set(quiet, loud.length);

    const expected = integratedLoudness([{ channel: "L", samples: signal }], SAMPLE_RATE);

    const { processor, port } = await makeProcessor();
    feedMono(processor, signal);

    expect(lastIntegrated(port)).toBeCloseTo(expected, 4);
  });
});
