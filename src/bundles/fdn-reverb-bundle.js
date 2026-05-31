var fdnReverb = (function (exports) {
    'use strict';

    /*
     * FDN reverb processor core — context-free DSP math for a Feedback Delay
     * Network (FDN) reverberator with velvet-noise diffusion.
     *
     * Implements the canonical FDN recursion and a lossless (paraunitary) feedback
     * matrix from:
     *   S. J. Schlecht, E. A. P. Habets, "Scattering in Feedback Delay Networks",
     *   IEEE/ACM Trans. Audio, Speech, Lang. Process., Vol. 28, 2020 (arXiv
     *   1912.08888). [hereafter "Schlecht 2019"]
     *
     * and the multiplication-free velvet-noise diffusion FIR from:
     *   J. Fagerström, B. Alary, S. J. Schlecht, V. Välimäki,
     *   "Velvet-Noise Feedback Delay Network", Proc. DAFx 2020, pp. 219-226.
     *   [hereafter "Fagerström 2020"]
     *
     * Frequency-dependent decay (T60) is set by per-delay-line absorption filters,
     * NOT by the feedback matrix, following the standard FDN design recipe of:
     *   J.-M. Jot, A. Chaigne, "Digital delay networks for designing artificial
     *   reverberators", AES Convention 90, 1991. [hereafter "Jot 1991"]
     *
     * ── Structure (Schlecht 2019 §II, eqs. as cited; Fagerström 2020 eqs. 1-3) ──
     * An FDN of N delay lines z^{-m_i} mixed through an N×N feedback matrix A, with
     * input gains b, output gains c, and direct (dry) gain d. The transfer is
     *   H(z) = cᵀ (D_m(z)^{-1} − A)^{-1} b + d ,  D_m(z) = diag(z^{-m_1}…z^{-m_N})
     * (Schlecht 2019 eq. for H(z), §II; Fagerström 2020 eq. 3). Per-sample, with
     * q_i(n) the output of delay line i (Fagerström 2020 eq. 1-2):
     *   y(n)            = Σ_i c_i q_i(n) + d·x(n)
     *   s_i(n + m_i)    = Σ_j A_{ij} q_j(n) + b_i·x(n)
     *
     * ── Stability (Schlecht 2019 §III, paraunitarity) ──
     * A is chosen LOSSLESS so the recursive core neither grows nor decays on its
     * own: a paraunitary feedback matrix Ã(z)A(z) = I (Schlecht 2019 §III,
     * para-conjugate Ã(z) = Aᵀ(z^{-1})) places all poles of the lossless core on
     * the unit circle. A scalar orthogonal matrix is the degree-0 special case of
     * a paraunitary matrix (Schlecht 2019 §III: "a scalar orthogonal/unitary
     * matrix is the degree-0 special case"). We use a normalized Hadamard matrix
     * H/√N: orthogonal (HᵀH = N·I ⇒ (H/√N)ᵀ(H/√N) = I), maximally mixing, ±1
     * entries (Schlecht 2019 §III recommends Hadamard as the scalar base U). Being
     * lossless, the feedback matrix contributes NO decay; ALL decay is applied by
     * the per-line absorption filters below. This separation is what makes the
     * decay independently and stably tunable (Schlecht 2019 §II; Jot 1991).
     *
     * ── Decay (Jot 1991, per-line absorption filters) ──
     * Each delay line i carries a per-sample gain g_i = 10^{-3 m_i / (T60·fs)} so
     * that after T60 seconds a signal circulating that line has decayed by 60 dB
     * (Jot 1991: gain per delay = 10^{-3 m_i / (T60 fs)} ⇒ −60 dB over T60).
     * High-frequency damping is a one-pole low-pass per line that shortens the HF
     * T60 relative to the broadband T60 (Jot 1991 frequency-dependent absorption).
     *
     * ── Diffusion (Fagerström 2020, velvet noise) ──
     * A sparse velvet-noise FIR (taps ∈ {+1, 0, −1}) smears each input impulse into
     * many sparse echoes BEFORE injection into the FDN, raising early echo density
     * at near-zero arithmetic cost — the convolution is a sum of signed delayed
     * samples, multiplication-free (Fagerström 2020 §2.3, eq. 8). Grid size
     * T_d = fs/ρ_d (eq. 4), M = L_s/T_d impulses (eq. 5), tap location
     * k(m) = round(m·T_d + r₂(m)(T_d − 1)) (eq. 7), sign s₁(m) = 2·round(r₁) − 1
     * ∈ {+1,−1} (eq. 6). Jittered locations avoid comb coloration (Fagerström
     * 2020 §2.3 design rationale). This stage is parameterized by `diffusion`
     * (0 = bypass) and is add-only.
     *
     * This file holds ONLY pure numeric math (plain numbers and Float32Array). It
     * has NO AudioWorklet / global dependencies so it can be unit-tested directly;
     * the worklet shell in fdn-reverb.ts delegates to it.
     */
    /** Speed of sound is irrelevant here; this is the −60 dB constant 10^(-3). */
    /** Smallest T60 we will honor, to keep the per-line gain finite and < 1. */
    const MIN_DECAY_TIME = 1e-3;
    /**
     * Default delay-line lengths in samples (N = 8), mutually coprime / spread to
     * avoid coincident echoes (Schlecht 2019 §II design lore: "choose N delay
     * lengths coprime/spread"). These primes span ~13–58 ms at 48 kHz, a typical
     * medium-room set. Scaled to the actual sample rate at construction.
     */
    const DEFAULT_DELAYS_AT_48K = [617, 769, 919, 1097, 1259, 1429, 1607, 1789];
    /**
     * Build a normalized Hadamard matrix H/√N for N a power of two via the
     * Sylvester construction. H has ±1 entries and HᵀH = N·I, so H/√N is
     * orthogonal — a paraunitary feedback matrix of degree 0 (Schlecht 2019 §III).
     * Orthogonality ⇒ the FDN feedback core is lossless ⇒ poles on the unit circle
     * ⇒ stable, with decay supplied separately by the absorption filters.
     *
     * @param n Number of delay lines (must be a power of two).
     * @returns Flat row-major N×N matrix, scaled by 1/√N (so it is orthonormal).
     */
    function buildHadamardMatrix(n) {
        if (n < 1 || (n & (n - 1)) !== 0) {
            throw new Error(`Hadamard matrix requires a power-of-two size, got ${n}`);
        }
        // Sylvester: H_1 = [1]; H_{2k} = [[H_k, H_k], [H_k, −H_k]].
        const h = new Float32Array(n * n);
        h[0] = 1;
        for (let size = 1; size < n; size <<= 1) {
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const v = h[r * n + c];
                    h[r * n + (c + size)] = v;
                    h[(r + size) * n + c] = v;
                    h[(r + size) * n + (c + size)] = -v;
                }
            }
        }
        const norm = 1 / Math.sqrt(n);
        for (let i = 0; i < n * n; i++)
            h[i] *= norm;
        return h;
    }
    /**
     * Construct a velvet-noise sequence (Fagerström 2020 §2.3, eqs. 4-7).
     *
     * Grid size T_d = fs/ρ_d (eq. 4); number of impulses M = L_s/T_d (eq. 5); one
     * jittered impulse per grid cell at k(m) = round(m·T_d + r₂(m)(T_d − 1)) (eq.
     * 7) with sign s₁(m) = 2·round(r₁(m)) − 1 ∈ {+1,−1} (eq. 6). The jitter avoids
     * the periodic comb coloration a regular pulse train would cause (Fagerström
     * 2020 §2.3 design rationale). All non-tap positions are implicitly 0, so the
     * sequence has exactly M non-zero ±1 entries — every value is +1, 0, or −1.
     *
     * @param lengthSamples L_s, total length of the sequence in samples.
     * @param density ρ_d, pulse density in impulses/second.
     * @param sampleRate fs in Hz.
     * @param rng A function returning a uniform random number in [0,1). Injected so
     *   tests are deterministic.
     * @returns The sparse tap list (length M), sorted by location.
     */
    function buildVelvetNoise(lengthSamples, density, sampleRate, rng = Math.random) {
        const gridSize = sampleRate / density; // T_d (eq. 4)
        const m = Math.max(0, Math.floor(lengthSamples / gridSize)); // M (eq. 5)
        const taps = [];
        for (let i = 0; i < m; i++) {
            const r1 = rng();
            const r2 = rng();
            // k(m) = round(m·T_d + r₂·(T_d − 1)) (eq. 7).
            const location = Math.round(i * gridSize + r2 * (gridSize - 1));
            if (location >= lengthSamples)
                continue;
            // s₁(m) = 2·round(r₁) − 1 ∈ {+1,−1} (eq. 6).
            const sign = 2 * Math.round(r1) - 1 >= 0 ? 1 : -1;
            taps.push({ location, sign });
        }
        return taps;
    }
    /**
     * A single delay line with an integrated one-pole HF-damping absorption filter
     * (Jot 1991). Reads tail, applies broadband decay gain g and an HF low-pass,
     * then accepts the feedback-mixed input write. Backed by a power-of-two ring
     * buffer for cheap bitmask wrapping (mirrors dattorro-reverb.ts).
     */
    class DampedDelayLine {
        buffer;
        mask;
        writeIndex = 0;
        lpState = 0; // one-pole low-pass memory (Jot HF absorption)
        length;
        constructor(lengthSamples) {
            this.length = Math.max(1, Math.floor(lengthSamples));
            const pow2 = 2 ** Math.ceil(Math.log2(this.length + 1));
            this.buffer = new Float32Array(pow2);
            this.mask = pow2 - 1;
        }
        /** Read the sample delayed by `length` (the tail of the line). */
        read() {
            return this.buffer[(this.writeIndex - this.length) & this.mask];
        }
        /**
         * Apply broadband decay gain `g` and HF damping coefficient `damp` to a
         * tail sample. y[n] = g·((1−damp)·tail + damp·lpState); lpState tracks the
         * smoothed (low-frequency) component, so larger `damp` removes more HF energy
         * each pass ⇒ shorter HF T60 (Jot 1991 frequency-dependent absorption).
         */
        absorb(tail, g, damp) {
            this.lpState = (1 - damp) * tail + damp * this.lpState;
            return g * this.lpState;
        }
        /** Write the feedback-mixed input and advance the write head one sample. */
        write(value) {
            this.buffer[this.writeIndex] = value;
            this.writeIndex = (this.writeIndex + 1) & this.mask;
        }
        reset() {
            this.buffer.fill(0);
            this.writeIndex = 0;
            this.lpState = 0;
        }
    }
    /**
     * Feedback Delay Network reverberator core.
     *
     * N parallel {@link DampedDelayLine}s mixed by a lossless Hadamard feedback
     * matrix (Schlecht 2019 §III, degree-0 paraunitary), with per-line absorption
     * filters setting T60 (Jot 1991) and an optional velvet-noise input diffuser
     * (Fagerström 2020). Pure: operates on numbers / Float32Array, no globals.
     */
    class FdnReverbProcessor {
        sampleRate;
        n;
        lines;
        matrix; // row-major N×N, orthonormal
        feedback; // scratch: matrix·tail
        tail; // scratch: per-line tail reads
        lineGains; // scratch: per-line decay gains
        // Pre-delay ring buffer (Schlecht 2019 §II input path).
        preDelayBuffer;
        preDelayWrite = 0;
        // Velvet-noise diffuser state.
        velvetTaps;
        velvetBuffer;
        velvetWrite = 0;
        velvetMask;
        /**
         * @param sampleRate fs in Hz.
         * @param n Number of delay lines; must be a power of two in [4,8]. Default 8.
         * @param rng Injected RNG for the velvet-noise sequence (deterministic tests).
         * @param delaysOverride Optional explicit delay-line lengths (samples), for
         *   tests; defaults to the coprime 48 kHz set scaled to `sampleRate`.
         */
        constructor(sampleRate, n = 8, rng = Math.random, delaysOverride) {
            if (n !== 4 && n !== 8) {
                throw new Error(`FdnReverbProcessor supports N ∈ {4, 8}, got ${n}`);
            }
            this.sampleRate = sampleRate;
            this.n = n;
            const baseDelays = delaysOverride ?? DEFAULT_DELAYS_AT_48K.slice(0, n);
            const scale = delaysOverride ? 1 : sampleRate / 48000;
            this.lines = baseDelays.slice(0, n).map((d) => new DampedDelayLine(Math.max(1, Math.round(d * scale))));
            this.matrix = buildHadamardMatrix(n); // orthonormal ⇒ lossless (Schlecht 2019 §III)
            this.feedback = new Float32Array(n);
            this.tail = new Float32Array(n);
            this.lineGains = new Float32Array(n);
            // Pre-delay: up to 1 second.
            const preLen = Math.max(1, sampleRate);
            this.preDelayBuffer = new Float32Array(preLen);
            // Velvet-noise diffuser: ~20 ms span at a moderate density (Fagerström
            // 2020 used 10-30 ms VNS). density ρ_d = 1000 pulses/s ⇒ ~20 taps.
            const velvetLen = Math.max(1, Math.round(0.02 * sampleRate));
            this.velvetTaps = buildVelvetNoise(velvetLen, 1000, sampleRate, rng);
            const vpow2 = 2 ** Math.ceil(Math.log2(velvetLen + 1));
            this.velvetBuffer = new Float32Array(vpow2);
            this.velvetMask = vpow2 - 1;
        }
        /** Number of delay lines. */
        get size() {
            return this.n;
        }
        /** The orthonormal feedback matrix (row-major), exposed for verification. */
        get feedbackMatrix() {
            return this.matrix;
        }
        /** The current velvet-noise tap list, exposed for verification. */
        get velvetNoise() {
            return this.velvetTaps;
        }
        /**
         * Per-line broadband decay gain g_i = 10^{-3 m_i/(T60 fs)} (Jot 1991): the
         * gain that yields −60 dB after T60 seconds for a signal circulating line i.
         */
        lineGain(lineLength, decayTime) {
            const t60 = Math.max(MIN_DECAY_TIME, decayTime);
            return 10 ** ((-3 * lineLength) / (t60 * this.sampleRate));
        }
        /**
         * Velvet-noise diffusion of one input sample (Fagerström 2020 eq. 8):
         * y = Σ_m s₁(m)·x(n − k(m)). Multiplication-free — each term is a signed add
         * of a delayed sample. `amount` linearly blends dry↔diffused so diffusion=0
         * is a true bypass.
         */
        diffuse(input, amount) {
            this.velvetBuffer[this.velvetWrite] = input;
            if (amount <= 0 || this.velvetTaps.length === 0) {
                this.velvetWrite = (this.velvetWrite + 1) & this.velvetMask;
                return input;
            }
            let acc = 0;
            for (let i = 0; i < this.velvetTaps.length; i++) {
                const tap = this.velvetTaps[i];
                const idx = (this.velvetWrite - tap.location) & this.velvetMask;
                // s₁(m) ∈ {+1,−1}: signed add, no multiply (eq. 8).
                acc += tap.sign === 1 ? this.velvetBuffer[idx] : -this.velvetBuffer[idx];
            }
            this.velvetWrite = (this.velvetWrite + 1) & this.velvetMask;
            // Normalize by √M so diffuser energy is unit-ish, then blend.
            const diffused = acc / Math.sqrt(this.velvetTaps.length);
            return (1 - amount) * input + amount * diffused;
        }
        /**
         * Process a block of mono samples. `input` and `output` must be the same
         * length; output may alias input. Stateful across calls (ring buffers and
         * absorption memory persist), so streaming callers reuse one instance.
         *
         * Per sample (Fagerström 2020 eqs. 1-2, Schlecht 2019 §II):
         *   1. read pre-delayed, diffused dry sample → s
         *   2. tail_i = absorb(read_i, g_i, damp)            (Jot decay + HF damping)
         *   3. wet    = (1/√N) Σ_i tail_i                     (output gain c)
         *   4. fb     = A · tail                              (lossless mix, Schlecht)
         *   5. write line i ← fb_i + b·s                      (input injection)
         *   6. out    = (1−mix)·dry + mix·wet
         */
        process(input, output, params) {
            const len = Math.min(input.length, output.length);
            const damp = clamp01(params.damping);
            const diffusion = clamp01(params.diffusion);
            const mix = clamp01(params.mix);
            const decayTime = params.decayTime;
            const preDelaySamples = Math.min(this.preDelayBuffer.length - 1, Math.max(0, Math.round(params.preDelay * this.sampleRate)));
            // Precompute per-line decay gains once per block (k-rate decay).
            for (let i = 0; i < this.n; i++) {
                this.lineGains[i] = this.lineGain(this.lines[i].length, decayTime);
            }
            const lineGains = this.lineGains;
            const outGain = 1 / Math.sqrt(this.n); // output gain c (energy-normalized sum)
            const inGain = 1 / Math.sqrt(this.n); // input gain b (spread equally)
            for (let s = 0; s < len; s++) {
                const dry = input[s];
                // Pre-delay (Schlecht 2019 §II input path). Write the current sample,
                // then read `preDelaySamples` back from it; preDelay=0 returns the
                // just-written sample (no spurious one-buffer-length latency).
                const preLen = this.preDelayBuffer.length;
                this.preDelayBuffer[this.preDelayWrite] = dry;
                const readIdx = (this.preDelayWrite - preDelaySamples + preLen) % preLen;
                const preDelayed = this.preDelayBuffer[readIdx];
                this.preDelayWrite = (this.preDelayWrite + 1) % preLen;
                // Velvet-noise input diffusion (Fagerström 2020 eq. 8, add-only).
                const injected = this.diffuse(preDelayed, diffusion) * inGain;
                // Read + absorb each delay-line tail (Jot 1991 decay/damping).
                let wet = 0;
                for (let i = 0; i < this.n; i++) {
                    const t = this.lines[i].absorb(this.lines[i].read(), lineGains[i], damp);
                    this.tail[i] = t;
                    wet += t;
                }
                wet *= outGain;
                // Lossless feedback mix fb = A·tail (Schlecht 2019 §III paraunitary A).
                for (let i = 0; i < this.n; i++) {
                    let acc = 0;
                    const row = i * this.n;
                    for (let j = 0; j < this.n; j++) {
                        acc += this.matrix[row + j] * this.tail[j];
                    }
                    this.feedback[i] = acc;
                }
                // Inject input + feedback into each line.
                for (let i = 0; i < this.n; i++) {
                    this.lines[i].write(this.feedback[i] + injected);
                }
                // Wet/dry mix.
                output[s] = (1 - mix) * dry + mix * wet;
            }
        }
        /** Clear all internal state (delay lines, pre-delay, diffuser, filters). */
        reset() {
            for (const line of this.lines)
                line.reset();
            this.preDelayBuffer.fill(0);
            this.preDelayWrite = 0;
            this.velvetBuffer.fill(0);
            this.velvetWrite = 0;
        }
    }
    /** Clamp x to [0,1]. */
    function clamp01(x) {
        if (x < 0)
            return 0;
        if (x > 1)
            return 1;
        return x;
    }

    /*
     * FDN reverb AudioWorklet shell — a thin AudioWorkletProcessor that delegates
     * ALL DSP math to the context-free FdnReverbProcessor in fdn-reverb-core.ts.
     * Mirrors the dattorro-reverb.ts / dynamics.ts core/shell split: this file owns
     * only the worklet plumbing (parameterDescriptors, process(), the
     * registerProcessor call); the algorithm lives in the unit-tested core.
     *
     * Algorithm: a Feedback Delay Network reverberator with a lossless (degree-0
     * paraunitary Hadamard) feedback matrix (Schlecht & Habets 2019, "Scattering in
     * Feedback Delay Networks"), per-delay-line absorption filters setting T60 (Jot
     * & Chaigne 1991), and multiplication-free velvet-noise input diffusion
     * (Fagerström, Alary, Schlecht & Välimäki 2020, "Velvet-Noise Feedback Delay
     * Network"). See fdn-reverb-core.ts for the full citation and per-equation
     * comments.
     */
    const WORKLET_LOG_PREFIX = "[cacophony/worklet:fdn-reverb]";
    class FdnReverbWorkletProcessor extends AudioWorkletProcessor {
        // One stateful core per channel so each channel keeps its own delay-line and
        // absorption-filter state across process() blocks.
        cores = [];
        static get parameterDescriptors() {
            // Defaults: a moderate, natural room. decayTime in seconds (T60); preDelay
            // in seconds; damping/diffusion/mix normalized to [0,1].
            return [
                ["decayTime", 1.5, 0.001, 20, "k-rate"],
                ["preDelay", 0, 0, 1, "k-rate"],
                ["damping", 0.3, 0, 1, "k-rate"],
                ["diffusion", 0.5, 0, 1, "k-rate"],
                ["mix", 0.3, 0, 1, "k-rate"],
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
                decayTime: parameters.decayTime[0],
                preDelay: parameters.preDelay[0],
                damping: parameters.damping[0],
                diffusion: parameters.diffusion[0],
                mix: parameters.mix[0],
            };
            const channelCount = Math.min(input.length, output.length);
            for (let ch = 0; ch < channelCount; ch++) {
                if (!this.cores[ch]) {
                    this.cores[ch] = new FdnReverbProcessor(sampleRate);
                }
                this.cores[ch].process(input[ch], output[ch], params);
            }
            return true;
        }
    }
    console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
    try {
        registerProcessor("fdn-reverb", FdnReverbWorkletProcessor);
        console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
    }
    catch (error) {
        console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
        throw error;
    }

    exports.FdnReverbWorkletProcessor = FdnReverbWorkletProcessor;

    return exports;

})({});
//# sourceMappingURL=fdn-reverb-bundle.js.map
