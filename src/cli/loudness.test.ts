/**
 * Loudness metering tests (CLI Stage 5).
 *
 * The HEADLINE assertion: a 997 Hz 0 dBFS sine at 48 kHz for 2 s must measure
 * −3.01 LKFS through `integratedLoudness` (ITU-R BS.1770-5). This is the
 * strongest non-visual proof in the suite — pure, deterministic, no audio
 * context. Mirrors `index.html:931-941`.
 *
 * `integratedLoudness` is PURE JS exported from the package index (`../index`),
 * NOT the `/node` subpath — so this test needs no build and no context.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "../backend-available";
import { integratedLoudness } from "../index";
import { meterFile } from "./meter";

const TEST_OGG = join(process.cwd(), "test.ogg");

describe("loudness self-check (BS.1770-5, pure)", () => {
  it("997 Hz 0 dBFS sine measures −3.01 LKFS within 0.1", () => {
    const sr = 48000;
    const n = sr * 2;
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 997 * i) / sr);

    const lkfs = integratedLoudness([{ channel: "L", samples: tone }], sr);

    // eslint-disable-next-line no-console
    console.log(`[loudness self-check] 997Hz 0dBFS → ${lkfs.toFixed(4)} LKFS (expected −3.01)`);

    expect(Math.abs(lkfs - -3.01)).toBeLessThan(0.1);
  });

  it("a −6 dBFS sine is quieter than a 0 dBFS sine by ≈6 LU", () => {
    const sr = 48000;
    const n = sr * 2;
    const full = new Float32Array(n);
    const half = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.sin((2 * Math.PI * 997 * i) / sr);
      full[i] = s;
      half[i] = s * 0.5; // -6.02 dB
    }
    const lFull = integratedLoudness([{ channel: "L", samples: full }], sr);
    const lHalf = integratedLoudness([{ channel: "L", samples: half }], sr);

    // eslint-disable-next-line no-console
    console.log(`[loudness] full=${lFull.toFixed(2)} half=${lHalf.toFixed(2)} ΔLU=${(lFull - lHalf).toFixed(2)}`);

    expect(lFull - lHalf).toBeCloseTo(6.02, 1);
  });
});

// Decodes via the real Node backend; skipped when the optional native dep is
// absent (e.g. Node < 22). The pure BS.1770 self-checks above always run.
describe.skipIf(!nodeBackendAvailable)("meter <file> (offline, decodes + measures)", () => {
  it("measures a finite integrated loudness for test.ogg", async () => {
    const r = await meterFile(TEST_OGG);

    // eslint-disable-next-line no-console
    console.log(
      `[meter test.ogg] ${r.channels}ch @ ${r.sampleRate}Hz, ${r.frames} frames → ` +
        `${r.integratedLkfs.toFixed(2)} LUFS, peak ${r.peakDbfs.toFixed(2)} dBFS`,
    );

    expect(r.channels).toBeGreaterThan(0);
    expect(r.sampleRate).toBeGreaterThan(0);
    expect(r.frames).toBeGreaterThan(0);
    // test.ogg is a real recording → finite, non-silent loudness.
    expect(Number.isFinite(r.integratedLkfs)).toBe(true);
    expect(r.peakDbfs).toBeGreaterThan(-60);
  });
});
