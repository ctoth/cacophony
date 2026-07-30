import { afterEach, describe, expect, it, vi } from "vitest";

describe("HlsAdapter optional peer loading", () => {
  afterEach(() => {
    vi.doUnmock("hls.js");
    vi.resetModules();
  });

  it("gives install guidance when hls.js is not installed", async () => {
    vi.doMock("hls.js", () => {
      throw new Error("Cannot find package 'hls.js'");
    });
    const { HlsAdapter } = await import("./hlsAdapter");

    await expect(HlsAdapter.create(vi.fn())).rejects.toThrow("install hls.js or use a direct stream URL");
  });
});
