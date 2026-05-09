var bccEncoderCore = (function (exports) {
    'use strict';

    /**
     * Frame-domain stereo-to-FOA encoder using BCC-style per-band coherence
     * and pan analysis. Produces ACN-ordered FOA frequency bins.
     *
     * Input: one STFT frame of stereo audio (L and R), supplied as separate
     * real/imag arrays of length `fftSize / 2 + 1` (one-sided spectrum).
     *
     * Output: one STFT frame of FOA, in ACN order (W, Y, Z, X). Z and X are
     * always zeroed since stereo carries no genuine vertical or front/back
     * information.
     *
     * The core is host-agnostic and stateful: smoothing is exponential across
     * frames, so callers must pass frames in time order and reuse one
     * `BccEncoderState`. Window/FFT plumbing belongs to the worklet shell.
     *
     * Foundation papers (referenced but never copied from):
     * - Baumgarte & Faller 2003, "Binaural Cue Coding-Part I"
     * - Faller 2004, "Parametric Coding of Spatial Audio" (EPFL thesis)
     * - Pulkki 2009, "Directional audio coding"
     */
    const SQRT1_2 = Math.SQRT1_2;
    const POWER_EPSILON = 1e-12;
    const DEFAULT_BCC_CONFIG = {
        fftSize: 512,
        hopSize: 256,
        partitionBandwidthErb: 2,
        smoothingTauSeconds: 0.05,
        highEmphasis: 1.4,
        lowSuppression: 0,
    };
    /**
     * Convert frequency (Hz) to ERB (Equivalent Rectangular Bandwidth scale)
     * using Glasberg & Moore 1990. A handful of references use this exact
     * equation; it is in the public domain as a published formula.
     */
    function frequencyToErb(frequencyHz) {
        return 21.4 * Math.log10(1 + 0.00437 * frequencyHz);
    }
    /**
     * Build a one-sided FFT-bin → partition mapping where partitions are
     * approximately uniform on the ERB scale. Partition 0 always covers DC
     * and the bins below the first partition's edge frequency.
     */
    function buildErbPartitionTable(sampleRate, fftSize, partitionBandwidthErb) {
        const numBins = fftSize / 2 + 1;
        const nyquistHz = sampleRate / 2;
        const maxErb = frequencyToErb(nyquistHz);
        const numPartitions = Math.max(1, Math.ceil(maxErb / partitionBandwidthErb));
        const binToPartition = new Int32Array(numBins);
        for (let bin = 0; bin < numBins; bin++) {
            const binFrequency = (bin / fftSize) * sampleRate;
            const erb = frequencyToErb(binFrequency);
            const partition = Math.min(numPartitions - 1, Math.floor(erb / partitionBandwidthErb));
            binToPartition[bin] = partition;
        }
        return binToPartition;
    }
    /**
     * Number of distinct partitions implied by a bin→partition table.
     */
    function partitionCount(binToPartition) {
        let max = 0;
        for (let i = 0; i < binToPartition.length; i++) {
            if (binToPartition[i] > max)
                max = binToPartition[i];
        }
        return max + 1;
    }
    /**
     * Stateful BCC encoder. One instance per stereo source.
     */
    class BccEncoderState {
        config;
        binToPartition;
        numPartitions;
        numBins;
        /**
         * Exponential smoothing coefficient for per-partition statistics. We
         * use it as `smoothed = alpha * smoothed + (1 - alpha) * sample`; alpha
         * close to 1 means slow tracking.
         */
        smoothingAlpha;
        // Smoothed per-partition statistics. All length numPartitions.
        smoothedPowerL;
        smoothedPowerR;
        smoothedCrossRe;
        smoothedCrossIm;
        // Scratch accumulators reused per frame.
        framePowerL;
        framePowerR;
        frameCrossRe;
        frameCrossIm;
        // Per-partition gains computed from smoothed statistics; reused per frame.
        wGain;
        yGainSigned;
        // Per-partition emphasis scale derived from low/high boundaries. The
        // partition holding the first bin above LOW_BOUNDARY_HZ uses
        // lowSuppression; partitions above HIGH_BOUNDARY_HZ use highEmphasis;
        // intermediate partitions interpolate linearly on the ERB axis.
        partitionEmphasis;
        constructor(config) {
            this.config = config;
            this.binToPartition = buildErbPartitionTable(config.sampleRate, config.fftSize, config.partitionBandwidthErb);
            this.numPartitions = partitionCount(this.binToPartition);
            this.numBins = config.fftSize / 2 + 1;
            const frameRate = config.sampleRate / config.hopSize;
            this.smoothingAlpha = Math.exp(-1 / (config.smoothingTauSeconds * frameRate));
            this.smoothedPowerL = new Float64Array(this.numPartitions);
            this.smoothedPowerR = new Float64Array(this.numPartitions);
            this.smoothedCrossRe = new Float64Array(this.numPartitions);
            this.smoothedCrossIm = new Float64Array(this.numPartitions);
            this.framePowerL = new Float64Array(this.numPartitions);
            this.framePowerR = new Float64Array(this.numPartitions);
            this.frameCrossRe = new Float64Array(this.numPartitions);
            this.frameCrossIm = new Float64Array(this.numPartitions);
            this.wGain = new Float64Array(this.numPartitions);
            this.yGainSigned = new Float64Array(this.numPartitions);
            this.partitionEmphasis = new Float64Array(this.numPartitions);
            this.populateEmphasis();
        }
        populateEmphasis() {
            const { sampleRate, fftSize, lowSuppression, highEmphasis } = this.config;
            const lowBoundaryHz = 250;
            const highBoundaryHz = 2000;
            for (let p = 0; p < this.numPartitions; p++) {
                // Find a representative center frequency for this partition.
                const centerHz = this.partitionCenterFrequency(p, sampleRate, fftSize);
                let weight;
                if (centerHz <= lowBoundaryHz) {
                    weight = lowSuppression;
                }
                else if (centerHz >= highBoundaryHz) {
                    weight = highEmphasis;
                }
                else {
                    const t = (centerHz - lowBoundaryHz) / (highBoundaryHz - lowBoundaryHz);
                    weight = lowSuppression + t * (highEmphasis - lowSuppression);
                }
                this.partitionEmphasis[p] = weight;
            }
        }
        partitionCenterFrequency(partition, sampleRate, fftSize) {
            let firstBin = -1;
            let lastBin = -1;
            for (let bin = 0; bin < this.numBins; bin++) {
                if (this.binToPartition[bin] === partition) {
                    if (firstBin < 0)
                        firstBin = bin;
                    lastBin = bin;
                }
            }
            if (firstBin < 0)
                return 0;
            const centerBin = (firstBin + lastBin) / 2;
            return (centerBin / fftSize) * sampleRate;
        }
        /**
         * Reset all smoothed statistics. Call when the stream restarts (seek,
         * stop/start, etc.) so previous coherence state does not leak in.
         */
        reset() {
            this.smoothedPowerL.fill(0);
            this.smoothedPowerR.fill(0);
            this.smoothedCrossRe.fill(0);
            this.smoothedCrossIm.fill(0);
        }
        /**
         * Analyze one stereo STFT frame and write one frame of FOA output.
         *
         * All input/output arrays must be `numBins` long (one-sided spectrum).
         */
        analyzeAndEncode(leftRe, leftIm, rightRe, rightIm, wRe, wIm, yRe, yIm, zRe, zIm, xRe, xIm) {
            const numBins = this.numBins;
            const binToPartition = this.binToPartition;
            // Frame-level partition accumulators are zeroed each call.
            this.framePowerL.fill(0);
            this.framePowerR.fill(0);
            this.frameCrossRe.fill(0);
            this.frameCrossIm.fill(0);
            // Pass 1: accumulate per-partition power and cross-spectrum.
            // Cross-spectrum sample = L conj(R) = (Lr + i Li)(Rr - i Ri)
            //                       = (Lr Rr + Li Ri) + i (Li Rr - Lr Ri)
            for (let bin = 0; bin < numBins; bin++) {
                const lr = leftRe[bin];
                const li = leftIm[bin];
                const rr = rightRe[bin];
                const ri = rightIm[bin];
                const partition = binToPartition[bin];
                this.framePowerL[partition] += lr * lr + li * li;
                this.framePowerR[partition] += rr * rr + ri * ri;
                this.frameCrossRe[partition] += lr * rr + li * ri;
                this.frameCrossIm[partition] += li * rr - lr * ri;
            }
            const alpha = this.smoothingAlpha;
            const oneMinusAlpha = 1 - alpha;
            // Pass 2: update smoothed statistics, derive per-partition gains.
            for (let p = 0; p < this.numPartitions; p++) {
                this.smoothedPowerL[p] = alpha * this.smoothedPowerL[p] + oneMinusAlpha * this.framePowerL[p];
                this.smoothedPowerR[p] = alpha * this.smoothedPowerR[p] + oneMinusAlpha * this.framePowerR[p];
                this.smoothedCrossRe[p] = alpha * this.smoothedCrossRe[p] + oneMinusAlpha * this.frameCrossRe[p];
                this.smoothedCrossIm[p] = alpha * this.smoothedCrossIm[p] + oneMinusAlpha * this.frameCrossIm[p];
                const pl = this.smoothedPowerL[p];
                const pr = this.smoothedPowerR[p];
                const total = pl + pr + POWER_EPSILON;
                const denom = Math.sqrt(pl * pr) + POWER_EPSILON;
                const crossRe = this.smoothedCrossRe[p];
                const crossIm = this.smoothedCrossIm[p];
                const crossMag = Math.sqrt(crossRe * crossRe + crossIm * crossIm);
                const icc = Math.min(1, crossMag / denom); // [0, 1]
                const pan = (pl - pr) / total; // [-1, +1]; positive = left dominant
                // Y conveys directional content. We treat a partition as
                // "directional" if either the inter-channel coherence is high
                // (correlated panned material) or |pan| is high (one channel
                // dominates outright, e.g. hard-panned source — ICC is degenerate
                // when the quieter channel approaches zero, but pan stays valid).
                // Diffuse content has both ICC and |pan| near zero and so falls
                // out of Y entirely, leaving only W.
                const directionCertainty = Math.max(icc, Math.abs(pan));
                const ySign = pan >= 0 ? 1 : -1;
                this.yGainSigned[p] = ySign * directionCertainty * this.partitionEmphasis[p];
                // W passes the omnidirectional sum unchanged. We do not drop W when
                // ICC is high; the directional information is conveyed by Y, not by
                // attenuating the sum.
                this.wGain[p] = 1.0;
            }
            // Pass 3: write frequency-domain output bins. Z and X are zero.
            for (let bin = 0; bin < numBins; bin++) {
                const partition = binToPartition[bin];
                const lr = leftRe[bin];
                const li = leftIm[bin];
                const rr = rightRe[bin];
                const ri = rightIm[bin];
                const mRe = (lr + rr) * SQRT1_2;
                const mIm = (li + ri) * SQRT1_2;
                const sRe = (lr - rr) * SQRT1_2;
                const sIm = (li - ri) * SQRT1_2;
                const wG = this.wGain[partition];
                const yG = this.yGainSigned[partition];
                wRe[bin] = wG * mRe;
                wIm[bin] = wG * mIm;
                yRe[bin] = yG * sRe;
                yIm[bin] = yG * sIm;
                zRe[bin] = 0;
                zIm[bin] = 0;
                xRe[bin] = 0;
                xIm[bin] = 0;
            }
        }
        /**
         * Diagnostic accessor: smoothed inter-channel coherence per partition,
         * useful for tests and runtime probes.
         */
        iccPerPartition(out) {
            for (let p = 0; p < this.numPartitions; p++) {
                const pl = this.smoothedPowerL[p];
                const pr = this.smoothedPowerR[p];
                const denom = Math.sqrt(pl * pr) + POWER_EPSILON;
                const crossRe = this.smoothedCrossRe[p];
                const crossIm = this.smoothedCrossIm[p];
                const crossMag = Math.sqrt(crossRe * crossRe + crossIm * crossIm);
                out[p] = Math.min(1, crossMag / denom);
            }
        }
        /**
         * Diagnostic accessor: smoothed pan ratio per partition in [-1, +1].
         */
        panPerPartition(out) {
            for (let p = 0; p < this.numPartitions; p++) {
                const pl = this.smoothedPowerL[p];
                const pr = this.smoothedPowerR[p];
                const total = pl + pr + POWER_EPSILON;
                out[p] = (pl - pr) / total;
            }
        }
    }

    exports.BccEncoderState = BccEncoderState;
    exports.DEFAULT_BCC_CONFIG = DEFAULT_BCC_CONFIG;
    exports.buildErbPartitionTable = buildErbPartitionTable;
    exports.partitionCount = partitionCount;

    return exports;

})({});
//# sourceMappingURL=bcc-encoder-core-bundle.js.map
