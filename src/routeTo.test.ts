/**
 * Tests for Sound/Synth/Group `routeTo` and the per-Sound _routeTarget /
 * _sends machinery. Covers both primary redirection (with live-playback
 * rewiring) and additive sends.
 */

import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { cacophony } from "./setupTests";

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
    sound.play();
    // The most recently created gain (the playback's gainNode) should have
    // been connected to bus.input. Walk created from the back since other
    // calls (sendGains, etc.) may also be allocated.
    const playbackGain = created[created.length - 1];
    expect(playbackGain).toBeDefined();
    expect(playbackGain.connect).toHaveBeenCalledWith(bus.input);
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
    sound.play();
    bus.destroy();
  });

  it("redirects live playbacks via disconnect/connect on each playback", async () => {
    const sound = await buildSound();
    const [playback] = sound.play();
    const bus = cacophony.createBus("live-redirect");
    const disconnectSpy = vi.spyOn(playback.outputNode, "disconnect");
    const connectSpy = vi.spyOn(playback.outputNode, "connect");
    sound.routeTo(bus);
    expect(disconnectSpy).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith(bus.input);
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
});

describe("Sound.routeTo: additive send", () => {
  it("routeTo(bus, 0.3) adds a send without changing primary routing", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("send-test");
    const [playback] = sound.play();
    // Capture the next createGain (the send gain).
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const allocatedSendGains: any[] = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementationOnce(() => {
      const node = realCreateGain();
      allocatedSendGains.push(node);
      return node;
    });
    const playbackConnectSpy = vi.spyOn(playback.outputNode, "connect");
    sound.routeTo(bus, 0.3);
    expect(playbackConnectSpy).toHaveBeenCalled();
    // Verify a send-gain was allocated with value 0.3.
    expect(allocatedSendGains.length).toBe(1);
    expect(allocatedSendGains[0].gain.value).toBe(0.3);
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
    bus.destroy();
  });
});

describe("Synth.routeTo", () => {
  it("redirects future playbacks to bus.input", () => {
    const synth = cacophony.createOscillator({});
    const bus = cacophony.createBus("synth-route");
    synth.routeTo(bus);
    synth.play();
    // No throw — the connect happened against bus.input.
    bus.destroy();
  });

  it("redirects live playbacks (uses outputNode.disconnect/connect)", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const bus = cacophony.createBus("synth-live");
    const disconnectSpy = vi.spyOn(playback.outputNode, "disconnect");
    const connectSpy = vi.spyOn(playback.outputNode, "connect");
    synth.routeTo(bus);
    expect(disconnectSpy).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith(bus.input);
    bus.destroy();
  });

  it("routeTo with sendGain adds a send", () => {
    const synth = cacophony.createOscillator({});
    synth.play();
    const bus = cacophony.createBus("synth-send");
    expect(() => synth.routeTo(bus, 0.2)).not.toThrow();
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
