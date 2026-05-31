import { AudioContext } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Cacophony } from "../cacophony";
import { audioContextMock, cacophony } from "../setupTests";
import { LoudnessMeter } from "./loudness-meter";

/**
 * The standardized-audio-context mock does not expose `audioWorklet`, and it
 * carries NO signal (its AnalyserNode is an empty stub), so these tests assert
 * the GRAPH WIRING only — that `createLoudnessMeter` branch-taps the target
 * output WITHOUT disturbing the audible path. The metering MATH is unit-tested
 * directly on Float32Arrays in `loudness-core.test.ts` / `truepeak-core.test.ts`.
 */
const mockAudioWorklet = () => {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", {
    value: { addModule },
    writable: true,
    configurable: true,
  });
  return addModule;
};

describe("createLoudnessMeter — graph wiring (ITU-R BS.1770-5 tap)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("taps the master bus output as a BRANCH without breaking the audible chain", async () => {
    // master.output → destination is the audible edge; the meter must be an
    // ADDITIONAL edge off master.output, never a replacement.
    const masterOut = cacophony.master.output;
    const connectSpy = vi.spyOn(masterOut, "connect");
    const disconnectSpy = vi.spyOn(masterOut, "disconnect");

    const meter = await cacophony.createLoudnessMeter();

    expect(meter).toBeInstanceOf(LoudnessMeter);
    // The branch tap connected master.output to the worklet node.
    expect(connectSpy).toHaveBeenCalledWith(meter.workletNode);
    // It did NOT disconnect anything — the audible path is untouched.
    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it("registers the loudness-meter worklet module on the context", async () => {
    const addModule = mockAudioWorklet();
    await cacophony.createLoudnessMeter();
    expect(addModule).toHaveBeenCalled();
  });

  it("taps an arbitrary AudioNode's output when one is supplied", async () => {
    const node = cacophony.context.createGain();
    const connectSpy = vi.spyOn(node, "connect");

    const meter = await cacophony.createLoudnessMeter(node);

    expect(connectSpy).toHaveBeenCalledWith(meter.workletNode);
  });

  it("taps a Bus's output node when a Bus is supplied", async () => {
    const bus = cacophony.createBus("meter-bus");
    const connectSpy = vi.spyOn(bus.output, "connect");

    const meter = await cacophony.createLoudnessMeter(bus);

    expect(connectSpy).toHaveBeenCalledWith(meter.workletNode);
    bus.destroy();
  });

  it("exposes initial readings of -Infinity before any worklet report arrives", async () => {
    const meter = await cacophony.createLoudnessMeter();
    expect(meter.momentary).toBe(-Infinity);
    expect(meter.shortTerm).toBe(-Infinity);
    expect(meter.integrated).toBe(-Infinity);
    expect(meter.truePeak).toBe(-Infinity);
  });

  it("posts a reset command to the worklet port", async () => {
    const meter = await cacophony.createLoudnessMeter();
    const postSpy = vi.spyOn(meter.workletNode.port, "postMessage");
    meter.reset();
    expect(postSpy).toHaveBeenCalledWith({ command: "reset" });
  });

  it("removes only its own branch on disconnect (audible path preserved)", async () => {
    const node = cacophony.context.createGain();
    const disconnectSpy = vi.spyOn(node, "disconnect");

    const meter = await cacophony.createLoudnessMeter(node);
    meter.disconnect();

    // Disconnect targets ONLY the worklet node, not a blanket node.disconnect().
    expect(disconnectSpy).toHaveBeenCalledWith(meter.workletNode);
  });

  it("builds the meter on the TARGET node's OWN context, not always this.context (no cross-context connect)", async () => {
    // The bug: createLoudnessMeter loaded/constructed on `this.context` even when
    // the target node lived on a DIFFERENT BaseContext, which would cross-connect
    // two contexts (illegal in Web Audio). The meter must load the worklet AND
    // build the node on the target node's own context.

    // A second, FOREIGN context with its own addModule spy.
    const foreignCtx = new AudioContext();
    const foreignAddModule = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(foreignCtx, "audioWorklet", {
      value: { addModule: foreignAddModule },
      writable: true,
      configurable: true,
    });
    // The host context (this.context) gets its own DISTINCT addModule spy.
    const hostAddModule = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(audioContextMock, "audioWorklet", {
      value: { addModule: hostAddModule },
      writable: true,
      configurable: true,
    });

    // Record which BaseContext the worklet node was constructed against.
    const builtOn: unknown[] = [];
    const host = new Cacophony(audioContextMock, undefined, {
      createAudioWorkletNode: (workletContext) => {
        builtOn.push(workletContext);
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          port: { postMessage: vi.fn(), addEventListener: vi.fn(), start: vi.fn() },
        } as never;
      },
    });

    // A node on the FOREIGN context.
    const foreignNode = foreignCtx.createGain();
    const meter = await host.createLoudnessMeter(foreignNode);

    expect(meter).toBeInstanceOf(LoudnessMeter);
    // The worklet module was registered on the FOREIGN context, never the host's.
    expect(foreignAddModule).toHaveBeenCalled();
    expect(hostAddModule).not.toHaveBeenCalled();
    // The node was constructed against the FOREIGN context (no cross-context).
    expect(builtOn).toContain(foreignCtx);
    expect(builtOn).not.toContain(audioContextMock);

    foreignCtx.close();
  });
});
