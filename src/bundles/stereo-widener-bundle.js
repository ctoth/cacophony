var stereoWidener = (function (exports) {
    'use strict';

    function seededRandom(seed) {
        let state = seed >>> 0;
        return () => {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 0x1_0000_0000;
        };
    }
    /** Exponentially decaying sparse velvet-noise FIR (Schlecht et al., DAFx-18). */
    function buildDecorrelatorTaps(sampleRate, seed) {
        const random = seededRandom(seed);
        const length = Math.max(32, Math.round(sampleRate * 0.02));
        const spacing = Math.max(3, Math.round(sampleRate / 2400));
        const taps = [];
        let energy = 0;
        for (let start = spacing; start < length; start += spacing) {
            const delay = Math.min(length - 1, start + Math.floor(random() * spacing));
            const sign = random() < 0.5 ? -1 : 1;
            const gain = sign * Math.exp((-3 * delay) / length);
            taps.push({ delay, gain });
            energy += gain * gain;
        }
        const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1;
        for (const tap of taps)
            tap.gain *= norm;
        return taps;
    }
    class SparseFir {
        taps;
        buffer;
        mask;
        write = 0;
        constructor(taps) {
            this.taps = taps;
            const maxDelay = taps.reduce((max, tap) => Math.max(max, tap.delay), 1);
            const size = 2 ** Math.ceil(Math.log2(maxDelay + 2));
            this.buffer = new Float32Array(size);
            this.mask = size - 1;
        }
        process(input) {
            this.buffer[this.write] = input;
            let output = 0;
            for (const tap of this.taps)
                output += tap.gain * this.buffer[(this.write - tap.delay) & this.mask];
            this.write = (this.write + 1) & this.mask;
            return output;
        }
    }
    /** Mono/stereo in to stereo out velvet-noise widener with transient bypass. */
    class StereoWidenerCore {
        leftFir;
        rightFir;
        envelope = 0;
        transient = 0;
        transientDecay;
        constructor(sampleRate) {
            this.leftFir = new SparseFir(buildDecorrelatorTaps(sampleRate, 0x51f15e));
            this.rightFir = new SparseFir(buildDecorrelatorTaps(sampleRate, 0xc0ffee));
            this.transientDecay = Math.exp(-1 / (sampleRate * 0.012));
        }
        processSample(left, right, params) {
            const level = Math.max(Math.abs(left), Math.abs(right));
            if (level > this.envelope * 3 + 0.04)
                this.transient = 1;
            this.envelope = Math.max(level, this.envelope * 0.995);
            this.transient *= this.transientDecay;
            const protection = Math.max(0, Math.min(1, params.transientProtection));
            const width = Math.max(0, Math.min(1, params.width)) * (1 - protection * this.transient);
            const decorrelation = Math.max(0, Math.min(1, params.decorrelation));
            const firLeft = this.leftFir.process(left);
            const firRight = this.rightFir.process(right);
            const decorLeft = left * (1 - decorrelation) + firLeft * decorrelation;
            const decorRight = right * (1 - decorrelation) + firRight * decorrelation;
            const dryGain = Math.cos((Math.PI / 2) * width);
            const wetGain = Math.sin((Math.PI / 2) * width);
            return [left * dryGain + decorLeft * wetGain, right * dryGain + decorRight * wetGain];
        }
    }

    class StereoWidenerWorkletProcessor extends AudioWorkletProcessor {
        core = new StereoWidenerCore(sampleRate);
        static get parameterDescriptors() {
            return [
                { name: "width", defaultValue: 0.65, minValue: 0, maxValue: 1, automationRate: "k-rate" },
                { name: "decorrelation", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
                { name: "transientProtection", defaultValue: 0.75, minValue: 0, maxValue: 1, automationRate: "k-rate" },
            ];
        }
        process(inputs, outputs, parameters) {
            const input = inputs[0] ?? [];
            const output = outputs[0] ?? [];
            if (output.length < 2)
                return true;
            const leftInput = input[0];
            const rightInput = input[1] ?? leftInput;
            const leftOutput = output[0];
            const rightOutput = output[1];
            if (!leftInput || !rightInput) {
                leftOutput.fill(0);
                rightOutput.fill(0);
                return true;
            }
            const params = {
                width: parameters.width[parameters.width.length - 1],
                decorrelation: parameters.decorrelation[parameters.decorrelation.length - 1],
                transientProtection: parameters.transientProtection[parameters.transientProtection.length - 1],
            };
            for (let i = 0; i < leftOutput.length; i++) {
                const [left, right] = this.core.processSample(leftInput[i], rightInput[i], params);
                leftOutput[i] = left;
                rightOutput[i] = right;
            }
            return true;
        }
    }
    registerProcessor("stereo-widener", StereoWidenerWorkletProcessor);

    exports.StereoWidenerWorkletProcessor = StereoWidenerWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=stereo-widener-bundle.js.map
