import { describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { cacophony } from "./setupTests";

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

  it("rejects a raw AudioNode (e.g. context.createGain())", async () => {
    const bus = new Bus(cacophony.context, null);
    const raw = cacophony.context.createGain();
    await expect(bus.addFilter(raw)).rejects.toThrow(/raw AudioNode/);
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
    await expect(bus.addFilter(filter)).rejects.toThrow(/same filter/);
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
    // Wrap createGain so the allocated sendGain's connect call is observable.
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const allocated: Array<{ node: any; connect: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const connectSpy = vi.fn(node.connect.bind(node));
      Object.assign(node, { connect: connectSpy });
      allocated.push({ node, connect: connectSpy });
      return node;
    });
    const outputConnectSpy = vi.spyOn(a.output, "connect");
    a.connect(b, 0.5);
    // First hop: a.output → sendGain (not b.input directly).
    expect(outputConnectSpy).toHaveBeenCalled();
    const firstCallTarget = outputConnectSpy.mock.calls[0]?.[0] as { gain?: { value: number } };
    expect(firstCallTarget).toBeDefined();
    expect(firstCallTarget).not.toBe(b.input);
    expect(firstCallTarget.gain?.value).toBe(0.5);
    // Second hop: sendGain → b.input. The sendGain was the LAST allocated
    // gain in this connect call (a.output and b.input were allocated earlier
    // when the buses were constructed).
    const sendGainRecord = allocated[allocated.length - 1];
    expect(sendGainRecord).toBeDefined();
    expect(sendGainRecord.node).toBe(firstCallTarget);
    expect(sendGainRecord.connect).toHaveBeenCalledWith(b.input);
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
});

describe("Bus: filter chain refresh", () => {
  it("re-inserts filters when one is added", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    expect(bus.filters).toEqual([f1, f2]);
  });

  it("removeFilter removes by identity and rebuilds the chain", async () => {
    const bus = new Bus(cacophony.context, null);
    const f1 = cacophony.createBiquadFilter({ frequency: 100 });
    const f2 = cacophony.createBiquadFilter({ frequency: 200 });
    await bus.addFilter(f1);
    await bus.addFilter(f2);
    bus.removeFilter(f1);
    expect(bus.filters).toEqual([f2]);
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
    expect(() => bus.removeFilter(filter)).toThrow(/never added/);
  });
});
