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

/** Feed a multichannel signal (one Float32Array per channel) in 128-sample quanta. */
function feedMulti(processor: ProcessorLike, channels: Float32Array[]): void {
  const QUANTUM = 128;
  const len = channels[0]?.length ?? 0;
  for (let i = 0; i < len; i += QUANTUM) {
    const end = Math.min(i + QUANTUM, len);
    const input = channels.map((ch) => Float32Array.from(ch.subarray(i, end)));
    const output = channels.map(() => new Float32Array(end - i));
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

  it("excludes the LFE channel from 5.1 loudness (BS.1770-5 Annex 1 Table 3, LFE weight 0)", async () => {
    // 5.1 channel order is [L, R, C, LFE, Ls, Rs]. A LOUD LFE (index 3) must not
    // change loudness; the flat default order mislabelled index 3 as Ls and
    // counted it. Compare a 6-channel feed with a loud LFE against the identical
    // feed with a silent LFE — they must read the same integrated loudness.
    const tone = sine(0.5, 2.0);
    const loud = sine(1.0, 2.0);
    const silent = new Float32Array(tone.length);

    const a = await makeProcessor();
    feedMulti(a.processor, [tone, tone, silent, loud, silent, silent]); // loud LFE
    const b = await makeProcessor();
    feedMulti(b.processor, [tone, tone, silent, silent, silent, silent]); // silent LFE

    const withLfe = lastIntegrated(a.port);
    const withoutLfe = lastIntegrated(b.port);
    expect(Number.isFinite(withLfe)).toBe(true);
    expect(withLfe).toBeCloseTo(withoutLfe, 6); // LFE excluded → identical
  });

  it("a loud non-LFE channel (C, index 2) DOES raise 5.1 loudness — exclusion is LFE-specific", async () => {
    // Guard against a vacuous pass: prove the meter is not simply ignoring index
    // 3, but excluding by LABEL. Putting the same loud tone on C (index 2, weight
    // 1.0) must raise integrated loudness over the silent-extra baseline.
    const tone = sine(0.5, 2.0);
    const loud = sine(1.0, 2.0);
    const silent = new Float32Array(tone.length);

    const c = await makeProcessor();
    feedMulti(c.processor, [tone, tone, loud, silent, silent, silent]); // loud C
    const base = await makeProcessor();
    feedMulti(base.processor, [tone, tone, silent, silent, silent, silent]);

    expect(lastIntegrated(c.port)).toBeGreaterThan(lastIntegrated(base.port) + 0.5);
  });
});
