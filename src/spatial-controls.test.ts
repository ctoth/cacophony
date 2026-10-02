import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import type { PanType, PlayOptions } from "./cacophony";
import { Group } from "./group";
import { MediaStreamSound } from "./mediaStream";
import { createOfflineNodeCacophony } from "./node";
import type { ThreeDOptions } from "./pannerMixin";
import { audioContextMock, cacophony } from "./setupTests";
import { SynthGroup } from "./synthGroup";

async function makeSource(kind: "sound" | "synth", panType: PanType) {
  return kind === "sound"
    ? cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }), "buffer", panType)
    : cacophony.createOscillator({ frequency: 440 }, panType);
}

function snapshot(source: Awaited<ReturnType<typeof makeSource>>) {
  return {
    pan: source.stereoPan,
    position: source.position,
    options: source.threeDOptions,
    voices: source.playbacks.map((voice) => ({
      panner: voice.panner,
      panType: voice.panType,
      pan: voice.stereoPan,
      options: voice.panType === "HRTF" ? voice.threeDOptions : undefined,
      state: voice.state,
    })),
  };
}

describe.each(["sound", "synth"] as const)("%s spatial broadcasts", (kind) => {
  it.each([0, 1, 3])("rejects stereo pan on HRTF before mutation with %i voices", async (count) => {
    const source = await makeSource(kind, "HRTF");
    // A stereo override must not make an HRTF source accept stereo defaults.
    for (let i = 0; i < count; i++) source.play({ panType: "stereo", stereoPan: -0.25 });
    const before = snapshot(source);
    expect(() => {
      source.stereoPan = 0.5;
    }).toThrow("Stereo panning is not available when using HRTF.");
    expect(snapshot(source)).toEqual(before);
    source.stop();
  });

  it.each([0, 1, 3])("rejects HRTF controls on stereo before mutation with %i voices", async (count) => {
    const source = await makeSource(kind, "stereo");
    for (let i = 0; i < count; i++) source.play({ panType: "HRTF" });
    const before = snapshot(source);
    expect(() => {
      source.position = [1, 2, 3];
    }).toThrow();
    expect(snapshot(source)).toEqual(before);
    expect(() => {
      source.threeDOptions = { refDistance: 5 };
    }).toThrow();
    expect(snapshot(source)).toEqual(before);
    source.stop();
  });

  it.each([false, true])("preflights mixed voices in either order (reverse=%s)", async (reverse) => {
    for (const mode of ["stereo", "HRTF"] as const) {
      const source = await makeSource(kind, mode);
      const modes: PanType[] = reverse ? ["HRTF", "stereo"] : ["stereo", "HRTF"];
      for (const panType of modes) source.play({ panType });
      const before = snapshot(source);
      expect(() => {
        if (mode === "stereo") source.stereoPan = 0.75;
        else source.position = [5, 6, 7];
      }).toThrow();
      expect(snapshot(source)).toEqual(before);
      if (mode === "HRTF") {
        expect(() => {
          source.threeDOptions = { positionX: 9, refDistance: 8 };
        }).toThrow();
        expect(snapshot(source)).toEqual(before);
      }
      source.stop();
    }
  });

  it("rejects a stereo configuration without switching mode or poisoning future voices", async () => {
    const source = await makeSource(kind, "HRTF");
    const before = snapshot(source);
    expect(() => {
      source.threeDOptions = { panType: "stereo", stereoPan: 0.5 } as unknown as ThreeDOptions;
    }).toThrow();
    expect(snapshot(source)).toEqual(before);
    expect(source.play()[0].panType).toBe("HRTF");
    source.stop();
  });

  it.each([-2, 2, NaN, Infinity])("rejects invalid stereo pan %s without poisoning defaults", async (value) => {
    const source = await makeSource(kind, "stereo");
    source.stereoPan = -0.25;
    source.play();
    const before = snapshot(source);
    expect(() => {
      source.stereoPan = value;
    }).toThrow(RangeError);
    expect(snapshot(source)).toEqual(before);
    expect(source.play()[0].stereoPan).toBe(-0.25);
    source.stop();
  });

  it("preflights all HRTF values before changing earlier fields", async () => {
    const source = await makeSource(kind, "HRTF");
    const [voice] = source.play();
    const before = snapshot(source);
    expect(() => {
      source.threeDOptions = { refDistance: 7, channelCount: 3 };
    }).toThrow(RangeError);
    expect(snapshot(source)).toEqual(before);
    expect(() => {
      voice.threeDOptions = { refDistance: 7, channelCount: 3 };
    }).toThrow(RangeError);
    expect(snapshot(source)).toEqual(before);
    expect(() => {
      source.position = [1, Infinity, 3];
    }).toThrow(RangeError);
    expect(snapshot(source)).toEqual(before);
    source.stop();
  });

  it("preflights cleaned voices before updating defaults or earlier voices", async () => {
    const source = await makeSource(kind, "stereo");
    const [first] = source.play();
    source.play()[0].cleanup();
    expect(() => {
      source.stereoPan = 0.5;
    }).toThrow();
    expect(source.stereoPan).toBe(0);
    expect(first.stereoPan).toBe(0);
    first.stop();
    first.cleanup();
  });

  it("applies compatible settings to every current and future voice", async () => {
    const stereo = await makeSource(kind, "stereo");
    stereo.play();
    stereo.play();
    stereo.stereoPan = -0.5;
    stereo.play();
    expect(stereo.playbacks.map((voice) => voice.stereoPan)).toEqual([-0.5, -0.5, -0.5]);
    stereo.stop();
    const hrtf = await makeSource(kind, "HRTF");
    hrtf.play();
    hrtf.play();
    hrtf.position = [1, 2, 3];
    hrtf.threeDOptions = { refDistance: 5, orientationY: 1 };
    hrtf.play();
    expect(hrtf.threeDOptions.refDistance).toBe(5);
    for (const voice of hrtf.playbacks) {
      expect(voice.position).toEqual([1, 2, 3]);
      // The mock's non-AudioParam setters are inert; native coverage below checks refDistance.
      expect(voice.threeDOptions).toMatchObject({ orientationY: 1 });
    }
    hrtf.stop();
  });

  it("preserves omitted values and owns configuration snapshots", async () => {
    const source = await makeSource(kind, "HRTF");
    source.position = [1, 2, 3];
    source.threeDOptions = { positionX: undefined, refDistance: 5 };
    const config = source.threeDOptions;
    config.positionX = 99;
    expect(source.position).toEqual([1, 2, 3]);
    const [voice] = source.play();
    voice.threeDOptions = { positionX: undefined, orientationX: 1 };
    expect(voice.position).toEqual([1, 2, 3]);
    const tuple: [number, number, number] = [4, 5, 6];
    source.threeDOptions = { ...source.threeDOptions, positionX: 8, position: tuple };
    tuple[0] = 99;
    expect(source.position).toEqual([4, 5, 6]);
    expect(voice.position).toEqual([4, 5, 6]);
    expect(source.play()[0].position).toEqual([4, 5, 6]);
    source.stop();
  });

  it("keeps explicit clone mode selection working", async () => {
    const source = await makeSource(kind, "HRTF");
    source.position = [1, 2, 3];
    const stereo = source.clone({ panType: "stereo", stereoPan: -0.5 });
    expect(stereo.play()[0].stereoPan).toBe(-0.5);
    const hrtf = stereo.clone({ panType: "HRTF", position: [4, 5, 6] });
    expect(hrtf.play()[0].position).toEqual([4, 5, 6]);
    stereo.stop();
    hrtf.stop();
  });
});

