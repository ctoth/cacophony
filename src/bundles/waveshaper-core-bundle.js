var waveshaperCore = (function (exports) {
    'use strict';

    /*
     * Waveshaper processor core — context-free DSP math for an antialiased
     * waveshaper / distortion using first-order Antiderivative Antialiasing (ADAA).
     *
     * Implements the first-order (rectangular-kernel) method from:
     *   J. D. Parker, V. Zavalishin, E. Le Bivic,
     *   "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time
     *    Convolution", Proc. DAFx-16, Brno, Czech Republic, Sept. 2016, pp. 137-144.
     *
     * Core idea (Parker 2016, eq.9): rather than oversample a memoryless
     * nonlinearity y[n] = f(x[n]) (whose harmonics fold back as aliasing),
     * reconstruct the input by linear interpolation, apply f in continuous time,
     * and convolve with a unit-width rectangular lowpass kernel. That analytic
     * convolution collapses to a first-order difference of f's antiderivative F0:
     *
     *     y[n] = (F0(x_n) - F0(x_{n-1})) / (x_n - x_{n-1})              (eq.9)
     *
     * where F0' = f and the integration constant is chosen so F0(0) = 0 (this
     * localizes finite-precision loss to the denominator only; Parker 2016 p.2-3).
     *
     * The eq.9 quotient is 0/0 when x_n ~= x_{n-1} (catastrophic cancellation in
     * the numerator, division by ~0 in the denominator). Parker 2016 eq.10 gives
     * the well-conditioned limit via the mean value theorem:
     *
     *     (F0(x_n) - F0(x_{n-1})) / (x_n - x_{n-1})
     *         -> f((x_n + x_{n-1}) / 2) + O((x_n - x_{n-1})^2)          (eq.10)
     *
     * i.e. when |x_n - x_{n-1}| < eps, fall back to evaluating f at the midpoint
     * of the two consecutive samples. This also makes a constant input produce
     * f(x) exactly.
     *
     * GROUP DELAY: first-order ADAA is equivalent (at low signal levels, f(x)~=x)
     * to y[n] = (x_n + x_{n-1})/2, a 0.5-sample fractional delay (Parker 2016 eq.17,
     * p.3). Callers placing this in a feedback loop must compensate for that
     * inherent half-sample group delay; in a plain forward effects chain it is
     * harmless. The method also imposes a mild HF rolloff (non-brickwall kernel).
     *
     * This file holds ONLY pure numeric math (plain numbers + Float32Array). It has
     * no AudioWorklet / global dependencies, so it is unit-testable directly; the
     * worklet shell in waveshaper.ts delegates to it.
     */
    /**
     * Threshold on |x_n - x_{n-1}| below which eq.9 is ill-conditioned and we use
     * the eq.10 midpoint fallback. Small relative to typical drive levels but large
     * enough to stay clear of catastrophic cancellation in single precision.
     */
    const ADAA_EPS = 1e-5;
    // --- tanh nonlinearity (Parker 2016 Sec 5.1, eqs 19-20) ---------------------
    /** f(x) = tanh(x)  (Parker 2016 eq.19). Bounded, monotone, odd; range (-1, 1). */
    function fTanh(x) {
        return Math.tanh(x);
    }
    /**
     * F0(x) = log(cosh(x))  (Parker 2016 eq.20), the antiderivative of tanh with
     * F0(0) = log(cosh(0)) = log(1) = 0, so the F0(0)=0 constant condition holds.
     *
     * Computed in the overflow-stable form
     *     log(cosh(x)) = |x| + log((1 + e^{-2|x|}) / 2)
     * which avoids cosh(x) overflowing to +Inf for large |x| (a naive
     * Math.log(Math.cosh(x)) returns Inf past |x| ~= 710).
     */
    function f0Tanh(x) {
        const ax = Math.abs(x);
        return ax + Math.log((1 + Math.exp(-2 * ax)) / 2);
    }
    // --- hard clipper nonlinearity (Parker 2016 Sec 5.2, eqs 24-25) -------------
    /**
     * f(x) = x for -1 <= x <= 1, else sgn(x)  (Parker 2016 eq.24). Saturates to
     * +/-1 beyond the unit threshold.
     */
    function fHardClip(x) {
        if (x > 1)
            return 1;
        if (x < -1)
            return -1;
        return x;
    }
    /**
     * F0(x), antiderivative of the hard clipper (Parker 2016 eq.25):
     *     F0(x) = (1/2) x^2                  for -1 <= x <= 1
     *     F0(x) = x*sgn(x) - 1/2  = |x| - 1/2   otherwise
     * The integration constant is chosen so F0(0) = 0 and F0 is continuous at
     * x = +/-1 (both branches give 1/2 there), per Parker 2016 p.4.
     */
    function f0HardClip(x) {
        const ax = Math.abs(x);
        if (ax <= 1)
            return 0.5 * x * x;
        return ax - 0.5;
    }
    /** Resolve a shape name to its matched (f, F0) pair. */
    function nonlinearity(shape) {
        if (shape === "tanh")
            return { f: fTanh, f0: f0Tanh };
        return { f: fHardClip, f0: f0HardClip };
    }
    /**
     * Stateful first-order ADAA waveshaper for ONE channel. Holds the previous
     * input sample x_{n-1} and its antiderivative value F0(x_{n-1}) across
     * process() blocks so the eq.9 difference is continuous over block boundaries.
     */
    class WaveshaperProcessor {
        /** x_{n-1}: previous (driven) input sample. */
        xPrev = 0;
        /** F0(x_{n-1}): previous antiderivative value, cached so only one F0 eval per sample. */
        f0Prev = 0;
        /** Shape whose F0 cache (f0Prev) is currently valid; re-primes f0Prev on change. */
        cachedShape = "hardclip";
        constructor() {
            // f0Prev = F0(0) = 0 for both shapes (F0(0)=0 by construction).
            this.f0Prev = 0;
        }
        /**
         * Apply first-order ADAA waveshaping to `input`, writing to `output`.
         * `input` and `output` may be the same Float32Array (in-place safe — the
         * driven sample is read into a local before output[i] is written).
         */
        process(input, output, params) {
            const { f, f0 } = nonlinearity(params.shape);
            const drive = params.drive;
            const out = params.output;
            const mix = params.mix;
            // If the shape changed since the last block, the cached F0(x_{n-1}) belongs
            // to the old antiderivative — re-evaluate it under the new shape so eq.9 is
            // consistent.
            if (params.shape !== this.cachedShape) {
                this.f0Prev = f0(this.xPrev);
                this.cachedShape = params.shape;
            }
            const n = Math.min(input.length, output.length);
            for (let i = 0; i < n; i++) {
                const dry = input[i];
                const xn = dry * drive; // pre-gain (drive) into the nonlinearity
                const f0n = f0(xn); // single F0 evaluation per sample (Parker 2016 p.2)
                const denom = xn - this.xPrev;
                let shaped;
                if (Math.abs(denom) < ADAA_EPS) {
                    // eq.10 midpoint fallback: eq.9 is 0/0 here; the well-conditioned
                    // limit is f at the midpoint of the two consecutive samples.
                    shaped = f((xn + this.xPrev) / 2);
                }
                else {
                    // eq.9 first-order ADAA: difference of the antiderivative over the
                    // input increment.
                    shaped = (f0n - this.f0Prev) / denom;
                }
                // advance per-channel ADAA state
                this.xPrev = xn;
                this.f0Prev = f0n;
                // wet/dry mix, then output gain
                output[i] = (mix * shaped + (1 - mix) * dry) * out;
            }
        }
        /** Reset per-channel ADAA history (x_{n-1}, F0(x_{n-1})) to the origin. */
        reset() {
            this.xPrev = 0;
            this.f0Prev = 0;
        }
    }
    /**
     * Direct (non-stateful) first-order ADAA evaluation of a single sample pair,
     * exposed for testing the eq.9 / eq.10 branch in isolation. Returns
     * (F0(xn) - F0(xPrev)) / (xn - xPrev), or the eq.10 midpoint fallback when the
     * inputs are within `eps`.
     */
    function adaaSample(xn, xPrev, shape, eps = ADAA_EPS) {
        const { f, f0 } = nonlinearity(shape);
        const denom = xn - xPrev;
        if (Math.abs(denom) < eps) {
            return f((xn + xPrev) / 2); // eq.10
        }
        return (f0(xn) - f0(xPrev)) / denom; // eq.9
    }
    /** Expose the (f, F0) pair for a shape (testing the closed forms directly). */
    function shapeFunctions(shape) {
        return nonlinearity(shape);
    }

    exports.ADAA_EPS = ADAA_EPS;
    exports.WaveshaperProcessor = WaveshaperProcessor;
    exports.adaaSample = adaaSample;
    exports.shapeFunctions = shapeFunctions;

    return exports;

})({});
//# sourceMappingURL=waveshaper-core-bundle.js.map
