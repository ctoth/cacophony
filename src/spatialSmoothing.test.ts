import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import type { PannerNode, StereoPannerNode } from "./context";
import { audioContextMock, cacophony } from "./setupTests";

function setTime(time: number): void {
  Object.defineProperty(audioContextMock, "currentTime", { configurable: true, value: time });
}

async function makeSound(instance = cacophony, panType: "stereo" | "HRTF" = "HRTF") {
  return instance.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }), "buffer", panType);
}

afterEach(() => vi.restoreAllMocks());

describe("spatial motion smoothing", () => {
  it("preserves immediate source writes by default", async () => {
    const sound = await makeSound();
    const [voice] = sound.play();
    const panner = voice.panner as PannerNode;
    const target = vi.spyOn(panner.positionX, "setTargetAtTime");
    voice.position = [4, 5, 6];
    expect(panner.positionX.value).toBe(4);
    expect(voice.position).toEqual([4, 5, 6]);
    expect(target).not.toHaveBeenCalled();
    sound.cleanup();
  });

  it("retargets from the owned exponential envelope and returns requested targets", async () => {
    const sound = await makeSound();
    sound.spatialSmoothingTau = 0.1;
    const [voice] = sound.play();
    const panner = voice.panner as PannerNode;
    const target = vi.spyOn(panner.positionX, "setTargetAtTime").mockReturnValue(panner.positionX);
    const anchor = vi.spyOn(panner.positionX, "setValueAtTime");
    const cancel = vi.spyOn(panner.positionX, "cancelScheduledValues");
    setTime(1);
    voice.position = [10, 2, 3];
    expect(target).toHaveBeenLastCalledWith(10, 1, 0.1);
    expect(voice.position).toEqual([10, 2, 3]);
    expect(voice.threeDOptions).toMatchObject({ positionX: 10, positionY: 2, positionZ: 3 });
    // Deliberately stale param.value: hosts/mocks need not expose the instantaneous envelope.
    panner.positionX.value = -999;
    setTime(1.05);
    voice.position = [-10, 2, 3];
    expect(anchor.mock.lastCall?.[0]).toBeCloseTo(10 * (1 - Math.exp(-0.5)), 10);
    expect(anchor.mock.lastCall?.[1]).toBe(1.05);
    expect(cancel).toHaveBeenLastCalledWith(0);
    expect(target).toHaveBeenLastCalledWith(-10, 1.05, 0.1);
    expect(voice.position).toEqual([-10, 2, 3]);
    sound.cleanup();
  });

  it("does not restart omitted or unchanged axes through container partial updates", async () => {
    const sound = await makeSound();
    sound.spatialSmoothingTau = 0.1;
    const [voice] = sound.play();
    const panner = voice.panner as PannerNode;
    const x = vi.spyOn(panner.positionX, "setTargetAtTime");
    const y = vi.spyOn(panner.positionY, "setTargetAtTime");
    const orientation = vi.spyOn(panner.orientationX, "setTargetAtTime");
    sound.position = [10, 20, 30];
    sound.threeDOptions = { orientationX: 2 };
    sound.threeDOptions = { rolloffFactor: 0.5 };
    voice.threeDOptions = { positionY: 40 };
    sound.threeDOptions = { rolloffFactor: 0.6 };
    expect(x).toHaveBeenCalledTimes(1);
    expect(y).toHaveBeenCalledTimes(2);
    expect(orientation).toHaveBeenCalledTimes(1);
    expect(voice.position).toEqual([10, 40, 30]);
    expect(voice.threeDOptions).toMatchObject({ orientationX: 2 });
    expect(sound.threeDOptions).toMatchObject({ rolloffFactor: 0.6 });
    sound.cleanup();
  });

  it("initializes source and invocation poses immediately before starting", async () => {
    const instance = new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: 0.1, quiet: true });
    const sound = await makeSound(instance);
    sound.position = [8, 0, -4];
    const [voice] = sound.preplay();
    const panner = voice.panner as PannerNode;
    expect(voice.spatialSmoothingTau).toBe(0.1);
    expect(panner.positionX.value).toBe(8);
    const target = vi.spyOn(panner.positionX, "setTargetAtTime");
    const start = vi.fn(() => {
      expect(panner.positionX.value).toBe(12);
    });
    const createSource = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const source = createSource();
      vi.spyOn(source, "start").mockImplementation(start);
      return source;
    });
    voice.play({ position: [12, 0, -4] });
    expect(start).toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
    voice.position = [20, 0, -4];
    expect(target).toHaveBeenLastCalledWith(20, audioContextMock.currentTime, 0.1);
    sound.cleanup();
  });

  it("smooths stereo pan and makes disabling smoothing snap to the target", async () => {
    const sound = await makeSound(cacophony, "stereo");
    sound.spatialSmoothingTau = 0.1;
    sound.stereoPan = -0.5;
    const [voice] = sound.play();
    const pan = (voice.panner as StereoPannerNode).pan;
    expect(pan.value).toBe(-0.5);
    const target = vi.spyOn(pan, "setTargetAtTime");
    voice.stereoPan = 0.75;
    expect(target).toHaveBeenLastCalledWith(0.75, audioContextMock.currentTime, 0.1);
    expect(voice.stereoPan).toBe(0.75);
    voice.spatialSmoothingTau = 0;
    expect(pan.value).toBe(0.75);
    voice.stereoPan = -1;
    expect(pan.value).toBe(-1);
    sound.cleanup();
  });

  it("propagates settings to existing/future voices and preserves clone targets", async () => {
    const instance = new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: 0.05 });
    const sound = await makeSound(instance);
    const [voice] = sound.play();
    voice.spatialSmoothingTau = 0.2;
    voice.position = [10, 20, 30];
    voice.threeDOptions = { orientationX: 1 };
    const clone = voice.clone();
    expect(clone.spatialSmoothingTau).toBe(0.2);
    expect(clone.position).toEqual([10, 20, 30]);
    expect((clone.panner as PannerNode).positionX.value).toBe(10);
    expect(clone.threeDOptions).toMatchObject({ orientationX: 1 });
    sound.spatialSmoothingTau = 0.3;
    expect(voice.spatialSmoothingTau).toBe(0.3);
    expect(clone.spatialSmoothingTau).toBe(0.3);
    expect(sound.preplay()[0].spatialSmoothingTau).toBe(0.3);
    const sourceClone = sound.clone();
    expect(sourceClone.spatialSmoothingTau).toBe(0.3);
    const instantClone = sound.clone({ spatialSmoothingTau: 0 });
    expect(instantClone.spatialSmoothingTau).toBe(0);
    instantClone.cleanup();
    sourceClone.cleanup();
    sound.cleanup();
  });

  it("smooths all modern listener setters without restarting unchanged axes", () => {
    const position = audioContextMock.createPanner();
    const orientation = audioContextMock.createPanner();
    const upOrientation = audioContextMock.createPanner();
    const listener = {
      positionX: position.positionX,
      positionY: position.positionY,
      positionZ: position.positionZ,
      forwardX: orientation.orientationX,
      forwardY: orientation.orientationY,
      forwardZ: orientation.orientationZ,
      upX: upOrientation.orientationX,
      upY: upOrientation.orientationY,
      upZ: upOrientation.orientationZ,
    };
    Object.defineProperty(audioContextMock, "listener", { configurable: true, value: listener });
    const instance = new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: 0.1 });
    const x = vi.spyOn(listener.positionX!, "setTargetAtTime");
    const forward = vi.spyOn(listener.forwardX!, "setTargetAtTime");
    const up = vi.spyOn(listener.upX!, "setTargetAtTime");
    instance.listenerPosition = [10, 20, 30];
    instance.listenerForwardOrientation = [2, 0, -1];
    instance.listenerUpOrientation = [2, 1, 0];
    expect(x).toHaveBeenLastCalledWith(10, audioContextMock.currentTime, 0.1);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(1);
    expect(instance.listenerPosition).toEqual([10, 20, 30]);
    expect(instance.listenerOrientation).toEqual({ forward: [2, 0, -1], up: [2, 1, 0] });
    instance.listenerOrientation = { forward: [3, 0, -1], up: [2, 1, 0] };
    expect(forward).toHaveBeenCalledTimes(2);
    expect(up).toHaveBeenCalledTimes(1);
    instance.listenerSmoothingTau = 0;
    expect(listener.positionX!.value).toBe(10);
  });

  it("keeps legacy listener updates immediate when smoothing is enabled", () => {
    const legacy = { setPosition: vi.fn(), setOrientation: vi.fn() };
    Object.defineProperty(audioContextMock, "listener", { configurable: true, value: legacy });
    const instance = new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: 0.1 });
    instance.listenerPosition = [1, 2, 3];
    instance.listenerOrientation = { forward: [1, 0, 0], up: [0, 0, 1] };
    expect(legacy.setPosition).toHaveBeenCalledWith(1, 2, 3);
    expect(legacy.setOrientation).toHaveBeenCalledWith(1, 0, 0, 0, 0, 1);
    expect(instance.listenerPosition).toEqual([1, 2, 3]);
  });

  it("retargets after pause/resume and keeps the requested pose", async () => {
    const sound = await makeSound();
    sound.spatialSmoothingTau = 0.1;
    const [voice] = sound.play();
    const param = (voice.panner as PannerNode).positionX;
    const target = vi.spyOn(param, "setTargetAtTime");
    voice.position = [10, 0, 0];
    voice.pause();
    voice.play();
    expect(voice.position).toEqual([10, 0, 0]);
    voice.position = [-10, 0, 0];
    expect(target).toHaveBeenLastCalledWith(-10, audioContextMock.currentTime, 0.1);
    sound.cleanup();
  });

  it("keeps custom params without setTargetAtTime usable", async () => {
    const sound = await makeSound();
    sound.spatialSmoothingTau = 0.1;
    const [voice] = sound.play();
    const panner = voice.panner as PannerNode;
    Object.defineProperty(panner.positionX, "setTargetAtTime", { configurable: true, value: undefined });
    voice.position = [10, 0, 0];
    expect(panner.positionX.value).toBe(10);
    expect(voice.position).toEqual([10, 0, 0]);
    sound.cleanup();
  });

  it("initializes and smooths synth, PCM and media stream voices through the shared path", async () => {
    const instance = new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: 0.1, quiet: true });
    Object.defineProperty(audioContextMock, "audioWorklet", {
      configurable: true,
      value: { addModule: vi.fn().mockResolvedValue(undefined) },
    });
    const synth = instance.createOscillator({ type: "sine", frequency: 220 });
    const stream = await instance.createPcmStreamSound();
    const mediaStream = { getTracks: () => [] } as unknown as MediaStream;
    vi.spyOn(audioContextMock, "createMediaStreamSource").mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      mediaStream,
    } as unknown as ReturnType<typeof audioContextMock.createMediaStreamSource>);
    const live = instance.createMediaStreamSound(mediaStream, { primeWithMediaElement: false });
    for (const source of [synth, stream, live]) {
      source.position = [3, 4, 5];
      const [voice] = source.preplay();
      const panner = voice.panner as PannerNode;
      const target = vi.spyOn(panner.positionX, "setTargetAtTime");
      expect(voice.spatialSmoothingTau).toBe(0.1);
      expect(panner.positionX.value).toBe(3);
      voice.play({ position: [6, 4, 5] });
      expect(panner.positionX.value).toBe(6);
      expect(target).not.toHaveBeenCalled();
      source.position = [10, 4, 5];
      expect(target).toHaveBeenLastCalledWith(10, audioContextMock.currentTime, 0.1);
      source.spatialSmoothingTau = 0.2;
      expect(voice.spatialSmoothingTau).toBe(0.2);
      const cancel = vi.spyOn(panner.positionX, "cancelScheduledValues");
      source.stop();
      source.cleanup();
      expect(cancel).toHaveBeenCalledWith(0);
      expect(voice.panner).toBeUndefined();
    }
    const clone = synth.clone();
    expect(clone.spatialSmoothingTau).toBe(0.2);
    clone.cleanup();
  });

  it.each([-1, NaN, Infinity])("rejects invalid tau %s without changing settings", async (tau) => {
    const sound = await makeSound();
    expect(() => new Cacophony(audioContextMock, undefined, { spatialSmoothingTau: tau })).toThrow(RangeError);
    expect(() => {
      sound.spatialSmoothingTau = tau;
    }).toThrow(RangeError);
    expect(() => {
      cacophony.listenerSmoothingTau = tau;
    }).toThrow(RangeError);
    const [voice] = sound.preplay();
    expect(() => {
      voice.spatialSmoothingTau = tau;
    }).toThrow(RangeError);
    const allocate = vi.spyOn(audioContextMock, "createGain");
    expect(() => sound.clone({ spatialSmoothingTau: tau })).toThrow(RangeError);
    expect(() => voice.clone({ spatialSmoothingTau: tau })).toThrow(RangeError);
    expect(allocate).not.toHaveBeenCalled();
    expect(sound.spatialSmoothingTau).toBe(0);
    expect(voice.spatialSmoothingTau).toBe(0);
    sound.cleanup();
  });

  it("cancels owned automation on cleanup and panner replacement", async () => {
    const sound = await makeSound();
    sound.spatialSmoothingTau = 0.1;
    const [voice] = sound.play();
    const panner = voice.panner as PannerNode;
    voice.position = [10, 0, 0];
    const cancel = vi.spyOn(panner.positionX, "cancelScheduledValues");
    voice.setPanType("stereo", audioContextMock);
    expect(cancel).toHaveBeenCalledWith(0);
    const pan = (voice.panner as StereoPannerNode).pan;
    voice.stereoPan = 1;
    const cancelPan = vi.spyOn(pan, "cancelScheduledValues");
    sound.cleanup();
    expect(cancelPan).toHaveBeenCalledWith(0);
  });
});
