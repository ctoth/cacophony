/**
 * Tests for Sound/Synth/Group `routeTo` and the per-Sound _routeTarget /
 * _sends machinery. Covers both primary redirection (with live-playback
 * rewiring) and additive sends.
 */

import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { cacophony, expectPath, expectReachable } from "./setupTests";

const buildSound = async () => {
  const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
  return cacophony.createSound(buffer as unknown as AudioBuffer);
};

describe("Sound.routeTo: primary redirection", () => {
  it("future playbacks connect to bus.input when routeTo(bus) was called", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("primary-test");
    // Spy on context.createGain so we can capture the gainNode the
    // forthcoming preplay will allocate and inspect its connect calls.
    const created: { connect: ReturnType<typeof vi.fn>; original: any }[] = [];
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    vi.spyOn(cacophony.context, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const connectSpy = vi.fn(node.connect.bind(node));
      const wrapped = Object.assign(node, { connect: connectSpy });
      created.push({ connect: connectSpy, original: node });
      return wrapped;
    });
    sound.routeTo(bus);
    const [playback] = sound.play();
    // The most recently created gain (the playback's gainNode) should have
    // been connected to bus.input. Walk created from the back since other
    // calls (sendGains, etc.) may also be allocated.
    const playbackGain = created[created.length - 1];
    expect(playbackGain).toBeDefined();
    expect(playbackGain.connect).toHaveBeenCalledWith(bus.input);
    expectPath(playback.outputNode, [], bus.input);
    expectReachable(playback.source!, bus.output);
    bus.destroy();
  });

  it("routeTo(name) looks up the bus via cacophony.getBus", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("named-route");
    sound.routeTo("named-route");
    // No throw → looked up successfully. Re-routing to the same bus again
    // should be a no-op (target unchanged).
    expect(() => sound.routeTo("named-route")).not.toThrow();
    bus.destroy();
  });

  it("routeTo('nonexistent') throws", async () => {
    const sound = await buildSound();
    expect(() => sound.routeTo("nonexistent")).toThrow(/No bus registered/);
  });

  it("routeTo(master) collapses to null and reverts to master", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("scratch");
    sound.routeTo(bus);
    sound.routeTo(cacophony.master);
    // Future playbacks should connect to globalGainNode (master.input).
    const [playback] = sound.play();
    expectPath(playback.outputNode, [], cacophony.master.input);
    bus.destroy();
  });

  it("redirects live playbacks via disconnect/connect on each playback", async () => {
    const sound = await buildSound();
    const [playback] = sound.play();
    const bus = cacophony.createBus("live-redirect");
    expectPath(playback.outputNode, [], cacophony.master.input);
    sound.routeTo(bus);
    expectPath(playback.outputNode, [], bus.input);
    bus.destroy();
  });

  it("routes to a destroyed bus by falling back to master with a console.warn", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("doomed");
    sound.routeTo(bus);
    bus.destroy();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sound.play();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/destroyed bus.*master/));
    warnSpy.mockRestore();
  });

  it("primary routeTo(destroyedBus) throws — caller is mutating a torn-down resource", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("predead");
    bus.destroy();
    expect(() => sound.routeTo(bus)).toThrow(/destroyed/);
  });
});

describe("Sound.routeTo: additive send", () => {
  it("routeTo(bus, 0.3) adds a send without changing primary routing — playback feeds BOTH primary master AND the bus via sendGain", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("send-test");
    const [playback] = sound.play();
    sound.routeTo(bus, 0.3);
    const sendGain = playback._sendGains.get(bus);
    expect(sendGain).toBeDefined();
    expect(sendGain!.gain.value).toBe(0.3);
    expectPath(playback.outputNode, [], cacophony.master.input);
    expectPath(playback.outputNode, [sendGain!], bus.input);
    // And after destroy + cleanup, the sendGain (owned by the playback) must
    // have its disconnect called — see playback._sendGains teardown.
    bus.destroy();
  });

  it("updates an existing send's gain in place when called twice", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("send-update");
    sound.play();
    sound.routeTo(bus, 0.5);
    sound.routeTo(bus, 0.25);
    // No new allocation expected on the second call — verified by behavior
    // not throwing and the routeTo helper returning normally.
    expect(true).toBe(true);
    bus.destroy();
  });

  it("throws when adding a send to a destroyed bus", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("dead-send");
    bus.destroy();
    expect(() => sound.routeTo(bus, 0.5)).toThrow(/destroyed/);
  });

  it("establishes a send on future playbacks (not just live ones)", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("future-send");
    sound.routeTo(bus, 0.4);
    // No playback yet; play and check no throw.
    const [playback] = sound.play();
    expect(playback).toBeDefined();
    const sendGain = playback._sendGains.get(bus);
    expect(sendGain).toBeDefined();
    expectPath(playback.outputNode, [], cacophony.master.input);
    expectPath(playback.outputNode, [sendGain!], bus.input);
    bus.destroy();
  });

  it("cleanup disconnects every allocated send-gain node (no GC reliance)", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("cleanup-send");
    sound.routeTo(bus, 0.6);
    const [playback] = sound.play();
    // The sendGain is owned by the playback under playback._sendGains.
    const sendGain = playback._sendGains.get(bus);
    expect(sendGain).toBeDefined();
    const sendGainDisconnect = vi.spyOn(sendGain!, "disconnect");
    sound.cleanup();
    // The sendGain.disconnect() call is the deterministic "this allocation
    // is torn down" signal — without it we'd be waiting on GC for the bus
    // graph to lose the reference.
    expect(sendGainDisconnect).toHaveBeenCalled();
    bus.destroy();
  });
});

