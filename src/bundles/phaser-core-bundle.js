var phaserCore = (function (exports) {
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
     * One first-order allpass section step (PASP §8.9 one-multiply direct form) for
     * the transfer function H(z) = (a + z^-1)/(1 + a*z^-1) with coefficient `a`:
     *   v  = a*s + z1
     *   z1 = s - a*v
     * (Derivation: with z1[n] = s[n-1] - a*v[n-1], V/S = (a + z^-1)/(1 + a*z^-1).)
     *
     * `state.z1` is the single per-section delay-element value, mutated in place so
     * the section's history survives across samples. Exposed pure for testing a
     * single section's flat-magnitude (|H| = 1) property in isolation.
     *
     * NOTE on the coefficient sign (PASP §8.9): the bilinear map
     * breakFreqToAllpassCoeff returns PASP's pole p_d for the form
     * (p_d - z^-1)/(1 - p_d*z^-1). For THIS template (a + z^-1)/(1 + a*z^-1) the
     * matching coefficient is a = -p_d, so that a cascade of sections notches AT the
     * break frequency (rather than at its Nyquist complement). The processor passes
     * a = -breakFreqToAllpassCoeff(fb) accordingly.
     */
    function allpassStep(s, a, state) {
        const v = a * s + state.z1;
        state.z1 = s - a * v;
        return v;
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

    exports.MAX_PHASER_FEEDBACK = MAX_PHASER_FEEDBACK;
    exports.MAX_STAGES = MAX_STAGES;
    exports.PHASER_DEFAULTS = PHASER_DEFAULTS;
    exports.PhaserProcessor = PhaserProcessor;
    exports.allpassStep = allpassStep;
    exports.breakFreqToAllpassCoeff = breakFreqToAllpassCoeff;

    return exports;

})({});
//# sourceMappingURL=phaser-core-bundle.js.map
