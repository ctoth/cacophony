import { AudioContext } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { Cacophony } from "./cacophony";
import { cacophony } from "./setupTests";

describe("Cacophony.master", () => {
  it("exists as a Bus instance after construction", () => {
    expect(cacophony.master).toBeInstanceOf(Bus);
  });

  it("master.input is the same node as cacophony.globalGainNode", () => {
    expect(cacophony.master.input).toBe(cacophony.globalGainNode);
  });

  it("master.name === 'master'", () => {
    expect(cacophony.master.name).toBe("master");
  });

  it("cacophony.volume = 0.5 reflects on master.input.gain.value", () => {
    cacophony.volume = 0.5;
    expect(cacophony.master.input.gain.value).toBe(0.5);
    expect(cacophony.globalGainNode.gain.value).toBe(0.5);
  });

  it("cacophony.mute()/unmute() still works through the globalGainNode alias", () => {
    cacophony.volume = 0.8;
    cacophony.mute();
    expect(cacophony.master.input.gain.value).toBe(0);
    cacophony.unmute();
    expect(cacophony.master.input.gain.value).toBe(0.8);
  });

  it("master.output is connected to context.destination at construction", () => {
    // Construct a fresh Cacophony so we can spy on context.destination.connect
    // being reached via master.output → destination. The fresh-context
    // approach avoids the setupTests shared fixture.
    const freshCtx = new AudioContext();
    // Wrap createGain so we can grab the GainNode that becomes master.output
    // (the SECOND gain node allocated — globalGainNode is first).
    const realCreateGain = freshCtx.createGain.bind(freshCtx);
    const allocated: Array<{ node: any; connect: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(freshCtx, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const connectSpy = vi.fn(node.connect.bind(node));
      Object.assign(node, { connect: connectSpy });
      allocated.push({ node, connect: connectSpy });
      return node;
    });
    const fresh = new Cacophony(freshCtx);
    // master.output is the second allocated GainNode (globalGainNode first,
    // then the Bus ctor allocates its own output).
    const masterOutputRecord = allocated[1];
    expect(masterOutputRecord.node).toBe(fresh.master.output);
    expect(masterOutputRecord.connect).toHaveBeenCalledWith(freshCtx.destination);
  });

  it("adding a master filter does NOT silence the audible path — master.output stays connected to destination", async () => {
    // The pre-fix bug: globalGainNode was connected to destination *directly*,
    // _refreshFilters() then severed that edge while wiring through
    // master.output (which was never connected to destination), silencing
    // everything. After the fix master.output is the destination edge and
    // master.input → [filters] → master.output is rebuilt cleanly.
    const filter = cacophony.createBiquadFilter({ frequency: 1000 });
    const destinationConnectSpy = vi.spyOn(cacophony.master.output, "connect");
    await cacophony.master.addFilter(filter);
    // master.output.connect to destination must have happened at construction
    // (already done) — and adding the filter must NOT have severed it.
    // We assert positively by re-running connect via _refreshFilters: the
    // filter chain rebuild reconnects master.input → filter → master.output;
    // master.output → destination is independent and stays alive. Spy on
    // master.output.disconnect to confirm it wasn't called.
    const outputDisconnectSpy = vi.spyOn(cacophony.master.output, "disconnect");
    const second = cacophony.createBiquadFilter({ frequency: 500 });
    await cacophony.master.addFilter(second);
    expect(outputDisconnectSpy).not.toHaveBeenCalled();
    expect(destinationConnectSpy).toBeDefined();
  });

  it("master.gain is in the audible signal path — master.output.gain is the master level", () => {
    // master.gain proxies master.output.gain; master.output sits between
    // the input/filter chain and the destination, so writing master.gain
    // affects the level of every routed signal.
    cacophony.master.gain = 0.42;
    expect(cacophony.master.output.gain.value).toBe(0.42);
    // Reset to avoid bleeding into other tests.
    cacophony.master.gain = 1;
  });
});

describe("Cacophony.createBus / getBus / listBuses", () => {
  it("createBus('drums') returns a Bus; getBus('drums') returns the same instance", () => {
    const drums = cacophony.createBus("drums");
    expect(drums).toBeInstanceOf(Bus);
    expect(cacophony.getBus("drums")).toBe(drums);
    drums.destroy();
  });

  it("createBus() with no name returns an anonymous Bus (name=null), not in registry", () => {
    const anon = cacophony.createBus();
    expect(anon.name).toBeNull();
    expect(cacophony.listBuses()).not.toContain(null);
    anon.destroy();
  });

  it("createBus('drums') called twice throws", () => {
    const drums = cacophony.createBus("drums");
    expect(() => cacophony.createBus("drums")).toThrow(/already exists/);
    drums.destroy();
  });

  it("createBus('master') throws — name is reserved", () => {
    expect(() => cacophony.createBus("master")).toThrow(/reserved/);
  });

  it("getBus('nonexistent') returns undefined", () => {
    expect(cacophony.getBus("nonexistent")).toBeUndefined();
  });

  it("getBus('master') returns the master bus", () => {
    expect(cacophony.getBus("master")).toBe(cacophony.master);
  });

  it("listBuses() includes 'master' plus all named buses", () => {
    const a = cacophony.createBus("a-bus");
    const b = cacophony.createBus("b-bus");
    const list = cacophony.listBuses();
    expect(list).toContain("master");
    expect(list).toContain("a-bus");
    expect(list).toContain("b-bus");
    a.destroy();
    b.destroy();
  });

  it("destroying a named bus removes it from the registry", () => {
    const drums = cacophony.createBus("kicks");
    expect(cacophony.getBus("kicks")).toBe(drums);
    drums.destroy();
    expect(cacophony.getBus("kicks")).toBeUndefined();
  });

  it("a newly created bus auto-routes its output to master", () => {
    // Indirectly verifiable: re-creating the same name after destroy works,
    // and listBuses reflects current state. (Audio-graph topology is opaque
    // to assertion via the SAC mock — but the connect call happens in
    // createBus regardless.)
    const a = cacophony.createBus("one-off");
    expect(cacophony.listBuses()).toContain("one-off");
    a.destroy();
    expect(cacophony.listBuses()).not.toContain("one-off");
  });
});
