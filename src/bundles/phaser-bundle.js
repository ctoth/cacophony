var phaser = (function (exports) {
    'use strict';

    /*
     * Phaser processor core — context-free DSP math for a classic MXR/Univibe-style
     * phase shifter: a cascade of N identical first-order allpass sections at a
     * common LFO-swept break frequency, summed additively with the dry signal.
     *
     * Implements the allpass-phaser design from:
     *   J. O. Smith III, "An Allpass Approach to Digital Phasing and Flanging",
     *   CCRMA Report STAN-M-21 (1982), presented at ICMC-84;
     *   and the first-order virtual-analog recipe in J. O. Smith, "Physical Audio
     *   Signal Processing", §8.9 "Classic Virtual Analog Phase Shifters".
     *
     * Topology (Smith STAN-M-21 VG6/VG17; PASP §8.9, Fig. 8.23):
     *   y[n] = x[n] + mix * cascade(x[n])
     * The cascade is N first-order allpass sections in series. A first-order allpass
     * is FLAT-magnitude (|H| = 1 at all frequencies), so the EFFECT comes entirely
     * from SUMMING the phase-shifted cascade output with the dry signal: at every
     * frequency where the cascade's accumulated phase reaches an odd multiple of
     * 180 deg the sum cancels, producing a notch. Two first-order sections create
     * one notch (PASP §8.9: "for each notch ... add two new first-order allpass
     * sections"), so `stages` sections give stages/2 notches. This is an ADDITIVE
     * sum, NOT a wet/dry crossfade — a crossfade of a flat-magnitude allpass would
     * leave the spectrum unchanged.
     *
     * First-order allpass section (PASP §8.9), per-section state z1:
     *   H(z) = (a + z^-1) / (1 + a*z^-1)
     *   v  = a*s + z1 ;  z1 = s - a*v        (one-multiply direct form)
     *
     * Break-frequency -> coefficient (exact bilinear/tan map, PASP Eq. 8.20):
     *   p_d = (1 - tan(pi*fb/fs)) / (1 + tan(pi*fb/fs))    (fb = break freq, Hz)
     * PASP writes its allpass as (p_d - z^-1)/(1 - p_d*z^-1); for THIS template
     * (a + z^-1)/(1 + a*z^-1) the matching coefficient is a = -p_d (PASP §8.9, the
     * sign-convention note), so the cascade's notches land AT the break frequency
     * rather than at its Nyquist complement. For fb in (0, fs/2) this gives |a| < 1
     * (a stable allpass pole), and Smith's structure-gain bound keeps the summed
     * output strictly in [0, 2] for any notch setting given stable sections
     * (STAN-M-21 page-03).
     *
     * Per sample:
     *   fb   = frequency * 2^(depth * lfo)       // multiplicative/log sweep (lfo in [-1,1])
     *   p    = bilinear(fb)                        //   preserves notch frequency RATIOS
     *   s    = x + feedback * lastCascadeOut       // regeneration/resonance (feedback=0 => s=x)
     *   v    = cascade of `stages` allpass sections applied to s
     *   y    = x + mix * v                         // ADDITIVE (Smith y = x + g*allpass)
     *   lastCascadeOut = v
     * LFO: sinusoidal, bipolar [-1, 1]; phase advances at `rate` Hz. Stereo uses a
     * quadrature LFO (90 deg per channel, Dattorro 1997 p.776), realized by seeding
     * each channel's core with lfoPhase0 = ch * pi/2 at construction (see phaser.ts).
     *
     * This file holds ONLY pure numeric math (plain numbers + Float32Array). It has
     * no AudioWorklet / global dependencies, so it is unit-testable directly; the
     * worklet shell in phaser.ts delegates to it.
     */
    /**
     * Default AudioParam values for the phaser worklet, in the worklet's own units.
     * SINGLE SOURCE OF TRUTH — the worklet's `parameterDescriptors` (phaser.ts)
     * builds its descriptors from this table, and tests that need the shipped
     * defaults import it here rather than re-typing literals.
     *
     * Defaults: a classic 4-section (2-notch) MXR-style phaser, mid-spectrum center,
     * slow sweep — the createPhaser factory (cacophony.ts) spreads option overrides
     * over these.
     */
    const PHASER_DEFAULTS = {
        frequency: 500,
        rate: 0.5,
        depth: 1.5,
        stages: 4,
        feedback: 0,
        mix: 0.5,
    };
    /** Maximum number of allpass sections the section-state array is sized for. */
    const MAX_STAGES = 12;
    /** Stability/safety bound on |feedback| for the regeneration loop. */
    const MAX_PHASER_FEEDBACK = 0.95;
    /**
     * Break-frequency -> first-order-allpass coefficient via the exact bilinear/tan
     * map (PASP Eq. 8.20):
     *   p = (1 - tan(pi*fb/fs)) / (1 + tan(pi*fb/fs))
     * For fb in (0, fs/2) the result lies in (-1, 1) (a stable allpass pole); as
     * fb -> 0, p -> 1, and as fb -> fs/2, p -> -1. Exposed pure for isolated testing.
     */
    function breakFreqToAllpassCoeff(breakFreqHz, sampleRate) {
        const t = Math.tan((Math.PI * breakFreqHz) / sampleRate);
        return (1 - t) / (1 + t);
    }
    /**
     * Stateful phaser processor for ONE channel. Owns the per-section allpass states
     * (z1 for each of up to MAX_STAGES sections), the feedback memory and the LFO
     * phase, and is reused block-to-block so the allpass histories, regeneration and
     * LFO continuity all survive across process() calls — constructing a fresh
     * instance per block would clear the section states and reset the LFO, producing
     * audible clicks (same hazard documented for the modulated-delay core).
     */
    class PhaserProcessor {
        sampleRate;
        /** Per-section allpass delay-element states z1 (one slot per section). */
        z1;
        /** Last cascade output, fed back into the input (regeneration). */
        lastCascadeOut = 0;
        /** Current LFO phase (radians). */
        lfoPhase;
        constructor(sampleRate, lfoPhase0 = 0) {
            this.sampleRate = sampleRate;
            this.z1 = new Float32Array(MAX_STAGES);
            this.lfoPhase = lfoPhase0;
        }
        /** Clear all allpass section states, the feedback memory and the LFO phase. */
        reset() {
            this.z1.fill(0);
            this.lastCascadeOut = 0;
            this.lfoPhase = 0;
        }
        /**
         * Process a block. `input` and `output` may alias (in-place is fine).
         *
         * Per sample (Smith STAN-M-21 / PASP §8.9):
         *   1. lfo  = sin(lfoPhase)                              (bipolar [-1, 1])
         *   2. fb   = frequency * 2^(depth * lfo)                (multiplicative sweep)
         *   3. a    = -bilinear(fb)                              (Eq. 8.20, a = -p_d)
         *   4. s    = x + feedback * lastCascadeOut              (regeneration)
         *   5. v    = cascade of `stages` allpass sections on s  (one z1 each)
         *   6. y    = x + mix * v                                (ADDITIVE sum)
         *   7. lastCascadeOut = v
         * The LFO phase advances by 2*pi*rate/sampleRate each sample.
         */
        process(input, output, params) {
            // k-rate-style coefficients computed once per block.
            const frequency = params.frequency;
            const depth = params.depth;
            const feedback = Math.max(-MAX_PHASER_FEEDBACK, Math.min(MAX_PHASER_FEEDBACK, params.feedback));
            const mix = params.mix;
            const stages = Math.max(0, Math.min(MAX_STAGES, Math.round(params.stages)));
            const phaseInc = (2 * Math.PI * params.rate) / this.sampleRate;
            const nyquist = this.sampleRate / 2;
            const n = Math.min(input.length, output.length);
            for (let i = 0; i < n; i++) {
                const x = input[i];
                // Sinusoidal bipolar LFO -> multiplicative break-frequency sweep. Clamp the
                // swept frequency to (0, Nyquist) so the bilinear map stays well-defined.
                const lfo = Math.sin(this.lfoPhase);
                let fb = frequency * 2 ** (depth * lfo);
                if (fb < 1)
                    fb = 1;
                if (fb > nyquist - 1)
                    fb = nyquist - 1;
                // Bilinear pole p_d (PASP Eq. 8.20). The section template here is
                // (a + z^-1)/(1 + a*z^-1), so a = -p_d makes the cascade notch AT fb
                // (not at its Nyquist complement). See allpassStep's sign note.
                const a = -breakFreqToAllpassCoeff(fb, this.sampleRate);
                // Regeneration: feed the previous cascade output back into the input.
                let v = x + feedback * this.lastCascadeOut;
                // Cascade of `stages` identical first-order allpass sections.
                for (let k = 0; k < stages; k++) {
                    const prev = this.z1[k];
                    const out = a * v + prev;
                    this.z1[k] = v - a * out;
                    v = out;
                }
                this.lastCascadeOut = v;
                // Additive output (Smith y = x + g*allpass): the notches come from the sum.
                output[i] = x + mix * v;
                // Advance the LFO phase.
                this.lfoPhase += phaseInc;
                if (this.lfoPhase >= 2 * Math.PI)
                    this.lfoPhase -= 2 * Math.PI;
            }
        }
    }

    /*
     * Phaser AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL DSP
     * math to the context-free PhaserProcessor in phaser-core.ts. Mirrors the
     * modulated-delay.ts / dynamics.ts core/shell split: this file owns only the
     * worklet plumbing (parameterDescriptors, process(), the registerProcessor
     * call); the algorithm lives in the unit-tested core.
     *
     * Algorithm: classic MXR/Univibe-style cascade of first-order allpass sections
     * at a common LFO-swept break frequency, summed additively with the dry signal
     * (Smith STAN-M-21; PASP §8.9). See phaser-core.ts header for the section
     * transfer function, the bilinear break-frequency map, the additive-notch
     * rationale and the multiplicative LFO sweep.
     */
    const WORKLET_LOG_PREFIX = "[cacophony/worklet:phaser]";
    class PhaserWorkletProcessor extends AudioWorkletProcessor {
        // One stateful core per channel so each channel keeps its own allpass section
        // states, feedback memory and LFO phase across process() blocks. Each
        // channel's LFO is seeded in quadrature (ch * pi/2) so a stereo pair gets the
        // dynamic stereo field Dattorro describes (p.776).
        cores = [];
        static get parameterDescriptors() {
            // Default VALUES come from PHASER_DEFAULTS (phaser-core.ts) — the single
            // source of truth shared with the core tests. Ranges live here. `stages` is
            // a count (rounded to an int in the core); |feedback| <= 0.95 keeps the
            // regeneration loop bounded.
            return [
                ["frequency", PHASER_DEFAULTS.frequency, 20, 10000, "k-rate"],
                ["rate", PHASER_DEFAULTS.rate, 0, 20, "k-rate"],
                ["depth", PHASER_DEFAULTS.depth, 0, 4, "k-rate"],
                ["stages", PHASER_DEFAULTS.stages, 2, 12, "k-rate"],
                ["feedback", PHASER_DEFAULTS.feedback, -0.95, 0.95, "k-rate"],
                ["mix", PHASER_DEFAULTS.mix, 0, 1, "k-rate"],
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
                frequency: parameters.frequency[0],
                rate: parameters.rate[0],
                depth: parameters.depth[0],
                stages: parameters.stages[0],
                feedback: parameters.feedback[0],
                mix: parameters.mix[0],
            };
            const channelCount = Math.min(input.length, output.length);
            for (let ch = 0; ch < channelCount; ch++) {
                if (!this.cores[ch]) {
                    // Seed the LFO 90 deg apart per channel for the quadrature stereo field
                    // (Dattorro p.776).
                    this.cores[ch] = new PhaserProcessor(sampleRate, (ch * Math.PI) / 2);
                }
                this.cores[ch].process(input[ch], output[ch], params);
            }
            return true;
        }
    }
    console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
    try {
        registerProcessor("phaser", PhaserWorkletProcessor);
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
    }
    catch (error) {
        console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
        throw error;
    }

    exports.PhaserWorkletProcessor = PhaserWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=phaser-bundle.js.map
