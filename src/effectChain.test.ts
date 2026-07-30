import { describe, expect, it, vi } from "vitest";
import { EffectChain } from "./effectChain";
import { cacophony, expectNotReachable, expectPath } from "./setupTests";

describe("EffectChain", () => {
  it("reconciles built effect endpoints between caller-owned nodes", () => {
    const input = cacophony.context.createGain();
    const output = cacophony.context.createGain();
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const handle = cacophony.context.createGain();
    graphInput.connect(graphOutput);
    const chain = new EffectChain(input, output);

    expectPath(input, [], output);

    expect(chain.add({ input: graphInput, output: graphOutput, handle })).toBe(handle);

    expect(chain.nodes).toEqual([handle]);
    expectPath(input, [graphInput, graphOutput], output);
  });

  it("reorders and bypasses entries through the incremental chain machine", () => {
    const input = cacophony.context.createGain();
    const output = cacophony.context.createGain();
    const first = cacophony.context.createGain();
    const second = cacophony.context.createGain();
    const chain = new EffectChain(input, output);

    chain.add(first);
    chain.add(second);
    chain.setOrder([second, first]);

    expect(chain.nodes).toEqual([second, first]);
    expectPath(input, [second, first], output);

    chain.setBypassed(second, true);

    expect(chain.isBypassed(second)).toBe(true);
    expectPath(input, [first], output);
    expectNotReachable(input, second);
  });

  it("removes the entry before disposing its owned graph", () => {
    const input = cacophony.context.createGain();
    const output = cacophony.context.createGain();
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const dispose = vi.fn();
    const chain = new EffectChain(input, output);
    const handle = chain.add({ input: graphInput, output: graphOutput, dispose });

    chain.remove(handle);

    expect(chain.nodes).toEqual([]);
    expectPath(input, [], output);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
