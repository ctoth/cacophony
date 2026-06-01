/*
 * FDN reverb processor core — context-free DSP math for a Feedback Delay
 * Network (FDN) reverberator with a Delay Feedback Matrix (scattering) and
 * per-delay-line velvet-noise diffusion.
 *
 * Implements the canonical FDN recursion and a lossless (paraunitary) feedback
 * matrix from:
 *   S. J. Schlecht, E. A. P. Habets, "Scattering in Feedback Delay Networks",
 *   IEEE/ACM Trans. Audio, Speech, Lang. Process., Vol. 28, 2020 (arXiv
 *   1912.08888). [hereafter "Schlecht 2020"]
 *
 * and the multiplication-free per-delay-line velvet-noise diffusion FIR from:
 *   J. Fagerström, B. Alary, S. J. Schlecht, V. Välimäki,
 *   "Velvet-Noise Feedback Delay Network", Proc. DAFx 2020, pp. 219-226.
 *   [hereafter "Fagerström 2020"]
 *
 * Frequency-dependent decay (T60) is set by per-delay-line absorption filters,
 * NOT by the feedback matrix, following the standard FDN design recipe of:
 *   J.-M. Jot, A. Chaigne, "Digital delay networks for designing artificial
 *   reverberators", AES Convention 90, 1991. [hereafter "Jot 1991"]
 *
 * ── Structure (Schlecht 2020 §II; Fagerström 2020 eqs. 1-3) ──
 * An FDN of N delay lines z^{-m_i} mixed through an N×N feedback matrix A(z),
 * with input gains b, output gains c, and direct (dry) gain d. The transfer is
 *   H(z) = cᵀ (D_m(z)^{-1} − A(z))^{-1} b + d ,  D_m(z) = diag(z^{-m_1}…z^{-m_N})
 * (Schlecht 2020 §II; Fagerström 2020 eq. 3). Per-sample, with q_i(n) the
 * output of delay line i (Fagerström 2020 eqs. 1-2):
 *   y(n)            = Σ_i c_i q_i(n) + d·x(n)
 *   s_i(n + m_i)    = Σ_j A_{ij} q_j(n) + b_i·x(n)
 *
 * ── Scattering: Delay Feedback Matrix, DFM (Schlecht 2020 §IV-A, eq. 14) ──
 * The classic FDN uses a SCALAR feedback matrix A (degree-0 paraunitary). That
 * is the lowest-echo-density baseline (Schlecht 2020 Fig. 4a "Scalar/EBFM"). To
 * scatter echoes inside the feedback path WITHOUT adding delay lines, Schlecht
 * 2020 generalizes A to a *filter feedback matrix* A(z). The cheapest such
 * construction is the **Delay Feedback Matrix** (Schlecht 2020 eq. 14):
 *   A(z) = U · D_κ(z) ,   D_κ(z) = diag(z^{-κ_1}, …, z^{-κ_N})
 * where U is a scalar orthogonal/unitary matrix (here a normalized Hadamard)
 * and D_κ(z) is a diagonal of *pure integer delays* κ_i on the feedback paths.
 * It is paraunitary — a unitary U times a diagonal of pure delays is lossless,
 * Ã(z)A(z) = D_κ(z^{-1}) Uᵀ U D_κ(z) = I (Schlecht 2020 §III, §IV-A) — so the
 * recursive core still has all poles on the unit circle. Each pre-mix delay κ_i
 * spreads the echo each delay-line output produces across the feedback paths,
 * raising echo density per traversal (Schlecht 2020 §VI, eq. 36: echo gain is a
 * PRODUCT over the path so each extra internal delay multiplies the echo
 * count). Setting all κ_i = 0 recovers the scalar Hadamard baseline. This core
 * uses small, mutually-spread κ_i so the DFM genuinely scatters.
 *
 * ── Per-line velvet diffusion: VFDN "single" (Fagerström 2020 §3, Fig. 4) ──
 * Fagerström 2020's VFDN inserts velvet-noise FIRs into the FDN. This core
 * applies a DISTINCT per-line VNS to the INPUT injection of each delay line —
 * the single input-set placement (Fagerström 2020 eq. 11): each line is
 * decorrelated and early echo density rises to ~M sparse echoes per line.
 * NOTE — honest scope: this core does NOT place VNS on the output branch or
 * inside the feedback loop, so the density does NOT compound to the ≈ M² of the
 * full input+output configuration (eq. 12) — that would require additional VNS
 * sets not implemented here. A VNS has taps ∈ {+1, 0, −1}, so the convolution is
 * a sum of signed delayed samples — multiplication-free (Fagerström 2020 eq. 8).
 * Distinct per-line filters (the "VFDN single" configuration) decorrelate the
 * lines, instead of one shared diffuser writing the same value into every line. Grid size
 * T_d = fs/ρ_d (eq. 4), M = L_s/T_d impulses (eq. 5), tap location
 * k(m) = round(m·T_d + r₂(m)(T_d − 1)) (eq. 7), sign s₁(m) = 2·round(r₁) − 1
 * ∈ {+1,−1} (eq. 6). Jittered locations avoid comb coloration (Fagerström 2020
 * §2.3). The per-line diffusion is parameterized by `diffusion` (0 = bypass).
 *
 * ── Decay (Jot 1991, per-line absorption filters) ──
 * Each delay line i carries a per-sample gain g_i = 10^{-3 m_i / (T60·fs)} so
 * that after T60 seconds a signal circulating that line has decayed by 60 dB
 * (Jot 1991: gain per delay = 10^{-3 m_i / (T60 fs)} ⇒ −60 dB over T60).
 * High-frequency damping is a one-pole low-pass per line that shortens the HF
 * T60 relative to the broadband T60 (Jot 1991 frequency-dependent absorption).
 *
 * This file holds ONLY pure numeric math (plain numbers and Float32Array). It
 * has NO AudioWorklet / global dependencies so it can be unit-tested directly;
 * the worklet shell in fdn-reverb.ts delegates to it.
 */