describe("spatial control owners", () => {
  it.skipIf(!nodeBackendAvailable)("keeps native stereo pan after rejecting mixed modes", async () => {
    const { cacophony: engine, context } = await createOfflineNodeCacophony({
      length: 512,
      sampleRate: 48000,
      numberOfChannels: 2,
      quiet: true,
    });
    const buffer = context.createBuffer(1, 512, 48000);
    buffer.getChannelData(0).fill(0.25);
    const sound = await engine.createSound(buffer, "buffer", "stereo");
    sound.stereoPan = -1;
    const [left] = sound.play();
    sound.play({ panType: "HRTF", volume: 0 });
    expect(() => {
      sound.stereoPan = 1;
    }).toThrow();
    expect(sound.stereoPan).toBe(-1);
    expect(left.stereoPan).toBe(-1);
    const rendered = await context.startRendering();
    expect(rendered.getChannelData(0)[256]).toBeCloseTo(0.25);
    expect(Math.abs(rendered.getChannelData(1)[256])).toBeLessThan(1e-6);
    sound.cleanup();
  });

  it.skipIf(!nodeBackendAvailable)("updates native HRTF nodes and future voices coherently", async () => {
    const { cacophony: engine, context } = await createOfflineNodeCacophony({
      length: 128,
      sampleRate: 48000,
      quiet: true,
    });
    const sound = await engine.createSound(context.createBuffer(1, 128, 48000));
    sound.preplay();
    sound.preplay();
    sound.threeDOptions = { refDistance: 5, rolloffFactor: 0.5, positionX: 2 };
    sound.preplay();
    for (const voice of sound.playbacks) {
      expect(voice.threeDOptions).toMatchObject({ refDistance: 5, rolloffFactor: 0.5, positionX: 2 });
    }
    const before = sound.threeDOptions;
    expect(() => {
      sound.threeDOptions = { refDistance: 8, coneOuterGain: 2 };
    }).toThrow(RangeError);
    expect(sound.threeDOptions).toEqual(before);
    for (const voice of sound.playbacks) expect(voice.threeDOptions.refDistance).toBe(5);
    sound.stop();
  });

  it("checks stream source modes before a voice exists", async () => {
    const media = new MediaStreamSound({} as MediaStream, audioContextMock, audioContextMock.createGain());
    const pcm = await cacophony.createPcmStreamSound({ panType: "stereo" });
    expect(() => {
      media.stereoPan = 0.5;
    }).toThrow();
    expect(media.stereoPan).toBe(0);
    expect(() => {
      pcm.position = [1, 2, 3];
    }).toThrow();
    expect(pcm.position).toEqual([0, 0, 0]);
    pcm.cleanup();
  });

  it("preflights group members and their voices before any member or group update", async () => {
    const first = await cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }));
    const second = await cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }));
    second.play({ panType: "stereo" });
    const group = new Group([first, second]);
    expect(() => {
      group.position = [1, 2, 3];
    }).toThrow();
    expect(group.position).toEqual([0, 0, 0]);
    expect(first.position).toEqual([0, 0, 0]);
    second.stop();
    const stereo = cacophony.createOscillator({}, "stereo");
    const hrtf = cacophony.createOscillator({}, "HRTF");
    const synths = new SynthGroup([stereo, hrtf]);
    expect(() => {
      synths.stereoPan = 0.5;
    }).toThrow();
    expect(stereo.stereoPan).toBe(0);
    expect(() => {
      new SynthGroup([hrtf, stereo]).position = [1, 2, 3];
    }).toThrow();
    expect(hrtf.position).toEqual([0, 0, 0]);
  });

  it("shares direct voice and invocation spatial validation", async () => {
    const sound = await cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }));
    const [voice] = sound.play();
    const before = voice.position;
    const invalid: PlayOptions = { position: [1, NaN, 3] };
    expect(() => sound.play(invalid)).toThrow(RangeError);
    expect(() => {
      voice.position = invalid.position!;
    }).toThrow(RangeError);
    expect(voice.position).toEqual(before);
    const sparse = new Array<number>(3);
    sparse[0] = 1;
    sparse[2] = 3;
    expect(() => {
      sound.position = sparse as [number, number, number];
    }).toThrow(RangeError);
    expect(sound.position).toEqual(before);
    sound.stop();
  });
});
