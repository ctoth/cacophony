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

  it("allocates a sendGain when gain !== 1; output → sendGain → target", () => {
    const a = new Bus(cacophony.context, null);
    const b = new Bus(cacophony.context, null);
    const outputConnectSpy = vi.spyOn(a.output, "connect");
    a.connect(b, 0.5);
    // First connect on a.output is to the sendGain, not to b.input directly.
    expect(outputConnectSpy).toHaveBeenCalled();
    const firstCallTarget = outputConnectSpy.mock.calls[0]?.[0] as { gain?: { value: number } };
    expect(firstCallTarget).toBeDefined();
    expect(firstCallTarget).not.toBe(b.input);
    expect(firstCallTarget.gain?.value).toBe(0.5);
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
    a.connect(b, 0.3);
    // After connect with gain, an internal sendGain exists. Disconnect should
    // disconnect it from a.output AND disconnect the sendGain itself.
    const outputDisconnectSpy = vi.spyOn(a.output, "disconnect");
    a.disconnect(b);
    expect(outputDisconnectSpy).toHaveBeenCalled();
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

  it("removeFilter throws if the node was never added", () => {
    const bus = new Bus(cacophony.context, null);
    const filter = cacophony.createBiquadFilter({ frequency: 100 });
    expect(() => bus.removeFilter(filter)).toThrow(/never added/);
  });
});
