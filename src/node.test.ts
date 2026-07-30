import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { Cacophony } from "./cacophony";
import { createOfflineNodeCacophony, decodeAudioFile } from "./node";

// These tests run against the REAL node-web-audio-api backend (the same one the
// adapter ships against), proving the context + createAudioWorkletNode seams are
// wired correctly. They construct their own contexts and never touch the shared
// mock harness in setupTests.ts.

function peak(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

// Skipped when the optional native backend is absent (e.g. Node < 22, where its
// `engines` exclude it and npm omits the optionalDependency). See backend-available.ts.
describe.skipIf(!nodeBackendAvailable)("cacophony/node adapter", () => {
  it("constructs offline instances through Cacophony.createOffline", async () => {
    const createOfflineSpy = vi.spyOn(Cacophony, "createOffline");

    try {
      const { context } = await createOfflineNodeCacophony({
        numberOfChannels: 1,
        length: 128,
        sampleRate: 48000,
        quiet: true,
      });

      expect(createOfflineSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          numberOfChannels: 1,
          length: 128,
          sampleRate: 48000,
          context,
        }),
        undefined,
        expect.objectContaining({
          createAudioWorkletNode: expect.any(Function),
          resolveWorkletUrl: expect.any(Function),
          quiet: true,
        }),
      );
    } finally {
      createOfflineSpy.mockRestore();
    }
  });

  it("renders a bare oscillator synth to a non-silent buffer (real Node backend)", async () => {
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: Math.round(48000 * 0.1),
      sampleRate: 48000,
      quiet: true,
    });
    expect(cacophony).toBeDefined();
    expect(context).toBeDefined();

    const synth = await cacophony.createOscillator({ frequency: 220, type: "sawtooth" });
    synth.volume = 0.5;
    synth.play();

    const rendered = await context.startRendering();
    expect(rendered.numberOfChannels).toBeGreaterThanOrEqual(1);
    expect(peak(rendered)).toBeGreaterThan(0);
  });

  it("decodes an audio file into an AudioBuffer", async () => {
    const { context } = await createOfflineNodeCacophony({
      length: Math.round(48000 * 0.1),
      sampleRate: 48000,
      quiet: true,
    });
    const buffer = await decodeAudioFile(context, resolve(__dirname, "..", "test.ogg"));
    expect(buffer.numberOfChannels).toBeGreaterThanOrEqual(1);
    expect(buffer.duration).toBeGreaterThan(0);
  });

  it("falls back to the second URL when the first candidate cannot be decoded", async () => {
    const { cacophony } = await createOfflineNodeCacophony({
      length: Math.round(48000 * 0.1),
      sampleRate: 48000,
      quiet: true,
    });
    const urls = ["https://example.com/audio.mp3", "https://example.com/audio.ogg"];
    const encodedOgg = await readFile(resolve(__dirname, "..", "test.ogg"));
    const validAudio = encodedOgg.buffer.slice(
      encodedOgg.byteOffset,
      encodedOgg.byteOffset + encodedOgg.byteLength,
    ) as ArrayBuffer;
    const invalidAudio = new TextEncoder().encode("not audio").buffer;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response(String(input) === urls[0] ? invalidAudio : validAudio);
    });

    try {
      const sound = await cacophony.createSound(urls);

      expect(sound.url).toBe(urls[1]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
