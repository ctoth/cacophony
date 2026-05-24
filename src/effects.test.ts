import { describe, expect, it } from "vitest";
import {
  BiquadEffect,
  isCacophonyBuiltBiquad,
  isCacophonyEffect,
  markAsCacophonyBiquad,
  ShareEffect,
} from "./effects";
import { cacophony } from "./setupTests";

describe("effects: markAsCacophonyBiquad / isCacophonyBuiltBiquad", () => {
  it("returns false for a raw biquad created directly on the context", () => {
    const raw = cacophony.context.createBiquadFilter();
    expect(isCacophonyBuiltBiquad(raw)).toBe(false);
  });

  it("returns true for a biquad produced by cacophony.createBiquadFilter", () => {
    const built = cacophony.createBiquadFilter({ type: "lowpass", frequency: 1000 });
    expect(isCacophonyBuiltBiquad(built)).toBe(true);
  });

  it("returns true after explicitly marking a node", () => {
    const raw = cacophony.context.createBiquadFilter();
    expect(isCacophonyBuiltBiquad(raw)).toBe(false);
    markAsCacophonyBiquad(raw);
    expect(isCacophonyBuiltBiquad(raw)).toBe(true);
  });

  it("returns false for non-node values", () => {
    expect(isCacophonyBuiltBiquad(null)).toBe(false);
    expect(isCacophonyBuiltBiquad(undefined)).toBe(false);
    expect(isCacophonyBuiltBiquad({})).toBe(false);
    expect(isCacophonyBuiltBiquad("filter")).toBe(false);
  });
});

describe("effects: isCacophonyEffect", () => {
  it("returns true for any object with a build function", () => {
    const effect = { build: () => cacophony.context.createGain() };
    expect(isCacophonyEffect(effect)).toBe(true);
  });

  it("returns false for objects without a build function", () => {
    expect(isCacophonyEffect({})).toBe(false);
    expect(isCacophonyEffect({ build: 42 })).toBe(false);
    expect(isCacophonyEffect(null)).toBe(false);
    expect(isCacophonyEffect(undefined)).toBe(false);
  });

  it("returns true for built-in BiquadEffect and ShareEffect", () => {
    const biquad = cacophony.createBiquadFilter({ frequency: 500 });
    expect(isCacophonyEffect(new BiquadEffect(biquad))).toBe(true);
    expect(isCacophonyEffect(new ShareEffect(cacophony.context.createGain()))).toBe(true);
  });
});

describe("effects: BiquadEffect", () => {
  it("build returns the wrapped biquad instance", () => {
    const biquad = cacophony.createBiquadFilter({ frequency: 800 });
    const effect = new BiquadEffect(biquad);
    expect(effect.build(cacophony.context)).toBe(biquad);
  });
});

describe("effects: ShareEffect", () => {
  it("build returns the wrapped node instance every time", () => {
    const node = cacophony.context.createGain();
    const effect = new ShareEffect(node);
    expect(effect.build(cacophony.context)).toBe(node);
    expect(effect.build(cacophony.context)).toBe(node);
  });
});

describe("Cacophony.shareEffect", () => {
  it("returns a CacophonyEffect that build()s to the supplied node", () => {
    const node = cacophony.context.createGain();
    const effect = cacophony.shareEffect(node);
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect.build(cacophony.context)).toBe(node);
  });
});
