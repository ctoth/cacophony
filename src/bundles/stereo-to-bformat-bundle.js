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
    const Y_GAIN_LOW = 0;
    const Y_GAIN_MID = 0.5;
    const Y_GAIN_HIGH = 0.85;
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
    class StereoToFoaUpmixer {
        lowLeft;
        lowRight;
        highLeft;
        highRight;
        constructor(sampleRate) {
            this.lowLeft = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
            this.lowRight = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
            this.highLeft = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
            this.highRight = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
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
                const lowMid = (lowLeft + lowRight) * 0.5;
                const lowSide = (lowLeft - lowRight) * 0.5;
                const midMid = (midLeft + midRight) * 0.5;
                const midSide = (midLeft - midRight) * 0.5;
                const highMid = (highLeft + highRight) * 0.5;
                const highSide = (highLeft - highRight) * 0.5;
                w[frame] = lowMid * W_GAIN_LOW + midMid * W_GAIN_MID + highMid * W_GAIN_HIGH;
                y[frame] = lowSide * Y_GAIN_LOW + midSide * Y_GAIN_MID + highSide * Y_GAIN_HIGH;
                z[frame] = 0;
                x[frame] = 0;
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
