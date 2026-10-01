import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaStreamSound } from "./mediaStream";
import { audioContextMock, cacophony, expectNotReachable, expectPath } from "./setupTests";

const buildSound = () => cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }));

afterEach(() => vi.restoreAllMocks());

describe("source send removal", () => {
  it("detaches both edges on every voice, preserves other routes, and allows re-adding", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("aux");
    const other = cacophony.createBus("other");
    sound.routeTo(bus, 0.5);
    sound.routeTo(other, 0.2);
    const voices = [...sound.preplay(), ...sound.preplay()];
    const gains = voices.map((voice) => voice._sendGains.get(bus)!);
    const unregister = vi.spyOn(bus, "_unregisterRoutedSource");

    sound.removeSend("aux");
    expect(unregister).toHaveBeenCalledWith(sound);
    for (const [i, voice] of voices.entries()) {
      expect(voice._sendGains.has(bus)).toBe(false);
      expectNotReachable(voice.outputNode, gains[i]!);
      expectNotReachable(voice.outputNode, bus.input);
      expectNotReachable(gains[i]!, bus.input);
      expectPath(voice.outputNode, [], cacophony.master.input);
      expectPath(voice.outputNode, [voice._sendGains.get(other)!], other.input);
    }
    const [future] = sound.preplay();
    expect(future._sendGains.has(bus)).toBe(false);
    expectNotReachable(future.outputNode, bus.input);
    bus.drainTo(other);
    expect(future._sendGains.get(other)!.gain.value).toBe(0.2);

    sound.routeTo(bus, 0.7);
    for (const [i, voice] of voices.entries()) {
      const gain = voice._sendGains.get(bus)!;
      expect(gain).not.toBe(gains[i]);
      expect(gain.gain.value).toBe(0.7);
      expectPath(voice.outputNode, [gain], bus.input);
    }
  });

  it("does not migrate a removed send when its bus drains", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    const target = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    sound.removeSend(bus);
    bus.drainTo(target);
    expect(voice._sendGains.has(target)).toBe(false);
    const [future] = sound.preplay();
    expectNotReachable(future.outputNode, target.input);
  });

  it("preserves primary routing and its bus registration when the bus is also a send", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    const target = cacophony.createBus();
    sound.routeTo(bus);
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!;
    const unregister = vi.spyOn(bus, "_unregisterRoutedSource");
    sound.removeSend(bus);
    expect(unregister).not.toHaveBeenCalled();
    expectPath(voice.outputNode, [], bus.input);
    expectNotReachable(voice.outputNode, gain);
    bus.drainTo(target);
    expectPath(voice.outputNode, [], target.input);
    expect(voice._sendGains.size).toBe(0);
    expectPath(sound.preplay()[0].outputNode, [], target.input);
  });

  it("is idempotent and can remove sends to a destroyed bus by reference", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus("doomed");
    expect(() => sound.removeSend(bus)).not.toThrow();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!;
    bus.destroy();
    sound.removeSend(bus);
    sound.removeSend(bus);
    expectNotReachable(voice.outputNode, gain);
    expect(voice._sendGains.has(bus)).toBe(false);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    sound.preplay();
    expect(warning).not.toHaveBeenCalled();
    expect(() => sound.removeSend("doomed")).toThrow(/No bus registered/);
    expect(() => sound.routeTo(bus, 0.5, { duration: 100 })).toThrow(/destroyed/);
  });

  it("reuses complete send teardown when draining a bus", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    const target = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!;
    bus.drainTo(target);
    expectNotReachable(voice.outputNode, gain);
    expectPath(voice.outputNode, [voice._sendGains.get(target)!], target.input);
  });
});