/** Parameters consumed per processing block. */
export interface FdnReverbParams {
  /** Reverberation time T60 (s) — −60 dB decay time. */
  decayTime: number;
  /** Pre-delay before the wet path (s). */
  preDelay: number;
  /** High-frequency damping in [0,1]; 0 = none, 1 = maximal HF absorption. */
  damping: number;
  /** Velvet-noise diffusion amount in [0,1]; 0 = bypass. */
  diffusion: number;
  /** Wet/dry mix in [0,1]; 0 = fully dry, 1 = fully wet. */
  mix: number;
}

/** Speed of sound is irrelevant here; this is the −60 dB constant 10^(-3). */
const DECAY_DB_CONSTANT = 3; // 60 dB / 20 = 3 → 10^{-3 m/(T60 fs)} is −60 dB over T60·fs samples

/** Smallest T60 we will honor, to keep the per-line gain finite and < 1. */
const MIN_DECAY_TIME = 1e-3;

/**
 * Default delay-line lengths in samples (N = 8), mutually coprime / spread to
 * avoid coincident echoes (Schlecht 2020 §II design lore: "choose N delay
 * lengths coprime/spread"). These primes span ~13–58 ms at 48 kHz, a typical
 * medium-room set. Scaled to the actual sample rate at construction.
 */
const DEFAULT_DELAYS_AT_48K = [617, 769, 919, 1097, 1259, 1429, 1607, 1789];

/**
 * Default DFM feedback-path delays κ_i in samples at 48 kHz (Schlecht 2020 eq.
 * 14, D_κ(z) = diag(z^{-κ_i})). Small, mutually-spread coprime integers so each
 * feedback path is delayed by a different short amount before the Hadamard mix,
 * scattering each echo across the lines (Schlecht 2020 §IV-A, §VI). Kept small
 * (sub-ms to a few ms) so the DFM scatters early reflections without smearing
 * the broadband decay. All-zero would collapse the DFM to the scalar baseline.
 */
const DEFAULT_FEEDBACK_DELAYS_AT_48K = [7, 13, 23, 31, 41, 53, 61, 73];

/**
 * Build a normalized Hadamard matrix H/√N for N a power of two via the
 * Sylvester construction. H has ±1 entries and HᵀH = N·I, so H/√N is
 * orthogonal — the scalar unitary U of the Delay Feedback Matrix A(z) =
 * U·D_κ(z) (Schlecht 2020 eq. 14), a paraunitary FFM. Orthogonality of U plus a
 * pure-delay diagonal ⇒ the FDN feedback core is lossless ⇒ poles on the unit
 * circle ⇒ stable, with decay supplied separately by the absorption filters.
 *
 * @param n Number of delay lines (must be a power of two).
 * @returns Flat row-major N×N matrix, scaled by 1/√N (so it is orthonormal).
 */
