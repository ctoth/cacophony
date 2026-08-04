import { describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { cacophony, expectPath } from "./setupTests";

describe("Bus: construction", () => {
  it("creates an anonymous bus with name=null when no name supplied", () => {
    const bus = new Bus(cacophony.context, null);
    expect(bus.name).toBeNull();
    expect(bus.destroyed).toBe(false);
  });

  it("creates a named bus with the supplied name", () => {
    const bus = new Bus(cacophony.context, "drums");
    expect(bus.name).toBe("drums");
  });

  it("allocates separate input and output GainNodes", () => {
    const bus = new Bus(cacophony.context, "fx");
    expect(bus.input).toBeDefined();
    expect(bus.output).toBeDefined();
    expect(bus.input).not.toBe(bus.output);
  });

  it("wires the input directly to the output before filters are added", () => {
    const bus = new Bus(cacophony.context, "dry");

    expectPath(bus.input, [], bus.output);
  });

  it("uses the externally supplied input GainNode when provided", () => {
    const supplied = cacophony.context.createGain();
    const bus = new Bus(cacophony.context, "master", supplied);
    expect(bus.input).toBe(supplied);
  });

  it("exposes the output gain via the .gain getter/setter", () => {
    const bus = new Bus(cacophony.context, null);
    bus.gain = 0.75;
    expect(bus.gain).toBe(0.75);
    expect(bus.output.gain.value).toBe(0.75);
  });
});

describe("Bus: addFilter discrimination", () => {
  it("accepts a Cacophony-built BiquadFilterNode directly", async () => {
    const bus = new Bus(cacophony.context, null);
    const filter = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(filter);
    expect(bus.filters).toContain(filter);
  });

  it("accepts a CacophonyEffect by awaiting build()", async () => {
    const bus = new Bus(cacophony.context, null);
    const node = cacophony.context.createGain();
    const effect = { build: vi.fn().mockReturnValue(node) };
    await bus.addFilter(effect);
    expect(effect.build).toHaveBeenCalledWith(cacophony.context);
    expect(bus.filters).toContain(node);
  });

  it("awaits async CacophonyEffect.build()", async () => {
    const bus = new Bus(cacophony.context, null);
    const node = cacophony.context.createGain();
    const effect = { build: () => Promise.resolve(node) };
    await bus.addFilter(effect);
    expect(bus.filters).toContain(node);
  });

  it("accepts a CacophonyEffect endpoint graph and chains by input/output endpoints", async () => {
    const bus = new Bus(cacophony.context, null);
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const handle = graphInput;
    const effect = { build: vi.fn().mockReturnValue({ input: graphInput, output: graphOutput, handle }) };

    const busInputConnect = vi.spyOn(bus.input, "connect");
    const graphOutputConnect = vi.spyOn(graphOutput, "connect");

    const returned = await bus.addFilter(effect);

    expect(returned).toBe(handle);
    expect(bus.filters).toEqual([handle]);
    expect(busInputConnect).toHaveBeenCalledWith(graphInput);
    expect(graphOutputConnect).toHaveBeenCalledWith(bus.output);
  });

  it("rejects adding the same graph handle twice", async () => {
    const bus = new Bus(cacophony.context, null);
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const effect = { build: () => ({ input: graphInput, output: graphOutput, handle: graphInput }) };

    await bus.addFilter(effect);
    await expect(bus.addFilter(effect)).rejects.toThrow("Bus: cannot add the same effect node twice");
  });

  it("disposes a built graph rejected for a duplicate handle", async () => {
    const bus = new Bus(cacophony.context, null);
    const handle = cacophony.context.createGain();
    const firstGraph = {
      input: cacophony.context.createGain(),
      output: cacophony.context.createGain(),
      handle,
    };
    const disposeDuplicate = vi.fn();
    const duplicateGraph = {
      input: cacophony.context.createGain(),
      output: cacophony.context.createGain(),
      handle,
      dispose: disposeDuplicate,
    };
    const effect = {
      build: vi.fn().mockReturnValueOnce(firstGraph).mockReturnValueOnce(duplicateGraph),
    };

    await bus.addFilter(effect);

    await expect(bus.addFilter(effect)).rejects.toThrow("Bus: cannot add the same effect node twice");
    expect(disposeDuplicate).toHaveBeenCalledOnce();
    expect(bus.filters).toEqual([handle]);
  });

  it("rejects a raw AudioNode synchronously (e.g. context.createGain())", () => {
    const bus = new Bus(cacophony.context, null);
    const raw = cacophony.context.createGain();
    expect(() => bus.addFilter(raw)).toThrow(/raw AudioNode/);
  });

  it("preserves declaration order when async effect builds resolve out of order", async () => {
    const bus = new Bus(cacophony.context, null);
    const first = cacophony.context.createGain();
    const second = cacophony.context.createGain();
    let resolveFirst!: (node: AudioNode) => void;
    let resolveSecond!: (node: AudioNode) => void;

    const firstAdded = bus.addFilter({
      build: () => new Promise<AudioNode>((resolve) => (resolveFirst = resolve)),
    });
    const secondAdded = bus.addFilter({
      build: () => new Promise<AudioNode>((resolve) => (resolveSecond = resolve)),
    });

    resolveSecond(second);
    await secondAdded;
    expect(bus.filters).toEqual([second]);
    expectPath(bus.input, [second], bus.output);

    resolveFirst(first);
    await firstAdded;
    expect(bus.filters).toEqual([first, second]);
    expectPath(bus.input, [first, second], bus.output);
  });

  it("accepts a ShareEffect-wrapped raw AudioNode", async () => {
    const bus = new Bus(cacophony.context, null);
    const raw = cacophony.context.createGain();
    const effect = cacophony.shareEffect(raw);
    await bus.addFilter(effect);
    expect(bus.filters).toContain(raw);
  });

  it("rejects adding the same node twice", async () => {
    const bus = new Bus(cacophony.context, null);
    const filter = cacophony.createBiquadFilter({ frequency: 500 });
    await bus.addFilter(filter);
    await expect(bus.addFilter(filter)).rejects.toThrow("Bus: cannot add the same effect node twice");
  });
});

describe("Bus: per-edge gain on connect", () => {
  it("connects directly (no GainNode allocated) when gain omitted", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    const connectSpy = vi.spyOn(a.output, "connect");
    a.connect(b);
    expect(connectSpy).toHaveBeenCalledWith(b.input);
  });

  it("connects directly when gain === 1", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    const connectSpy = vi.spyOn(a.output, "connect");
    a.connect(b, 1);
    expect(connectSpy).toHaveBeenCalledWith(b.input);
  });

  it("allocates a sendGain when gain !== 1; output → sendGain → target.input", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    a.connect(b, 0.5);
    const sendGain = (
      a as unknown as {
        _sendGains: Map<Bus, GainNode>;
      }
    )._sendGains.get(b);
    expect(sendGain).toBeDefined();
    expect(sendGain!.gain.value).toBe(0.5);
    expectPath(a.output, [sendGain!], b.input);
  });

  it("connects to a raw AudioNode target", () => {
    const a = new Bus(cacophony.context, null);
    const dest = cacophony.context.createGain();
    const connectSpy = vi.spyOn(a.output, "connect");
    a.connect(dest);
    expect(connectSpy).toHaveBeenCalledWith(dest);
  });

  it("disconnect(target) tears down the direct connection", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    a.connect(b);
    const disconnectSpy = vi.spyOn(a.output, "disconnect");
    a.disconnect(b);
    expect(disconnectSpy).toHaveBeenCalledWith(b.input);
  });

  it("disconnect(target) tears down the sendGain when one was allocated", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    // Capture the sendGain node by wrapping its disconnect so we can assert
    // the allocated GainNode itself was disconnected (not just the output edge).
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const sendDisconnectSpies: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const disconnectSpy = vi.fn(node.disconnect.bind(node));
      Object.assign(node, { disconnect: disconnectSpy });
      sendDisconnectSpies.push(disconnectSpy);
      return node;
    });
    a.connect(b, 0.3);
    // The sendGain is the LAST allocated GainNode.
    const sendGainDisconnect = sendDisconnectSpies[sendDisconnectSpies.length - 1];
    expect(sendGainDisconnect).toBeDefined();
    const outputDisconnectSpy = vi.spyOn(a.output, "disconnect");
    a.disconnect(b);
    // a.output disconnected from the sendGain.
    expect(outputDisconnectSpy).toHaveBeenCalled();
    // AND the sendGain itself was disconnected (its outgoing edge to b.input).
    expect(sendGainDisconnect).toHaveBeenCalled();
    // Re-connecting after disconnect uses the no-gain path → direct edge again.
    const reconnectSpy = vi.spyOn(a.output, "connect");
    a.connect(b);
    expect(reconnectSpy).toHaveBeenCalledWith(b.input);
  });

  it("updates an existing sendGain in place when reconnecting with a new gain", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    a.connect(b, 0.5);
    // Force visibility into the sendGain by spying on createGain to count
    // allocations after the first connect.
    const allocationsBefore = vi.spyOn(cacophony.context, "createGain").mock.calls.length;
    a.connect(b, 0.25);
    const allocationsAfter = vi.spyOn(cacophony.context, "createGain").mock.calls.length;
    // No new gain allocated (the existing send-gain's value should be mutated).
    expect(allocationsAfter).toBe(allocationsBefore);
  });
});

