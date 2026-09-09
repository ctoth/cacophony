import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./webCodecsStream");
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("imports and constructs Cacophony without loading the WebCodecs adapter", async () => {
  vi.resetModules();
  const load = vi.fn(() => ({ WebCodecsPullAdapter: { open: vi.fn() } }));
  vi.doMock("./webCodecsStream", load);
  const { Cacophony } = await import("./cacophony");
  const audio = new Cacophony(new AudioContext(), undefined, { autoUnlock: false });
  expect(audio.context).toBeDefined();
  expect(load).not.toHaveBeenCalled();
});

it.each(["missing WebCodecs", "HLS"])("keeps the adapter unloaded for %s", async (transport) => {
  vi.resetModules();
  const load = vi.fn(() => ({ WebCodecsPullAdapter: { open: vi.fn() } }));
  vi.doMock("./webCodecsStream", load);
  vi.stubGlobal("AudioDecoder", transport === "HLS" ? vi.fn() : undefined);
  const { Cacophony } = await import("./cacophony");
  const audio = new Cacophony(new AudioContext(), undefined, { autoUnlock: false });
  const fallback = vi.fn().mockResolvedValue("fallback");
  Object.defineProperty(audio, transport === "HLS" ? "createHlsSound" : "createMediaSound", { value: fallback });

  expect(await audio.createStream(transport === "HLS" ? "test.m3u8" : "test.mp3")).toBe("fallback");
  expect(load).not.toHaveBeenCalled();
});

it("does not open media when aborted while the adapter import is pending", async () => {
  vi.resetModules();
  const open = vi.fn();
  let release!: (adapter: { WebCodecsPullAdapter: { open: typeof open } }) => void;
  const ready = new Promise<{ WebCodecsPullAdapter: { open: typeof open } }>((resolve) => {
    release = resolve;
  });
  const load = vi.fn(() => ready);
  vi.doMock("./webCodecsStream", load);
  vi.stubGlobal("AudioDecoder", vi.fn());
  const { Cacophony } = await import("./cacophony");
  const audio = new Cacophony(new AudioContext(), undefined, { autoUnlock: false });
  const controller = new AbortController();
  const pending = audio.createStream("test.mp3", controller.signal);
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  controller.abort();
  release({ WebCodecsPullAdapter: { open } });
  await rejection;
  expect(open).not.toHaveBeenCalled();
});

it("rejects an already aborted stream before importing the adapter", async () => {
  vi.resetModules();
  const load = vi.fn(() => ({ WebCodecsPullAdapter: { open: vi.fn() } }));
  vi.doMock("./webCodecsStream", load);
  vi.stubGlobal("AudioDecoder", vi.fn());
  const { Cacophony } = await import("./cacophony");
  const audio = new Cacophony(new AudioContext(), undefined, { autoUnlock: false });
  await expect(audio.createStream("test.mp3", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  expect(load).not.toHaveBeenCalled();
});