export function buildHadamardMatrix(n: number): Float32Array {
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
  for (let i = 0; i < n * n; i++) h[i] *= norm;
  return h;
}

/**
 * A velvet-noise tap: a location (samples) and a sign (±1). Sign is stored as a
 * number so the convolution is a signed add (no multiply) — Fagerström 2020
 * eq. 8: z*s(n) = Σ_m s₁(m)·x(n − k(m)), s₁(m) ∈ {+1,−1}.
 */
export interface VelvetTap {
  location: number;
  sign: 1 | -1;
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
export function buildVelvetNoise(
  lengthSamples: number,
  density: number,
  sampleRate: number,
  rng: () => number = Math.random,
): VelvetTap[] {
  const gridSize = sampleRate / density; // T_d (eq. 4)
  const m = Math.max(0, Math.floor(lengthSamples / gridSize)); // M (eq. 5)
  const taps: VelvetTap[] = [];
  for (let i = 0; i < m; i++) {
    const r1 = rng();
    const r2 = rng();
    // k(m) = round(m·T_d + r₂·(T_d − 1)) (eq. 7).
    const location = Math.round(i * gridSize + r2 * (gridSize - 1));
    if (location >= lengthSamples) continue;
    // s₁(m) = 2·round(r₁) − 1 ∈ {+1,−1} (eq. 6).
    const sign: 1 | -1 = 2 * Math.round(r1) - 1 >= 0 ? 1 : -1;
    taps.push({ location, sign });
  }
  return taps;
}

/**
 * A multiplication-free velvet-noise FIR filter (Fagerström 2020 eq. 8). Holds
 * its own sparse ±1 tap list and a power-of-two ring buffer of recent inputs so
 * `process(x)` returns Σ_m s₁(m)·x(n − k(m)) — a sum of signed delayed samples,
 * no multiplications. One of these lives on each FDN delay line in the VFDN
 * "single" configuration (input-set placement), so each line is decorrelated and
 * early echo density rises (input injection only — no M² loop compounding).
 */
class VelvetFilter {
  private readonly taps: VelvetTap[];
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private write = 0;
  private readonly norm: number;

  constructor(taps: VelvetTap[], spanSamples: number) {
    this.taps = taps;
    const pow2 = 2 ** Math.ceil(Math.log2(Math.max(2, spanSamples + 1)));
    this.buffer = new Float32Array(pow2);
    this.mask = pow2 - 1;
    // Normalize by √M so the diffuser is ~unit-energy (a VNS of M unit taps has
    // expected energy M); keeps the per-line injection level comparable to the
    // undiffused path so `diffusion` is a clean dry↔wet blend.
    this.norm = taps.length > 0 ? 1 / Math.sqrt(taps.length) : 1;
  }

  /** Number of nonzero taps M (echo-density multiplier of this filter). */
  get tapCount(): number {
    return this.taps.length;
  }

  /**
   * Convolve one input sample with the VNS (Fagerström 2020 eq. 8): push x into
   * the ring, then accumulate Σ_m s₁(m)·x(n − k(m)) as signed adds. Returns the
   * √M-normalized result. Multiplication-free: each term adds or subtracts a
   * stored sample.
   */
  process(x: number): number {
    this.buffer[this.write] = x;
    let acc = 0;
    for (let i = 0; i < this.taps.length; i++) {
      const tap = this.taps[i];
      const idx = (this.write - tap.location) & this.mask;
      acc += tap.sign === 1 ? this.buffer[idx] : -this.buffer[idx];
    }
    this.write = (this.write + 1) & this.mask;
    return acc * this.norm;
  }

  reset(): void {
    this.buffer.fill(0);
    this.write = 0;
  }
}

/**
 * A single delay line with an integrated one-pole HF-damping absorption filter
 * (Jot 1991). Reads tail, applies broadband decay gain g and an HF low-pass,
 * then accepts the feedback-mixed input write. Backed by a power-of-two ring
 * buffer for cheap bitmask wrapping (mirrors dattorro-reverb.ts).
 */
class DampedDelayLine {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private writeIndex = 0;
  private lpState = 0; // one-pole low-pass memory (Jot HF absorption)
  readonly length: number;