describe("source send gain automation", () => {
  it("keeps new sends immediate even when ramp options are supplied", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    const [voice] = sound.preplay();
    sound.routeTo(bus, 0.5, { duration: 500 });
    expect(voice._sendGains.get(bus)!.gain.value).toBe(0.5);
    expect(sound.preplay()[0]._sendGains.get(bus)!.gain.value).toBe(0.5);
  });

  it("rejects ramp options on a primary route without rerouting", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    const [voice] = sound.preplay();
    expect(() => sound.routeTo(bus, undefined, { duration: 250 })).toThrow(TypeError);
    expectNotReachable(voice.outputNode, bus.input);
    expectPath(voice.outputNode, [], cacophony.master.input);
  });

  it("uses a linear ramp for a signed gain transition requested as exponential", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!.gain;
    const linear = vi.spyOn(gain, "linearRampToValueAtTime");
    const exponential = vi.spyOn(gain, "exponentialRampToValueAtTime");
    sound.routeTo(bus, -0.5, { duration: 100, type: "exponential" });
    expect(linear).toHaveBeenCalledWith(-0.5, audioContextMock.currentTime + 0.1);
    expect(exponential).not.toHaveBeenCalled();
  });

  it("ramps existing voices in place on the audio clock and uses the target for future voices", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const voices = [...sound.preplay(), ...sound.preplay()];
    const gains = voices.map((voice) => voice._sendGains.get(bus)!);
    const automation = gains.map(({ gain }) => ({
      cancel: vi.spyOn(gain, "cancelScheduledValues"),
      anchor: vi.spyOn(gain, "setValueAtTime"),
      ramp: vi.spyOn(gain, "linearRampToValueAtTime"),
    }));
    vi.spyOn(audioContextMock, "currentTime", "get").mockReturnValue(2);
    const allocate = vi.spyOn(cacophony.context, "createGain");
    sound.routeTo(bus, 0.1, { duration: 250 });
    expect(allocate).not.toHaveBeenCalled();
    for (const [i, voice] of voices.entries()) {
      expect(voice._sendGains.get(bus)).toBe(gains[i]);
      expect(automation[i]!.cancel).toHaveBeenCalledWith(2);
      expect(automation[i]!.anchor).toHaveBeenCalledWith(0.5, 2);
      expect(automation[i]!.ramp).toHaveBeenCalledWith(0.1, 2.25);
    }
    expect(sound.preplay()[0]._sendGains.get(bus)!.gain.value).toBe(0.1);
  });

  it.each([
    "linear",
    "exponential",
  ] as const)("re-anchors an interrupted %s ramp at its interpolated value", async (type) => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 1);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!.gain;
    const clock = vi.spyOn(audioContextMock, "currentTime", "get").mockReturnValue(0);
    sound.routeTo(bus, 0.25, { duration: 1000, type });
    clock.mockReturnValue(0.5);
    const anchor = vi.spyOn(gain, "setValueAtTime");
    const cancel = vi.spyOn(gain, "cancelScheduledValues");
    sound.routeTo(bus, 1, { duration: 500 });
    expect(cancel).toHaveBeenCalledWith(0.5);
    expect(anchor).toHaveBeenCalledWith(type === "linear" ? 0.625 : 0.5, 0.5);
  });

  it("cancels earlier automation for a default instant change", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    sound.routeTo(bus, 1, { duration: 500 });
    const gain = voice._sendGains.get(bus)!.gain;
    const cancel = vi.spyOn(gain, "cancelScheduledValues");
    const set = vi.spyOn(gain, "setValueAtTime");
    sound.routeTo(bus, 0);
    expect(cancel).toHaveBeenCalledWith(audioContextMock.currentTime);
    expect(set).toHaveBeenCalledWith(0, audioContextMock.currentTime);
  });

  it("schedules exact silence after an exponential ramp and resumes from zero linearly", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 1);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!.gain;
    const clock = vi.spyOn(audioContextMock, "currentTime", "get").mockReturnValue(0);
    const exponential = vi.spyOn(gain, "exponentialRampToValueAtTime");
    const set = vi.spyOn(gain, "setValueAtTime");
    sound.routeTo(bus, 0, { duration: 1000, type: "exponential" });
    expect(exponential).toHaveBeenCalledWith(0.0001, 1);
    expect(set).toHaveBeenCalledWith(0, 1);
    clock.mockReturnValue(1.5);
    const linear = vi.spyOn(gain, "linearRampToValueAtTime");
    sound.routeTo(bus, 1, { duration: 500, type: "exponential" });
    expect(set).toHaveBeenCalledWith(0, 1.5);
    expect(linear).toHaveBeenCalledWith(1, 2);
    expect(exponential).toHaveBeenCalledOnce();
  });

  it.each([
    [NaN, {}],
    [Infinity, {}],
    [0.5, { duration: -1 }],
    [0.5, { duration: NaN }],
    [0.5, { duration: Infinity }],
  ])("rejects invalid gain/options before changing the graph or future defaults (%j, %j)", async (value, options) => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.preplay();
    const gain = voice._sendGains.get(bus)!;
    expect(() => sound.routeTo(bus, value as number, options)).toThrow(RangeError);
    expect(voice._sendGains.get(bus)).toBe(gain);
    expect(gain.gain.value).toBe(0.5);
    expect(sound.preplay()[0]._sendGains.get(bus)!.gain.value).toBe(0.5);
  });
});

