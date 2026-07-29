import { describe, expect, it } from "vitest";
import { BasePlayback } from "./basePlayback";
import { OscillatorMixin } from "./oscillatorMixin";

describe("OscillatorMixin", () => {
  it("is a BasePlayback subclass without playback implementations", () => {
    expect(OscillatorMixin.prototype).toBeInstanceOf(BasePlayback);
    expect(Object.hasOwn(OscillatorMixin.prototype, "play")).toBe(false);
    expect(Object.hasOwn(OscillatorMixin.prototype, "pause")).toBe(false);
    expect(Object.hasOwn(OscillatorMixin.prototype, "stop")).toBe(false);
  });
});
