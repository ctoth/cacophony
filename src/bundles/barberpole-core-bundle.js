var barberpoleCore = (function (exports) {
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

    /** First-order allpass A(z)=(a+z^-1)/(1+a z^-1), DAFx-15 eq. 14. */
    class FirstOrderAllpass {
        x1 = 0;
        y1 = 0;
        process(input, coefficient) {
            const output = coefficient * input + this.x1 - coefficient * this.y1;
            this.x1 = input;
            this.y1 = output;
            return output;
        }
    }
    /**
     * SSB barberpole phaser from Esqueda, Valimaki & Parker, DAFx-15 Fig. 12.
     * The Hilbert shifter supplies the moving copy; a cascaded allpass spectral
     * delay warps the notch spacing toward the Shepard-Risset octave distribution.
     */
    class BarberpoleCore {
        sampleRate;
        hilbert = new HilbertTransformer();
        allpasses = Array.from({ length: 64 }, () => new FirstOrderAllpass());
        phase = 0;
        constructor(sampleRate) {
            this.sampleRate = sampleRate;
        }
        processSample(input, params) {
            const pair = this.hilbert.process(input);
            let shifted = pair.direct * Math.cos(this.phase) - pair.quadrature * Math.sin(this.phase);
            const stages = Math.max(2, Math.min(this.allpasses.length, Math.round(params.stages)));
            const coefficient = Math.max(-0.95, Math.min(0.95, params.coefficient));
            for (let i = 0; i < stages; i++)
                shifted = this.allpasses[i].process(shifted, coefficient);
            const rate = Math.max(-2, Math.min(2, params.rate));
            this.phase += (2 * Math.PI * rate) / this.sampleRate;
            if (this.phase > Math.PI || this.phase < -Math.PI)
                this.phase -= Math.round(this.phase / (2 * Math.PI)) * 2 * Math.PI;
            const barberpole = 0.5 * (pair.direct + shifted);
            const mix = Math.max(0, Math.min(1, params.mix));
            return pair.direct * (1 - mix) + barberpole * mix;
        }
        process(input, output, params) {
            for (let i = 0; i < input.length; i++)
                output[i] = this.processSample(input[i], params);
        }
    }

    exports.BarberpoleCore = BarberpoleCore;

    return exports;

})({});
//# sourceMappingURL=barberpole-core-bundle.js.map