  constructor(lengthSamples: number) {
    this.length = Math.max(1, Math.floor(lengthSamples));
    const pow2 = 2 ** Math.ceil(Math.log2(this.length + 1));
    this.buffer = new Float32Array(pow2);
    this.mask = pow2 - 1;
  }

  /** Read the sample delayed by `length` (the tail of the line). */
  read(): number {
    return this.buffer[(this.writeIndex - this.length) & this.mask];
  }

  /**
   * Apply broadband decay gain `g` and HF damping coefficient `damp` to a
   * tail sample. y[n] = g·((1−damp)·tail + damp·lpState); lpState tracks the
   * smoothed (low-frequency) component, so larger `damp` removes more HF energy
   * each pass ⇒ shorter HF T60 (Jot 1991 frequency-dependent absorption).
   */
  absorb(tail: number, g: number, damp: number): number {
    this.lpState = (1 - damp) * tail + damp * this.lpState;
    return g * this.lpState;
  }

  /** Write the feedback-mixed input and advance the write head one sample. */
  write(value: number): void {
    this.buffer[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) & this.mask;
  }

  reset(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.lpState = 0;
  }
}

/**
 * A pure-delay ring buffer: the diagonal pure-delay element z^{-κ} of the Delay
 * Feedback Matrix (Schlecht 2020 eq. 14, D_κ(z) = diag(z^{-κ_i})). Applied to a
 * feedback path before the Hadamard mix. A κ of 0 is a transparent pass-through
 * (recovers the scalar feedback matrix). No filtering, no gain — paraunitarity
 * is preserved because a pure integer delay is allpass/lossless.
 */
class PureDelay {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private write = 0;
  readonly delay: number;

  constructor(delaySamples: number) {
    this.delay = Math.max(0, Math.floor(delaySamples));
    const pow2 = 2 ** Math.ceil(Math.log2(Math.max(2, this.delay + 1)));
    this.buffer = new Float32Array(pow2);
    this.mask = pow2 - 1;
  }

  /** Push x, return the sample delayed by κ (κ=0 returns x just written). */
  process(x: number): number {
    this.buffer[this.write] = x;
    const out = this.buffer[(this.write - this.delay) & this.mask];
    this.write = (this.write + 1) & this.mask;
    return out;
  }

  reset(): void {
    this.buffer.fill(0);
    this.write = 0;
  }
}

/**
 * Feedback Delay Network reverberator core.
 *
 * N parallel {@link DampedDelayLine}s mixed by a lossless Delay Feedback Matrix
 * A(z) = H·D_κ(z) (Schlecht 2020 eq. 14: Hadamard U scattered by per-path pure
 * delays D_κ), with per-line absorption filters setting T60 (Jot 1991) and a
 * per-delay-line velvet-noise diffuser (Fagerström 2020 VFDN "single"). Pure:
 * operates on numbers / Float32Array, no globals.
 */
export class FdnReverbProcessor {
  private readonly sampleRate: number;
  private readonly n: number;
  private readonly lines: DampedDelayLine[];
  private readonly matrix: Float32Array; // row-major N×N, orthonormal (U)
  private readonly fbDelays: PureDelay[]; // D_κ(z): per-path pure delays (DFM)
  private readonly velvets: VelvetFilter[]; // per-line VNS (Fagerström VFDN single)
  private readonly feedback: Float32Array; // scratch: matrix·delayed-tail
  private readonly scattered: Float32Array; // scratch: D_κ(z)·tail
  private readonly tail: Float32Array; // scratch: per-line tail reads
  private readonly lineGains: Float32Array; // scratch: per-line decay gains

  // Pre-delay ring buffer (Schlecht 2020 §II input path).
  private preDelayBuffer: Float32Array;
  private preDelayWrite = 0;

