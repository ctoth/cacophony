var stereoToBformat = (function (exports) {
    'use strict';

    const BUTTERWORTH_Q = Math.SQRT1_2;
    const LOW_CUTOFF_HZ = 250;
    const HIGH_CUTOFF_HZ = 2000;
    // Tier 1 perceptual tuning:
    // - Keep low-band energy mostly omnidirectional.
    // - Reduce W relative to the original sqrt(1/2) mapping.
    // - Let upper bands carry more of the horizontal cue.
    const W_GAIN_LOW = 0.5;
    const W_GAIN_MID = 0.45;
    const W_GAIN_HIGH = 0.35;
    const X_GAIN_LOW = 0;
    const X_GAIN_MID = 0.35;
    const X_GAIN_HIGH = 0.55;
    const Y_GAIN_LOW = 0;
    const Y_GAIN_MID = 0.5;
    const Y_GAIN_HIGH = 0.85;
    const SIDE_DOMINANCE_EPSILON = 1e-9;
    // Coherence smoothing. Exponential first-order low-pass on per-band power
    // and cross-power. Alpha closer to 1 means slower tracking; this value gives
    // a time constant of about 20 ms at 48 kHz, which lines up with BCC-paper
    // recommendations for perceptual-cue smoothing.
    const COHERENCE_SMOOTHING_ALPHA = 0.999;
    // Numerical floor on per-band power so the ICC denominator never blows up
    // during silence.
    const COHERENCE_POWER_EPSILON = 1e-12;
    class BiquadFilter {
        b0 = 0;
        b1 = 0;
        b2 = 0;
        a1 = 0;
        a2 = 0;
        x1 = 0;
        x2 = 0;
        y1 = 0;
        y2 = 0;
        constructor(type, sampleRate, cutoffHz, q = BUTTERWORTH_Q) {
            this.configure(type, sampleRate, cutoffHz, q);
        }
        configure(type, sampleRate, cutoffHz, q) {
            const clampedCutoff = Math.max(1, Math.min(cutoffHz, sampleRate * 0.45));
            const omega = (2 * Math.PI * clampedCutoff) / sampleRate;
            const sin = Math.sin(omega);
            const cos = Math.cos(omega);
            const alpha = sin / (2 * q);
            let b0;
            let b1;
            let b2;
            if (type === "lowpass") {
                b0 = (1 - cos) / 2;
                b1 = 1 - cos;
                b2 = (1 - cos) / 2;
            }
            else {
                b0 = (1 + cos) / 2;
                b1 = -(1 + cos);
                b2 = (1 + cos) / 2;
            }
            const a0 = 1 + alpha;
            const a1 = -2 * cos;
            const a2 = 1 - alpha;
            this.b0 = b0 / a0;
            this.b1 = b1 / a0;
            this.b2 = b2 / a0;
            this.a1 = a1 / a0;
            this.a2 = a2 / a0;
        }
        process(input) {
            const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
            this.x2 = this.x1;
            this.x1 = input;
            this.y2 = this.y1;
            this.y1 = output;
            return output;
        }
    }
    /**
     * Running per-band inter-channel coherence estimator.
     *
     * Maintains exponentially smoothed estimates of L*L, R*R, and L*R, then
     * derives a normalized coherence value `|<LR>| / sqrt(<L²> * <R²>)` in
     * the range [0, 1]. High coherence indicates a stable in-phase / panned
     * source; low coherence indicates decorrelated diffuse content like room
     * reverb.
     *
     * The sign of <LR> is preserved internally so callers can differentiate
     * positive (in-phase / center) from negative (anti-phase) correlation,
     * but the public `coherence()` helper returns magnitude only.
     */
    class CrossCorrelator {
        smoothedLL = 0;
        smoothedRR = 0;
        smoothedLR = 0;
        alpha;
        oneMinusAlpha;
        constructor(alpha = COHERENCE_SMOOTHING_ALPHA) {
            this.alpha = alpha;
            this.oneMinusAlpha = 1 - alpha;
        }
        update(left, right) {
            this.smoothedLL = this.alpha * this.smoothedLL + this.oneMinusAlpha * left * left;
            this.smoothedRR = this.alpha * this.smoothedRR + this.oneMinusAlpha * right * right;
            this.smoothedLR = this.alpha * this.smoothedLR + this.oneMinusAlpha * left * right;
        }
        /** Magnitude of normalized cross-correlation in [0, 1]. */
        coherence() {
            const denom = Math.sqrt(this.smoothedLL * this.smoothedRR) + COHERENCE_POWER_EPSILON;
            const c = Math.abs(this.smoothedLR) / denom;
            return c > 1 ? 1 : c;
        }
        /**
         * Signed normalized cross-correlation in [-1, +1].
         *
         * - +1: perfectly in-phase (L and R move together, mono / center pan)
         * - 0: uncorrelated (diffuse ambient, hard-panned single source)
         * - -1: perfectly anti-phase (L and R move oppositely, stereo width
         *   tricks or out-of-phase content)
         *
         * Front/back routing wants positive correlation (real center material).
         * Left/right routing wants whatever isn't in-phase (anything that has
         * a stable difference between channels, including hard pans).
         */
        signedCoherence() {
            const denom = Math.sqrt(this.smoothedLL * this.smoothedRR) + COHERENCE_POWER_EPSILON;
            const c = this.smoothedLR / denom;
            if (c > 1)
                return 1;
            if (c < -1)
                return -1;
            return c;
        }
    }
    class StereoToFoaUpmixer {
        lowLeft;
        lowRight;
        highLeft;
        highRight;
        lowCoherence;
        midCoherence;
        highCoherence;
        constructor(sampleRate) {
            this.lowLeft = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
            this.lowRight = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
            this.highLeft = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
            this.highRight = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
            this.lowCoherence = new CrossCorrelator();
            this.midCoherence = new CrossCorrelator();
            this.highCoherence = new CrossCorrelator();
        }
        process(left, right, w, y, z, x) {
            const frameCount = Math.min(left.length, right.length, w.length, x.length, y.length, z.length);
            for (let frame = 0; frame < frameCount; frame++) {
                const leftSample = left[frame];
                const rightSample = right[frame];
                const lowLeft = this.lowLeft.process(leftSample);
                const lowRight = this.lowRight.process(rightSample);
                const highLeft = this.highLeft.process(leftSample);
                const highRight = this.highRight.process(rightSample);
                const midLeft = leftSample - lowLeft - highLeft;
                const midRight = rightSample - lowRight - highRight;
                this.lowCoherence.update(lowLeft, lowRight);
                this.midCoherence.update(midLeft, midRight);
                this.highCoherence.update(highLeft, highRight);
                const lowMid = (lowLeft + lowRight) * 0.5;
                const lowSide = (lowLeft - lowRight) * 0.5;
                const midMid = (midLeft + midRight) * 0.5;
                const midSide = (midLeft - midRight) * 0.5;
                const highMid = (highLeft + highRight) * 0.5;
                const highSide = (highLeft - highRight) * 0.5;
                // Coherence gating uses signed cross-correlation per band:
                //   ρ ≈ +1: in-phase / center material → frontal X cue, no Y
                //   ρ ≈  0: hard-panned single source or diffuse ambient → Y open, X suppressed
                //   ρ ≈ -1: anti-phase / inverted-pair stereo trickery → Y open, X suppressed
                //
                // X gain factor = max(0, ρ). Only positive in-phase content steers
                // forward; decorrelated and anti-phase content stays out of X.
                //
                // Y gain factor = 1 - max(0, ρ). Center material (high +ρ)
                // suppresses Y; everything else (hard pans, anti-phase, ambient)
                // keeps the side cue.
                //
                // High-frequency vocals were still peeling sideways because "not
                // perfectly centered" was enough to keep a lot of treble in Y.
                // Make the high band more selective: only steer hard sideways when
                // the band is both non-centered and actually side-dominant.
                const lowRho = Math.max(0, this.lowCoherence.signedCoherence());
                const midRho = Math.max(0, this.midCoherence.signedCoherence());
                const highRho = Math.max(0, this.highCoherence.signedCoherence());
                const highSideDominance = Math.abs(highSide) / (Math.abs(highMid) + Math.abs(highSide) + SIDE_DOMINANCE_EPSILON);
                const highYWeight = (1 - highRho) * highSideDominance * highSideDominance;
                w[frame] = lowMid * W_GAIN_LOW + midMid * W_GAIN_MID + highMid * W_GAIN_HIGH;
                y[frame] =
                    lowSide * Y_GAIN_LOW * (1 - lowRho) +
                        midSide * Y_GAIN_MID * (1 - midRho) +
                        highSide * Y_GAIN_HIGH * highYWeight;
                z[frame] = 0;
                x[frame] = lowMid * X_GAIN_LOW * lowRho + midMid * X_GAIN_MID * midRho + highMid * X_GAIN_HIGH * highRho;
            }
        }
    }

    const WORKLET_LOG_PREFIX = "[cacophony/worklet:stereo-to-bformat]";
    class StereoToBFormatProcessor extends AudioWorkletProcessor {
        framesProcessed = 0;
        framesShortInput = 0;
        lastReportFrame = 0;
        upmixer = new StereoToFoaUpmixer(sampleRate);
        process(inputs, outputs) {
            const input = inputs[0];
            const output = outputs[0];
            if (!input || input.length < 2 || !output || output.length < 4) {
                this.framesShortInput++;
                this.framesProcessed++;
                this.maybeReport(input?.length ?? 0, "short-input", input, output);
                return true;
            }
            this.upmixer.process(input[0], input[1], output[0], output[1], output[2], output[3]);
            this.framesProcessed++;
            this.maybeReport(input.length, "ok", input, output);
            return true;
        }
        maybeReport(channels, kind, input, output) {
            if (this.framesProcessed - this.lastReportFrame < 750)
                return;
            this.lastReportFrame = this.framesProcessed;
            let stats = "";
            if (input && input.length >= 2 && output && output.length >= 4) {
                const peak = (a) => {
                    let m = 0;
                    for (let i = 0; i < a.length; i++) {
                        const v = Math.abs(a[i]);
                        if (v > m)
                            m = v;
                    }
                    return m;
                };
                stats =
                    ` peakL=${peak(input[0]).toFixed(4)}` +
                        ` peakR=${peak(input[1]).toFixed(4)}` +
                        ` peakW=${peak(output[0]).toFixed(4)}` +
                        ` peakY=${peak(output[1]).toFixed(4)}` +
                        ` peakZ=${peak(output[2]).toFixed(4)}` +
                        ` peakX=${peak(output[3]).toFixed(4)}`;
            }
            console.info(`${WORKLET_LOG_PREFIX} process tick framesTotal=${this.framesProcessed} shortInput=${this.framesShortInput} channelsThisTick=${channels} kind=${kind}${stats}`);
        }
    }
    console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
    try {
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor start`);
        registerProcessor("stereo-to-bformat", StereoToBFormatProcessor);
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
    }
    catch (error) {
        console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
        throw error;
    }

    exports.StereoToBFormatProcessor = StereoToBFormatProcessor;

    return exports;

})({});
//# sourceMappingURL=stereo-to-bformat-bundle.js.map