describe("Bus: destroy lifecycle", () => {
  it("destroy() sets destroyed=true and is idempotent", () => {
    const bus = new Bus(cacophony.context, null);
    bus.destroy();
    expect(bus.destroyed).toBe(true);
    expect(() => bus.destroy()).not.toThrow();
  });

  it("calls the onDestroy hook exactly once", () => {
    const onDestroy = vi.fn();
    const bus = new Bus(cacophony.context, "named", undefined, onDestroy);
    bus.destroy();
    bus.destroy();
    expect(onDestroy).toHaveBeenCalledTimes(1);
  });

  it("addFilter throws after destroy", async () => {
    const bus = new Bus(cacophony.context, null);
    bus.destroy();
    const filter = cacophony.createBiquadFilter({ frequency: 200 });
    await expect(bus.addFilter(filter)).rejects.toThrow(/destroyed/);
  });

  it("connect throws after destroy", () => {
    const bus = new Bus(cacophony.context, null);
    const other = new Bus(cacophony.context, null);
    bus.destroy();
    expect(() => bus.connect(other)).toThrow(/destroyed/);
  });

  it("disconnect throws after destroy", () => {
    const bus = new Bus(cacophony.context, null);
    const other = new Bus(cacophony.context, null);
    bus.connect(other);
    bus.destroy();
    expect(() => bus.disconnect(other)).toThrow(/destroyed/);
  });

  it("removeFilter throws after destroy", () => {
    const bus = new Bus(cacophony.context, null);
    bus.destroy();
    const filter = cacophony.createBiquadFilter({ frequency: 200 });
    expect(() => bus.removeFilter(filter)).toThrow(/destroyed/);
  });

  it("destroy() disconnects input, output, every filter, every sendGain, and fires onDestroy", async () => {
    // Wrap createGain so we can spy on each allocated node's disconnect.
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const allocated: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const disconnectSpy = vi.fn(node.disconnect.bind(node));
      Object.assign(node, { disconnect: disconnectSpy });
      allocated.push(disconnectSpy);
      return node;
    });

    const onDestroy = vi.fn();
    const bus = new Bus(cacophony.context, "destroy-paths", undefined, onDestroy);
    // bus.input and bus.output were the first two GainNodes allocated.
    const inputDisconnect = allocated[0];
    const outputDisconnect = allocated[1];

    // Add a filter so the destroy() path walks the filter list too.
    const filter = cacophony.createBiquadFilter({ frequency: 500 });
    const filterDisconnectSpy = vi.spyOn(filter, "disconnect");
    await bus.addFilter(filter);

    // Add a gained connection so destroy walks the _sendGains map.
    const target = new Bus(cacophony.context, null);
    bus.connect(target, 0.4);
    // The sendGain is the LAST createGain allocation (target's input/output
    // were allocated by the Bus(target) ctor before connect ran).
    const sendGainDisconnect = allocated[allocated.length - 1];

    bus.destroy();

    expect(inputDisconnect).toHaveBeenCalled();
    expect(outputDisconnect).toHaveBeenCalled();
    expect(filterDisconnectSpy).toHaveBeenCalled();
    expect(sendGainDisconnect).toHaveBeenCalled();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(bus.destroyed).toBe(true);
  });

  it("destroy() calls dispose on owned endpoint-graph filters", async () => {
    const bus = new Bus(cacophony.context, null);
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const dispose = vi.fn();
    await bus.addFilter({ build: () => ({ input: graphInput, output: graphOutput, dispose }) });

    bus.destroy();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup and unregisters a named bus when filter disposal throws", async () => {
    const bus = cacophony.createBus("dispose-throws-cleanup");
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const dispose = vi.fn(() => {
      throw new Error("dispose failed");
    });
    await bus.addFilter({ build: () => ({ input: graphInput, output: graphOutput, dispose }) });
    const inputDisconnect = vi.spyOn(bus.input, "disconnect");
    const outputDisconnect = vi.spyOn(bus.output, "disconnect");

    expect(() => bus.destroy()).not.toThrow();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(inputDisconnect).toHaveBeenCalled();
    expect(outputDisconnect).toHaveBeenCalled();
    expect(cacophony.getBus("dispose-throws-cleanup")).toBeUndefined();

    const replacement = cacophony.createBus("dispose-throws-cleanup");
    replacement.destroy();
  });
});

