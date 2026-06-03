import { describe, expect, it } from "vitest";
import { parseFxToken } from "../../src/cli/commands";
import { aliasesFor, EFFECT_REGISTRY, parseKvParams } from "../../src/cli/effects-registry";

describe("parseKvParams", () => {
  it("coerces numeric params: 'decay=2.5,mix=0.6' -> {decay:2.5, mix:0.6}", () => {
    // reverb schema uses decayTime; `decay` is an alias for it.
    const schema = { decay: "num", mix: "num" } as const;
    expect(parseKvParams(schema, "decay=2.5,mix=0.6")).toEqual({ decay: 2.5, mix: 0.6 });
  });

  it("passes a string-alias value through unchanged: shape=tanh", () => {
    const schema = EFFECT_REGISTRY.distortion.schema;
    const out = parseKvParams(schema, "drive=50,shape=tanh");
    expect(out).toEqual({ drive: 50, shape: "tanh" });
    expect(typeof out.shape).toBe("string");
  });

  it("throws on an unknown key", () => {
    const schema = { decay: "num" } as const;
    expect(() => parseKvParams(schema, "bogus=1")).toThrow(/Unknown effect param "bogus"/);
  });

  it("throws on a non-numeric value for a num key", () => {
    const schema = { decay: "num" } as const;
    expect(() => parseKvParams(schema, "decay=abc")).toThrow(/expected a number/);
  });

  it("throws on a token without '='", () => {
    const schema = { decay: "num" } as const;
    expect(() => parseKvParams(schema, "decay")).toThrow(/expected key=value/);
  });

  it("returns {} for an empty spec", () => {
    expect(parseKvParams({ decay: "num" }, "")).toEqual({});
  });

  it("applies the reverb decay->decayTime alias", () => {
    const out = parseKvParams(EFFECT_REGISTRY.reverb.schema, "decay=2.5,mix=0.6", aliasesFor("reverb"));
    expect(out).toEqual({ decayTime: 2.5, mix: 0.6 });
  });
});

describe("parseFxToken (Risk R6: split name from k=v,k=v after parseArgs)", () => {
  it("splits 'reverb:decay=2.5,mix=0.6' into name + params, '=' and ',' surviving", () => {
    expect(parseFxToken("reverb:decay=2.5,mix=0.6")).toEqual({
      name: "reverb",
      params: "decay=2.5,mix=0.6",
    });
  });

  it("handles a bare effect name with no params", () => {
    expect(parseFxToken("distortion")).toEqual({ name: "distortion", params: "" });
  });

  it("only splits on the FIRST colon", () => {
    expect(parseFxToken("biquad:type=lowpass,frequency=400")).toEqual({
      name: "biquad",
      params: "type=lowpass,frequency=400",
    });
  });
});
