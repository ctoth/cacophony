import { describe, expect, it, vi } from "vitest";
import { nodeBackendAvailable } from "./backend-available";

describe.skipIf(!nodeBackendAvailable)("Node factory configuration before allocation", () => {
  it.each([-1, NaN, Infinity])("rejects tau %s before allocating a backend context", async (tau) => {
    vi.resetModules();
    const allocate = vi.fn(function allocateContext() {
      throw new Error("Backend context was allocated");
    });
    vi.doMock("node-web-audio-api", () => ({ AudioContext: allocate, OfflineAudioContext: allocate }));
    try {
      const { createNodeCacophony, createOfflineNodeCacophony } = await import("./node");
      await expect(createNodeCacophony({ spatialSmoothingTau: tau })).rejects.toThrow(RangeError);
      await expect(
        createOfflineNodeCacophony({ length: 48000, sampleRate: 48000, spatialSmoothingTau: tau }),
      ).rejects.toThrow(RangeError);
      expect(allocate).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("node-web-audio-api");
      vi.resetModules();
    }
  });
});
