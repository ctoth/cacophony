import { vi, expect, describe, it, beforeEach } from "vitest";
import { audioContextMock } from "./setupTests";
import { BasePlayback } from "./basePlayback";
import { Sound } from "./sound";

// Create a concrete implementation of BasePlayback for testing
class TestPlayback extends BasePlayback {
    constructor(
        public source?: AudioNode,
        public gainNode?: GainNode,
        public panner?: AudioNode
    ) {
        super();
    }

    play(): [this] { return [this]; }
    pause(): void {}
    stop(): void {}
    cleanup(): void {
        this.source = undefined;
        this.gainNode = undefined;
        this.panner = undefined;
    }
}

describe("BasePlayback Audio Node Interface", () => {
    let playback: TestPlayback;
    let destination: AudioNode;
    let param: AudioParam;

    beforeEach(() => {
        const source = audioContextMock.createOscillator();
        const gainNode = audioContextMock.createGain();
        const panner = audioContextMock.createStereoPanner();
        playback = new TestPlayback(source, gainNode, panner);
        destination = audioContextMock.createGain();
        param = destination.gain;
    });

    describe("Connection Methods", () => {
        it("can connect to other nodes", () => {
            const connectSpy = vi.spyOn(playback.outputNode, 'connect');
            playback.connect(destination);
            expect(connectSpy).toHaveBeenCalledWith(destination);
        });

        it("can connect to audio params", () => {
            const connectSpy = vi.spyOn(playback.outputNode, 'connect');
            playback.connect(param);
            expect(connectSpy).toHaveBeenCalledWith(param);
        });

        it("can disconnect all outputs", () => {
            const disconnectSpy = vi.spyOn(playback.outputNode, 'disconnect');
            playback.disconnect();
            expect(disconnectSpy).toHaveBeenCalled();
        });
    });

    describe("Error Handling", () => {
        it("throws when accessing nodes after cleanup", () => {
            playback.cleanup();
            expect(() => playback.connect(destination)).toThrow();
            expect(() => playback.disconnect()).toThrow();
        });
    });
});