describe("Bus: filter chain refresh", () => {
  it("re-inserts filters when one is added", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    expect(bus.filters).toEqual([f1, f2]);
    expectPath(bus.input, [f1, f2], bus.output);
  });

  it("removeFilter removes by identity and rebuilds the chain", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    bus.removeFilter(f1);
    expect(bus.filters).toEqual([f2]);
    expectPath(bus.input, [f2], bus.output);
  });

  it("removeFilter tears down an owned endpoint graph after removing its chain edges", async () => {
    const bus = new Bus(cacophony.context, null);
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const dispose = vi.fn();
    const handle = await bus.addFilter({ build: () => ({ input: graphInput, output: graphOutput, dispose }) });

    bus.removeFilter(handle);

    expect(bus.filters).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("refreshes only this bus's edges when a filter node is shared", async () => {
    const shared = cacophony.context.createGain();
    const busA = new Bus(cacophony.context, "a");
    const busB = new Bus(cacophony.context, "b");

    await busA.addFilter(cacophony.shareEffect(shared));
    await busB.addFilter(cacophony.shareEffect(shared));

    const disconnectShared = vi.spyOn(shared, "disconnect");
    const secondFilter = cacophony.createBiquadFilter({ frequency: 200 });
    await busB.addFilter(secondFilter);

    expect(disconnectShared).not.toHaveBeenCalledWith();
    expect(disconnectShared).not.toHaveBeenCalledWith(busA.output);
    expect(disconnectShared).toHaveBeenCalledWith(busB.output);
  });

  it("removeFilter throws if the node was never added", () => {
    const bus = new Bus(cacophony.context, null);
    const filter = cacophony.createBiquadFilter({ frequency: 100 });
    expect(() => bus.removeFilter(filter)).toThrow("Bus: cannot remove an effect that was never added");
  });

  it("adding a filter only touches the changed tail edge, not the unchanged head", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    const f4 = cacophony.createBiquadFilter({ frequency: 400 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);
    // Chain is now input → f1 → f2 → f3 → output.

    const inputConnect = vi.spyOn(bus.input, "connect");
    const inputDisconnect = vi.spyOn(bus.input, "disconnect");
    const f1Connect = vi.spyOn(f1, "connect");
    const f1Disconnect = vi.spyOn(f1, "disconnect");
    const f2Connect = vi.spyOn(f2, "connect");
    const f2Disconnect = vi.spyOn(f2, "disconnect");
    const f3Connect = vi.spyOn(f3, "connect");
    const f3Disconnect = vi.spyOn(f3, "disconnect");
    const f4Connect = vi.spyOn(f4, "connect");

    await bus.addFilter(f4);
    // Chain is now input → f1 → f2 → f3 → f4 → output.

    // The only edge removed is the old f3 → output tail.
    expect(f3Disconnect).toHaveBeenCalledTimes(1);
    expect(f3Disconnect).toHaveBeenCalledWith(bus.output);
    // The only new edges are f3 → f4 and f4 → output.
    expect(f3Connect).toHaveBeenCalledTimes(1);
    expect(f3Connect).toHaveBeenCalledWith(f4);
    expect(f4Connect).toHaveBeenCalledTimes(1);
    expect(f4Connect).toHaveBeenCalledWith(bus.output);

    // The unchanged head input → f1 → f2 → f3 is untouched.
    expect(inputConnect).not.toHaveBeenCalled();
    expect(inputDisconnect).not.toHaveBeenCalled();
    expect(f1Connect).not.toHaveBeenCalled();
    expect(f1Disconnect).not.toHaveBeenCalled();
    expect(f2Connect).not.toHaveBeenCalled();
    expect(f2Disconnect).not.toHaveBeenCalled();

    expect(bus.filters).toEqual([f1, f2, f3, f4]);
  });

  it("removing a middle filter only touches the edges around it", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);
    // Chain is now input → f1 → f2 → f3 → output.

    const inputConnect = vi.spyOn(bus.input, "connect");
    const inputDisconnect = vi.spyOn(bus.input, "disconnect");
    const f1Connect = vi.spyOn(f1, "connect");
    const f1Disconnect = vi.spyOn(f1, "disconnect");
    const f2Connect = vi.spyOn(f2, "connect");
    const f2Disconnect = vi.spyOn(f2, "disconnect");
    const f3Connect = vi.spyOn(f3, "connect");
    const f3Disconnect = vi.spyOn(f3, "disconnect");

    bus.removeFilter(f2);
    // Chain is now input → f1 → f3 → output.

    // f2's two edges (f1 → f2 and f2 → f3) are disconnected.
    expect(f1Disconnect).toHaveBeenCalledTimes(1);
    expect(f1Disconnect).toHaveBeenCalledWith(f2);
    expect(f2Disconnect).toHaveBeenCalledTimes(1);
    expect(f2Disconnect).toHaveBeenCalledWith(f3);
    // The single new bridging edge f1 → f3 is connected.
    expect(f1Connect).toHaveBeenCalledTimes(1);
    expect(f1Connect).toHaveBeenCalledWith(f3);

    // input → f1 and f3 → output are untouched.
    expect(inputConnect).not.toHaveBeenCalled();
    expect(inputDisconnect).not.toHaveBeenCalled();
    expect(f2Connect).not.toHaveBeenCalled();
    expect(f3Connect).not.toHaveBeenCalled();
    expect(f3Disconnect).not.toHaveBeenCalled();

    expect(bus.filters).toEqual([f1, f3]);
  });

  it("setFilterOrder reorders the chain to the supplied permutation", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);

    bus.setFilterOrder([f3, f1, f2]);
    expect(bus.filters).toEqual([f3, f1, f2]);
  });

  it("setFilterOrder throws when given a non-permutation", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    const foreign = cacophony.createBiquadFilter({ frequency: 999 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);

    // Wrong length (subset).
    expect(() => bus.setFilterOrder([f1, f2])).toThrow("Bus: effect order must be a permutation of the current nodes");
    // Right length but contains a foreign node.
    expect(() => bus.setFilterOrder([f1, f2, foreign])).toThrow(
      "Bus: effect order must be a permutation of the current nodes",
    );
    // Right length but contains a duplicate.
    expect(() => bus.setFilterOrder([f1, f2, f2])).toThrow(
      "Bus: effect order must be a permutation of the current nodes",
    );
  });
});

