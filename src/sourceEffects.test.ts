import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import type { AudioNode, BaseContext, BiquadFilterNode } from "./context";
import type { BuiltEffect, CacophonyEffect } from "./effects";
import { audioContextMock, cacophony, expectPath } from "./setupTests";

function recipe(build: (context: BaseContext) => BuiltEffect | Promise<BuiltEffect>): CacophonyEffect {
  return { build };
}

async function createSound() {
  return cacophony.createSound(new AudioBuffer({ length: 100, sampleRate: 44_100 }));
}

describe("per-source effects", () => {
  it("builds independent instances for every Sound playback before its panner", async () => {
    const sound = await createSound();
    const built: BiquadFilterNode[] = [];
    sound.addEffect(
      recipe((context) => {
        const node = context.createBiquadFilter();
        built.push(node);
        return node;
      }),
    );

    const first = sound.preplay()[0];
    const second = sound.preplay()[0];

    expect(built).toHaveLength(2);
    expect(built[0]).not.toBe(built[1]);
    expectPath(first.source!, [built[0]!, first.panner!, first.outputNode], cacophony.master.input);
    expectPath(second.source!, [built[1]!, second.panner!, second.outputNode], cacophony.master.input);

    const firstSet = vi.spyOn(built[0]!.frequency, "setValueAtTime");
    const secondSet = vi.spyOn(built[1]!.frequency, "setValueAtTime");
    first.rampEffectParam(built[0]!, "frequency", 880);
    expect(firstSet).toHaveBeenCalledWith(880, built[0]!.context.currentTime);
    expect(secondSet).not.toHaveBeenCalled();
  });

  it("returns the live handle when an effect is added directly to a playback", async () => {
    const sound = await createSound();
    const playback = sound.preplay()[0];
    const node = audioContextMock.createGain();

    await expect(playback.addEffect(recipe(() => node))).resolves.toBe(node);
    expectPath(playback.source!, [node, playback.panner!, playback.outputNode], cacophony.master.input);
  });

  it("preserves declaration order when async effect builds resolve out of order", async () => {
    const sound = await createSound();
    const first = audioContextMock.createGain();
    const second = audioContextMock.createGain();
    const third = audioContextMock.createGain();
    let resolveFirst!: (node: AudioNode) => void;
    let resolveSecond!: (node: AudioNode) => void;
    sound.addEffect(recipe(() => new Promise<AudioNode>((resolve) => (resolveFirst = resolve))));
    sound.addEffect(recipe(() => new Promise<AudioNode>((resolve) => (resolveSecond = resolve))));
    sound.addEffect(recipe(() => third));

    const playback = sound.preplay()[0];
    expectPath(playback.source!, [third, playback.panner!, playback.outputNode], cacophony.master.input);

    resolveSecond(second);
    await Promise.resolve();
    expectPath(playback.source!, [second, third, playback.panner!, playback.outputNode], cacophony.master.input);

    resolveFirst(first);
    await Promise.resolve();
    expectPath(playback.source!, [first, second, third, playback.panner!, playback.outputNode], cacophony.master.input);
  });

  it("disposes a built effect graph during playback cleanup", async () => {
    const sound = await createSound();
    const dispose = vi.fn();
    sound.addEffect(
      recipe((context) => ({
        input: context.createGain(),
        output: context.createGain(),
        dispose,
      })),
    );
    const playback = sound.preplay()[0];

    playback.cleanup();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("removes a source recipe before future playbacks are built", async () => {
    const sound = await createSound();
    const build = vi.fn((context: BaseContext) => context.createGain());
    const effect = recipe(build);
    sound.addEffect(effect);
    sound.removeEffect(effect);

    sound.preplay();

    expect(build).not.toHaveBeenCalled();
  });

  it("supports a per-playback dry chain and a shared wet send end to end", async () => {
    const sound = await createSound();
    const dry = audioContextMock.createGain();
    const wet = audioContextMock.createGain();
    const reverbBus = cacophony.createBus("source-effects-wet-send");
    sound.addEffect(recipe(() => dry));
    await reverbBus.addFilter(recipe(() => wet));
    sound.routeTo(reverbBus, 0.25);

    const playback = sound.preplay()[0];
    const sendGain = playback._sendGains.get(reverbBus);

    expectPath(playback.source!, [dry, playback.panner!, playback.outputNode], cacophony.master.input);
    expectPath(playback.outputNode, [sendGain!, reverbBus.input, wet, reverbBus.output], cacophony.master.input);
  });
});
