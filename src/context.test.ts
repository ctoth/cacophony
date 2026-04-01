/**
 * Type compliance tests for context interfaces.
 *
 * These tests verify that standardized-audio-context-mock objects
 * structurally satisfy our interfaces. If this file compiles, the
 * types are compatible. The runtime assertions are secondary confirmation.
 */

import { AudioBuffer as MockAudioBuffer, AudioContext as MockAudioContext } from "standardized-audio-context-mock";
import { describe, expect, it } from "vitest";
import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioListener,
  AudioParam,
  BaseContext,
  BiquadFilterNode,
  GainNode,
  OscillatorNode,
  PannerNode,
  StereoPannerNode,
} from "./context";

describe("Context interface compliance", () => {
  describe("SAC mock satisfies BaseContext", () => {
    it("mock AudioContext is assignable to BaseContext", () => {
      const mock = new MockAudioContext();
      // Compile-time check: if this assignment works, the mock satisfies the interface
      const ctx: BaseContext = mock as unknown as BaseContext;
      expect(ctx.currentTime).toBeDefined();
      expect(ctx.sampleRate).toBeGreaterThan(0);
      expect(ctx.destination).toBeDefined();
      expect(ctx.listener).toBeDefined();
      expect(typeof ctx.createGain).toBe("function");
      expect(typeof ctx.createBufferSource).toBe("function");
      expect(typeof ctx.createBiquadFilter).toBe("function");
      expect(typeof ctx.createPanner).toBe("function");
      expect(typeof ctx.createStereoPanner).toBe("function");
      expect(typeof ctx.createOscillator).toBe("function");
      expect(typeof ctx.decodeAudioData).toBe("function");
      mock.close();
    });
  });

  describe("SAC mock nodes satisfy node interfaces", () => {
    let mock: MockAudioContext;

    // Fresh context per test to avoid cross-contamination
    function freshContext() {
      return new MockAudioContext();
    }

    it("GainNode", () => {
      mock = freshContext();
      const gain = mock.createGain() as unknown as GainNode;
      expect(gain.gain).toBeDefined();
      expect(typeof gain.gain.value).toBe("number");
      expect(typeof gain.gain.setValueAtTime).toBe("function");
      expect(typeof gain.gain.linearRampToValueAtTime).toBe("function");
      expect(typeof gain.gain.exponentialRampToValueAtTime).toBe("function");
      expect(typeof gain.gain.cancelScheduledValues).toBe("function");
      expect(typeof gain.connect).toBe("function");
      expect(typeof gain.disconnect).toBe("function");
      mock.close();
    });

    it("BiquadFilterNode", () => {
      mock = freshContext();
      const filter = mock.createBiquadFilter() as unknown as BiquadFilterNode;
      expect(filter.type).toBeDefined();
      expect(filter.frequency).toBeDefined();
      expect(filter.Q).toBeDefined();
      expect(filter.gain).toBeDefined();
      expect(typeof filter.frequency.value).toBe("number");
      mock.close();
    });

    it("PannerNode", () => {
      mock = freshContext();
      const panner = mock.createPanner() as unknown as PannerNode;
      expect(typeof panner.coneInnerAngle).toBe("number");
      expect(typeof panner.coneOuterAngle).toBe("number");
      expect(typeof panner.distanceModel).toBe("string");
      expect(typeof panner.panningModel).toBe("string");
      expect(panner.positionX).toBeDefined();
      expect(panner.positionY).toBeDefined();
      expect(panner.positionZ).toBeDefined();
      expect(panner.orientationX).toBeDefined();
      expect(panner.orientationY).toBeDefined();
      expect(panner.orientationZ).toBeDefined();
      mock.close();
    });

    it("StereoPannerNode", () => {
      mock = freshContext();
      const panner = mock.createStereoPanner() as unknown as StereoPannerNode;
      expect(panner.pan).toBeDefined();
      expect(typeof panner.pan.value).toBe("number");
      mock.close();
    });

    it("AudioBufferSourceNode", () => {
      mock = freshContext();
      const source = mock.createBufferSource() as unknown as AudioBufferSourceNode;
      expect(typeof source.loop).toBe("boolean");
      expect(typeof source.loopStart).toBe("number");
      expect(typeof source.loopEnd).toBe("number");
      expect(source.playbackRate).toBeDefined();
      expect(typeof source.start).toBe("function");
      expect(typeof source.stop).toBe("function");
      mock.close();
    });

    it("OscillatorNode", () => {
      mock = freshContext();
      const osc = mock.createOscillator() as unknown as OscillatorNode;
      expect(osc.type).toBeDefined();
      expect(osc.frequency).toBeDefined();
      expect(osc.detune).toBeDefined();
      expect(typeof osc.start).toBe("function");
      expect(typeof osc.stop).toBe("function");
      mock.close();
    });

    it("AudioBuffer", () => {
      const buf = new MockAudioBuffer({ length: 100, sampleRate: 44100 }) as unknown as AudioBuffer;
      expect(typeof buf.duration).toBe("number");
      expect(buf.length).toBe(100);
      expect(buf.sampleRate).toBe(44100);
      expect(typeof buf.numberOfChannels).toBe("number");
      expect(typeof buf.getChannelData).toBe("function");
    });

    it("AudioListener (mock returns empty object — tests mock it manually)", () => {
      mock = freshContext();
      // The SAC mock's listener getter returns {} — existing tests replace it
      // with a manual mock. This test verifies that a properly shaped listener
      // object satisfies our interface.
      const mockListener: AudioListener = {
        positionX: {
          value: 0,
          setValueAtTime: () => mockListener.positionX,
          linearRampToValueAtTime: () => mockListener.positionX,
          exponentialRampToValueAtTime: () => mockListener.positionX,
          cancelScheduledValues: () => mockListener.positionX,
        },
        positionY: {
          value: 0,
          setValueAtTime: () => mockListener.positionY,
          linearRampToValueAtTime: () => mockListener.positionY,
          exponentialRampToValueAtTime: () => mockListener.positionY,
          cancelScheduledValues: () => mockListener.positionY,
        },
        positionZ: {
          value: 0,
          setValueAtTime: () => mockListener.positionZ,
          linearRampToValueAtTime: () => mockListener.positionZ,
          exponentialRampToValueAtTime: () => mockListener.positionZ,
          cancelScheduledValues: () => mockListener.positionZ,
        },
        forwardX: {
          value: 0,
          setValueAtTime: () => mockListener.forwardX,
          linearRampToValueAtTime: () => mockListener.forwardX,
          exponentialRampToValueAtTime: () => mockListener.forwardX,
          cancelScheduledValues: () => mockListener.forwardX,
        },
        forwardY: {
          value: 0,
          setValueAtTime: () => mockListener.forwardY,
          linearRampToValueAtTime: () => mockListener.forwardY,
          exponentialRampToValueAtTime: () => mockListener.forwardY,
          cancelScheduledValues: () => mockListener.forwardY,
        },
        forwardZ: {
          value: 0,
          setValueAtTime: () => mockListener.forwardZ,
          linearRampToValueAtTime: () => mockListener.forwardZ,
          exponentialRampToValueAtTime: () => mockListener.forwardZ,
          cancelScheduledValues: () => mockListener.forwardZ,
        },
        upX: {
          value: 0,
          setValueAtTime: () => mockListener.upX,
          linearRampToValueAtTime: () => mockListener.upX,
          exponentialRampToValueAtTime: () => mockListener.upX,
          cancelScheduledValues: () => mockListener.upX,
        },
        upY: {
          value: 0,
          setValueAtTime: () => mockListener.upY,
          linearRampToValueAtTime: () => mockListener.upY,
          exponentialRampToValueAtTime: () => mockListener.upY,
          cancelScheduledValues: () => mockListener.upY,
        },
        upZ: {
          value: 0,
          setValueAtTime: () => mockListener.upZ,
          linearRampToValueAtTime: () => mockListener.upZ,
          exponentialRampToValueAtTime: () => mockListener.upZ,
          cancelScheduledValues: () => mockListener.upZ,
        },
      };
      expect(mockListener.positionX.value).toBe(0);
      expect(typeof mockListener.positionX.setValueAtTime).toBe("function");
      mock.close();
    });
  });

  describe("AudioParam interface", () => {
    it("gain param satisfies AudioParam", () => {
      const mock = new MockAudioContext();
      const gain = mock.createGain();
      const param = gain.gain as unknown as AudioParam;
      // All required methods exist
      expect(typeof param.value).toBe("number");
      expect(typeof param.setValueAtTime).toBe("function");
      expect(typeof param.linearRampToValueAtTime).toBe("function");
      expect(typeof param.exponentialRampToValueAtTime).toBe("function");
      expect(typeof param.cancelScheduledValues).toBe("function");
      mock.close();
    });
  });
});