describe("shared source and Group send controls", () => {
  it("removes sends from a reaped buffer voice when it is replayed", async () => {
    const sound = await buildSound();
    const bus = cacophony.createBus();
    sound.routeTo(bus, 0.5);
    const [voice] = sound.play();
    voice.stop();
    sound.preplay();
    expect(sound.playbacks).not.toContain(voice);
    sound.removeSend(bus);
    voice.play();
    expect(sound.playbacks).toContain(voice);
    expect(voice._sendGains.has(bus)).toBe(false);
    expectNotReachable(voice.outputNode, bus.input);
  });

  it("ramps and removes sends on a reused PCM stream voice", async () => {
    Object.defineProperty(audioContextMock, "audioWorklet", {
      value: { addModule: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const stream = await cacophony.createPcmStreamSound();
    const bus = cacophony.createBus();
    stream.routeTo(bus, 0.5);
    const [voice] = stream.preplay();
    const gain = voice._sendGains.get(bus)!;
    const ramp = vi.spyOn(gain.gain, "linearRampToValueAtTime");
    stream.routeTo(bus, 0, { duration: 100 });
    expect(ramp).toHaveBeenCalledWith(0, audioContextMock.currentTime + 0.1);
    stream.removeSend(bus);
    expect(stream.preplay()[0]).toBe(voice);
    expect(voice._sendGains.has(bus)).toBe(false);
    expectNotReachable(voice.outputNode, gain);
    expectNotReachable(voice.outputNode, bus.input);
  });

  it("ramps and removes sends on a MediaStream source without changing its primary output", () => {
    const media = { getTracks: () => [] } as unknown as MediaStream;
    vi.spyOn(audioContextMock, "createMediaStreamSource").mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      mediaStream: media,
    } as unknown as MediaStreamAudioSourceNode);
    const stream = new MediaStreamSound(media, cacophony.context, cacophony.globalGainNode, {}, cacophony);
    const bus = cacophony.createBus();
    stream.routeTo(bus, 0.5);
    const [voice] = stream.preplay();
    const ramp = vi.spyOn(voice._sendGains.get(bus)!.gain, "linearRampToValueAtTime");
    stream.routeTo(bus, 0, { duration: 100 });
    expect(ramp).toHaveBeenCalledWith(0, audioContextMock.currentTime + 0.1);
    stream.removeSend(bus);
    expectNotReachable(voice.outputNode, bus.input);
    expectPath(voice.outputNode, [], cacophony.master.input);
  });

  it("removes Synth sends from current and future voices", () => {
    const synth = cacophony.createOscillator({});
    const bus = cacophony.createBus();
    synth.routeTo(bus, 0.3);
    const [voice] = synth.preplay();
    synth.removeSend(bus);
    expectNotReachable(voice.outputNode, bus.input);
    expectNotReachable(synth.preplay()[0].outputNode, bus.input);
  });

  it("fans ramps and removal out to every Group member", async () => {
    const sounds = await Promise.all([buildSound(), buildSound()]);
    const group = await cacophony.createGroup(sounds);
    const bus = cacophony.createBus("group-aux");
    group.routeTo(bus, 0.5);
    const voices = group.preplay();
    const ramps = voices.map((voice) => vi.spyOn(voice._sendGains.get(bus)!.gain, "linearRampToValueAtTime"));
    group.routeTo("group-aux", 0, { duration: 100 });
    for (const ramp of ramps) expect(ramp).toHaveBeenCalledWith(0, audioContextMock.currentTime + 0.1);
    group.removeSend("group-aux");
    for (const voice of [...voices, ...group.preplay()]) {
      expect(voice._sendGains.has(bus)).toBe(false);
      expectNotReachable(voice.outputNode, bus.input);
    }
  });
});