describe("Bus: addFilter returns the built node", () => {
  it("returns the same node it added (a biquad)", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const n = await bus.addFilter(biquad);
    expect(n).toBe(biquad);
    expect(bus.filters.includes(n)).toBe(true);
  });
});

describe("Bus: rampFilterParam", () => {
  it("uses endpoint-graph params before probing the handle node", async () => {
    const bus = new Bus(cacophony.context, null);
    const graphInput = cacophony.context.createGain();
    const graphOutput = cacophony.context.createGain();
    const dry = cacophony.context.createGain().gain;
    const setSpy = vi.spyOn(dry, "setValueAtTime");

    const handle = await bus.addFilter({
      build: () => ({ input: graphInput, output: graphOutput, handle: graphInput, params: { dry } }),
    });

    bus.rampFilterParam(handle, "dry", 0.25);

    expect(setSpy).toHaveBeenCalledWith(0.25, handle.context.currentTime);
    setSpy.mockRestore();
  });

  it("ramps a native biquad param linearly, pinning the start", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);
    // The mocked context exposes a real `.frequency` AudioParam with the ramp
    // scheduling methods.
    const freq = (
      biquad as unknown as {
        frequency: {
          value: number;
          setValueAtTime: (v: number, t: number) => unknown;
          linearRampToValueAtTime: (v: number, t: number) => unknown;
        };
      }
    ).frequency;
    const now = (node as unknown as { context: { currentTime: number } }).context.currentTime;
    const startValue = freq.value;

    const setSpy = vi.spyOn(freq, "setValueAtTime");
    const linSpy = vi.spyOn(freq, "linearRampToValueAtTime");

    bus.rampFilterParam(node, "frequency", 800, { duration: 500 });

    // Start pinned at the current value, then a linear ramp to the target.
    expect(setSpy).toHaveBeenCalledWith(startValue, now);
    expect(linSpy).toHaveBeenCalledTimes(1);
    const [rampValue, endTime] = linSpy.mock.calls[0] as [number, number];
    expect(rampValue).toBe(800);
    expect(endTime).toBeCloseTo(now + 0.5, 10);

    setSpy.mockRestore();
    linSpy.mockRestore();
  });

  it("sets the value instantly when duration is omitted", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);
    const freq = (
      biquad as unknown as {
        frequency: {
          setValueAtTime: (v: number, t: number) => unknown;
          linearRampToValueAtTime: (v: number, t: number) => unknown;
          exponentialRampToValueAtTime: (v: number, t: number) => unknown;
        };
      }
    ).frequency;
    const now = (node as unknown as { context: { currentTime: number } }).context.currentTime;

    const setSpy = vi.spyOn(freq, "setValueAtTime");
    const linSpy = vi.spyOn(freq, "linearRampToValueAtTime");
    const expSpy = vi.spyOn(freq, "exponentialRampToValueAtTime");

    bus.rampFilterParam(node, "frequency", 800);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(800, now);
    expect(linSpy).not.toHaveBeenCalled();
    expect(expSpy).not.toHaveBeenCalled();

    setSpy.mockRestore();
    linSpy.mockRestore();
    expSpy.mockRestore();
  });

  it("uses an exponential ramp when type is 'exponential'", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);
    const freq = (
      biquad as unknown as {
        frequency: {
          value: number;
          setValueAtTime: (v: number, t: number) => unknown;
          linearRampToValueAtTime: (v: number, t: number) => unknown;
          exponentialRampToValueAtTime: (v: number, t: number) => unknown;
        };
      }
    ).frequency;
    const now = (node as unknown as { context: { currentTime: number } }).context.currentTime;

    const setSpy = vi.spyOn(freq, "setValueAtTime");
    const linSpy = vi.spyOn(freq, "linearRampToValueAtTime");
    const expSpy = vi.spyOn(freq, "exponentialRampToValueAtTime");

    bus.rampFilterParam(node, "frequency", 800, { type: "exponential", duration: 200 });

    expect(setSpy).toHaveBeenCalledWith(freq.value, now);
    expect(linSpy).not.toHaveBeenCalled();
    expect(expSpy).toHaveBeenCalledTimes(1);
    const [rampValue, endTime] = expSpy.mock.calls[0] as [number, number];
    expect(rampValue).toBe(800);
    expect(endTime).toBeCloseTo(now + 0.2, 10);

    setSpy.mockRestore();
    linSpy.mockRestore();
    expSpy.mockRestore();
  });

  it("warns and no-ops (no throw) when the node is not on the bus", async () => {
    const bus = new Bus(cacophony.context, null);
    const onBus = cacophony.createBiquadFilter({ frequency: 100 });
    await bus.addFilter(onBus);
    const notOnBus = cacophony.createBiquadFilter({ frequency: 200 });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const freq = (notOnBus as unknown as { frequency: { setValueAtTime: (v: number, t: number) => unknown } })
      .frequency;
    const setSpy = vi.spyOn(freq, "setValueAtTime");

    expect(() => bus.rampFilterParam(notOnBus, "frequency", 1)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // No scheduling happened on a node that is not on the bus.
    expect(setSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("warns and no-ops (no throw) for a bogus param name on a valid node", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => bus.rampFilterParam(node, "totallyBogusParam", 1)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("throws only when the bus has been destroyed", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);
    bus.destroy();
    expect(() => bus.rampFilterParam(node, "frequency", 1)).toThrow();
  });
});

describe("Bus: per-filter bypass", () => {
  it("bypassing a middle filter skips it (input → f1 → f3 → output) and preserves filters order", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);
    // Chain is now input → f1 → f2 → f3 → output.

    const f1Connect = vi.spyOn(f1, "connect");
    const f1Disconnect = vi.spyOn(f1, "disconnect");
    const f2Connect = vi.spyOn(f2, "connect");
    const f2Disconnect = vi.spyOn(f2, "disconnect");

    bus.setFilterBypassed(f2, true);
    // Chain is now input → f1 → f3 → output, with f2 skipped.

    // The two edges around f2 (f1 → f2 and f2 → f3) are disconnected.
    expect(f1Disconnect).toHaveBeenCalledTimes(1);
    expect(f1Disconnect).toHaveBeenCalledWith(f2);
    expect(f2Disconnect).toHaveBeenCalledTimes(1);
    expect(f2Disconnect).toHaveBeenCalledWith(f3);
    // The single bridging edge f1 → f3 is connected.
    expect(f1Connect).toHaveBeenCalledTimes(1);
    expect(f1Connect).toHaveBeenCalledWith(f3);
    // f2 receives no inbound connect (nothing wires into a bypassed node).
    expect(f2Connect).not.toHaveBeenCalled();

    // filters STILL reports all three in order; identity preserved.
    expect(bus.filters).toEqual([f1, f2, f3]);
    expect(bus.isFilterBypassed(f2)).toBe(true);
    expect(bus.isFilterBypassed(f1)).toBe(false);
    expect(bus.isFilterBypassed(f3)).toBe(false);
  });

  it("un-bypassing restores the node incrementally (f1 → f3 dropped, f1 → f2 and f2 → f3 reconnected)", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);
    bus.setFilterBypassed(f2, true);
    // Chain is now input → f1 → f3 → output.

    const f1Connect = vi.spyOn(f1, "connect");
    const f1Disconnect = vi.spyOn(f1, "disconnect");
    const f2Connect = vi.spyOn(f2, "connect");

    bus.setFilterBypassed(f2, false);
    // Chain is back to input → f1 → f2 → f3 → output.

    // The bridging edge f1 → f3 is dropped.
    expect(f1Disconnect).toHaveBeenCalledTimes(1);
    expect(f1Disconnect).toHaveBeenCalledWith(f3);
    // f1 → f2 and f2 → f3 are reconnected.
    expect(f1Connect).toHaveBeenCalledTimes(1);
    expect(f1Connect).toHaveBeenCalledWith(f2);
    expect(f2Connect).toHaveBeenCalledTimes(1);
    expect(f2Connect).toHaveBeenCalledWith(f3);

    expect(bus.filters).toEqual([f1, f2, f3]);
    expect(bus.isFilterBypassed(f2)).toBe(false);
  });

  it("bypassing the head wires input → f2", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    // Chain is now input → f1 → f2 → output.

    const inputConnect = vi.spyOn(bus.input, "connect");

    bus.setFilterBypassed(f1, true);
    // Chain is now input → f2 → output (f1 skipped).

    expect(inputConnect).toHaveBeenCalledTimes(1);
    expect(inputConnect).toHaveBeenCalledWith(f2);
    expect(bus.filters).toEqual([f1, f2]);
    expect(bus.isFilterBypassed(f1)).toBe(true);
  });

  it("bypassing the tail wires f1 → output", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    // Chain is now input → f1 → f2 → output.

    const f1Connect = vi.spyOn(f1, "connect");

    bus.setFilterBypassed(f2, true);
    // Chain is now input → f1 → output (f2 skipped).

    expect(f1Connect).toHaveBeenCalledTimes(1);
    expect(f1Connect).toHaveBeenCalledWith(bus.output);
    expect(bus.filters).toEqual([f1, f2]);
    expect(bus.isFilterBypassed(f2)).toBe(true);
  });

  it("bypassing every filter collapses to the direct input → output edge", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    const f3 = cacophony.createBiquadFilter({ frequency: 300 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    await bus.addFilter(f3);

    bus.setFilterBypassed(f1, true);
    bus.setFilterBypassed(f2, true);

    const inputConnect = vi.spyOn(bus.input, "connect");
    bus.setFilterBypassed(f3, true);
    // With all three bypassed the desired chain is the direct edge.

    expect(inputConnect).toHaveBeenCalledTimes(1);
    expect(inputConnect).toHaveBeenCalledWith(bus.output);
    expect(bus.filters).toEqual([f1, f2, f3]);
    expect(bus.isFilterBypassed(f1)).toBe(true);
    expect(bus.isFilterBypassed(f2)).toBe(true);
    expect(bus.isFilterBypassed(f3)).toBe(true);
  });

  it("a bypassed node's params survive: rampFilterParam still schedules on it", async () => {
    const bus = new Bus(cacophony.context, null);
    const biquad = cacophony.createBiquadFilter({ frequency: 100 });
    const node = await bus.addFilter(biquad);

    bus.setFilterBypassed(node, true);

    const freq = (
      biquad as unknown as {
        frequency: { setValueAtTime: (v: number, t: number) => unknown };
      }
    ).frequency;
    const setSpy = vi.spyOn(freq, "setValueAtTime");

    // The node is alive (still in _filterNodes), just unwired — automation works.
    expect(() => bus.rampFilterParam(node, "frequency", 800)).not.toThrow();
    expect(setSpy).toHaveBeenCalledTimes(1);

    setSpy.mockRestore();
  });

  it("setFilterBypassed throws for a node that was never added", async () => {
    const bus = new Bus(cacophony.context, null);
    const onBus = cacophony.createBiquadFilter({ frequency: 100 });
    await bus.addFilter(onBus);
    const foreign = cacophony.createBiquadFilter({ frequency: 999 });

    expect(() => bus.setFilterBypassed(foreign, true)).toThrow("Bus: cannot bypass an effect that was never added");
  });

  it("setFilterBypassed throws after the bus is destroyed", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    await bus.addFilter(f1);
    bus.destroy();
    expect(() => bus.setFilterBypassed(f1, true)).toThrow(/destroyed/);
  });

  it("removing a bypassed node clears its bypass; re-adding wires it back into the chain", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);

    bus.setFilterBypassed(f2, true);
    expect(bus.isFilterBypassed(f2)).toBe(true);

    bus.removeFilter(f2);
    expect(bus.filters).toEqual([f1]);

    const f1Connect = vi.spyOn(f1, "connect");
    await bus.addFilter(f2);
    // Chain is now input → f1 → f2 → output again — not phantom-bypassed.

    expect(bus.isFilterBypassed(f2)).toBe(false);
    expect(bus.filters).toEqual([f1, f2]);
    expect(f1Connect).toHaveBeenCalledWith(f2);
  });

  it("isFilterBypassed returns false for a node that was never added", () => {
    const bus = new Bus(cacophony.context, null);
    const foreign = cacophony.createBiquadFilter({ frequency: 100 });
    expect(bus.isFilterBypassed(foreign)).toBe(false);
  });

  it("setFilterBypassed to the same state is a no-op (no chain churn)", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    bus.setFilterBypassed(f1, true);

    const inputConnect = vi.spyOn(bus.input, "connect");
    const inputDisconnect = vi.spyOn(bus.input, "disconnect");
    const f2Connect = vi.spyOn(f2, "connect");

    // Already bypassed → no-op.
    bus.setFilterBypassed(f1, true);

    expect(inputConnect).not.toHaveBeenCalled();
    expect(inputDisconnect).not.toHaveBeenCalled();
    expect(f2Connect).not.toHaveBeenCalled();
    expect(bus.isFilterBypassed(f1)).toBe(true);
  });
});
