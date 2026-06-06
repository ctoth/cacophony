import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioBuffer, ConvolverNode, GainNode } from "./context";
import { isBuiltEffectGraph } from "./effects";
import { cacophony } from "./setupTests";

function stubBuffer(): AudioBuffer {
  return new AudioContext().createBuffer(1, 128, 44100);
}

function makeConvolver(base: GainNode): ConvolverNode {
  return Object.assign(base, {
    normalize: true,
    buffer: null as AudioBuffer | null,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImpulseResponseEffect", () => {
  it("builds a wet-only ConvolverNode with normalize defaulting to false", async () => {
    const buffer = stubBuffer();
    const convolver = makeConvolver(cacophony.context.createGain());
    (cacophony.context as unknown as { createConvolver: () => ConvolverNode }).createConvolver = vi
      .fn()
      .mockReturnValue(convolver);

    const effect = cacophony.createImpulseResponse(buffer);
    const built = await effect.build(cacophony.context);

    expect(built).toBe(convolver);
    expect(convolver.normalize).toBe(false);
    expect(convolver.buffer).toBe(buffer);
  });

  it("builds an owned dry/wet endpoint graph with exposed gain params", async () => {
    const buffer = stubBuffer();
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const gains: GainNode[] = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      Object.assign(node, {
        connect: vi.fn(node.connect.bind(node)),
        disconnect: vi.fn(node.disconnect.bind(node)),
      });
      gains.push(node);
      return node;
    });

    const convolver = makeConvolver(realCreateGain());
    Object.assign(convolver, {
      connect: vi.fn(convolver.connect.bind(convolver)),
      disconnect: vi.fn(convolver.disconnect.bind(convolver)),
    });
    (cacophony.context as unknown as { createConvolver: () => ConvolverNode }).createConvolver = vi
      .fn()
      .mockReturnValue(convolver);

    const effect = cacophony.createImpulseResponse(buffer, { dry: 0.2, wet: 0.8, normalize: true });
    const built = await effect.build(cacophony.context);

    expect(isBuiltEffectGraph(built)).toBe(true);
    if (!isBuiltEffectGraph(built)) {
      throw new Error("expected endpoint graph");
    }

    const [input, dryGain, wetGain, output] = gains;
    expect(built.input).toBe(input);
    expect(built.output).toBe(output);
    expect(built.params?.dry).toBe(dryGain.gain);
    expect(built.params?.wet).toBe(wetGain.gain);
    expect(dryGain.gain.value).toBe(0.2);
    expect(wetGain.gain.value).toBe(0.8);
    expect(convolver.normalize).toBe(true);
    expect(convolver.buffer).toBe(buffer);
    expect(input.connect).toHaveBeenCalledWith(dryGain);
    expect(input.connect).toHaveBeenCalledWith(convolver);
    expect(convolver.connect).toHaveBeenCalledWith(wetGain);
    expect(wetGain.connect).toHaveBeenCalledWith(output);
  });

  it("loads URL-backed impulse responses through a per-context cache", async () => {
    const decoded = stubBuffer();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(cacophony.context, "decodeAudioData").mockResolvedValue(decoded);

    const first = await cacophony.loadImpulseResponseBuffer("/ir.wav");
    const second = await cacophony.loadImpulseResponseBuffer("/ir.wav");

    expect(first).toBe(decoded);
    expect(second).toBe(decoded);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps caller aborts independent while sharing an in-flight URL load", async () => {
    const decoded = stubBuffer();
    let resolveFetch!: () => void;
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
          });
        signal?.addEventListener("abort", () => reject(new DOMException("Operation was aborted", "AbortError")), {
          once: true,
        });
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(cacophony.context, "decodeAudioData").mockResolvedValue(decoded);

    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = cacophony.loadImpulseResponseBuffer("/shared-ir.wav", undefined, firstController.signal);
    const second = cacophony.loadImpulseResponseBuffer("/shared-ir.wav", undefined, secondController.signal);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    firstController.abort();
    resolveFetch();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBe(decoded);
  });

  it("evicts rejected URL-backed impulse-response loads so a later retry can succeed", async () => {
    const decoded = stubBuffer();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: vi.fn(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(cacophony.context, "decodeAudioData").mockResolvedValue(decoded);

    await expect(cacophony.loadImpulseResponseBuffer("/missing.wav")).rejects.toThrow(/Failed to load/);
    await expect(cacophony.loadImpulseResponseBuffer("/missing.wav")).resolves.toBe(decoded);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws clearly if the context cannot create convolvers", async () => {
    const bare = {
      ...cacophony.context,
      createConvolver: undefined,
    } as never;
    const effect = cacophony.createImpulseResponse(stubBuffer());

    await expect(effect.build(bare)).rejects.toThrow(/createConvolver/);
  });
});