  /**
   * @param sampleRate fs in Hz.
   * @param n Number of delay lines; must be a power of two in [4,8]. Default 8.
   * @param rng Injected RNG for the velvet-noise sequences (deterministic
   *   tests). Each delay line draws a DISTINCT VNS from this stream, so the
   *   lines are decorrelated (Fagerström 2020 VFDN single).
   * @param delaysOverride Optional explicit delay-line lengths (samples), for
   *   tests; defaults to the coprime 48 kHz set scaled to `sampleRate`.
   * @param feedbackDelaysOverride Optional explicit DFM feedback-path delays κ_i
   *   (samples), for tests. All-zero collapses the DFM to the scalar Hadamard
   *   baseline (Schlecht 2020 eq. 14 with D_κ = I). Defaults to a small spread.
   */
  constructor(
    sampleRate: number,
    n = 8,
    rng: () => number = Math.random,
    delaysOverride?: number[],
    feedbackDelaysOverride?: number[],
  ) {
    if (n !== 4 && n !== 8) {
      throw new Error(`FdnReverbProcessor supports N ∈ {4, 8}, got ${n}`);
    }
    this.sampleRate = sampleRate;
    this.n = n;

    const baseDelays = delaysOverride ?? DEFAULT_DELAYS_AT_48K.slice(0, n);
    const scale = delaysOverride ? 1 : sampleRate / 48000;
    this.lines = baseDelays.slice(0, n).map((d) => new DampedDelayLine(Math.max(1, Math.round(d * scale))));

    this.matrix = buildHadamardMatrix(n); // scalar unitary U of A(z)=U·D_κ(z)

    // DFM feedback-path pure delays D_κ(z) (Schlecht 2020 eq. 14). Scaled to fs
    // unless an explicit override is given (tests may pass all-zero to compare
    // against the scalar-Hadamard baseline).
    const baseFbDelays = feedbackDelaysOverride ?? DEFAULT_FEEDBACK_DELAYS_AT_48K.slice(0, n);
    const fbScale = feedbackDelaysOverride ? 1 : sampleRate / 48000;
    this.fbDelays = baseFbDelays.slice(0, n).map((k) => new PureDelay(Math.max(0, Math.round(k * fbScale))));

    this.feedback = new Float32Array(n);
    this.scattered = new Float32Array(n);
    this.tail = new Float32Array(n);
    this.lineGains = new Float32Array(n);

    // Pre-delay: up to 1 second.
    const preLen = Math.max(1, sampleRate);
    this.preDelayBuffer = new Float32Array(preLen);

    // Per-delay-line velvet-noise diffusers (Fagerström 2020 VFDN "single").
    // Each line gets its OWN distinct VNS (~20 ms span, ρ_d = 1000 pulses/s ⇒
    // ~20 taps), drawn from the shared RNG stream so the N filters differ. With
    // a distinct filter per line, each line's input injection is decorrelated
    // (single input-set, ~M echoes/line; NOT the M² input+output case, eq. 12).
    const velvetLen = Math.max(1, Math.round(0.02 * sampleRate));
    this.velvets = [];
    for (let i = 0; i < n; i++) {
      this.velvets.push(new VelvetFilter(buildVelvetNoise(velvetLen, 1000, sampleRate, rng), velvetLen));
    }
  }

  /** Number of delay lines. */
  get size(): number {
    return this.n;
  }

  /** The scalar unitary U (row-major) of the DFM A(z)=U·D_κ(z), for verification. */
  get feedbackMatrix(): Float32Array {
    return this.matrix;
  }

  /** The DFM feedback-path delays κ_i (samples), for verification. */
  get feedbackDelays(): number[] {
    return this.fbDelays.map((d) => d.delay);
  }

  /** Per-line velvet tap counts M_i (echo-density multipliers), for verification. */
  get velvetTapCounts(): number[] {
    return this.velvets.map((v) => v.tapCount);
  }

  /**
   * Per-line broadband decay gain g_i = 10^{-3 m_i/(T60 fs)} (Jot 1991): the
   * gain that yields −60 dB after T60 seconds for a signal circulating line i.
   */
  private lineGain(lineLength: number, decayTime: number): number {
    const t60 = Math.max(MIN_DECAY_TIME, decayTime);
    return 10 ** ((-DECAY_DB_CONSTANT * lineLength) / (t60 * this.sampleRate));
  }

