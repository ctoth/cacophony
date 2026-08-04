import { afterEach, describe, expect, it, vi } from "vitest";

function mockHlsModule(supported = true) {
  const instances: MockHls[] = [];

  class MockHls {
    static readonly Events = { ERROR: "hlsError" };
    static readonly isSupported = vi.fn(() => supported);

    readonly attachMedia = vi.fn();
    readonly destroy = vi.fn();
    readonly detachMedia = vi.fn();
    readonly listeners: Array<(...args: any[]) => void> = [];
    readonly loadSource = vi.fn();
    readonly off = vi.fn((_event: string, listener: (...args: any[]) => void) => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    });
    readonly on = vi.fn((_event: string, listener: (...args: any[]) => void) => {
      this.listeners.push(listener);
    });

    constructor() {
      instances.push(this);
    }

    emitError(data: Record<string, unknown>): void {
      for (const listener of this.listeners) {
        listener(MockHls.Events.ERROR, data);
      }
    }
  }

  vi.doMock("hls.js", () => ({ default: MockHls }));
  return { instances };
}

describe("HlsAdapter optional peer loading", () => {
  afterEach(() => {
    vi.doUnmock("hls.js");
    vi.resetModules();
  });

  it("gives install guidance when hls.js is not installed", async () => {
    const missingModuleError = Object.assign(new Error("Cannot find package 'hls.js'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    vi.doMock("hls.js", () => {
      throw missingModuleError;
    });
    const { HlsAdapter } = await import("./hlsAdapter");

    await expect(HlsAdapter.create(vi.fn())).rejects.toThrow("install hls.js or use a direct stream URL");
  });

  it("preserves hls.js module evaluation errors", async () => {
    const evaluationError = new Error("hls.js module initialization failed");
    vi.doMock("hls.js", () => {
      throw evaluationError;
    });
    const { HlsAdapter } = await import("./hlsAdapter");

    let caught: unknown;
    try {
      await HlsAdapter.create(vi.fn());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("install hls.js");
    expect((caught as Error & { cause?: unknown }).cause).toBe(evaluationError);
  });

  it("explains missing Media Source Extensions without install guidance", async () => {
    mockHlsModule(false);
    const { HlsAdapter } = await import("./hlsAdapter");

    const creation = HlsAdapter.create(vi.fn());
    await expect(creation).rejects.toThrow("Media Source Extensions are not supported");
    await expect(creation).rejects.not.toThrow("install hls.js");
  });
});

describe("HlsAdapter lifecycle", () => {
  afterEach(() => {
    vi.doUnmock("hls.js");
    vi.resetModules();
  });

  it("registers its error listener only once across repeated attachment", async () => {
    const { instances } = mockHlsModule();
    const { HlsAdapter } = await import("./hlsAdapter");
    const adapter = await HlsAdapter.create(vi.fn());
    const audio = {} as HTMLAudioElement;

    adapter.attach(audio, "https://example.com/first.m3u8");
    adapter.attach(audio, "https://example.com/second.m3u8");

    expect(instances[0].on).toHaveBeenCalledOnce();
    adapter.destroy();
    expect(instances[0].off).toHaveBeenCalledOnce();
  });

  it("rejects attachment after destruction without touching hls.js", async () => {
    const { instances } = mockHlsModule();
    const { HlsAdapter } = await import("./hlsAdapter");
    const adapter = await HlsAdapter.create(vi.fn());
    adapter.destroy();
    const hls = instances[0];

    expect(() => adapter.attach({} as HTMLAudioElement, "https://example.com/live.m3u8")).toThrow(/destroyed/);
    expect(hls.on).not.toHaveBeenCalled();
    expect(hls.loadSource).not.toHaveBeenCalled();
    expect(hls.attachMedia).not.toHaveBeenCalled();
  });

  it("does not advertise unimplemented recovery for nonfatal hls.js errors", async () => {
    const { instances } = mockHlsModule();
    const onError = vi.fn();
    const { HlsAdapter } = await import("./hlsAdapter");
    const adapter = await HlsAdapter.create(onError);
    adapter.attach({} as HTMLAudioElement, "https://example.com/live.m3u8");

    instances[0].emitError({ type: "networkError", details: "fragLoadError", fatal: false });

    expect(onError).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
