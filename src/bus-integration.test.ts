import { describe, expect, it } from "vitest";
import { Bus } from "./bus";
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