  /**
   * Process a block of mono samples. `input` and `output` must be the same
   * length; output may alias input. Stateful across calls (ring buffers and
   * absorption memory persist), so streaming callers reuse one instance.
   *
   * Per sample (Fagerström 2020 eqs. 1-2; Schlecht 2020 §II, eq. 14):
   *   1. read pre-delayed dry sample → s
   *   2. tail_i  = absorb(read_i, g_i, damp)           (Jot decay + HF damping)
   *   3. wet     = (1/√N) Σ_i tail_i                    (output gain c)
   *   4. scat_i  = z^{-κ_i}·tail_i                       (DFM delays D_κ, Schlecht)
   *   5. fb      = H · scat                              (lossless Hadamard mix U)
   *   6. inj_i   = b · VNS_i(s)                          (per-line velvet, Fagerström)
   *   7. write line i ← fb_i + inj_i                     (input injection)
   *   8. out     = (1−mix)·dry + mix·wet
   */
  process(input: Float32Array, output: Float32Array, params: FdnReverbParams): void {
    const len = Math.min(input.length, output.length);
    const damp = clamp01(params.damping);
    const diffusion = clamp01(params.diffusion);
    const mix = clamp01(params.mix);
    const decayTime = params.decayTime;
    const preDelaySamples = Math.min(
      this.preDelayBuffer.length - 1,
      Math.max(0, Math.round(params.preDelay * this.sampleRate)),
    );

    // Precompute per-line decay gains once per block (k-rate decay).
    for (let i = 0; i < this.n; i++) {
      this.lineGains[i] = this.lineGain(this.lines[i].length, decayTime);
    }
    const lineGains = this.lineGains;

    const outGain = 1 / Math.sqrt(this.n); // output gain c (energy-normalized sum)
    const inGain = 1 / Math.sqrt(this.n); // input gain b (spread equally)

    for (let s = 0; s < len; s++) {
      const dry = input[s];

      // Pre-delay (Schlecht 2020 §II input path). Write the current sample,
      // then read `preDelaySamples` back from it; preDelay=0 returns the
      // just-written sample (no spurious one-buffer-length latency).
      const preLen = this.preDelayBuffer.length;
      this.preDelayBuffer[this.preDelayWrite] = dry;
      const readIdx = (this.preDelayWrite - preDelaySamples + preLen) % preLen;
      const preDelayed = this.preDelayBuffer[readIdx];
      this.preDelayWrite = (this.preDelayWrite + 1) % preLen;

      // Read + absorb each delay-line tail (Jot 1991 decay/damping).
      let wet = 0;
      for (let i = 0; i < this.n; i++) {
        const t = this.lines[i].absorb(this.lines[i].read(), lineGains[i], damp);
        this.tail[i] = t;
        wet += t;
      }
      wet *= outGain;

      // DFM scattering: apply the per-path pure delays z^{-κ_i} BEFORE the
      // mix (Schlecht 2020 eq. 14, D_κ(z)). Each feedback path is delayed by a
      // different κ_i, spreading the echo each line produces across the lines.
      for (let i = 0; i < this.n; i++) {
        this.scattered[i] = this.fbDelays[i].process(this.tail[i]);
      }

      // Lossless Hadamard mix fb = H·scat (Schlecht 2020 eq. 14, the unitary U).
      for (let i = 0; i < this.n; i++) {
        let acc = 0;
        const row = i * this.n;
        for (let j = 0; j < this.n; j++) {
          acc += this.matrix[row + j] * this.scattered[j];
        }
        this.feedback[i] = acc;
      }

      // Per-line velvet diffusion of the injected input (Fagerström 2020 VFDN
      // single, eq. 8). Each line gets its OWN VNS-filtered copy of the input
      // (multiplication-free), blended dry↔diffused by `diffusion`, then added
      // to that line's feedback. Distinct per-line filters decorrelate the
      // lines and raise early echo density (input-set placement; not M² loop compounding).
      for (let i = 0; i < this.n; i++) {
        const diffused = this.velvets[i].process(preDelayed);
        const injected = ((1 - diffusion) * preDelayed + diffusion * diffused) * inGain;
        this.lines[i].write(this.feedback[i] + injected);
      }

      // Wet/dry mix.
      output[s] = (1 - mix) * dry + mix * wet;
    }
  }

  /** Clear all internal state (delay lines, pre-delay, DFM delays, diffusers). */
  reset(): void {
    for (const line of this.lines) line.reset();
    for (const d of this.fbDelays) d.reset();
    for (const v of this.velvets) v.reset();
    this.preDelayBuffer.fill(0);
    this.preDelayWrite = 0;
  }
}

/** Clamp x to [0,1]. */
function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
