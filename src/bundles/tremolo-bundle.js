var tremolo = (function (exports) {
    'use strict';

    /*
     * Tremolo processor core — context-free DSP math for LFO-driven amplitude
     * modulation (a VCA whose gain is swung by a low-frequency oscillator).
     *
     * Tremolo is the most ELEMENTARY modulation effect — per-sample amplitude
     * modulation — and has no dedicated peer-reviewed DSP paper. This implementation
     * is anchored honestly to:
     *   - Standard amplitude-modulation theory for the gain law and its sideband
     *     structure: a carrier at f_c multiplied by (1 + m*cos(2*pi*f_m*t)) gains two
     *     sidebands at f_c +/- f_m of amplitude m/2.
     *   - J. Dattorro, "Effect Design, Part 2" (JAES 1997), p.776, for the quadrature
     *     (90-deg per-channel) stereo LFO used for stereo tremolo / auto-pan.
     *   - C. Mitcheltree, C. J. Steinmetz, M. Comunita, J. D. Reiss, "Modulation
     *     Extraction for LFO-driven Audio Effects" (DAFx23), Sec. 2.1, for the
     *     LFO-driven-effect framing (an LFO driving a VCA gain) and the standard LFO
     *     shapes (sine / triangle / square). The paper's technical core (neural LFO
     *     extraction) is NOT used here; only its framing.
     *
     * AM gain law (g >= 0 always — a true tremolo never inverts the signal phase;
     * allowing g < 0 would be ring modulation / carrier suppression, a different
     * effect):
     *   lfo = shape(phase + channelIndex * stereoPhaseRad)   in [-1, 1]
     *   u   = 0.5 * (1 + lfo)                                 unipolar [0, 1]
     *   g   = (1 - depth) + depth * u                         swings (1-depth) .. 1
     *   y   = x * g
     * The gain is computed PER SAMPLE from a continuously-advanced LFO phase, so
     * there are no block-rate gain steps (no "zipper" clicks).
     *
     * Stereo: each channel's core is constructed with its channelIndex; the LFO
     * offset channelIndex * stereoPhaseRad is applied LIVE each block, so stereoPhase
     * is an adjustable AudioParam (unlike the modulated-delay/phaser fixed ch*pi/2
     * seed). stereoPhase = 0 -> mono tremolo (both channels in phase); 90 ->
     * quadrature; 180 -> hard auto-pan (channels anti-phase).
     *
     * This file holds ONLY pure numeric math (plain numbers + Float32Array). It has
     * no AudioWorklet / global dependencies, so it is unit-testable directly; the
     * worklet shell in tremolo.ts delegates to it.
     */
    /**
     * Default AudioParam values for the tremolo worklet, in the worklet's own units.
     * SINGLE SOURCE OF TRUTH — the worklet's `parameterDescriptors` (tremolo.ts)
     * builds its descriptors from this table, and tests that need the shipped
     * defaults import it here rather than re-typing literals.
     *
     * Defaults: a moderate ~5 Hz, half-depth sine tremolo, mono (stereoPhase 0).
     */
    const TREMOLO_DEFAULTS = {
        rate: 5,
        depth: 0.5,
        stereoPhase: 0,
    };
    /**
     * Evaluate an LFO waveform at `phase` (radians) — bipolar, range [-1, 1],
     * 2*pi periodic. Exposed pure for testing the waveform shapes in isolation.
     *   - sine:     sin(phase).
     *   - triangle: 0 at phase 0/pi, +1 at pi/2, -1 at 3pi/2 (continuous, peaks +/-1).
     *   - square:   +1 on the first half-cycle [0, pi), -1 on the second [pi, 2pi).
     */
    function lfoShape(phase, mode) {
        // Wrap to [0, 2*pi) for the piecewise shapes.
        let p = phase % (2 * Math.PI);
        if (p < 0)
            p += 2 * Math.PI;
        if (mode === "triangle") {
            // Rising 0->+1 over [0, pi/2], +1->-1 over [pi/2, 3pi/2], -1->0 over [3pi/2, 2pi].
            // Equivalent closed form anchored to sin's peaks: a unit triangle in phase.
            const t = p / (2 * Math.PI); // [0, 1)
            // Triangle that is 0 at t=0, +1 at t=0.25, 0 at t=0.5, -1 at t=0.75, 0 at t=1.
            if (t < 0.25)
                return 4 * t;
            if (t < 0.75)
                return 2 - 4 * t;
            return 4 * t - 4;
        }
        if (mode === "square") {
            return p < Math.PI ? 1 : -1;
        }
        // sine
        return Math.sin(p);
    }
    /**
     * Stateful tremolo processor for ONE channel. Owns only the LFO phase, and is
     * reused block-to-block so the LFO advances continuously across process() calls
     * — constructing a fresh instance per block would reset the LFO phase and produce
     * an audible discontinuity (same hazard documented for the modulated-delay and
     * phaser cores).
     *
     * `channelIndex` is fixed at construction and combined with the (live) stereoPhase
     * param to give each channel its phase offset, so a stereo pair can be panned by
     * adjusting stereoPhase without reconstructing the cores.
     */
    class TremoloProcessor {
        sampleRate;
        channelIndex;
        /** Current LFO phase (radians). */
        lfoPhase = 0;
        constructor(sampleRate, channelIndex) {
            this.sampleRate = sampleRate;
            this.channelIndex = channelIndex;
        }
        /** Reset the LFO phase to its construction value (0). */
        reset() {
            this.lfoPhase = 0;
        }
        /**
         * Process a block. `input` and `output` may alias (in-place is fine).
         *
         * Per sample (AM law):
         *   1. lfo = shape(lfoPhase + channelIndex * stereoPhaseRad)   (bipolar [-1, 1])
         *   2. g   = (1 - depth) + depth * 0.5 * (1 + lfo)             (in [1-depth, 1])
         *   3. y   = x * g
         * The LFO phase advances by 2*pi*rate/sampleRate each sample (per-sample gain,
         * so no zipper).
         */
        process(input, output, params) {
            // k-rate-style coefficients computed once per block.
            const depth = params.depth;
            const shape = params.shape;
            const phaseInc = (2 * Math.PI * params.rate) / this.sampleRate;
            const channelOffset = this.channelIndex * ((params.stereoPhase * Math.PI) / 180);
            const n = Math.min(input.length, output.length);
            for (let i = 0; i < n; i++) {
                const lfo = lfoShape(this.lfoPhase + channelOffset, shape);
                // g >= 0 always: u = 0.5*(1+lfo) in [0,1], g = (1-depth) + depth*u.
                const g = 1 - depth + depth * 0.5 * (1 + lfo);
                output[i] = input[i] * g;
                this.lfoPhase += phaseInc;
                if (this.lfoPhase >= 2 * Math.PI)
                    this.lfoPhase -= 2 * Math.PI;
            }
        }
    }

    /*
     * Tremolo AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL DSP
     * math to the context-free TremoloProcessor in tremolo-core.ts. Mirrors the
     * modulated-delay.ts / phaser.ts core/shell split: this file owns only the
     * worklet plumbing (parameterDescriptors, process(), the registerProcessor
     * call); the algorithm lives in the unit-tested core.
     *
     * Algorithm: LFO-driven amplitude modulation (a VCA swung by a low-frequency
     * oscillator). See tremolo-core.ts header for the AM gain law, its sideband
     * structure, the honest paper anchoring (AM theory + Dattorro 1997 p.776
     * quadrature LFO + Mitcheltree et al. DAFx23 LFO framing), and the per-sample
     * (zipper-free) gain.
     */
    const WORKLET_LOG_PREFIX = "[cacophony/worklet:tremolo]";
    /**
     * Shape selection rides on an AudioParam (which can only carry numbers), so the
     * "shape" param is an enum index: 0 = sine, 1 = triangle, 2 = square.
     */
    const SHAPE_BY_INDEX = ["sine", "triangle", "square"];
    function shapeFromIndex(index) {
        const i = Math.round(index);
        return SHAPE_BY_INDEX[i] ?? "sine";
    }
    class TremoloWorkletProcessor extends AudioWorkletProcessor {
        // One stateful core per channel so each channel keeps its own LFO phase across
        // process() blocks. Each core is constructed with its channelIndex so the
        // (live) stereoPhase param can pan the channels apart (Dattorro p.776).
        cores = [];
        static get parameterDescriptors() {
            // Default VALUES come from TREMOLO_DEFAULTS (tremolo-core.ts) — the single
            // source of truth shared with the core tests. Ranges live here. `shape` is an
            // enum index (0=sine, 1=triangle, 2=square); stereoPhase is in degrees.
            return [
                ["rate", TREMOLO_DEFAULTS.rate, 0, 20, "k-rate"],
                ["depth", TREMOLO_DEFAULTS.depth, 0, 1, "k-rate"],
                ["shape", 0, 0, 2, "k-rate"],
                ["stereoPhase", TREMOLO_DEFAULTS.stereoPhase, 0, 180, "k-rate"],
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
                rate: parameters.rate[0],
                depth: parameters.depth[0],
                shape: shapeFromIndex(parameters.shape[0]),
                stereoPhase: parameters.stereoPhase[0],
            };
            const channelCount = Math.min(input.length, output.length);
            for (let ch = 0; ch < channelCount; ch++) {
                if (!this.cores[ch]) {
                    // Pass the channel index so stereoPhase offsets the per-channel LFO
                    // live (quadrature/auto-pan stereo field, Dattorro p.776).
                    this.cores[ch] = new TremoloProcessor(sampleRate, ch);
                }
                this.cores[ch].process(input[ch], output[ch], params);
            }
            return true;
        }
    }
    console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
    try {
        registerProcessor("tremolo", TremoloWorkletProcessor);
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
    }
    catch (error) {
        console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
        throw error;
    }

    exports.TremoloWorkletProcessor = TremoloWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=tremolo-bundle.js.map
