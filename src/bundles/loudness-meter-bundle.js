(function () {
    'use strict';

    /**
     * ITU-R BS.1770-5 loudness metering — context-free DSP core.
     *
     * Implements the loudness measurement pipeline of Recommendation
     * ITU-R BS.1770-5 (11/2023), "Algorithms to measure audio programme loudness
     * and true-peak audio level", Annex 1:
     *
     *   1. "K" frequency weighting — a two-stage pre-filter per channel
     *      (Annex 1, §2 / Figs 2-4; coefficients Tables 1 & 2, p.4-5).
     *   2. Mean-square per channel z_i (Annex 1, eq.1, p.5).
     *   3. Channel-weighted summation with weights G_i (Annex 1, Table 3, p.7;
     *      L/R/C = 1.0, Ls/Rs = 1.41, LFE excluded).
     *   4. Loudness  L_K = -0.691 + 10·log10(Σ G_i·z_i)  (Annex 1, eq.2, p.6),
     *      and gated integrated loudness via the two-stage gate
     *      (Γ_a = -70 LKFS absolute, Γ_r = -10 LU relative; Annex 1, eq.3-7, p.6-7).
     *
     * Momentary (400 ms) and short-term (3 s) windows are the EBU R128 / Tech 3341
     * ungated derivatives built directly on the same K-weighted mean-square; LRA
     * (loudness range) follows EBU Tech 3342 (95th − 10th percentile of short-term
     * loudness above a relative gate).
     *
     * This module is PURE: it operates on `Float32Array` channel data and has no
     * Web Audio / worklet / global dependencies, so the metering MATH can be unit
     * tested directly (the standardized-audio-context mock carries no signal — its
     * AnalyserNode is an empty stub). Mirrors the context-free-core test pattern of
     * `src/processors/stereo-to-bformat-core.ts`.
     *
     * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
     */
    /**
     * Per-channel weighting G_i — ITU-R BS.1770-5 Annex 1, Table 3 (p.7).
     * Front/centre channels are unity; the two surround channels are boosted by
     * +1.5 dB (G = 1.41); the LFE channel is not measured (weight 0 / excluded).
     */
    const CHANNEL_WEIGHTS = {
        L: 1.0,
        R: 1.0,
        C: 1.0,
        Ls: 1.41,
        Rs: 1.41,
        LFE: 0, // excluded — see Table 3, p.7
    };
    /**
     * The K-weighting calibration constant of ITU-R BS.1770-5 Annex 1, eq.2 (p.6).
     * Chosen so the K-weighting filter's gain at the 997 Hz reference frequency is
     * cancelled, making a 0 dBFS 997 Hz sine on L/C/R read exactly -3.01 LKFS (p.7).
     */
    const LOUDNESS_OFFSET = -0.691;
    /** Absolute gating threshold Γ_a, ITU-R BS.1770-5 Annex 1, eq.6 (p.6). */
    const ABSOLUTE_GATE_LKFS = -70;
    /** Relative gate offset (LU below the absolute-gated mean), Annex 1 eq.6 (p.6). */
    const RELATIVE_GATE_OFFSET_LU = -10;
    /** Gating block length T_g, ITU-R BS.1770-5 Annex 1 (p.6): 400 ms. */
    const GATING_BLOCK_SECONDS = 0.4;
    /** Gating block overlap, Annex 1 (p.6): 75% → step = 0.25 → 100 ms hop. */
    const GATING_OVERLAP = 0.75;
    /** Momentary window (EBU Tech 3341): 400 ms, ungated. */
    const MOMENTARY_SECONDS = 0.4;
    /** Short-term window (EBU Tech 3341): 3 s, ungated. */
    const SHORT_TERM_SECONDS = 3.0;
    /**
     * Stage 1 of the K-weighting filter — second-order high-shelf modelling the
     * acoustic effect of the head as a rigid sphere. ITU-R BS.1770-5 Annex 1,
     * Table 1 (p.4). VERBATIM coefficients, specified at a 48 kHz sample rate.
     */
    const K_WEIGHTING_STAGE1_48K = {
        b0: 1.53512485958697,
        b1: -2.69169618940638,
        b2: 1.19839281085285,
        a1: -1.69065929318241,
        a2: 0.73248077421585,
    };
    /**
     * Stage 2 of the K-weighting filter — second-order RLB high-pass. ITU-R
     * BS.1770-5 Annex 1, Table 2 (p.5). VERBATIM coefficients, at 48 kHz.
     */
    const K_WEIGHTING_STAGE2_48K = {
        b0: 1.0,
        b1: -2,
        b2: 1.0,
        a1: -1.99004745483398,
        a2: 0.99007225036621,
    };
    /** Sample rate the verbatim Table 1/2 coefficients are specified at (p.5). */
    const REFERENCE_SAMPLE_RATE = 48_000;
    /**
     * Direct-Form-II transposed biquad. The K-weighting stages are applied as a
     * cascade of two of these (Annex 1, Figs 3-4). Stateful across `process` calls
     * so a streaming caller can feed successive blocks without resetting IIR memory.
     */
    class Biquad {
        b0;
        b1;
        b2;
        a1;
        a2;
        // Transposed Direct Form II state.
        z1 = 0;
        z2 = 0;
        constructor(coeffs) {
            this.b0 = coeffs.b0;
            this.b1 = coeffs.b1;
            this.b2 = coeffs.b2;
            this.a1 = coeffs.a1;
            this.a2 = coeffs.a2;
        }
        process(input) {
            const output = this.b0 * input + this.z1;
            this.z1 = this.b1 * input - this.a1 * output + this.z2;
            this.z2 = this.b2 * input - this.a2 * output;
            return output;
        }
        reset() {
            this.z1 = 0;
            this.z2 = 0;
        }
    }
    /**
     * Re-derives the K-weighting coefficients for a sample rate other than the
     * 48 kHz the Table 1/2 values are quoted at, so the digital filter keeps the
     * SAME frequency response (ITU-R BS.1770-5 Annex 1, p.5: "Other sample rates
     * require recomputed coefficients giving the same frequency response").
     *
     * Method: read the analog prototype poles/zeros back out of the 48 kHz digital
     * coefficients with the INVERSE bilinear transform (matched at the reference
     * rate), then re-apply the bilinear transform at the target rate. At 48 kHz
     * this is the identity and returns the verbatim coefficients unchanged.
     */
    function kWeightingCoefficients(sampleRate, reference) {
        if (sampleRate === REFERENCE_SAMPLE_RATE) {
            return { ...reference };
        }
        // Bilinear transform: s = K·(1 - z^-1)/(1 + z^-1), with K = 2·fs (the factor
        // is absorbed by the analog coefficients, so any consistent K works as long
        // as the same K is used for the inverse and forward transform). Recover the
        // continuous-time biquad (analog b/a in powers of s) from the reference
        // digital coefficients at fs_ref, then re-discretise at the target fs.
        const fsRef = REFERENCE_SAMPLE_RATE;
        const kRef = 2 * fsRef;
        // Digital → analog (inverse bilinear). For
        //   H(z) = (b0 + b1 z^-1 + b2 z^-2)/(1 + a1 z^-1 + a2 z^-2)
        // substitute z^-1 = (p - s)/(p + s) (p = kRef = 2·fs_ref) and multiply
        // numerator and denominator by (p + s)^2, collecting powers of s. The
        // resulting analog num/denom coefficients (B2 s^2 + B1 s + B0) /
        // (A2 s^2 + A1 s + A0) keep CONSISTENT relative scaling between num & denom,
        // which the forward transform below then re-discretises at the target rate.
        const p = kRef;
        const { b0, b1, b2, a1, a2 } = reference;
        // Numerator analog coeffs (B2 s^2 + B1 s + B0):
        const B2 = b0 - b1 + b2;
        const B1 = 2 * (b0 - b2) * p;
        const B0 = (b0 + b1 + b2) * p * p;
        // Denominator analog coeffs (A2 s^2 + A1 s + A0):
        const A2 = 1 - a1 + a2;
        const A1 = 2 * (1 - a2) * p;
        const A0 = (1 + a1 + a2) * p * p;
        // Analog → digital (forward bilinear) at the target rate. s = kT·(1-z^-1)/(1+z^-1).
        const kT = 2 * sampleRate;
        const kT2 = kT * kT;
        // Evaluate numerator/denominator polynomials at s = kT·(1-z^-1)/(1+z^-1) and
        // multiply through by (1+z^-1)^2; collect digital coefficients.
        const nd0 = B2 * kT2 + B1 * kT + B0;
        const nd1 = 2 * (B0 - B2 * kT2);
        const nd2 = B2 * kT2 - B1 * kT + B0;
        const dd0 = A2 * kT2 + A1 * kT + A0;
        const dd1 = 2 * (A0 - A2 * kT2);
        const dd2 = A2 * kT2 - A1 * kT + A0;
        return {
            b0: nd0 / dd0,
            b1: nd1 / dd0,
            b2: nd2 / dd0,
            a1: dd1 / dd0,
            a2: dd2 / dd0,
        };
    }
    /**
     * The two-stage K-weighting pre-filter for ONE channel (Annex 1, §2). Holds the
     * cascade of the Table 1 high-shelf followed by the Table 2 RLB high-pass and
     * preserves IIR state across blocks.
     */
    class KWeightingFilter {
        stage1;
        stage2;
        constructor(sampleRate = REFERENCE_SAMPLE_RATE) {
            this.stage1 = new Biquad(kWeightingCoefficients(sampleRate, K_WEIGHTING_STAGE1_48K));
            this.stage2 = new Biquad(kWeightingCoefficients(sampleRate, K_WEIGHTING_STAGE2_48K));
        }
        /** Apply both K-weighting stages to one sample (Annex 1, Figs 3-4). */
        process(input) {
            return this.stage2.process(this.stage1.process(input));
        }
        reset() {
            this.stage1.reset();
            this.stage2.reset();
        }
    }
    /**
     * Converts a channel-weighted mean-square power sum Σ G_i·z_i to loudness in
     * LKFS via ITU-R BS.1770-5 Annex 1, eq.2 (p.6): L_K = -0.691 + 10·log10(Σ).
     * Returns -Infinity for a non-positive sum (digital silence).
     */
    function powerSumToLoudness(weightedPowerSum) {
        if (weightedPowerSum <= 0) {
            return -Infinity;
        }
        return LOUDNESS_OFFSET + 10 * Math.log10(weightedPowerSum);
    }

    /**
     * ITU-R BS.1770-5 true-peak metering — context-free DSP core.
     *
     * Implements the inter-sample (true-peak) level estimator of Recommendation
     * ITU-R BS.1770-5 (11/2023), Annex 2 (p.18-19). The true peak of a signal is
     * the maximum absolute value of the reconstructed CONTINUOUS-time waveform,
     * which can exceed the largest discrete sample — a peak-sample meter misses it.
     *
     * Per-channel processing stages (Annex 2, Fig. p.18):
     *   1. Attenuate by 12.04 dB (a 2-bit right shift; integer headroom). SKIPPED
     *      here — this is a floating-point implementation, and the recommendation
     *      states the attenuate/restore pair is for integer arithmetic only (p.18).
     *   2. ≥4× over-sample (48 kHz → 192 kHz). A compliant meter must oversample to
     *      at least 192 kHz (p.18-19). This core does 4× via the polyphase FIR.
     *   3. Low-pass interpolation filter — the 48-tap, 4-phase polyphase FIR whose
     *      coefficients are given verbatim below (Annex 2, p.18-19).
     *   4. Take the absolute value (rectify).
     *   5. Convert to dB TP: 20·log10(value) [then +12.04 dB to undo stage 1, which
     *      is a no-op here since stage 1 is skipped].
     *
     * Pure: operates on `Float32Array` and has no Web Audio / worklet dependencies.
     *
     * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
     */
    /**
     * The 4× oversampling interpolation FIR of ITU-R BS.1770-5 Annex 2 (p.18-19):
     * order-48, given as a 4-phase polyphase filter (each phase a 12-tap subfilter,
     * 4 × 12 = 48 taps). VERBATIM coefficients. The phases are mirror-symmetric
     * (phase 3 = phase 0 reversed, phase 2 = phase 1 reversed) — the standard
     * linear-phase polyphase structure.
     *
     * Phase k produces the oversampled output sample at fractional position k/4
     * between input samples (phase 0 ≈ the input sample itself).
     */
    const TRUE_PEAK_POLYPHASE_FIR_48K = [
        // Phase 0 (tap0..tap11)
        [
            0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875,
            -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
        ],
        // Phase 1 (tap0..tap11)
        [
            -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625,
            -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
        ],
        // Phase 2 (tap0..tap11)
        [
            -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625,
            -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
        ],
        // Phase 3 (tap0..tap11)
        [
            -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625,
            -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
        ],
    ];
    /** Oversampling ratio of the verbatim Annex 2 FIR (4×). */
    const TRUE_PEAK_OVERSAMPLE = TRUE_PEAK_POLYPHASE_FIR_48K.length;
    const FIR_TAPS = TRUE_PEAK_POLYPHASE_FIR_48K[0].length;
    /**
     * BS.1770-5 Annex 2 requires the oversampled rate to be **at least 192 kHz**
     * (p.18: "The 4× over-sampling filter increases the sampling rate of the signal
     * from 48 kHz to 192 kHz"). The verbatim FIR's 4× only reaches that at ≥48 kHz;
     * at 44.1 kHz, 4× = 176.4 kHz, BELOW the requirement.
     */
    const TRUE_PEAK_MIN_OVERSAMPLED_RATE = 192_000;
    /**
     * Chooses the integer oversampling factor for a given input sample rate so the
     * oversampled rate reaches BS.1770-5's ≥192 kHz requirement (Annex 2, p.18). The
     * factor is never below 4 (the verbatim FIR's design ratio), and at sample rates
     * the verbatim 4× already covers (≥48 kHz) it stays 4. Examples: 48 kHz → 4×
     * (192 kHz); 44.1 kHz → 5× (220.5 kHz); 96 kHz → 4× (the spec notes 2× would
     * suffice, but the verbatim FIR floor of 4× is kept as the conservative default).
     */
    function truePeakOversampleFactor(sampleRate) {
        if (!(sampleRate > 0)) {
            return TRUE_PEAK_OVERSAMPLE;
        }
        return Math.max(TRUE_PEAK_OVERSAMPLE, Math.ceil(TRUE_PEAK_MIN_OVERSAMPLED_RATE / sampleRate));
    }
    /**
     * Builds an N-phase polyphase interpolating FIR (each phase a 12-tap subfilter,
     * matching the verbatim filter's order) from a Hann-windowed-sinc prototype. The
     * BS.1770-5 verbatim coefficients are "one set ... that would satisfy the
     * requirements" (Annex 2, p.18) for the 4× case; for sample rates that need a
     * higher factor to clear 192 kHz, an equivalent windowed-sinc low-pass
     * interpolator of the same order is generated here. Phase k samples the
     * continuous-time reconstruction at fractional offset k/N between input samples.
     */
    function buildPolyphaseFir(oversample) {
        if (oversample === TRUE_PEAK_OVERSAMPLE) {
            return TRUE_PEAK_POLYPHASE_FIR_48K;
        }
        const taps = FIR_TAPS;
        const center = (taps - 1) / 2; // symmetric about the middle tap
        const phases = [];
        for (let phase = 0; phase < oversample; phase++) {
            const frac = phase / oversample; // fractional sample position 0 ≤ frac < 1
            const coeffs = new Array(taps);
            for (let k = 0; k < taps; k++) {
                // Ideal interpolation kernel sampled at distance (k - center - frac):
                const t = k - center - frac;
                const sincArg = Math.PI * t;
                const sinc = t === 0 ? 1 : Math.sin(sincArg) / sincArg;
                // Hann window across the tap span keeps the FIR finite & low-ripple.
                const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1));
                coeffs[k] = sinc * w;
            }
            // Normalize each phase to unity DC gain so a constant reconstructs exactly.
            let sum = 0;
            for (const c of coeffs) {
                sum += c;
            }
            if (sum !== 0) {
                for (let k = 0; k < taps; k++) {
                    coeffs[k] /= sum;
                }
            }
            phases.push(coeffs);
        }
        return phases;
    }
    /**
     * Streaming 4× polyphase true-peak detector for ONE channel (ITU-R BS.1770-5
     * Annex 2). Maintains a 12-sample input history so successive blocks join
     * seamlessly, runs every phase of the polyphase FIR per input sample (giving
     * the 4× oversampled stream), rectifies, and tracks the running max.
     *
     * The verbatim coefficients are quoted at 48 kHz. At higher input rates fewer
     * oversampling phases are needed for the same accuracy (Annex 2: 96 kHz → 2×
     * suffices); this 4× design is the conservative default at any rate.
     */
    class TruePeakDetector {
        history;
        writeIndex = 0;
        peak = 0;
        /** The polyphase FIR actually used (verbatim at 4×, generated for >4×). */
        fir;
        /** Oversampling factor chosen for the input sample rate (≥4; ≥192 kHz). */
        oversample;
        /**
         * @param sampleRate Input sample rate in Hz. Selects the oversampling factor
         *   so the oversampled rate reaches BS.1770-5's ≥192 kHz requirement (Annex 2,
         *   p.18). Defaults to 48 kHz (the rate the verbatim FIR is quoted at → 4×).
         */
        constructor(sampleRate = 48_000) {
            this.oversample = truePeakOversampleFactor(sampleRate);
            this.fir = buildPolyphaseFir(this.oversample);
            this.history = new Float32Array(FIR_TAPS);
        }
        /**
         * Pushes a block of input samples through the polyphase interpolator and
         * updates the running true peak (max absolute oversampled value).
         */
        process(samples) {
            for (let n = 0; n < samples.length; n++) {
                // Shift the newest sample into the circular history.
                this.history[this.writeIndex] = samples[n];
                this.writeIndex = (this.writeIndex + 1) % FIR_TAPS;
                // For each polyphase branch, convolve the 12-tap history. tap 0 is the
                // oldest sample; the newest sample is at (writeIndex - 1).
                for (let phase = 0; phase < this.fir.length; phase++) {
                    const coeffs = this.fir[phase];
                    let acc = 0;
                    for (let k = 0; k < FIR_TAPS; k++) {
                        const idx = (this.writeIndex + k) % FIR_TAPS;
                        acc += coeffs[k] * this.history[idx];
                    }
                    const mag = Math.abs(acc);
                    if (mag > this.peak) {
                        this.peak = mag;
                    }
                }
            }
        }
        /** Linear (not dB) true-peak magnitude observed so far. */
        truePeak() {
            return this.peak;
        }
        /**
         * True-peak level in dBTP (ITU-R BS.1770-5 Annex 2 stage 5: 20·log10 of the
         * rectified oversampled peak, relative to 100% full scale). Returns -Infinity
         * for pure silence.
         */
        truePeakDb() {
            return this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
        }
        reset() {
            this.history.fill(0);
            this.writeIndex = 0;
            this.peak = 0;
        }
    }

    /**
     * Loudness metering AudioWorkletProcessor — ITU-R BS.1770-5.
     *
     * A PASS-THROUGH metering tap: it copies its input straight to its output
     * (so inserting it never alters the audible signal) while measuring loudness
     * in real time and posting the latest readings back to the main thread via the
     * MessagePort.
     *
     * The metering MATH lives entirely in the context-free cores
     * `../meters/loudness-core` and `../meters/truepeak-core` (verbatim ITU-R
     * BS.1770-5 coefficients and formulae), which are unit-tested directly on
     * `Float32Array`s — the standardized-audio-context mock cannot carry signal, so
     * the worklet shell here is intentionally thin. Rollup inlines the imported
     * cores into the IIFE worklet bundle.
     *
     * Reported values:
     *   - momentary  (M): K-weighted loudness over the last 400 ms (EBU Tech 3341).
     *   - shortTerm  (S): K-weighted loudness over the last 3 s (EBU Tech 3341).
     *   - integrated (I): gated integrated loudness since the last reset
     *     (ITU-R BS.1770-5 Annex 1 two-stage gate, -70 abs / -10 rel).
     *   - truePeak  (TP): running max true-peak in dBTP (ITU-R BS.1770-5 Annex 2,
     *     4× polyphase oversampling).
     *
     * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
     */
    /** Default channel label assignment by channel index for ≤5-channel input. */
    const DEFAULT_CHANNEL_ORDER = ["L", "R", "C", "Ls", "Rs"];
    /**
     * Channel label layout by channel COUNT. Two distinct authorities apply:
     *  - The channel INDEX order for each count is the W3C Web Audio API 1.0
     *    "speakers" layout: 6-channel 5.1 is [FL, FR, FC, LFE, SL, SR] = index 3 is
     *    the LFE (https://www.w3.org/TR/webaudio/#ChannelOrdering).
     *  - The loudness TREATMENT of those channels is ITU-R BS.1770-5 Annex 1
     *    (Table 3 / Fig.1, p.3,7): the LFE is EXCLUDED from the loudness sum
     *    (CHANNEL_WEIGHTS.LFE = 0) and only L/R/C/Ls/Rs are measured (Ls/Rs at 1.41).
     * The flat DEFAULT_CHANNEL_ORDER above cannot express the LFE slot — it would
     * mislabel a 5.1 stream's index-3 LFE as `Ls` and count it as programme
     * loudness — so a layout is chosen by channel count here. Counts not listed fall
     * back to DEFAULT_CHANNEL_ORDER.
     */
    const CHANNEL_LAYOUTS = {
        1: ["C"], // mono: one measured channel, weight 1.0
        2: ["L", "R"], // stereo
        3: ["L", "R", "C"],
        5: ["L", "R", "C", "Ls", "Rs"], // 5.0
        6: ["L", "R", "C", "LFE", "Ls", "Rs"], // 5.1 — LFE (index 3) excluded
    };
    /**
     * Maintains the K-weighted mean-square of one channel over a sliding window,
     * plus a 100 ms-hop block accumulator for integrated gating. Pure number
     * crunching; one instance per input channel.
     */
    class ChannelMeter {
        kFilter;
        truePeak;
        constructor(sampleRate) {
            this.kFilter = new KWeightingFilter(sampleRate);
            // Sample-rate-aware: the detector picks an oversampling factor reaching
            // BS.1770-5's ≥192 kHz requirement (4× at 48 kHz, ≥5× at 44.1 kHz).
            this.truePeak = new TruePeakDetector(sampleRate);
        }
    }
    /**
     * Ring of recent K-weighted squared samples for one channel, supporting a
     * sliding-window mean-square over the most recent `capacity` samples.
     */
    class SlidingPower {
        ring;
        head = 0;
        filled = 0;
        sum = 0;
        constructor(capacity) {
            this.ring = new Float32Array(Math.max(1, capacity));
        }
        push(squared) {
            if (this.filled === this.ring.length) {
                this.sum -= this.ring[this.head];
            }
            else {
                this.filled++;
            }
            this.ring[this.head] = squared;
            this.sum += squared;
            this.head = (this.head + 1) % this.ring.length;
        }
        meanSquare() {
            return this.filled > 0 ? this.sum / this.filled : 0;
        }
    }
    class LoudnessMeterProcessor extends AudioWorkletProcessor {
        channelMeters = [];
        momentaryWindows = [];
        shortTermWindows = [];
        // Integrated gating state: per-channel mean-square accumulated per 100 ms
        // block (ITU-R BS.1770-5 Annex 1; 400 ms blocks at 75% overlap == sum of the
        // most recent four 100 ms sub-blocks). We accumulate 100 ms sub-block power
        // and form 400 ms gating blocks from a sliding sum of four sub-blocks.
        subBlockSamples = 0;
        samplesIntoSubBlock = 0;
        subBlockSumPerChannel = [];
        recentSubBlocks = []; // up to 4 sub-blocks of per-channel sums
        gatedBlocksPerChannel = []; // surviving-absolute-gate block per-channel mean-squares
        gatedBlockLoudness = [];
        channelCount = 0;
        postCounter = 0;
        postEverySamples = 0;
        samplesSincePost = 0;
        constructor(options) {
            super(options);
            // Post readings ~10× per second.
            this.postEverySamples = Math.round(sampleRate / 10);
            this.subBlockSamples = Math.round(GATING_BLOCK_SECONDS * (1 - GATING_OVERLAP) * sampleRate); // 100 ms
            this.port.onmessage = (event) => {
                if (event.data && event.data.command === "reset") {
                    this.reset();
                }
            };
        }
        ensureChannels(count) {
            if (count === this.channelCount) {
                return;
            }
            this.channelCount = count;
            this.channelMeters = [];
            this.momentaryWindows = [];
            this.shortTermWindows = [];
            const momentaryCapacity = Math.round(MOMENTARY_SECONDS * sampleRate);
            const shortTermCapacity = Math.round(SHORT_TERM_SECONDS * sampleRate);
            for (let c = 0; c < count; c++) {
                this.channelMeters.push(new ChannelMeter(sampleRate));
                this.momentaryWindows.push(new SlidingPower(momentaryCapacity));
                this.shortTermWindows.push(new SlidingPower(shortTermCapacity));
            }
            this.subBlockSumPerChannel = new Array(count).fill(0);
            this.recentSubBlocks = [];
            this.gatedBlocksPerChannel = [];
            this.gatedBlockLoudness = [];
            this.samplesIntoSubBlock = 0;
        }
        reset() {
            const count = this.channelCount;
            this.channelCount = 0;
            this.ensureChannels(count);
            for (const meter of this.channelMeters) {
                meter.kFilter.reset();
                meter.truePeak.reset();
            }
        }
        channelLabel(index) {
            // Pick the layout for the live channel count so a 5.1 stream's index-3 LFE
            // is labelled LFE (weight 0, excluded) rather than mislabelled Ls. Counts
            // without a defined layout fall back to the flat default order.
            const layout = CHANNEL_LAYOUTS[this.channelCount] ?? DEFAULT_CHANNEL_ORDER;
            return layout[index] ?? "C";
        }
        /** Loudness of a per-channel mean-square vector (Annex 1, eqs.1-2). */
        loudnessOf(meanSquaresPerChannel) {
            let weightedSum = 0;
            for (let c = 0; c < meanSquaresPerChannel.length; c++) {
                weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * meanSquaresPerChannel[c];
            }
            return powerSumToLoudness(weightedSum);
        }
        windowLoudness(windows) {
            let weightedSum = 0;
            for (let c = 0; c < windows.length; c++) {
                weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * windows[c].meanSquare();
            }
            return powerSumToLoudness(weightedSum);
        }
        /**
         * Closes the current 100 ms sub-block exactly at its boundary: converts the
         * accumulated per-channel power sum to a mean, pushes it onto the ring of the
         * four most-recent sub-blocks, forms a 400 ms gating block (eq.3) when four
         * sub-blocks are available, applies the absolute gate (eq.6), then resets the
         * sub-block accumulator. Called the instant `samplesIntoSubBlock` reaches the
         * boundary so no sample lands in the wrong sub-block.
         */
        closeSubBlock() {
            const subMean = this.subBlockSumPerChannel.map((s) => s / this.subBlockSamples);
            this.recentSubBlocks.push(subMean);
            if (this.recentSubBlocks.length > 4) {
                this.recentSubBlocks.shift();
            }
            // A complete 400 ms gating block exists once four sub-blocks accumulate.
            if (this.recentSubBlocks.length === 4) {
                const blockMean = new Array(this.channelCount).fill(0);
                for (let c = 0; c < this.channelCount; c++) {
                    let s = 0;
                    for (const sub of this.recentSubBlocks) {
                        s += sub[c];
                    }
                    blockMean[c] = s / 4;
                }
                const l = this.loudnessOf(blockMean);
                // Absolute gate Γ_a (-70 LKFS): only store passing blocks (Annex 1 eq.6).
                if (l > ABSOLUTE_GATE_LKFS) {
                    this.gatedBlocksPerChannel.push(blockMean);
                    this.gatedBlockLoudness.push(l);
                }
            }
            this.subBlockSumPerChannel = new Array(this.channelCount).fill(0);
            this.samplesIntoSubBlock -= this.subBlockSamples;
        }
        /** Gated integrated loudness over surviving blocks (Annex 1, eqs.5-7). */
        computeIntegrated() {
            if (this.gatedBlocksPerChannel.length === 0) {
                return -Infinity;
            }
            // Mean of absolute-gated set already filtered on the absolute gate when the
            // block was stored. Compute relative threshold then re-filter.
            const relativeThreshold = this.gatedLoudnessOfSet(this.gatedBlocksPerChannel) + RELATIVE_GATE_OFFSET_LU;
            const finalSet = [];
            for (let i = 0; i < this.gatedBlocksPerChannel.length; i++) {
                if (this.gatedBlockLoudness[i] > relativeThreshold) {
                    finalSet.push(this.gatedBlocksPerChannel[i]);
                }
            }
            if (finalSet.length === 0) {
                return -Infinity;
            }
            return this.gatedLoudnessOfSet(finalSet);
        }
        gatedLoudnessOfSet(set) {
            let weightedSum = 0;
            for (let c = 0; c < this.channelCount; c++) {
                let mean = 0;
                for (const block of set) {
                    mean += block[c];
                }
                mean /= set.length;
                weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * mean;
            }
            return powerSumToLoudness(weightedSum);
        }
        process(inputs, outputs) {
            const input = inputs[0];
            const output = outputs[0];
            // No input connected this quantum — keep the processor alive.
            if (!input || input.length === 0) {
                return true;
            }
            this.ensureChannels(input.length);
            const frameCount = input[0]?.length ?? 0;
            // True-peak runs on the RAW (un-weighted) channel signal (Annex 2); it has
            // no sub-block boundary dependency, so process whole quanta per channel.
            for (let c = 0; c < input.length; c++) {
                this.channelMeters[c].truePeak.process(input[c]);
            }
            // Pass-through copy: metering must not alter the audible path. Done in one
            // pass so the boundary-split loudness loop below need not also copy.
            if (output) {
                for (let c = 0; c < input.length; c++) {
                    const inCh = input[c];
                    const outCh = output[c];
                    if (outCh) {
                        outCh.set(inCh);
                    }
                }
            }
            // K-weight, square, and accumulate the sliding windows + 100 ms sub-block.
            // CRITICAL (ITU-R BS.1770-5 Annex 1, eq.3 / p.6 — a gating block is a set of
            // CONTIGUOUS samples of exactly the block duration): a 128-sample render
            // quantum can STRADDLE a sub-block boundary (4800 samples at 48 kHz). We must
            // close the sub-block exactly AT the boundary so no sample lands in the wrong
            // 100 ms sub-block. Walk the quantum in segments bounded by the next sub-block
            // edge; close (and form gating blocks from) the sub-block when it fills.
            let offset = 0;
            while (offset < frameCount) {
                const remainingInSubBlock = this.subBlockSamples > 0 ? this.subBlockSamples - this.samplesIntoSubBlock : frameCount - offset;
                const segment = Math.min(remainingInSubBlock, frameCount - offset);
                for (let c = 0; c < input.length; c++) {
                    const inCh = input[c];
                    const meter = this.channelMeters[c];
                    const momentary = this.momentaryWindows[c];
                    const shortTerm = this.shortTermWindows[c];
                    let subSum = this.subBlockSumPerChannel[c];
                    for (let i = offset; i < offset + segment; i++) {
                        // K-weight then square for the loudness windows / blocks.
                        const y = meter.kFilter.process(inCh[i]);
                        const sq = y * y;
                        momentary.push(sq);
                        shortTerm.push(sq);
                        subSum += sq;
                    }
                    this.subBlockSumPerChannel[c] = subSum;
                }
                offset += segment;
                this.samplesIntoSubBlock += segment;
                // Close a 100 ms sub-block exactly at the boundary.
                if (this.subBlockSamples > 0 && this.samplesIntoSubBlock >= this.subBlockSamples) {
                    this.closeSubBlock();
                }
            }
            this.samplesSincePost += frameCount;
            if (this.samplesSincePost >= this.postEverySamples) {
                this.samplesSincePost = 0;
                let maxTruePeak = -Infinity;
                for (const meter of this.channelMeters) {
                    const tp = meter.truePeak.truePeakDb();
                    if (tp > maxTruePeak) {
                        maxTruePeak = tp;
                    }
                }
                const report = {
                    type: "loudness",
                    momentary: this.windowLoudness(this.momentaryWindows),
                    shortTerm: this.windowLoudness(this.shortTermWindows),
                    integrated: this.computeIntegrated(),
                    truePeak: maxTruePeak,
                };
                this.port.postMessage(report);
                this.postCounter++;
            }
            return true;
        }
    }
    registerProcessor("loudness-meter", LoudnessMeterProcessor);

})();
//# sourceMappingURL=loudness-meter-bundle.js.map