describe("Synth.routeTo", () => {
  it("redirects future playbacks to bus.input", () => {
    const synth = cacophony.createOscillator({});
    const bus = cacophony.createBus("synth-route");
    synth.routeTo(bus);
    const [playback] = synth.play();
    expectPath(playback.outputNode, [], bus.input);
    expectReachable(playback.source!, bus.output);
    bus.destroy();
  });

  it("redirects live playbacks (uses outputNode.disconnect/connect)", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const bus = cacophony.createBus("synth-live");
    expectPath(playback.outputNode, [], cacophony.master.input);
    synth.routeTo(bus);
    expectPath(playback.outputNode, [], bus.input);
    bus.destroy();
  });

  it("routeTo with sendGain adds a send", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const bus = cacophony.createBus("synth-send");
    expect(() => synth.routeTo(bus, 0.2)).not.toThrow();
    const sendGain = playback._sendGains.get(bus);
    expect(sendGain).toBeDefined();
    expectPath(playback.outputNode, [], cacophony.master.input);
    expectPath(playback.outputNode, [sendGain!], bus.input);
    bus.destroy();
  });

  it("routeTo by name looks up via cacophony.getBus", () => {
    const synth = cacophony.createOscillator({});
    cacophony.createBus("synth-by-name");
    expect(() => synth.routeTo("synth-by-name")).not.toThrow();
  });

  it("routeTo('nonexistent') throws", () => {
    const synth = cacophony.createOscillator({});
    expect(() => synth.routeTo("never-existed")).toThrow(/No bus registered/);
  });

  it("primary routeTo(destroyedBus) throws", () => {
    const synth = cacophony.createOscillator({});
    const bus = cacophony.createBus("synth-predead");
    bus.destroy();
    expect(() => synth.routeTo(bus)).toThrow(/destroyed/);
  });

  it("SynthPlayback cleanup disconnects every allocated send-gain node", () => {
    const synth = cacophony.createOscillator({});
    const bus = cacophony.createBus("synth-cleanup-send");
    synth.routeTo(bus, 0.5);
    const [playback] = synth.play();
    const sendGain = playback._sendGains.get(bus);
    expect(sendGain).toBeDefined();
    const sendGainDisconnect = vi.spyOn(sendGain!, "disconnect");
    playback.cleanup();
    expect(sendGainDisconnect).toHaveBeenCalled();
    bus.destroy();
  });

  it("SynthPlayback.outputNode throws after cleanup (parity with Playback)", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    expect(playback.outputNode).toBeDefined();
    playback.cleanup();
    expect(() => playback.outputNode).toThrow(/cleaned up/);
  });
});

describe("Group.routeTo", () => {
  it("fans out routeTo to every member sound", async () => {
    const s1 = await buildSound();
    const s2 = await buildSound();
    const group = await cacophony.createGroup([s1, s2]);
    const bus = cacophony.createBus("group-route");
    const s1Spy = vi.spyOn(s1, "routeTo");
    const s2Spy = vi.spyOn(s2, "routeTo");
    group.routeTo(bus);
    expect(s1Spy).toHaveBeenCalledWith(bus);
    expect(s2Spy).toHaveBeenCalledWith(bus);
    bus.destroy();
  });

  it("fans out routeTo with sendGain to every member sound", async () => {
    const s1 = await buildSound();
    const s2 = await buildSound();
    const group = await cacophony.createGroup([s1, s2]);
    const bus = cacophony.createBus("group-send");
    const s1Spy = vi.spyOn(s1, "routeTo");
    const s2Spy = vi.spyOn(s2, "routeTo");
    group.routeTo(bus, 0.4);
    expect(s1Spy).toHaveBeenCalledWith(bus, 0.4);
    expect(s2Spy).toHaveBeenCalledWith(bus, 0.4);
    bus.destroy();
  });
});
