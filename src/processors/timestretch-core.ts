/*
 * Time-stretch core — context-free, unit-testable OFFLINE independent
 * time-scaling (change tempo WITHOUT changing pitch).
 *
 * Algorithm: Zdeněk Průša & Nicki Holighaus, "Phase Vocoder Done Right",
 * Proc. EUSIPCO 2017 / arXiv:2202.07382 (2022). The synthesis phase is
 * reconstructed from the analysis-phase gradients via Phase Gradient Heap
 * Integration (PGHI / RTPGHI), originally Průša, Balazs & Søndergaard 2017
 * ("A noniterative method for reconstruction of phase from STFT magnitude")
 * and Průša & Søndergaard 2016 (RTPGHI, DAFx-16). No peak picking, no partial
 * tracking, no transient detection — phase coherence (both horizontal/time and
 * vertical/frequency) is enforced automatically by integrating along the
 * spectrogram's magnitude ridges (Průša 2022, p.2-3, Fig. 2).
 *
 * WHY THIS IS OFFLINE, NOT A REAL-TIME WORKLET
 * --------------------------------------------
 * The project's OLA worklet base (`src/processors/ola.ts`) hardwires the hop to
 * the 128-sample Web Audio render quantum and runs analysis hop == synthesis
 * hop, i.e. it is a UNITY-RATE analysis/synthesis loop and cannot change the
 * time base in real time (see reports/scout-resurrection.md §B3). Genuine
 * independent time-stretch requires analysis hop ≠ synthesis hop
 * (a_s = α·a_a). So this is implemented as a whole-buffer offline transform:
 * STFT the entire signal at analysis hop a_a → reconstruct synthesis phase with
 * PGHI heap integration → ISTFT/overlap-add at synthesis hop a_s = round(α·a_a)
 * → return a new buffer of length ≈ input·α at the SAME pitch. (Průša 2022,
 * Eq.7: α = a_s/a_a; output length = αL.)
 *
 * The spectrum/phase manipulation that carries the testable invariants lives
 * here, context-free, mirroring the project's core/shell split
 * (phase-vocoder-core.ts, waveshaper-core.ts, dynamics-core.ts).
 */

import FFT from "fft.js";

/** Options for {@link timeStretch}. */
export interface TimeStretchOptions {
  /**
   * FFT length / window length `M` (samples), power of two (fft.js radix-4
   * constraint). Průša 2022 evaluation used M=8192; for general short cacophony
   * buffers a smaller window keeps frequency-resolution-vs-time-resolution
   * balanced. Default 2048 (matches the project's phase-vocoder block size).
   */
  fftSize?: number;
  /**
   * Analysis hop `a_a` (samples). Synthesis hop is `a_s = round(a_a·factor)`
   * (Průša 2022, Eq.7). Default = fftSize/4 (75% overlap, COLA-exact for Hann).
   */
  analysisHop?: number;
  /**
   * Relative tolerance `tol` for the significant-bin set; `abstol = tol·max(s)`
   * (Průša 2022, p.3, Algorithm 1 line 1). Default 1e-6 (paper value).
   */
  tol?: number;
  /**
   * Deterministic RNG seed for the random phase assigned to insignificant bins
   * (Algorithm 1 line 3). Default 1 — deterministic so tests are reproducible.
   */
  randomSeed?: number;
}

const TWO_PI = 2 * Math.PI;

/** Hann window of `length` (periodic / DFT-even form), matching phase-vocoder.ts. */
function hannWindow(length: number): Float32Array {
  const win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / length));
  }
  return win;
}

/**
 * Principal-argument operator `[x]_2π = x − 2π·round(x/2π)` — wraps to the
 * nearest interval of length 2π (Průša 2022, p.2, the `[·]_2π` operator with
 * round-to-closest-integer `⌈·⌋`). Used by every finite-difference scheme.
 */
function princarg(x: number): number {
  return x - TWO_PI * Math.round(x / TWO_PI);
}

/** Mulberry32 — tiny deterministic PRNG so insignificant-bin phase is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flat typed-array binary MAX-heap keyed by a Float64 magnitude, carrying an
 * Int32 payload (here: an encoded (bin, frameSelector) tuple). No per-pop
 * allocation — the backing arrays are sized once to the worst case and reused
 * by `clear()`. This is the "self-sorting max-heap" of Průša 2022 Algorithm 1
 * (always pops the globally-highest-magnitude known coefficient).
 */
class MaxHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }

  push(key: number, val: number): void {
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    // sift up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] >= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Pop the payload of the max-key element. Caller must check `length > 0`. */
  pop(): number {
    const topVal = this.vals[0];
    const last = --this.size;
    this.keys[0] = this.keys[last];
    this.vals[0] = this.vals[last];
    // sift down
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let largest = i;
      if (l < this.size && this.keys[l] > this.keys[largest]) largest = l;
      if (r < this.size && this.keys[r] > this.keys[largest]) largest = r;
      if (largest === i) break;
      this.swap(i, largest);
      i = largest;
    }
    return topVal;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }
}

/**
 * OFFLINE independent time-stretch of a single channel.
 *
 * @param input  Mono signal.
 * @param factor Stretch factor `α = a_s/a_a` (Průša 2022, Eq.7). `>1` lengthens
 *               (slower tempo), `<1` shortens (faster tempo); pitch unchanged.
 * @returns A new `Float32Array` of length ≈ round(input.length·factor) at the
 *          SAME pitch as the input.
 *
 * Pipeline (Průša 2022, the STFT analysis-modify-synthesis loop, p.2-3):
 *   1. Whole-signal STFT (Hann window, analysis hop a_a) → magnitude s + phase φ_a.
 *   2. Phase gradients: CENTERED time derivative Δt φ_a (Eqs 13-15, heterodyned)
 *      and the directional forward/backward frequency difference Δf φ_a (Eqs
 *      16-17). See the gradient block below for why the directional (rather than
 *      the centered+trapezoidal) frequency integration is used.
 *   3. Per frame: PGHI heap integration (Algorithm 1) → synthesis phase φ_s,
 *      using synthesis hop a_s for the trapezoidal TIME update (Eq.8) and
 *      synthesis freq step b_s = α·b_a for the directional FREQUENCY update.
 *   4. ISTFT each synthesis frame (s·e^{iφ_s}) + Hann window, overlap-add at
 *      synthesis hop a_s, normalized by the COLA window-energy envelope.
 */
