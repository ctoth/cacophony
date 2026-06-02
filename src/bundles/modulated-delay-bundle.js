var modulatedDelay = (function (exports) {
    'use strict';

    /*
     * Modulated-delay processor core — context-free DSP math for the unified
     * delay-line modulation effect behind delay/echo, chorus, flanger, vibrato and
     * doubling.
     *
     * Implements the canonical unified circuit from:
     *   J. Dattorro, "Effect Design, Part 2: Delay-Line Modulation and Chorus",
     *   J. Audio Eng. Soc., Vol. 45, No. 10, pp. 764-788 (1997).
     *
     * Topology (Dattorro 1997, Fig. 36, p.775) — ONE modulated delay line wrapped
     * in dry/wet/feedback paths:
     *
     *     H(z) = (blend + feedforward * z^-i.frac) / (1 + feedback * z^-center)
     *
     *   - blend       — dry path gain on x[n].
     *   - feedforward — gain on the MODULATED wet tap z^-i.frac, where the read
     *     pointer i.frac = NOMINAL_DELAY + CHORUS_WIDTH * y[n] sweeps with the LFO.
     *   - feedback    — gain on a FIXED center tap z^-center. Dattorro p.775: the
     *     feedback is taken from a SEPARATE fixed tap at the nominal center, NEVER
     *     the modulated tap — feeding back a pitch-modulated signal is objectionable.
     *
     * Knob presets (Table 6, p.775) yield each effect from this one circuit:
     *   vibrato  blend=0,      ff=1,      fb=0        (100% wet)
     *   flanger  blend=0.7071, ff=0.7071, fb=-0.7071  (blend=ff for deepest trough)
     *   chorus   blend=0.7071, ff=1,      fb=0.7071   (white-chorus knobs: blend=fb, ff=1)
     *   doubling blend=0.7071, ff=0.7071, fb=0
     *   echo     blend=1,      ff<=1,     fb<1        (modulation off)
     * Stability requires |feedback| <= 0.9999999 (Table 6, p.776).
     *
     * LFO: sinusoidal, bipolar [-1, 1] (Dattorro p.767 — a triangular LFO gives an
     * unnatural piecewise-constant instantaneous pitch). Modulated delay in samples
     * is delayTime + depth*sin(phase); phase advances at `rate` Hz. Stereo uses a
     * quadrature LFO (90 deg per channel, p.776), realized by seeding each channel's
     * core with lfoPhase0 = ch * pi/2 at construction (see modulated-delay.ts).
     *
     * Interpolation: the read pointer lands between samples, so the fractional delay
     * is interpolated with a Lagrange FIR filter (Laakso, Valimaki, Karjalainen &
     * Laine, "Splitting the Unit Delay", IEEE SP Mag 1996, Eq. 42 / N=1,3 table).
     * Lagrange is FIR (stateless coefficients): updating the coefficients every
     * sample under modulation does NOT excite the recursive transient that plagues
     * an allpass fractional-delay filter (Laakso p.52), and its magnitude stays <= 1
     * for feedback-loop safety (Laakso p.42). Two orders are exposed:
     *   - "linear" (N=1, Laakso Eq.43): h0 = 1-d, h1 = d.
     *   - "cubic"  (N=3, Laakso table): the 4-tap maximally-flat interpolator, with
     *     D = 1 + d so the fraction sits between taps 1 and 2 (M_opt centering).
     * Allpass interpolation is deliberately deferred: under modulation it produces
     * transients and is clean only over ~+/-1 semitone (Dattorro p.770-774).
     *
     * NOTE on "white chorus": Dattorro (p.776) defines white chorus as negative
     * feedback AND allpass fractional-delay interpolation. This core uses the
     * white-chorus KNOB settings (the negative-feedback path) but substitutes
     * cubic-Lagrange interpolation (Laakso 1996) for Dattorro's allpass — it is
     * transient-safe under modulation (Laakso p.52) at the cost of some
     * high-frequency trough depth versus a true allpass-interpolated white chorus.
     *
     * This file holds ONLY pure numeric math (plain numbers + Float32Array). It has
     * no AudioWorklet / global dependencies, so it is unit-testable directly; the
     * worklet shell in modulated-delay.ts delegates to it.
     */
    /**
     * The Dattorro Table 6 knob constant 1/sqrt(2), printed VERBATIM as 0.7071 in
     * the paper (p.775 — Dattorro quantized it to 4 decimals for his q23 fixed-point
     * hardware). The factory presets (cacophony.ts) and the white-chorus condition
     * blend = feedback use this exact printed value, NOT the full-precision
     * Math.SQRT1_2, so the shipped knobs match the paper's table digit-for-digit.
     */
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: Dattorro Table 6 prints 0.7071 verbatim; matching the paper digit-for-digit is intentional, not an inexact Math.SQRT1_2.
    const DATTORRO_INV_SQRT2 = 0.7071;
    /**
     * Default AudioParam values for the modulated-delay worklet, in the worklet's
     * own units. SINGLE SOURCE OF TRUTH — the worklet's `parameterDescriptors`
     * (modulated-delay.ts) builds its descriptors from this table, and tests that
     * need the shipped defaults import it here rather than re-typing literals.
     *
     * Defaults: a short, dry, slow setting (a transparent near-bypass) — the
     * createDelay/createChorus/createFlanger/createVibrato/createDoubling factories
     * (cacophony.ts) spread Dattorro Table 6 knob presets over these.
     */
    const MODULATED_DELAY_DEFAULTS = {
        delayTime: 5,
        depth: 0,
        rate: 0.5,
        feedback: 0,
        blend: 1,
        feedforward: DATTORRO_INV_SQRT2};
    /** Maximum nominal delay (ms) the buffer is sized for (delayTime AudioParam max). */
    const MAX_DELAY_MS = 1000;
    /** Maximum LFO excursion (ms) the buffer is sized for (depth AudioParam max). */
    const MAX_DEPTH_MS = 50;
    /** Stability bound on |feedback| (Dattorro Table 6, q23 max, p.776). */
    const MAX_FEEDBACK = 0.9999999;
    /**
     * Lagrange linear (N=1) fractional-delay coefficients (Laakso 1996 Eq.43):
     *   h0 = 1 - d,  h1 = d        for fractional delay d in [0, 1).
     * Two-tap FIR; h0 weights the integer tap, h1 the next sample. h0 + h1 = 1
     * (partition of unity, DC gain 1). Exposed pure for isolated testing.
     */
    function lagrangeLinear(d) {
        return [1 - d, d];
    }
    /**
     * Lagrange cubic (N=3) fractional-delay coefficients (Laakso 1996, N=3 table,
     * p.41). The 4-tap maximally-flat interpolator evaluated at total delay
     * D = 1 + d, so the desired fraction d in [0, 1) sits between taps 1 and 2
     * (Laakso M_opt centering, Eq.21) — the regime where |H| <= 1:
     *
     *   h0 = -(D-1)(D-2)(D-3)/6
     *   h1 =  D(D-2)(D-3)/2
     *   h2 = -D(D-1)(D-3)/2
     *   h3 =  D(D-1)(D-2)/6
     *
     * The returned taps weight delay-line samples at integer offsets {i-1, i, i+1,
     * i+2} relative to the integer part of the read pointer. Sum = 1 (DC gain 1).
     */
    function lagrangeCubic(d) {
        const D = 1 + d;
        return [
            (-(D - 1) * (D - 2) * (D - 3)) / 6,
            (D * (D - 2) * (D - 3)) / 2,
            (-D * (D - 1) * (D - 3)) / 2,
            (D * (D - 1) * (D - 2)) / 6,
        ];
    }
    /** Convert milliseconds to a (fractional) sample count at the given rate. */
    function msToSamples(ms, sampleRate) {
        return (ms / 1000) * sampleRate;
    }
    /**
     * Stateful modulated-delay processor for ONE channel. Owns the circular delay
     * buffer, the write pointer and the LFO phase, and is reused block-to-block so
     * the delay-line contents, feedback recirculation and LFO continuity all survive
     * across process() calls — constructing a fresh instance per block would clear
     * the buffer and reset the LFO, producing audible clicks (same hazard documented
     * for the dynamics ballistics and ADAA history cores).
     *
     * The buffer is sized ONCE in the constructor for MAX_DELAY_MS + MAX_DEPTH_MS
     * plus a margin for the cubic interpolator's 4-tap window, so the read pointer
     * can never run past the allocation regardless of the (clamped) params.
     */
    class ModulatedDelayProcessor {
        sampleRate;
        /** Circular delay line. */
        buffer;
        /** Length of the circular buffer (samples). */
        size;
        /** Write head index into `buffer`. */
        writeIndex = 0;
        /** Current LFO phase (radians). */
        lfoPhase;
        constructor(sampleRate, lfoPhase0 = 0) {
            this.sampleRate = sampleRate;
            // Size for the worst case: max nominal delay + max excursion + cubic margin
            // (the cubic interpolator reads one sample before and two after the integer
            // tap). +4 samples of slack keeps every read index inside the allocation.
            const maxDelaySamples = msToSamples(MAX_DELAY_MS + MAX_DEPTH_MS, sampleRate);
            this.size = Math.ceil(maxDelaySamples) + 4;
            this.buffer = new Float32Array(this.size);
            this.lfoPhase = lfoPhase0;
        }
        /** Clear the delay line, write head and LFO phase. */
        reset() {
            this.buffer.fill(0);
            this.writeIndex = 0;
            this.lfoPhase = 0;
        }
        /** Read the delay line at integer offset `delaySamples` behind the write head. */
        readInteger(delaySamples) {
            let idx = this.writeIndex - delaySamples;
            idx %= this.size;
            if (idx < 0)
                idx += this.size;
            return this.buffer[idx];
        }
        /**
         * Read the delay line at a fractional delay `delaySamples` behind the write
         * head, interpolating with the selected Lagrange FIR (Laakso 1996).
         */
        readFractional(delaySamples, mode) {
            const intDelay = Math.floor(delaySamples);
            const frac = delaySamples - intDelay;
            // Linear (N=1), or cubic degraded to linear near the head: when intDelay < 1
            // the cubic's newest tap (intDelay-1) would be a FUTURE sample, so fall back
            // to the 2-tap linear interpolator. Linear reaches delay 0 exactly (offset 0
            // = the just-written current sample) for true through-zero flange/vibrato.
            if (mode === "linear" || intDelay < 1) {
                const [h0, h1] = lagrangeLinear(frac);
                // The desired delay intDelay+frac sits between offset intDelay (newer) and
                // offset intDelay+1 (older). h0 weights the integer tap, h1 the next-OLDER
                // sample, so a larger frac pulls toward the larger (older) delay.
                return h0 * this.readInteger(intDelay) + h1 * this.readInteger(intDelay + 1);
            }
            // Cubic: D = 1 + frac centers the fraction between taps 1 and 2, so the four
            // taps run newest->oldest at offsets {intDelay-1, intDelay, intDelay+1,
            // intDelay+2}, weighted by h0..h3 from the Laakso N=3 table in that order.
            const [h0, h1, h2, h3] = lagrangeCubic(frac);
            return (h0 * this.readInteger(intDelay - 1) +
                h1 * this.readInteger(intDelay) +
                h2 * this.readInteger(intDelay + 1) +
                h3 * this.readInteger(intDelay + 2));
        }
        /**
         * Process a block. `input` and `output` may alias (in-place is fine).
         *
         * Per sample (Dattorro 1997 Fig. 36):
         *   1. center  = fixed nominal delay tap (samples)                  (feedback tap)
         *   2. fb      = feedback * delayLine[center]                       (fixed tap)
         *   3. w[n]    = x[n] - feedback*delayLine[center] -> written       (recirculation)
         *      The summer SUBTRACTS the feedback (Fig. 36's negative-feedback summer,
         *      p.775), realizing the paper's denominator 1 + feedback*z^-center (p.776).
         *   4. i.frac  = center + depth * sin(lfoPhase)                     (modulated tap)
         *   5. wet     = interpolate delayLine at i.frac                    (Lagrange FIR)
         *   6. y[n]    = blend * w[n] + feedforward * wet                   (dry + wet mix)
         *      The dry (blend) tap reads the recirculation node w[n], NOT the raw input
         *      x[n], so both numerator taps share the feedback denominator and the
         *      transfer function is exactly H(z) = (blend + feedforward*z^-i)/(1 +
         *      feedback*z^-center) (p.776). This is the canonical allpass-comb: with
         *      blend = feedback and feedforward = 1 it collapses to a unity-magnitude
         *      allpass (the white-chorus condition, p.776). When feedback = 0, w[n] =
         *      x[n], so the dry path is the plain input as expected for the no-feedback
         *      presets (vibrato/industry chorus/doubling/echo).
         * The LFO phase advances by 2*pi*rate/sampleRate each sample.
         */
        process(input, output, params) {
            // k-rate-style coefficients computed once per block.
            const centerSamples = msToSamples(params.delayTime, this.sampleRate);
            const depthSamples = msToSamples(params.depth, this.sampleRate);
            const feedback = Math.max(-MAX_FEEDBACK, Math.min(MAX_FEEDBACK, params.feedback));
            const blend = params.blend;
            const feedforward = params.feedforward;
            const mode = params.interpolation;
            const phaseInc = (2 * Math.PI * params.rate) / this.sampleRate;
            // The fixed feedback tap reads the integer center; clamp to a valid offset.
            const centerTap = Math.max(0, Math.min(this.size - 1, Math.round(centerSamples)));
            const n = Math.min(input.length, output.length);
            for (let i = 0; i < n; i++) {
                const x = input[i];
                // Feedback from the FIXED center tap (Dattorro p.775: never the modulated
                // tap). Read BEFORE writing this sample so the loop delay is `center`.
                const fb = feedback * this.readInteger(centerTap);
                // Write the recirculated sample into the delay line at the write head.
                // The feedback is SUBTRACTED (Dattorro Fig. 36's negative-feedback summer,
                // p.775), so the transfer function denominator is 1 + feedback*z^-center.
                const w = x - fb;
                this.buffer[this.writeIndex] = w;
                // Modulated read pointer i.frac = center + depth * LFO (Dattorro eq, p.765).
                let readDelay = centerSamples + depthSamples * Math.sin(this.lfoPhase);
                // Allow the delay down to 0 so flangers/vibrato can sweep through absolute
                // zero (Dattorro p.775; Table 7 vibrato/flange onset 0 ms). Offset 0 is the
                // legitimate just-written current sample (we write before reading the wet
                // tap). readFractional degrades cubic -> linear near the head so no future
                // sample is ever read. The upper clamp keeps the cubic's oldest tap
                // (intDelay+2) inside the allocation.
                if (readDelay < 0)
                    readDelay = 0;
                if (readDelay > this.size - 3)
                    readDelay = this.size - 3;
                const wet = this.readFractional(readDelay, mode);
                // Fig. 36 output: dry (blend, off the recirculation node w[n]) + modulated
                // wet (feedforward). Both taps share the feedback denominator, giving
                // H(z) = (blend + feedforward*z^-i)/(1 + feedback*z^-center) (p.776).
                output[i] = blend * w + feedforward * wet;
                // Advance write head and LFO phase.
                this.writeIndex = (this.writeIndex + 1) % this.size;
                this.lfoPhase += phaseInc;
                if (this.lfoPhase >= 2 * Math.PI)
                    this.lfoPhase -= 2 * Math.PI;
            }
        }
    }

    /*
     * Modulated-delay AudioWorklet shell — thin AudioWorkletProcessor that delegates
     * ALL DSP math to the context-free ModulatedDelayProcessor in
     * modulated-delay-core.ts. Mirrors the dynamics.ts / waveshaper.ts core/shell
     * split: this file owns only the worklet plumbing (parameterDescriptors,
     * process(), the registerProcessor call); the algorithm lives in the unit-tested
     * core.
     *
     * Algorithm: Dattorro's unified modulated-delay circuit (Fig. 36, JAES 1997)
     * driving delay/chorus/flanger/vibrato/doubling from blend/feedforward/feedback
     * knobs, with Lagrange FIR fractional-delay interpolation (Laakso 1996). See
     * modulated-delay-core.ts header for the transfer function, Table 6 presets, the
     * fixed-feedback-tap rationale, the sinusoidal LFO and the interpolation choice.
     */
    const WORKLET_LOG_PREFIX = "[cacophony/worklet:modulated-delay]";
    /**
     * Interpolation selection rides on an AudioParam (which can only carry numbers),
     * so the "interpolation" param is an enum index: 0 = cubic (4-tap Lagrange N=3,
     * the default), 1 = linear (2-tap Lagrange N=1). Both are FIR (Laakso 1996).
     */
    const INTERPOLATION_BY_INDEX = ["cubic", "linear"];
    function interpolationFromIndex(index) {
        const i = Math.round(index);
        return INTERPOLATION_BY_INDEX[i] ?? "cubic";
    }
    class ModulatedDelayWorkletProcessor extends AudioWorkletProcessor {
        // One stateful core per channel so each channel keeps its own delay line,
        // feedback recirculation and LFO phase across process() blocks. Each channel's
        // LFO is seeded in quadrature (ch * pi/2) so a stereo pair gets the dynamic
        // stereo field Dattorro describes (p.776).
        cores = [];
        static get parameterDescriptors() {
            // Default VALUES come from MODULATED_DELAY_DEFAULTS (modulated-delay-core.ts)
            // — the single source of truth shared with the core tests. Ranges live here
            // and bound the buffer sizing (delayTime <= MAX_DELAY_MS, depth <=
            // MAX_DEPTH_MS) and stability (|feedback| <= 0.9999999, Dattorro Table 6).
            return [
                ["delayTime", MODULATED_DELAY_DEFAULTS.delayTime, 0, 1000, "k-rate"],
                ["depth", MODULATED_DELAY_DEFAULTS.depth, 0, 50, "k-rate"],
                ["rate", MODULATED_DELAY_DEFAULTS.rate, 0, 20, "k-rate"],
                ["feedback", MODULATED_DELAY_DEFAULTS.feedback, -0.9999999, 0.9999999, "k-rate"],
                ["blend", MODULATED_DELAY_DEFAULTS.blend, 0, 1, "k-rate"],
                ["feedforward", MODULATED_DELAY_DEFAULTS.feedforward, 0, 1, "k-rate"],
                ["interpolation", 0, 0, 1, "k-rate"],
            ].map(([name, defaultValue, minValue, maxValue, automationRate]) => ({
                name: name,
                defaultValue: defaultValue,
                minValue: minValue,
                maxValue: maxValue,
                automationRate: automationRate,
            }));
        }
        process(inputs, outputs, parameters) {
            const input = inputs[0];
            const output = outputs[0];
            if (!input || input.length === 0 || !output || output.length === 0) {
                return true;
            }
            // k-rate params: take the first (constant-over-block) value.
            const params = {
                delayTime: parameters.delayTime[0],
                depth: parameters.depth[0],
                rate: parameters.rate[0],
                feedback: parameters.feedback[0],
                blend: parameters.blend[0],
                feedforward: parameters.feedforward[0],
                interpolation: interpolationFromIndex(parameters.interpolation[0]),
            };
            const channelCount = Math.min(input.length, output.length);
            for (let ch = 0; ch < channelCount; ch++) {
                if (!this.cores[ch]) {
                    // Seed the LFO 90 deg apart per channel for the quadrature stereo field
                    // (Dattorro p.776).
                    this.cores[ch] = new ModulatedDelayProcessor(sampleRate, (ch * Math.PI) / 2);
                }
                this.cores[ch].process(input[ch], output[ch], params);
            }
            return true;
        }
    }
    console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
    try {
        registerProcessor("modulated-delay", ModulatedDelayWorkletProcessor);
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
    }
    catch (error) {
        console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
        throw error;
    }

    exports.ModulatedDelayWorkletProcessor = ModulatedDelayWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=modulated-delay-bundle.js.map
