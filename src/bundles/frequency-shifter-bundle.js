var frequencyShifter = (function (exports) {
    'use strict';

    /**
     * FIR-Hilbert single-sideband frequency shifter.
     *
     * Scott Wardle, "A Hilbert-Transformer Frequency Shifter for Audio",
     * DAFx-98, eq. 5c:
     *
     *   y(t) = x(t) cos(w_c t) - H{x(t)} sin(w_c t)
     *
     * The real path is delayed by the FIR group delay so it remains in quadrature
     * with the Hilbert path. A signed carrier frequency chooses upper/lower
     * sideband translation without changing the algorithm.
     */
    const DEFAULT_TAPS = 127;
    /** Windowed ideal odd-symmetric Hilbert-transform FIR. */
    function designHilbertFir(tapCount = DEFAULT_TAPS) {
        if (tapCount < 7 || tapCount % 2 === 0) {
            throw new RangeError("Hilbert FIR tap count must be an odd integer >= 7");
        }
        const center = (tapCount - 1) / 2;
        const coefficients = new Float64Array(tapCount);
        for (let n = 0; n < tapCount; n++) {
            const m = n - center;
            if (m !== 0 && Math.abs(m) % 2 === 1) {
                const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (tapCount - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (tapCount - 1));
                coefficients[n] = (2 / (Math.PI * m)) * window;
            }
        }
        return coefficients;
    }
    /** Streaming FIR Hilbert transformer with an aligned direct tap. */
    class HilbertTransformer {
        latencySamples;
        coefficients;
        buffer;
        mask;
        writeIndex = 0;
        constructor(tapCount = DEFAULT_TAPS) {
            this.coefficients = designHilbertFir(tapCount);
            this.latencySamples = (tapCount - 1) / 2;
            const size = 2 ** Math.ceil(Math.log2(tapCount + 1));
            this.buffer = new Float64Array(size);
            this.mask = size - 1;
        }
        process(input) {
            this.buffer[this.writeIndex] = input;
            let quadrature = 0;
            for (let i = 0; i < this.coefficients.length; i++) {
                quadrature += this.coefficients[i] * this.buffer[(this.writeIndex - i) & this.mask];
            }
            const direct = this.buffer[(this.writeIndex - this.latencySamples) & this.mask];
            this.writeIndex = (this.writeIndex + 1) & this.mask;
            return { direct, quadrature };
        }
        reset() {
            this.buffer.fill(0);
            this.writeIndex = 0;
        }
    }
    /** One-channel streaming SSB shifter. Create one instance per audio channel. */
    class FrequencyShifterCore {
        sampleRate;
        hilbert;
        phase = 0;
        constructor(sampleRate, tapCount = DEFAULT_TAPS) {
            this.sampleRate = sampleRate;
            this.hilbert = new HilbertTransformer(tapCount);
        }
        processSample(input, params) {
            const pair = this.hilbert.process(input);
            const shifted = pair.direct * Math.cos(this.phase) - pair.quadrature * Math.sin(this.phase);
            const mix = Math.max(0, Math.min(1, params.mix));
            const frequency = Math.max(-this.sampleRate / 2, Math.min(this.sampleRate / 2, params.frequency));
            this.phase += (2 * Math.PI * frequency) / this.sampleRate;
            if (this.phase > Math.PI || this.phase < -Math.PI)
                this.phase -= Math.round(this.phase / (2 * Math.PI)) * 2 * Math.PI;
            return pair.direct * (1 - mix) + shifted * mix;
        }
        process(input, output, params) {
            for (let i = 0; i < input.length; i++)
                output[i] = this.processSample(input[i], params);
        }
        reset() {
            this.hilbert.reset();
            this.phase = 0;
        }
    }

    class FrequencyShifterWorkletProcessor extends AudioWorkletProcessor {
        cores = [];
        static get parameterDescriptors() {
            return [
                { name: "frequency", defaultValue: 100, minValue: -24e3, maxValue: 24000, automationRate: "k-rate" },
                { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
            ];
        }
        process(inputs, outputs, parameters) {
            const input = inputs[0] ?? [];
            const output = outputs[0] ?? [];
            const frequency = parameters.frequency[parameters.frequency.length - 1];
            const mix = parameters.mix[parameters.mix.length - 1];
            for (let channel = 0; channel < output.length; channel++) {
                const source = input[channel] ?? input[0];
                if (!source) {
                    output[channel].fill(0);
                    continue;
                }
                const core = (this.cores[channel] ??= new FrequencyShifterCore(sampleRate));
                core.process(source, output[channel], { frequency, mix });
            }
            return true;
        }
    }
    registerProcessor("frequency-shifter", FrequencyShifterWorkletProcessor);

    exports.FrequencyShifterWorkletProcessor = FrequencyShifterWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=frequency-shifter-bundle.js.map
