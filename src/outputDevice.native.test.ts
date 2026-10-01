import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createNodeCacophony } from "./node";

describe.skipIf(!nodeBackendAvailable)("native Node output selection", () => {
  it("selects a silent sink at runtime on the same context", async () => {
    const { cacophony, context } = await createNodeCacophony({ sinkId: { type: "none" }, quiet: true });
    try {
      await cacophony.setOutputDevice({ type: "none" });
      expect(cacophony.outputDevice).toEqual({ type: "none" });
      expect(cacophony.context).toBe(context);
    } finally {
      cacophony.dispose();
      await context.close();
    }
  });
});
