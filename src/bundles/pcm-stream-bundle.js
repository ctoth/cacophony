var pcmStream = (function (exports) {
    'use strict';

    class PcmRingBuffer {
        capacityFrames;
        channelCount;
        channels;
        readIndex = 0;
        writeIndex = 0;
        size = 0;
        constructor(capacityFrames, channelCount) {
            this.capacityFrames = capacityFrames;
            this.channelCount = channelCount;
            if (!Number.isInteger(capacityFrames) || capacityFrames <= 0) {
                throw new RangeError("PCM ring-buffer capacity must be a positive integer");
            }
            if (!Number.isInteger(channelCount) || channelCount <= 0) {
                throw new RangeError("PCM channel count must be a positive integer");
            }
            this.channels = Array.from({ length: channelCount }, () => new Float32Array(capacityFrames));
        }
        get bufferedFrames() {
            return this.size;
        }
        writeInterleaved(samples) {
            if (samples.length % this.channelCount !== 0) {
                throw new RangeError(`Interleaved PCM length must be divisible by channelCount (${this.channelCount})`);
            }
            const frameCount = samples.length / this.channelCount;
            if (frameCount > this.capacityFrames - this.size) {
                return false;
            }
            for (let frame = 0; frame < frameCount; frame++) {
                for (let channel = 0; channel < this.channelCount; channel++) {
                    this.channels[channel][this.writeIndex] = samples[frame * this.channelCount + channel];
                }
                this.writeIndex = (this.writeIndex + 1) % this.capacityFrames;
            }
            this.size += frameCount;
            return true;
        }
        read(output) {
            const frameCount = Math.min(this.size, output[0]?.length ?? 0);
            for (let frame = 0; frame < frameCount; frame++) {
                for (let channel = 0; channel < Math.min(this.channelCount, output.length); channel++) {
                    output[channel][frame] = this.channels[channel][this.readIndex];
                }
                this.readIndex = (this.readIndex + 1) % this.capacityFrames;
            }
            this.size -= frameCount;
            return frameCount;
        }
        clear() {
            this.readIndex = 0;
            this.writeIndex = 0;
            this.size = 0;
        }
    }
    /**
     * Context-free state machine for the PCM stream worklet.
     *
     * The worklet shell owns MessagePort plumbing; this class owns the fixed-size
     * ring buffer, latency gate, pause/resume position, underrun episodes, and
     * terminal end-of-input behavior.
     */
    class PcmStreamEngine {
        ring;
        latencyFrames;
        playing = false;
        started = false;
        inputEnded = false;
        underrunActive = false;
        endedReported = false;
        constructor(options) {
            if (!Number.isInteger(options.latencyFrames) || options.latencyFrames < 0) {
                throw new RangeError("PCM latency must be a non-negative integer number of frames");
            }
            if (options.latencyFrames > options.capacityFrames) {
                throw new RangeError("PCM latency cannot exceed the ring-buffer capacity");
            }
            this.ring = new PcmRingBuffer(options.capacityFrames, options.channelCount);
            this.latencyFrames = options.latencyFrames;
        }
        get bufferedFrames() {
            return this.ring.bufferedFrames;
        }
        writeInterleaved(samples) {
            if (this.inputEnded) {
                throw new Error("Cannot write PCM after end()");
            }
            const accepted = this.ring.writeInterleaved(samples);
            if (accepted) {
                this.underrunActive = false;
            }
            return accepted;
        }
        play() {
            if (!this.endedReported) {
                this.playing = true;
            }
        }
        pause() {
            this.playing = false;
        }
        stop() {
            this.ring.clear();
            this.playing = false;
            this.started = false;
            this.inputEnded = false;
            this.underrunActive = false;
            this.endedReported = false;
        }
        end() {
            this.inputEnded = true;
        }
        process(output) {
            for (const channel of output) {
                channel.fill(0);
            }
            const result = {
                consumedFrames: 0,
                ended: false,
                underrun: false,
            };
            const quantumFrames = output[0]?.length ?? 0;
            if (!this.playing || quantumFrames === 0) {
                return result;
            }
            if (!this.started) {
                if (this.ring.bufferedFrames < this.latencyFrames && !this.inputEnded) {
                    return result;
                }
                this.started = true;
            }
            result.consumedFrames = this.ring.read(output);
            if (this.inputEnded && this.ring.bufferedFrames === 0) {
                this.playing = false;
                if (!this.endedReported) {
                    this.endedReported = true;
                    result.ended = true;
                }
                return result;
            }
            if (result.consumedFrames < quantumFrames && this.ring.bufferedFrames === 0 && !this.underrunActive) {
                this.underrunActive = true;
                result.underrun = true;
            }
            return result;
        }
    }

    /**
     * AudioWorklet shell for push-based PCM playback.
     *
     * All buffering and playback state lives in the context-free
     * {@link PcmStreamEngine}; this class only translates MessagePort commands,
     * renders one Web Audio quantum, and reports consumption/state upstream.
     */
    class PcmStreamWorkletProcessor extends AudioWorkletProcessor {
        engine;
        constructor(options) {
            super(options);
            const processorOptions = (options?.processorOptions ?? {});
            this.engine = new PcmStreamEngine({
                capacityFrames: processorOptions.capacityFrames ?? sampleRate,
                channelCount: processorOptions.channelCount ?? 1,
                latencyFrames: processorOptions.latencyFrames ?? 0,
            });
            this.port.onmessage = (event) => {
                const command = event.data;
                switch (command.type) {
                    case "write":
                        if (!this.engine.writeInterleaved(command.samples)) {
                            this.port.postMessage({ type: "overflow" });
                        }
                        break;
                    case "play":
                        this.engine.play();
                        break;
                    case "pause":
                        this.engine.pause();
                        break;
                    case "stop":
                        this.engine.stop();
                        break;
                    case "end":
                        this.engine.end();
                        break;
                }
            };
        }
        process(_inputs, outputs) {
            const result = this.engine.process(outputs[0] ?? []);
            if (result.consumedFrames > 0) {
                this.port.postMessage({ type: "consumed", frames: result.consumedFrames });
            }
            if (result.underrun) {
                this.port.postMessage({ type: "underrun" });
            }
            if (result.ended) {
                this.port.postMessage({ type: "ended" });
            }
            return true;
        }
    }
    registerProcessor("pcm-stream", PcmStreamWorkletProcessor);

    exports.PcmStreamWorkletProcessor = PcmStreamWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=pcm-stream-bundle.js.map