export function timeStretch(input: Float32Array, factor: number, opts: TimeStretchOptions = {}): Float32Array {
  if (!(factor > 0)) {
    throw new Error(`timeStretch: factor must be > 0, got ${factor}`);
  }

  // FFT length M must be a power of two (fft.js radix constraint) and large
  // enough that the default hop M/4 is a positive integer with real overlap.
  // M < 4 would make the default hop fractional (M=2 → 0.5); require M ≥ 16 so
  // a Hann window has a meaningful main lobe and the default 75%-overlap hop is
  // a sensible integer.
  const M = opts.fftSize ?? 2048;
  if (!Number.isInteger(M) || M < 16 || (M & (M - 1)) !== 0) {
    throw new Error(`timeStretch: fftSize must be a power of two ≥ 16, got ${M}`);
  }
  const aA = opts.analysisHop ?? M / 4; // analysis hop a_a (M/4 is integer since M is a power of two ≥ 16)
  // The analysis hop must be a positive INTEGER: the frame loop reads
  // padded[n*aA + i], and a fractional hop reads off-grid (undefined → NaN).
  // It must also not exceed M (hops larger than the window leave gaps with no
  // COLA coverage).
  if (!Number.isInteger(aA) || aA < 1 || aA > M) {
    throw new Error(`timeStretch: analysisHop must be a positive integer in [1, fftSize=${M}], got ${aA}`);
  }
  const aS = Math.max(1, Math.round(aA * factor)); // synthesis hop a_s = round(α·a_a), Eq.7
  const tol = opts.tol ?? 1e-6;
  const rand = mulberry32(opts.randomSeed ?? 1);

  const nyq = M / 2; // index of the Nyquist bin
  const nBins = nyq + 1; // non-redundant bins 0..M/2

  // Analysis (b_a) and synthesis (b_s = α·b_a) frequency steps. The per-bin
  // angular spacing on the unwrapped axis is 2π·bin/M; the frequency update
  // accumulates the directional Δf gradient scaled by the synthesis step.
  // We carry the ratio (b_s/b_a) = a_s/a_a directly via the gradient scaling
  // below (see freq-update comment), so b_a/b_s never need explicit values.

  const win = hannWindow(M);

  // ---- Framing geometry -------------------------------------------------
  // Pad the front and back by one window so the first and last samples get
  // full window coverage (standard STFT zero-padding). Number of analysis
  // frames covers the whole padded signal at hop a_a.
  const pad = M;
  const paddedLen = input.length + 2 * pad;
  const padded = new Float32Array(paddedLen);
  padded.set(input, pad);

  const nFrames = Math.max(1, Math.floor((paddedLen - M) / aA) + 1);

  // ---- FFT scratch ------------------------------------------------------
  const fft = new FFT(M);
  // fft.js returns its complex arrays typed as any[]; the runtime is a flat
  // interleaved Float32Array [re,im,re,im,...] of length 2*M.
  const frameTime = new Float32Array(M);
  const freq = fft.createComplexArray() as unknown as Float32Array;

  // Per-frame magnitude `s` and analysis phase `φ_a`, bins 0..nyq.
  const mag: Float32Array[] = new Array(nFrames);
  const phase: Float32Array[] = new Array(nFrames);

  for (let n = 0; n < nFrames; n++) {
    const start = n * aA;
    for (let i = 0; i < M; i++) {
      frameTime[i] = padded[start + i] * win[i];
    }
    fft.realTransform(freq, frameTime);
    const s = new Float32Array(nBins);
    const ph = new Float32Array(nBins);
    for (let m = 0; m < nBins; m++) {
      const re = freq[2 * m];
      const im = freq[2 * m + 1];
      s[m] = Math.hypot(re, im);
      ph[m] = Math.atan2(im, re);
    }
    mag[n] = s;
    phase[n] = ph;
  }

  // ---- Phase gradients (Průša 2022, centered finite differences) --------
  // Time-direction derivative Δt φ_a (Eqs 13-15), HETERODYNED: the linear
  // phase advance 2π·m·a_a/M of a stationary sinusoid is removed before the
  // principal-argument wrap, then added back. We store Δt already MULTIPLIED
  // BY a_a (i.e. the per-analysis-hop phase increment Δt·a_a), because the
  // synthesis time update multiplies by a_s and the only thing that matters is
  // the ratio a_s/a_a — storing the per-hop increment lets the trapezoidal
  // update (Eq.8) just scale by (a_s/a_a)/... See the heap loop below.
  //
  // dtInc[n][m] = a_a · (Δt,cent φ_a)(m,n)  (radians advanced per analysis hop)
  // dfFwd[n][m] = [φ_a(m+1,n) − φ_a(m,n)]_2π  — the FORWARD wrapped frequency-
  //              direction difference (Eq.17 numerator, b_a units). Used
  //              DIRECTIONALLY: forward (Δf,fwd) for up-propagation, backward
  //              (Δf,back(m) = Δf,fwd(m-1)) for down-propagation.
  //
  // FREQUENCY-INTEGRATION SCHEME — why forward/backward (rectangle) rather than
  // the centered+trapezoidal form of Algorithm 1 lines 17/22. The paper presents
  // forward (Eq.17), backward (Eq.16) AND centered (Eq.18) and says "Any of the
  // schemes can be used in place of Δf" — only that centered is "the most
  // suitable" in the authors' experience. Crucially the paper's OWN evaluation
  // implementation did NOT use the trapezoidal-rule integration (paper p.4,
  // Conclusion/Limitations: the implementation "does not include the trapezoidal
  // rule" and adding it is noted as future work). Directional forward/backward
  // integration telescopes EXACTLY to the analysis phase along a ridge:
  //   up:   φ_s(m+1) = φ_s(m) + Δf,fwd(m)  ⇒ φ_a(m+1) − φ_a(m)
  //   down: φ_s(m-1) = φ_s(m) − Δf,fwd(m-1) ⇒ φ_a(m-1) − φ_a(m)
  // so it preserves both spectral identity at α=1 and the off-bin tone's peak
  // location. The centered+trapezoidal variant was implemented faithfully and
  // MEASURED to be strictly worse here: it lowers tonal spectral purity in every
  // tested case (e.g. 440 Hz factor=1: 0.94 → 0.56) and SHIFTS the dominant bin
  // of an off-bin tone at factor≠1 (440 Hz, bin 41 → 45 at factor=2), breaking
  // pitch preservation, while improving chirp spectral spread only marginally
  // (≈8% at factor 2, ≈1% at factor 3) and single-impulse temporal spread ≈11%.
  // See reports/fix-B3-timestretch.md for the full measurements. The trapezoidal
  // refinement is the paper's acknowledged-omitted future work, not its baseline;
  // we keep the paper's directional integration that the authors actually shipped.
  const dtInc: Float32Array[] = new Array(nFrames);
  const dfFwd: Float32Array[] = new Array(nFrames);

  for (let n = 0; n < nFrames; n++) {
    dtInc[n] = new Float32Array(nBins);
    dfFwd[n] = new Float32Array(nBins);
  }

  for (let n = 0; n < nFrames; n++) {
    const ph = phase[n];
    const phPrev = n > 0 ? phase[n - 1] : null;
    const phNext = n < nFrames - 1 ? phase[n + 1] : null;

    for (let m = 0; m < nBins; m++) {
      // expected linear advance of bin m over one analysis hop
      const expected = (TWO_PI * m * aA) / M;

      // backward & forward heterodyned time differences (Eqs 13-14):
      //   Δt,back·a_a = [φ(n) − φ(n−1) − expected]_2π + expected
      //   Δt,fwd·a_a  = [φ(n+1) − φ(n) − expected]_2π + expected
      let dt: number;
      if (phPrev && phNext) {
        const back = princarg(ph[m] - phPrev[m] - expected) + expected;
        const fwd = princarg(phNext[m] - ph[m] - expected) + expected;
        dt = 0.5 * (back + fwd); // centered (Eq.15)
      } else if (phPrev) {
        dt = princarg(ph[m] - phPrev[m] - expected) + expected; // backward only at last frame
      } else if (phNext) {
        dt = princarg(phNext[m] - ph[m] - expected) + expected; // forward only at first frame
      } else {
        dt = expected; // single frame: assume stationary
      }
      dtInc[n][m] = dt;

      // frequency-direction FORWARD wrapped difference (Eq.17): the directed
      // increment from bin m to bin m+1. No heterodyning (a pure sinusoid has
      // Δf φ ≈ 0, the paper's testable property, p.2). The last bin has no m+1.
      dfFwd[n][m] = m < nBins - 1 ? princarg(ph[m + 1] - ph[m]) : 0;
    }
  }

  // ---- PGHI heap integration (Průša 2022, Algorithm 1) ------------------
  // Produce the synthesis phase φ_s frame by frame. The frequency update uses
  // synthesis freq step b_s = α·b_a; since dfInc holds the per-bin centered
  // difference (already in "per b_a" units of radians/binstep), scaling it by
  // the factor α = a_s/a_a converts the b_a step to the b_s step (b_s = α·b_a).
  const ratio = aS / aA; // = α, the time-scaling factor (Eq.7)
  const synthPhase: Float32Array[] = new Array(nFrames);
  for (let n = 0; n < nFrames; n++) synthPhase[n] = new Float32Array(nBins);

  // Heap payload encodes (bin << 1 | sel): sel=0 -> previous frame (n-1),
  // sel=1 -> current frame (n). Capacity 2·nBins (prev seeds + current bins).
  const heap = new MaxHeap(2 * nBins);
  const assigned = new Uint8Array(nBins); // whether φ_s(m,n) computed this frame
  const inSet = new Uint8Array(nBins); // significant set I membership this frame

  for (let n = 0; n < nFrames; n++) {
    const s = mag[n];
    const sPrev = n > 0 ? mag[n - 1] : null;
    const phiS = synthPhase[n];
    const phiSPrev = n > 0 ? synthPhase[n - 1] : null;

    // Algorithm 1 line 1: abstol = tol · max(s(·,n) ∪ s(·,n-1)).
    let maxS = 0;
    for (let m = 0; m < nBins; m++) {
      if (s[m] > maxS) maxS = s[m];
      if (sPrev && sPrev[m] > maxS) maxS = sPrev[m];
    }
    const abstol = tol * maxS;

    // Lines 2-3: significant set I = { m : s(m,n) > abstol }; insignificant
    // bins get random phase and do not propagate.
    heap.clear();
    let remaining = 0;
    for (let m = 0; m < nBins; m++) {
      assigned[m] = 0;
      if (s[m] > abstol) {
        inSet[m] = 1;
        remaining++;
      } else {
        inSet[m] = 0;
        phiS[m] = TWO_PI * rand(); // random phase, Algorithm 1 line 3
        assigned[m] = 1; // resolved (will not be propagated to)
      }
    }

    if (n === 0 || !phiSPrev || !sPrev) {
      // First frame (or no previous synthesis phase): there is no prior frame to
      // time-propagate from. Seed the frequency integration from the
      // highest-magnitude significant bin, whose synthesis phase we anchor to
      // its analysis phase (the PGHI initialization for the very first column).
      // Find the max-magnitude significant bin.
      let seed = -1;
      let seedMag = -1;
      for (let m = 0; m < nBins; m++) {
        if (inSet[m] && s[m] > seedMag) {
          seedMag = s[m];
          seed = m;
        }
      }
      if (seed >= 0) {
        phiS[seed] = phase[n][seed];
        assigned[seed] = 1;
        remaining--;
        heap.push(s[seed], (seed << 1) | 1);
      }
      // Frequency-only spreading for the first frame. Directional integration
      // (b_s = α·b_a folded into `ratio`):
      //   up:   φ_s(m+1)=φ_s(m)+b_s·Δf,fwd(m)
      //   down: φ_s(m-1)=φ_s(m)−b_s·Δf,fwd(m-1)   [= Δf,back(m)]
      while (heap.length > 0 && remaining > 0) {
        const top = heap.pop();
        const mh = top >> 1;
        if (mh + 1 < nBins && inSet[mh + 1] && !assigned[mh + 1]) {
          phiS[mh + 1] = phiS[mh] + ratio * dfFwd[n][mh];
          assigned[mh + 1] = 1;
          remaining--;
          heap.push(s[mh + 1], ((mh + 1) << 1) | 1);
        }
        if (mh - 1 >= 0 && inSet[mh - 1] && !assigned[mh - 1]) {
          phiS[mh - 1] = phiS[mh] - ratio * dfFwd[n][mh - 1];
          assigned[mh - 1] = 1;
          remaining--;
          heap.push(s[mh - 1], ((mh - 1) << 1) | 1);
        }
      }
      continue;
    }

    // Lines 4-5: seed the heap with all significant PREVIOUS-frame coefficients
    // (their synthesis phase is already known from frame n-1).
    for (let m = 0; m < nBins; m++) {
      if (inSet[m]) {
        // key on the previous frame's magnitude (the known coefficient's mag)
        heap.push(sPrev[m], (m << 1) | 0); // sel=0 -> previous frame
      }
    }

    // Lines 6-27: integrate until all significant current-frame bins assigned.
    while (heap.length > 0 && remaining > 0) {
      const top = heap.pop();
      const mh = top >> 1;
      const sel = top & 1;

      if (sel === 0) {
        // Top is a previous-frame coefficient (n-1): propagate in TIME into the
        // current frame (Algorithm 1 lines 8-13). Trapezoidal time update
        // (Průša 2022, Eq.8):
        //   φ_s(m,n) = φ_s(m,n-1) + (a_s/2)·[Δt(m,n-1) + Δt(m,n)]
        // dtInc holds the per-analysis-hop increment (Δt·a_a); the synthesis
        // step a_s = α·a_a, so a_s·Δt = α·(Δt·a_a) = ratio·dtInc.
        if (inSet[mh] && !assigned[mh]) {
          phiS[mh] = phiSPrev[mh] + 0.5 * ratio * (dtInc[n - 1][mh] + dtInc[n][mh]);
          assigned[mh] = 1;
          remaining--;
          heap.push(s[mh], (mh << 1) | 1); // now a current-frame known coeff
        }
      } else {
        // Top is a current-frame coefficient (n) with known synthesis phase:
        // propagate in FREQUENCY to m±1 (Algorithm 1 lines 15-26) using the
        // directed forward/backward gradient Δf,fwd with synthesis freq step
        // b_s = α·b_a (folded into `ratio`):
        //   φ_s(m+1,n) = φ_s(m,n) + b_s·Δf,fwd(m,n)
        //   φ_s(m-1,n) = φ_s(m,n) − b_s·Δf,fwd(m-1,n)   [= Δf,back(m,n)]
        if (mh + 1 < nBins && inSet[mh + 1] && !assigned[mh + 1]) {
          phiS[mh + 1] = phiS[mh] + ratio * dfFwd[n][mh];
          assigned[mh + 1] = 1;
          remaining--;
          heap.push(s[mh + 1], ((mh + 1) << 1) | 1);
        }
        if (mh - 1 >= 0 && inSet[mh - 1] && !assigned[mh - 1]) {
          phiS[mh - 1] = phiS[mh] - ratio * dfFwd[n][mh - 1];
          assigned[mh - 1] = 1;
          remaining--;
          heap.push(s[mh - 1], ((mh - 1) << 1) | 1);
        }
      }
    }

    // Any significant bins the heap could not reach (disconnected ridge): fall
    // back to a pure time update so they still advance coherently rather than
    // being left at zero. This never double-assigns (guarded by `assigned`).
    if (remaining > 0) {
      for (let m = 0; m < nBins; m++) {
        if (inSet[m] && !assigned[m]) {
          phiS[m] = phiSPrev[m] + 0.5 * ratio * (dtInc[n - 1][m] + dtInc[n][m]);
          assigned[m] = 1;
          remaining--;
        }
      }
    }
  }

  // ---- ISTFT + overlap-add resynthesis at synthesis hop a_s -------------
  // Per-frame inverse STFT of s·e^{iφ_s} (Průša 2022, the per-frame inverse,
  // p.2), Hann-windowed again, overlap-added at synthesis hop a_s, then divided
  // by the accumulated squared-window envelope (canonical COLA normalization /
  // dual synthesis window, p.2). Output length = round(input.length·factor).
  const outLen = Math.max(1, Math.round(input.length * factor));
  const synthPad = M;
  const synthBufLen = (nFrames - 1) * aS + M + synthPad;
  const acc = new Float32Array(synthBufLen);
  const winEnergy = new Float32Array(synthBufLen);

  const specOut = fft.createComplexArray() as unknown as Float32Array;
  const timeOut = fft.createComplexArray() as unknown as Float32Array;

  for (let n = 0; n < nFrames; n++) {
    const s = mag[n];
    const phiS = synthPhase[n];
    // Build the half-spectrum (bins 0..nyq) as re/im, then mirror.
    for (let m = 0; m < nBins; m++) {
      const re = s[m] * Math.cos(phiS[m]);
      const im = s[m] * Math.sin(phiS[m]);
      specOut[2 * m] = re;
      specOut[2 * m + 1] = im;
    }
    // Nyquist and DC must be real for a real signal; imag already ~0 since we
    // mirror with conjugate symmetry next.
    fft.completeSpectrum(specOut);
    fft.inverseTransform(timeOut, specOut);

    const start = n * aS;
    for (let i = 0; i < M; i++) {
      const w = win[i];
      // timeOut is interleaved; real part at even indices.
      acc[start + i] += timeOut[2 * i] * w;
      winEnergy[start + i] += w * w;
    }
  }

  // Normalize by the COLA window-energy envelope (canonical dual window). The
  // analysis front-pad was `pad`; the synthesis frames begin at index 0 here,
  // and the analysis pad maps to a synthesis-side offset of round(pad·factor).
  for (let i = 0; i < synthBufLen; i++) {
    if (winEnergy[i] > 1e-8) acc[i] /= winEnergy[i];
  }

  const offset = Math.round(pad * factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = offset + i;
    out[i] = src < synthBufLen ? acc[src] : 0;
  }
  return out;
}

/**
 * Multichannel convenience: time-stretch each channel independently with the
 * same factor/options. Returns one new `Float32Array` per channel, all the same
 * length (≈ round(channelLength·factor)).
 */
export function timeStretchChannels(
  channels: Float32Array[],
  factor: number,
  opts: TimeStretchOptions = {},
): Float32Array[] {
  return channels.map((ch) => timeStretch(ch, factor, opts));
}
