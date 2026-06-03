/**
 * Tests for Bus.drainTo / Bus.destroy({ drainTo }) and the inbound
 * source-tracking that backs it. A draining bus moves every source routed to
 * it (primary route and/or send) onto a target bus before teardown, so live
 * playbacks keep feeding a live bus instead of the dead `input`.
 */

import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { cacophony } from "./setupTests";

const buildSound = async () => {
  const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
  return cacophony.createSound(buffer as unknown as AudioBuffer);
};

describe("Bus.drainTo: primary route", () => {
  it("reroutes a playing primary-routed sound onto the target bus", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("drain-primary-a");
    const busB = cacophony.createBus("drain-primary-b");
    sound.routeTo(busA);
    const [playback] = sound.play();
    const disconnectSpy = vi.spyOn(playback.outputNode, "disconnect");
    const connectSpy = vi.spyOn(playback.outputNode, "connect");

    busA.drainTo(busB);

    // _routeTarget is now busB.
    expect((sound as unknown as { _routeTarget: unknown })._routeTarget).toBe(busB);
    // Live playback was rewired off busA.input onto busB.input.
    expect(disconnectSpy).toHaveBeenCalledWith(busA.input);
    expect(connectSpy).toHaveBeenCalledWith(busB.input);

    busA.destroy();
    busB.destroy();
  });
});

describe("Bus.drainTo: send", () => {
  it("moves a send (preserving gain) and rewires the per-playback sendGain", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("drain-send-a");
    const busB = cacophony.createBus("drain-send-b");
    sound.routeTo(busA, 0.3);
    const [playback] = sound.play();

    const oldSendGain = playback._sendGains.get(busA);
    expect(oldSendGain).toBeDefined();
    const oldSendGainDisconnect = vi.spyOn(oldSendGain!, "disconnect");

    // Capture the new sendGain that _addSend(busB, ...) will allocate so we can
    // assert its outgoing edge targets busB.input.
    const realCreateGain = cacophony.context.createGain.bind(cacophony.context);
    const allocated: Array<{ node: any; connect: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(cacophony.context, "createGain").mockImplementationOnce(() => {
      const node = realCreateGain();
      const connectSpy = vi.fn(node.connect.bind(node));
      Object.assign(node, { connect: connectSpy });
      allocated.push({ node, connect: connectSpy });
      return node;
    });

    busA.drainTo(busB);

    const sends = (sound as unknown as { _sends: Map<unknown, number> })._sends;
    expect(sends.has(busA)).toBe(false);
    expect(sends.get(busB)).toBe(0.3);
    // Old per-playback sendGain to busA was disconnected and dropped.
    expect(oldSendGainDisconnect).toHaveBeenCalled();
    expect(playback._sendGains.has(busA)).toBe(false);
    // New sendGain → busB.input.
    expect(allocated.length).toBe(1);
    expect(allocated[0]?.node.gain.value).toBe(0.3);
    expect(allocated[0]?.connect).toHaveBeenCalledWith(busB.input);

    busA.destroy();
    busB.destroy();
  });
});

describe("Bus.destroy({ drainTo })", () => {
  it("reroutes then destroys", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("destroy-drain-a");
    const busB = cacophony.createBus("destroy-drain-b");
    sound.routeTo(busA);
    sound.play();

    busA.destroy({ drainTo: busB });

    expect(busA.destroyed).toBe(true);
    expect((sound as unknown as { _routeTarget: unknown })._routeTarget).toBe(busB);

    busB.destroy();
  });

  it("default destroy() does NOT reroute — sound stays on _routeTarget = busA", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("destroy-no-drain");
    sound.routeTo(busA);
    const [playback] = sound.play();
    // No live rewire to master should happen at destroy time.
    const disconnectSpy = vi.spyOn(playback.outputNode, "disconnect");
    const connectSpy = vi.spyOn(playback.outputNode, "connect");

    busA.destroy();

    expect(busA.destroyed).toBe(true);
    expect((sound as unknown as { _routeTarget: unknown })._routeTarget).toBe(busA);
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });
});

describe("Bus.drainTo: unregister on bus-identity change with unchanged resolved node", () => {
  it("rerouting off a destroyed bus to master unregisters the sound from the old bus", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("identity-unreg-a");
    // Route a playing sound to busA; the sound registers in busA._routedSources.
    sound.routeTo(busA);
    sound.play();
    const routedSources = (busA as unknown as { _routedSources: Set<unknown> })._routedSources;
    expect(routedSources.has(sound)).toBe(true);

    // Destroy busA with NO drain. _routeTarget stays busA; the destroyed bus now
    // resolves to globalGainNode (master) at preplay/_resolveRouteTargetNode.
    busA.destroy();
    expect(routedSources.has(sound)).toBe(true);

    // Reroute to master. oldTargetNode (destroyed busA -> globalGainNode) and
    // newTargetNode (master -> globalGainNode) are EQUAL, so the old
    // node-equality early-return would have skipped the unregister. The fix
    // drives the unregister off the BUS-identity change instead.
    sound.routeTo(cacophony.master);

    // The sound is no longer leaked in busA's source-tracking.
    expect(routedSources.has(sound)).toBe(false);
    // _routeTarget collapsed to master (null).
    expect((sound as unknown as { _routeTarget: unknown })._routeTarget).toBe(null);

    // A subsequent cleanup must not throw and fully detaches the sound.
    expect(() => sound.cleanup()).not.toThrow();
  });
});

describe("Bus.drainTo: guards", () => {
  it("throws when draining a bus to itself", () => {
    const bus = cacophony.createBus("drain-self");
    expect(() => bus.drainTo(bus)).toThrow(/itself/);
    bus.destroy();
  });

  it("throws when draining a destroyed bus", () => {
    const busA = cacophony.createBus("drain-dead-a");
    const busB = cacophony.createBus("drain-dead-b");
    busA.destroy();
    expect(() => busA.drainTo(busB)).toThrow(/destroyed/);
    busB.destroy();
  });
});

describe("Bus.drainTo: registration cleanup", () => {
  it("does not touch a sound that was cleaned up before the bus drains", async () => {
    const sound = await buildSound();
    const busA = cacophony.createBus("drain-cleanup-a");
    const busB = cacophony.createBus("drain-cleanup-b");
    sound.routeTo(busA);
    sound.routeTo(busA, 0.5);
    sound.play();

    // Cleanup unregisters the sound from busA's source-tracking.
    sound.cleanup();
    const onDrainedSpy = vi.spyOn(sound, "_onBusDrained");

    // Draining the now-empty bus must not reach the dead sound (no throw).
    expect(() => busA.drainTo(busB)).not.toThrow();
    expect(onDrainedSpy).not.toHaveBeenCalled();

    busA.destroy();
    busB.destroy();
  });
});
