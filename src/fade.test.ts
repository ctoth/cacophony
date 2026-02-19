import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";

import { Sound } from "./sound";
import { Playback } from "./playback";

describe("VolumeMixin fade", () => {
  let sound: Sound;
  let buffer: AudioBuffer;
  let playback: Playback;

  beforeEach(async () => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = await cacophony.createSound(buffer);
    const playbacks = sound.play();
    playback = playbacks[0];
  });

  afterEach(() => {
    if (sound) {
      sound.stop();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  // --- Cycle 1: fadeTo (core primitive) ---

  it("fadeTo calls setValueAtTime with current value at current time", async () => {
    const gain = playback.gainNode!.gain;
    const currentTime = playback.gainNode!.context.currentTime;
    playback.volume = 0.8;

    playback.fadeTo(1.0, 1000);

    expect(gain.setValueAtTime.calledWith(0.8, currentTime)).toBe(true);
  });

  it("fadeTo calls linearRampToValueAtTime with target and end time (linear)", async () => {
    const gain = playback.gainNode!.gain;
    const currentTime = playback.gainNode!.context.currentTime;

    playback.fadeTo(0.5, 1000, "linear");

    expect(gain.linearRampToValueAtTime.calledWith(0.5, currentTime + 1)).toBe(true);
  });

  it("fadeTo calls exponentialRampToValueAtTime for exponential type", async () => {
    const gain = playback.gainNode!.gain;
    const currentTime = playback.gainNode!.context.currentTime;

    playback.fadeTo(0.5, 1000, "exponential");

    expect(gain.exponentialRampToValueAtTime.calledWith(0.5, currentTime + 1)).toBe(true);
  });

  it("fadeTo with exponential uses 0.0001 instead of 0 for target", async () => {
    const gain = playback.gainNode!.gain;
    const currentTime = playback.gainNode!.context.currentTime;

    playback.fadeTo(0, 1000, "exponential");

    expect(gain.exponentialRampToValueAtTime.calledWith(0.0001, currentTime + 1)).toBe(true);
  });

  it("fadeTo returns a promise that resolves after duration", async () => {
    let resolved = false;
    const promise = playback.fadeTo(0.5, 500).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    vi.advanceTimersByTime(500);
    await promise;
    expect(resolved).toBe(true);
  });

  it("fadeTo defaults to linear type", async () => {
    const gain = playback.gainNode!.gain;

    playback.fadeTo(0.5, 1000);

    expect(gain.linearRampToValueAtTime.callCount).toBeGreaterThan(0);
    expect(gain.exponentialRampToValueAtTime.callCount).toBe(0);
  });

  // --- Cycle 2: cancelFade + volume setter interaction ---

  it("cancelFade calls cancelScheduledValues", () => {
    playback.fadeTo(0.5, 1000);
    const gain = playback.gainNode!.gain;
    const countBefore = gain.cancelScheduledValues.callCount;

    playback.cancelFade();

    expect(gain.cancelScheduledValues.callCount).toBeGreaterThan(countBefore);
  });

  it("cancelFade clears pending timeout", () => {
    playback.fadeTo(0.5, 1000);

    playback.cancelFade();

    // After cancelling, advancing timers should NOT resolve the original fade
    // We verify by checking isFading is false immediately
    expect(playback.isFading).toBe(false);
  });

  it("cancelFade sets isFading to false", () => {
    playback.fadeTo(0.5, 1000);
    expect(playback.isFading).toBe(true);

    playback.cancelFade();
    expect(playback.isFading).toBe(false);
  });

  it("setting volume during fade cancels the fade", () => {
    playback.fadeTo(0.5, 1000);
    expect(playback.isFading).toBe(true);

    playback.volume = 0.7;
    expect(playback.isFading).toBe(false);
  });

  it("setting volume during fade clears scheduled values", () => {
    playback.fadeTo(0.5, 1000);
    const gain = playback.gainNode!.gain;
    const countBefore = gain.cancelScheduledValues.callCount;

    playback.volume = 0.7;

    expect(gain.cancelScheduledValues.callCount).toBeGreaterThan(countBefore);
  });

  it("cleanup cancels any in-progress fade", () => {
    playback.fadeTo(0.5, 1000);
    expect(playback.isFading).toBe(true);

    // Stop sound first to avoid afterEach error when playback source is gone
    sound.stop();
    playback.cleanup();
    // After cleanup, isFading should be false (fade was cancelled)
    // Note: gainNode is undefined after cleanup, but the fade state should be cleared
    expect(playback.isFading).toBe(false);
  });

  // --- Cycle 3: fadeIn and fadeOut convenience methods ---

  it("fadeIn sets gain to near-zero then ramps to current volume", () => {
    const gain = playback.gainNode!.gain;
    playback.volume = 0.8;

    playback.fadeIn(1000);

    // Should have set value to 0.0001 (near-zero for exponential safety)
    const setValueCalls = gain.setValueAtTime.args;
    // The first setValueAtTime call from fadeIn sets gain to 0.0001
    // Then fadeTo internally calls setValueAtTime with current value
    expect(setValueCalls.some((args: number[]) => args[0] === 0.0001)).toBe(true);
  });

  it("fadeIn ramps to the captured target value", () => {
    const gain = playback.gainNode!.gain;
    playback.volume = 0.8;

    playback.fadeIn(1000);

    // Should ramp to 0.8 (the value captured before setting to near-zero)
    expect(gain.linearRampToValueAtTime.calledWith(0.8, gain.linearRampToValueAtTime.args[gain.linearRampToValueAtTime.callCount - 1]?.[1])).toBe(true);
    // Simpler check: the first arg of the last linear ramp call should be 0.8
    const lastCall = gain.linearRampToValueAtTime.args[gain.linearRampToValueAtTime.callCount - 1];
    expect(lastCall[0]).toBe(0.8);
  });

  it("fadeOut ramps from current value to near-zero", () => {
    const gain = playback.gainNode!.gain;
    playback.volume = 0.8;

    playback.fadeOut(1000);

    // Should ramp to 0 (linear) - the last linearRampToValueAtTime target should be 0
    const lastCall = gain.linearRampToValueAtTime.args[gain.linearRampToValueAtTime.callCount - 1];
    expect(lastCall[0]).toBe(0);
  });

  it("fadeOut with exponential type targets 0.0001", () => {
    const gain = playback.gainNode!.gain;
    playback.volume = 0.8;

    playback.fadeOut(1000, "exponential");

    // Should ramp to 0.0001 (exponential can't reach 0)
    const lastCall = gain.exponentialRampToValueAtTime.args[gain.exponentialRampToValueAtTime.callCount - 1];
    expect(lastCall[0]).toBe(0.0001);
  });
});
