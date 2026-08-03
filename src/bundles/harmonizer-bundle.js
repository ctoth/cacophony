var harmonizer = (function (exports) {
	'use strict';

	function getDefaultExportFromCjs (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
	}

	var fft;
	var hasRequiredFft;

	function requireFft () {
		if (hasRequiredFft) return fft;
		hasRequiredFft = 1;

		function FFT(size) {
		  this.size = size | 0;
		  if (this.size <= 1 || (this.size & (this.size - 1)) !== 0)
		    throw new Error('FFT size must be a power of two and bigger than 1');

		  this._csize = size << 1;

		  // NOTE: Use of `var` is intentional for old V8 versions
		  var table = new Array(this.size * 2);
		  for (var i = 0; i < table.length; i += 2) {
		    const angle = Math.PI * i / this.size;
		    table[i] = Math.cos(angle);
		    table[i + 1] = -Math.sin(angle);
		  }
		  this.table = table;

		  // Find size's power of two
		  var power = 0;
		  for (var t = 1; this.size > t; t <<= 1)
		    power++;

		  // Calculate initial step's width:
		  //   * If we are full radix-4 - it is 2x smaller to give inital len=8
		  //   * Otherwise it is the same as `power` to give len=4
		  this._width = power % 2 === 0 ? power - 1 : power;

		  // Pre-compute bit-reversal patterns
		  this._bitrev = new Array(1 << this._width);
		  for (var j = 0; j < this._bitrev.length; j++) {
		    this._bitrev[j] = 0;
		    for (var shift = 0; shift < this._width; shift += 2) {
		      var revShift = this._width - shift - 2;
		      this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
		    }
		  }

		  this._out = null;
		  this._data = null;
		  this._inv = 0;
		}
		fft = FFT;

		FFT.prototype.fromComplexArray = function fromComplexArray(complex, storage) {
		  var res = storage || new Array(complex.length >>> 1);
		  for (var i = 0; i < complex.length; i += 2)
		    res[i >>> 1] = complex[i];
		  return res;
		};

		FFT.prototype.createComplexArray = function createComplexArray() {
		  const res = new Array(this._csize);
		  for (var i = 0; i < res.length; i++)
		    res[i] = 0;
		  return res;
		};

		FFT.prototype.toComplexArray = function toComplexArray(input, storage) {
		  var res = storage || this.createComplexArray();
		  for (var i = 0; i < res.length; i += 2) {
		    res[i] = input[i >>> 1];
		    res[i + 1] = 0;
		  }
		  return res;
		};

		FFT.prototype.completeSpectrum = function completeSpectrum(spectrum) {
		  var size = this._csize;
		  var half = size >>> 1;
		  for (var i = 2; i < half; i += 2) {
		    spectrum[size - i] = spectrum[i];
		    spectrum[size - i + 1] = -spectrum[i + 1];
		  }
		};

		FFT.prototype.transform = function transform(out, data) {
		  if (out === data)
		    throw new Error('Input and output buffers must be different');

		  this._out = out;
		  this._data = data;
		  this._inv = 0;
		  this._transform4();
		  this._out = null;
		  this._data = null;
		};

		FFT.prototype.realTransform = function realTransform(out, data) {
		  if (out === data)
		    throw new Error('Input and output buffers must be different');

		  this._out = out;
		  this._data = data;
		  this._inv = 0;
		  this._realTransform4();
		  this._out = null;
		  this._data = null;
		};

		FFT.prototype.inverseTransform = function inverseTransform(out, data) {
		  if (out === data)
		    throw new Error('Input and output buffers must be different');

		  this._out = out;
		  this._data = data;
		  this._inv = 1;
		  this._transform4();
		  for (var i = 0; i < out.length; i++)
		    out[i] /= this.size;
		  this._out = null;
		  this._data = null;
		};

		// radix-4 implementation
		//
		// NOTE: Uses of `var` are intentional for older V8 version that do not
		// support both `let compound assignments` and `const phi`
		FFT.prototype._transform4 = function _transform4() {
		  var out = this._out;
		  var size = this._csize;

		  // Initial step (permute and transform)
		  var width = this._width;
		  var step = 1 << width;
		  var len = (size / step) << 1;

		  var outOff;
		  var t;
		  var bitrev = this._bitrev;
		  if (len === 4) {
		    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
		      const off = bitrev[t];
		      this._singleTransform2(outOff, off, step);
		    }
		  } else {
		    // len === 8
		    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
		      const off = bitrev[t];
		      this._singleTransform4(outOff, off, step);
		    }
		  }

		  // Loop through steps in decreasing order
		  var inv = this._inv ? -1 : 1;
		  var table = this.table;
		  for (step >>= 2; step >= 2; step >>= 2) {
		    len = (size / step) << 1;
		    var quarterLen = len >>> 2;

		    // Loop through offsets in the data
		    for (outOff = 0; outOff < size; outOff += len) {
		      // Full case
		      var limit = outOff + quarterLen;
		      for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
		        const A = i;
		        const B = A + quarterLen;
		        const C = B + quarterLen;
		        const D = C + quarterLen;

		        // Original values
		        const Ar = out[A];
		        const Ai = out[A + 1];
		        const Br = out[B];
		        const Bi = out[B + 1];
		        const Cr = out[C];
		        const Ci = out[C + 1];
		        const Dr = out[D];
		        const Di = out[D + 1];

		        // Middle values
		        const MAr = Ar;
		        const MAi = Ai;

		        const tableBr = table[k];
		        const tableBi = inv * table[k + 1];
		        const MBr = Br * tableBr - Bi * tableBi;
		        const MBi = Br * tableBi + Bi * tableBr;

		        const tableCr = table[2 * k];
		        const tableCi = inv * table[2 * k + 1];
		        const MCr = Cr * tableCr - Ci * tableCi;
		        const MCi = Cr * tableCi + Ci * tableCr;

		        const tableDr = table[3 * k];
		        const tableDi = inv * table[3 * k + 1];
		        const MDr = Dr * tableDr - Di * tableDi;
		        const MDi = Dr * tableDi + Di * tableDr;

		        // Pre-Final values
		        const T0r = MAr + MCr;
		        const T0i = MAi + MCi;
		        const T1r = MAr - MCr;
		        const T1i = MAi - MCi;
		        const T2r = MBr + MDr;
		        const T2i = MBi + MDi;
		        const T3r = inv * (MBr - MDr);
		        const T3i = inv * (MBi - MDi);

		        // Final values
		        const FAr = T0r + T2r;
		        const FAi = T0i + T2i;

		        const FCr = T0r - T2r;
		        const FCi = T0i - T2i;

		        const FBr = T1r + T3i;
		        const FBi = T1i - T3r;

		        const FDr = T1r - T3i;
		        const FDi = T1i + T3r;

		        out[A] = FAr;
		        out[A + 1] = FAi;
		        out[B] = FBr;
		        out[B + 1] = FBi;
		        out[C] = FCr;
		        out[C + 1] = FCi;
		        out[D] = FDr;
		        out[D + 1] = FDi;
		      }
		    }
		  }
		};

		// radix-2 implementation
		//
		// NOTE: Only called for len=4
		FFT.prototype._singleTransform2 = function _singleTransform2(outOff, off,
		                                                             step) {
		  const out = this._out;
		  const data = this._data;

		  const evenR = data[off];
		  const evenI = data[off + 1];
		  const oddR = data[off + step];
		  const oddI = data[off + step + 1];

		  const leftR = evenR + oddR;
		  const leftI = evenI + oddI;
		  const rightR = evenR - oddR;
		  const rightI = evenI - oddI;

		  out[outOff] = leftR;
		  out[outOff + 1] = leftI;
		  out[outOff + 2] = rightR;
		  out[outOff + 3] = rightI;
		};

		// radix-4
		//
		// NOTE: Only called for len=8
		FFT.prototype._singleTransform4 = function _singleTransform4(outOff, off,
		                                                             step) {
		  const out = this._out;
		  const data = this._data;
		  const inv = this._inv ? -1 : 1;
		  const step2 = step * 2;
		  const step3 = step * 3;

		  // Original values
		  const Ar = data[off];
		  const Ai = data[off + 1];
		  const Br = data[off + step];
		  const Bi = data[off + step + 1];
		  const Cr = data[off + step2];
		  const Ci = data[off + step2 + 1];
		  const Dr = data[off + step3];
		  const Di = data[off + step3 + 1];

		  // Pre-Final values
		  const T0r = Ar + Cr;
		  const T0i = Ai + Ci;
		  const T1r = Ar - Cr;
		  const T1i = Ai - Ci;
		  const T2r = Br + Dr;
		  const T2i = Bi + Di;
		  const T3r = inv * (Br - Dr);
		  const T3i = inv * (Bi - Di);

		  // Final values
		  const FAr = T0r + T2r;
		  const FAi = T0i + T2i;

		  const FBr = T1r + T3i;
		  const FBi = T1i - T3r;

		  const FCr = T0r - T2r;
		  const FCi = T0i - T2i;

		  const FDr = T1r - T3i;
		  const FDi = T1i + T3r;

		  out[outOff] = FAr;
		  out[outOff + 1] = FAi;
		  out[outOff + 2] = FBr;
		  out[outOff + 3] = FBi;
		  out[outOff + 4] = FCr;
		  out[outOff + 5] = FCi;
		  out[outOff + 6] = FDr;
		  out[outOff + 7] = FDi;
		};

		// Real input radix-4 implementation
		FFT.prototype._realTransform4 = function _realTransform4() {
		  var out = this._out;
		  var size = this._csize;

		  // Initial step (permute and transform)
		  var width = this._width;
		  var step = 1 << width;
		  var len = (size / step) << 1;

		  var outOff;
		  var t;
		  var bitrev = this._bitrev;
		  if (len === 4) {
		    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
		      const off = bitrev[t];
		      this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
		    }
		  } else {
		    // len === 8
		    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
		      const off = bitrev[t];
		      this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
		    }
		  }

		  // Loop through steps in decreasing order
		  var inv = this._inv ? -1 : 1;
		  var table = this.table;
		  for (step >>= 2; step >= 2; step >>= 2) {
		    len = (size / step) << 1;
		    var halfLen = len >>> 1;
		    var quarterLen = halfLen >>> 1;
		    var hquarterLen = quarterLen >>> 1;

		    // Loop through offsets in the data
		    for (outOff = 0; outOff < size; outOff += len) {
		      for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
		        var A = outOff + i;
		        var B = A + quarterLen;
		        var C = B + quarterLen;
		        var D = C + quarterLen;

		        // Original values
		        var Ar = out[A];
		        var Ai = out[A + 1];
		        var Br = out[B];
		        var Bi = out[B + 1];
		        var Cr = out[C];
		        var Ci = out[C + 1];
		        var Dr = out[D];
		        var Di = out[D + 1];

		        // Middle values
		        var MAr = Ar;
		        var MAi = Ai;

		        var tableBr = table[k];
		        var tableBi = inv * table[k + 1];
		        var MBr = Br * tableBr - Bi * tableBi;
		        var MBi = Br * tableBi + Bi * tableBr;

		        var tableCr = table[2 * k];
		        var tableCi = inv * table[2 * k + 1];
		        var MCr = Cr * tableCr - Ci * tableCi;
		        var MCi = Cr * tableCi + Ci * tableCr;

		        var tableDr = table[3 * k];
		        var tableDi = inv * table[3 * k + 1];
		        var MDr = Dr * tableDr - Di * tableDi;
		        var MDi = Dr * tableDi + Di * tableDr;

		        // Pre-Final values
		        var T0r = MAr + MCr;
		        var T0i = MAi + MCi;
		        var T1r = MAr - MCr;
		        var T1i = MAi - MCi;
		        var T2r = MBr + MDr;
		        var T2i = MBi + MDi;
		        var T3r = inv * (MBr - MDr);
		        var T3i = inv * (MBi - MDi);

		        // Final values
		        var FAr = T0r + T2r;
		        var FAi = T0i + T2i;

		        var FBr = T1r + T3i;
		        var FBi = T1i - T3r;

		        out[A] = FAr;
		        out[A + 1] = FAi;
		        out[B] = FBr;
		        out[B + 1] = FBi;

		        // Output final middle point
		        if (i === 0) {
		          var FCr = T0r - T2r;
		          var FCi = T0i - T2i;
		          out[C] = FCr;
		          out[C + 1] = FCi;
		          continue;
		        }

		        // Do not overwrite ourselves
		        if (i === hquarterLen)
		          continue;

		        // In the flipped case:
		        // MAi = -MAi
		        // MBr=-MBi, MBi=-MBr
		        // MCr=-MCr
		        // MDr=MDi, MDi=MDr
		        var ST0r = T1r;
		        var ST0i = -T1i;
		        var ST1r = T0r;
		        var ST1i = -T0i;
		        var ST2r = -inv * T3i;
		        var ST2i = -inv * T3r;
		        var ST3r = -inv * T2i;
		        var ST3i = -inv * T2r;

		        var SFAr = ST0r + ST2r;
		        var SFAi = ST0i + ST2i;

		        var SFBr = ST1r + ST3i;
		        var SFBi = ST1i - ST3r;

		        var SA = outOff + quarterLen - i;
		        var SB = outOff + halfLen - i;

		        out[SA] = SFAr;
		        out[SA + 1] = SFAi;
		        out[SB] = SFBr;
		        out[SB + 1] = SFBi;
		      }
		    }
		  }
		};

		// radix-2 implementation
		//
		// NOTE: Only called for len=4
		FFT.prototype._singleRealTransform2 = function _singleRealTransform2(outOff,
		                                                                     off,
		                                                                     step) {
		  const out = this._out;
		  const data = this._data;

		  const evenR = data[off];
		  const oddR = data[off + step];

		  const leftR = evenR + oddR;
		  const rightR = evenR - oddR;

		  out[outOff] = leftR;
		  out[outOff + 1] = 0;
		  out[outOff + 2] = rightR;
		  out[outOff + 3] = 0;
		};

		// radix-4
		//
		// NOTE: Only called for len=8
		FFT.prototype._singleRealTransform4 = function _singleRealTransform4(outOff,
		                                                                     off,
		                                                                     step) {
		  const out = this._out;
		  const data = this._data;
		  const inv = this._inv ? -1 : 1;
		  const step2 = step * 2;
		  const step3 = step * 3;

		  // Original values
		  const Ar = data[off];
		  const Br = data[off + step];
		  const Cr = data[off + step2];
		  const Dr = data[off + step3];

		  // Pre-Final values
		  const T0r = Ar + Cr;
		  const T1r = Ar - Cr;
		  const T2r = Br + Dr;
		  const T3r = inv * (Br - Dr);

		  // Final values
		  const FAr = T0r + T2r;

		  const FBr = T1r;
		  const FBi = -T3r;

		  const FCr = T0r - T2r;

		  const FDr = T1r;
		  const FDi = T3r;

		  out[outOff] = FAr;
		  out[outOff + 1] = 0;
		  out[outOff + 2] = FBr;
		  out[outOff + 3] = FBi;
		  out[outOff + 4] = FCr;
		  out[outOff + 5] = 0;
		  out[outOff + 6] = FDr;
		  out[outOff + 7] = FDi;
		};
		return fft;
	}

	var fftExports = requireFft();
	var FFT = /*@__PURE__*/getDefaultExportFromCjs(fftExports);

	const WEBAUDIO_BLOCK_SIZE = 128;
	const DEFAULT_BLOCK_SIZE = 1024; // Default block size if not provided in options
	/** Overlap-Add Node */
	class OLAProcessor extends AudioWorkletProcessor {
	    nbInputs;
	    nbOutputs;
	    blockSize;
	    hopSize;
	    nbOverlaps;
	    inputBuffers = [];
	    inputBuffersHead = [];
	    inputBuffersToSend = [];
	    outputBuffers = [];
	    outputBuffersToRetrieve = [];
	    constructor(options) {
	        super(options);
	        this.nbInputs = options?.numberOfInputs || 1;
	        this.nbOutputs = options?.numberOfOutputs || 1;
	        // processorOptions is typed `unknown` at the ambient boundary; narrow here.
	        const procOpts = (options?.processorOptions ?? {});
	        this.blockSize = procOpts.blockSize || DEFAULT_BLOCK_SIZE;
	        this.hopSize = WEBAUDIO_BLOCK_SIZE;
	        this.nbOverlaps = Math.floor(this.blockSize / this.hopSize);
	        this.initializeBuffers();
	    }
	    initializeBuffers() {
	        this.inputBuffers = new Array(this.nbInputs);
	        this.inputBuffersHead = new Array(this.nbInputs);
	        this.inputBuffersToSend = new Array(this.nbInputs);
	        this.outputBuffers = new Array(this.nbOutputs);
	        this.outputBuffersToRetrieve = new Array(this.nbOutputs);
	        for (let i = 0; i < this.nbInputs; i++) {
	            this.allocateInputChannels(i, 1);
	        }
	        for (let i = 0; i < this.nbOutputs; i++) {
	            this.allocateOutputChannels(i, 1);
	        }
	    }
	    allocateInputChannels(inputIndex, nbChannels) {
	        this.inputBuffers[inputIndex] = new Array(nbChannels);
	        this.inputBuffersHead[inputIndex] = new Array(nbChannels);
	        this.inputBuffersToSend[inputIndex] = new Array(nbChannels);
	        for (let i = 0; i < nbChannels; i++) {
	            this.inputBuffers[inputIndex][i] = new Float32Array(this.blockSize + WEBAUDIO_BLOCK_SIZE);
	            this.inputBuffers[inputIndex][i].fill(0);
	            this.inputBuffersHead[inputIndex][i] = this.inputBuffers[inputIndex][i].subarray(0, this.blockSize);
	            this.inputBuffersToSend[inputIndex][i] = new Float32Array(this.blockSize);
	        }
	    }
	    allocateOutputChannels(outputIndex, nbChannels) {
	        this.outputBuffers[outputIndex] = new Array(nbChannels);
	        this.outputBuffersToRetrieve[outputIndex] = new Array(nbChannels);
	        for (let i = 0; i < nbChannels; i++) {
	            this.outputBuffers[outputIndex][i] = new Float32Array(this.blockSize);
	            this.outputBuffers[outputIndex][i].fill(0);
	            this.outputBuffersToRetrieve[outputIndex][i] = new Float32Array(this.blockSize);
	        }
	    }
	    reallocateChannelsIfNeeded(inputs, outputs) {
	        for (let i = 0; i < this.nbInputs; i++) {
	            const nbChannels = inputs[i].length;
	            if (nbChannels !== this.inputBuffers[i].length) {
	                this.allocateInputChannels(i, nbChannels);
	            }
	        }
	        for (let i = 0; i < this.nbOutputs; i++) {
	            const nbChannels = outputs[i].length;
	            if (nbChannels !== this.outputBuffers[i].length) {
	                this.allocateOutputChannels(i, nbChannels);
	            }
	        }
	    }
	    readInputs(inputs) {
	        for (let i = 0; i < this.nbInputs; i++) {
	            for (let j = 0; j < this.inputBuffers[i].length; j++) {
	                const webAudioBlock = inputs[i][j];
	                this.inputBuffers[i][j].set(webAudioBlock, this.blockSize);
	            }
	        }
	    }
	    writeOutputs(outputs) {
	        for (let i = 0; i < this.nbOutputs; i++) {
	            for (let j = 0; j < this.outputBuffers[i].length; j++) {
	                const webAudioBlock = outputs[i][j];
	                webAudioBlock.set(this.outputBuffers[i][j].subarray(0, WEBAUDIO_BLOCK_SIZE));
	            }
	        }
	    }
	    shiftInputBuffers() {
	        for (let i = 0; i < this.nbInputs; i++) {
	            for (let j = 0; j < this.inputBuffers[i].length; j++) {
	                this.inputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
	            }
	        }
	    }
	    shiftOutputBuffers() {
	        for (let i = 0; i < this.nbOutputs; i++) {
	            for (let j = 0; j < this.outputBuffers[i].length; j++) {
	                this.outputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
	                this.outputBuffers[i][j].fill(0, this.blockSize - WEBAUDIO_BLOCK_SIZE);
	            }
	        }
	    }
	    prepareInputBuffersToSend() {
	        for (let i = 0; i < this.nbInputs; i++) {
	            for (let j = 0; j < this.inputBuffers[i].length; j++) {
	                this.inputBuffersToSend[i][j].set(this.inputBuffersHead[i][j]);
	            }
	        }
	    }
	    handleOutputBuffersToRetrieve() {
	        for (let i = 0; i < this.nbOutputs; i++) {
	            for (let j = 0; j < this.outputBuffers[i].length; j++) {
	                for (let k = 0; k < this.blockSize; k++) {
	                    this.outputBuffers[i][j][k] += this.outputBuffersToRetrieve[i][j][k] / this.nbOverlaps;
	                }
	            }
	        }
	    }
	    process(inputs, outputs, parameters) {
	        this.reallocateChannelsIfNeeded(inputs, outputs);
	        this.readInputs(inputs);
	        this.shiftInputBuffers();
	        this.prepareInputBuffersToSend();
	        this.processOLA(this.inputBuffersToSend, this.outputBuffersToRetrieve, parameters);
	        this.handleOutputBuffersToRetrieve();
	        this.writeOutputs(outputs);
	        this.shiftOutputBuffers();
	        return true;
	    }
	}

	/*
	 * Phase-vocoder core — context-free, unit-testable DSP for peak-based
	 * pitch-shifting with Identity Phase-Locking.
	 *
	 * Algorithm: Jean Laroche & Mark Dolson, "New Phase-Vocoder Techniques for
	 * Pitch-Shifting, Harmonizing and Other Exotic Effects", Proc. 1999 IEEE
	 * WASPAA, New Paltz, NY. The pitch-shift detects spectral peaks, divides the
	 * frequency axis into per-peak "regions of influence", and rigidly translates
	 * each region to the peak's shifted frequency (Section 3.1-3.4).
	 *
	 * The phase handling is the "Identity Phase-Locking" rule of Laroche-Dolson
	 * 1999 Section 3.5: to maintain frame-to-frame (horizontal) phase coherence
	 * after shifting a peak by Delta-omega, EVERY frequency bin in that peak's
	 * region of influence is multiplied by a SINGLE complex number
	 *
	 *     Z_u = exp(j * Delta-omega * R)            (Laroche-Dolson 1999, eq. p.3)
	 *
	 * (R = hop size), and the rotation is cumulated frame to frame
	 *
	 *     Z_{u+1} = Z_u * exp(j * Delta-omega_{u+1} * R).
	 *
	 * Because all bins in a region are rotated by the SAME angle, the phase
	 * relationships BETWEEN bins around a peak (the vertical / intra-peak
	 * coherence that identifies the sinusoid) are PRESERVED across the move — this
	 * is exactly what removes the "phasiness" artifact of the naive bin-independent
	 * phase vocoder. No knowledge of the true peak frequency omega is needed, so no
	 * arctangent and no phase-unwrapping (Laroche-Dolson 1999 Section 3.5).
	 *
	 * This module mirrors the project's core/shell split (cf. waveshaper-core.ts,
	 * dynamics-core.ts): the FFT framing and worklet plumbing live in the
	 * AudioWorkletProcessor shell (phase-vocoder.ts); the spectrum manipulation
	 * that carries the testable invariants lives here.
	 */
	/**
	 * Squared-magnitude spectrum from an interleaved [re, im, re, im, ...] complex
	 * buffer. `magnitudes[i]` corresponds to bin `i`. Writes into `out` (length
	 * fftSize/2 + 1) to avoid per-call allocation in the worklet.
	 */
	function computeMagnitudes(complex, out) {
	    for (let i = 0, j = 0; i < out.length; i++, j += 2) {
	        const real = complex[j];
	        const imag = complex[j + 1];
	        out[i] = real ** 2 + imag ** 2;
	    }
	}
	/**
	 * Peak detection per Laroche-Dolson 1999 Section 3.2: a bin is a peak iff its
	 * magnitude strictly exceeds its two nearest neighbours on each side. Writes
	 * the peak bin indices into `peakIndexes` and returns the count.
	 */
	function findPeaks(magnitudes, peakIndexes) {
	    let nbPeaks = 0;
	    for (let i = 2, end = magnitudes.length - 2; i < end; i++) {
	        const mag = magnitudes[i];
	        if (magnitudes[i - 1] >= mag || magnitudes[i - 2] >= mag || magnitudes[i + 1] >= mag || magnitudes[i + 2] >= mag) {
	            continue;
	        }
	        peakIndexes[nbPeaks++] = i;
	    }
	    return nbPeaks;
	}
	/**
	 * The per-frame phase increment exp(j * Delta-omega * R) for ONE peak shifted
	 * by Delta-omega over a hop of R synthesis samples. Laroche-Dolson 1999 eq.
	 * p.3 (Section 3.5), the single complex number applied uniformly to the peak's
	 * whole region of influence.
	 *
	 * Delta-omega (rad/sample) is the frequency shift the peak undergoes:
	 *   Delta-omega = 2*pi * (peakIndexShifted - peakIndex) / fftSize.
	 *
	 * This is the per-frame factor, NOT the cumulative rotator. Cross-frame
	 * cumulation Z_{u+1} = Z_u * exp(j*Delta-omega_{u+1}*R) is the job of
	 * {@link PeakRotatorState}; this function produces the `exp(...)` factor that
	 * state multiplies in each frame.
	 */
	function frameRotation(peakIndex, peakIndexShifted, fftSize, hop) {
	    const omegaDelta = (2 * Math.PI * (peakIndexShifted - peakIndex)) / fftSize;
	    const angle = omegaDelta * hop;
	    return { re: Math.cos(angle), im: Math.sin(angle) };
	}
	/**
	 * Cross-frame cumulative phase-lock state (Laroche-Dolson 1999 Section 3.5).
	 *
	 * The paper requires the per-peak rotation be ACCUMULATED frame to frame:
	 *
	 *     Z_{u+1} = Z_u * exp(j * Delta-omega_{u+1} * R)
	 *
	 * with Delta-omega allowed to vary per frame (automated / time-varying pitch).
	 * A naive `omegaDelta * elapsedTime` rotator is wrong: when the shift changes,
	 * it retroactively re-phases every prior frame and produces a discontinuity.
	 *
	 * This state keeps one cumulative rotator Z_u PER PEAK, keyed by the peak's
	 * source bin index. {@link PeakRotatorState.advance} multiplies each peak's Z
	 * by this frame's exp(j*Delta-omega*R) (so history is preserved across pitch
	 * changes), and {@link PeakRotatorState.get} returns the current cumulative
	 * rotator to apply to that peak's region of influence.
	 */
	class PeakRotatorState {
	    /** peak source-bin index -> cumulative rotator Z_u (unit modulus). */
	    rotators = new Map();
	    /** scratch set of bins seen this frame, for pruning vanished peaks. */
	    seen = new Set();
	    /**
	     * Advance every currently-detected peak's cumulative rotator by this frame's
	     * exp(j*Delta-omega*R). New peaks start at Z = 1 (no rotation) then take this
	     * frame's increment; peaks not present this frame are dropped so their stale
	     * phase does not leak into a later re-detection.
	     *
	     * `pitchFactor` and `hop` define this frame's per-peak Delta-omega via the
	     * shifted bin `round(peakIndex * pitchFactor)`.
	     */
	    advance(peakIndexes, nbPeaks, fftSize, pitchFactor, hop) {
	        this.seen.clear();
	        for (let i = 0; i < nbPeaks; i++) {
	            const peakIndex = peakIndexes[i];
	            this.seen.add(peakIndex);
	            const peakIndexShifted = Math.round(peakIndex * pitchFactor);
	            const inc = frameRotation(peakIndex, peakIndexShifted, fftSize, hop);
	            const prev = this.rotators.get(peakIndex) ?? { re: 1, im: 0 };
	            // Z_{u+1} = Z_u * inc  (complex multiply)
	            this.rotators.set(peakIndex, {
	                re: prev.re * inc.re - prev.im * inc.im,
	                im: prev.re * inc.im + prev.im * inc.re,
	            });
	        }
	        // Prune peaks that disappeared this frame.
	        for (const key of this.rotators.keys()) {
	            if (!this.seen.has(key))
	                this.rotators.delete(key);
	        }
	    }
	    /** The current cumulative rotator Z_u for a peak (identity if unseen). */
	    get(peakIndex) {
	        return this.rotators.get(peakIndex) ?? { re: 1, im: 0 };
	    }
	    /** Reset all accumulated phase (e.g. on stop / re-seek). */
	    reset() {
	        this.rotators.clear();
	        this.seen.clear();
	    }
	    /** Number of peaks currently tracked (test/introspection helper). */
	    get size() {
	        return this.rotators.size;
	    }
	}
	/**
	 * Half-way region-of-influence boundaries for peak `i` (Laroche-Dolson 1999
	 * Section 3.2 — boundary set midway between adjacent peaks). Returns the
	 * [startIndex, endIndex) bin range owned by this peak.
	 *
	 * The LAST peak's region must end at the non-redundant half-spectrum length
	 * `magnitudesLength` (= fftSize/2 + 1), NOT at `fftSize`. The analysed spectrum
	 * only carries bins [0, fftSize/2]; the upper half is the conjugate-symmetric
	 * mirror filled later by `completeSpectrum`. Reading source bins past Nyquist
	 * folds stale / not-yet-populated negative-frequency data into the output, so
	 * the region is clamped to the analysed positive spectrum.
	 */
	function regionOfInfluence(peakIndexes, i, nbPeaks, magnitudesLength) {
	    const peakIndex = peakIndexes[i];
	    const startIndex = i > 0 ? peakIndex - Math.floor((peakIndex - peakIndexes[i - 1]) / 2) : 0;
	    const endIndex = i < nbPeaks - 1 ? peakIndex + Math.ceil((peakIndexes[i + 1] - peakIndex) / 2) : magnitudesLength;
	    return { startIndex, endIndex };
	}
	/**
	 * Peak-shift with Identity Phase-Locking (Laroche-Dolson 1999, Sections 3.4 &
	 * 3.5). For each detected peak:
	 *  - compute the shifted peak bin (peakIndex * pitchFactor, rounded — the
	 *    integer-bin case of Section 3.4, a lossless region copy),
	 *  - compute ONE rotator Z_u = exp(j*Delta-omega*timeCursor) for the peak
	 *    (`peakRotator`),
	 *  - rigidly translate the peak's region of influence to the shifted location,
	 *    multiplying EVERY bin in the region by that SAME Z_u.
	 * Overlapping shifted regions are summed (Section 3.4).
	 *
	 * `complex` is the analysis spectrum (interleaved re/im). `shifted` is the
	 * output spectrum (interleaved re/im) and is zero-filled here before
	 * accumulation. `magnitudesLength` = fftSize/2 + 1 (the non-redundant bin
	 * count); bins beyond it are skipped / terminate the peak loop, matching the
	 * worklet's pre-`completeSpectrum` half-spectrum.
	 */
	function shiftPeaks(complex, shifted, peakIndexes, nbPeaks, fftSize, magnitudesLength, pitchFactor, rotators) {
	    shifted.fill(0);
	    for (let i = 0; i < nbPeaks; i++) {
	        const peakIndex = peakIndexes[i];
	        const peakIndexShifted = Math.round(peakIndex * pitchFactor);
	        const { startIndex, endIndex } = regionOfInfluence(peakIndexes, i, nbPeaks, magnitudesLength);
	        // Laroche-Dolson 1999 Identity Phase-Locking: ONE cumulative rotator Z_u
	        // per peak, applied uniformly to the whole region of influence (one complex
	        // multiply per bin), preserving the intra-region phase relationships. Z_u
	        // is accumulated frame-to-frame by PeakRotatorState — not recomputed from
	        // absolute time — so a changing pitchFactor does not retroactively rephase.
	        const rot = rotators.get(peakIndex);
	        for (let j = startIndex - peakIndex; j < endIndex - peakIndex; j++) {
	            const binIndex = peakIndex + j;
	            const binIndexShifted = peakIndexShifted + j;
	            if (binIndexShifted >= magnitudesLength) {
	                break;
	            }
	            // Source bins are only valid inside the analysed positive spectrum.
	            if (binIndex < 0 || binIndex >= magnitudesLength) {
	                continue;
	            }
	            const indexReal = binIndex * 2;
	            const indexImag = indexReal + 1;
	            const valueReal = complex[indexReal];
	            const valueImag = complex[indexImag];
	            // Complex multiply by the single per-peak cumulative rotator Z_u.
	            const valueShiftedReal = valueReal * rot.re - valueImag * rot.im;
	            const valueShiftedImag = valueReal * rot.im + valueImag * rot.re;
	            if (binIndexShifted < 0) {
	                // Laroche-Dolson 1999 Section 3.4: a region of influence spilling onto
	                // the NEGATIVE-frequency axis is reflected back into the positive
	                // frequencies with COMPLEX CONJUGATION, because the original signal is
	                // real (Hermitian symmetry X(-w) = conj(X(w))). Without this the energy
	                // below DC is dropped and downward shifts lose their low end.
	                const reflected = -binIndexShifted;
	                if (reflected >= magnitudesLength) {
	                    continue;
	                }
	                const reflReal = reflected * 2;
	                const reflImag = reflReal + 1;
	                shifted[reflReal] += valueShiftedReal;
	                shifted[reflImag] += -valueShiftedImag; // conjugate
	                continue;
	            }
	            const indexShiftedReal = binIndexShifted * 2;
	            const indexShiftedImag = indexShiftedReal + 1;
	            shifted[indexShiftedReal] += valueShiftedReal;
	            shifted[indexShiftedImag] += valueShiftedImag;
	        }
	    }
	}

	const BLOCK_SIZE = 2048;
	function hann(length) {
	    const out = new Float32Array(length);
	    for (let i = 0; i < length; i++)
	        out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
	    return out;
	}
	/** Two added voices in one Laroche-Dolson STFT analysis pass. */
	class HarmonizerWorkletProcessor extends OLAProcessor {
	    fft;
	    window;
	    sourceSpectrum;
	    voiceASpectrum;
	    voiceBSpectrum;
	    outputSpectrum;
	    timeComplex;
	    magnitudes;
	    peaks;
	    voiceAStates = [];
	    voiceBStates = [];
	    static get parameterDescriptors() {
	        return [
	            { name: "semitonesA", defaultValue: 7, minValue: -36, maxValue: 36, automationRate: "k-rate" },
	            { name: "semitonesB", defaultValue: 12, minValue: -36, maxValue: 36, automationRate: "k-rate" },
	            { name: "gainA", defaultValue: 0.6, minValue: 0, maxValue: 2, automationRate: "k-rate" },
	            { name: "gainB", defaultValue: 0.45, minValue: 0, maxValue: 2, automationRate: "k-rate" },
	            { name: "dry", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
	        ];
	    }
	    constructor(options) {
	        const workletOptions = options ?? {};
	        workletOptions.processorOptions = { blockSize: BLOCK_SIZE, ...(workletOptions.processorOptions ?? {}) };
	        super(workletOptions);
	        this.fft = new FFT(this.blockSize);
	        this.window = hann(this.blockSize);
	        this.sourceSpectrum = this.fft.createComplexArray();
	        this.voiceASpectrum = this.fft.createComplexArray();
	        this.voiceBSpectrum = this.fft.createComplexArray();
	        this.outputSpectrum = this.fft.createComplexArray();
	        this.timeComplex = this.fft.createComplexArray();
	        this.magnitudes = new Float32Array(this.blockSize / 2 + 1);
	        this.peaks = new Int32Array(this.magnitudes.length);
	    }
	    processOLA(inputs, outputs, parameters) {
	        const factorA = 2 ** (parameters.semitonesA[parameters.semitonesA.length - 1] / 12);
	        const factorB = 2 ** (parameters.semitonesB[parameters.semitonesB.length - 1] / 12);
	        const gainA = parameters.gainA[parameters.gainA.length - 1];
	        const gainB = parameters.gainB[parameters.gainB.length - 1];
	        const dry = parameters.dry[parameters.dry.length - 1];
	        const norm = 1 / Math.max(1, dry + gainA + gainB);
	        for (let channel = 0; channel < inputs[0].length; channel++) {
	            const input = inputs[0][channel];
	            const output = outputs[0][channel];
	            for (let i = 0; i < input.length; i++)
	                input[i] *= this.window[i];
	            this.fft.realTransform(this.sourceSpectrum, input);
	            computeMagnitudes(this.sourceSpectrum, this.magnitudes);
	            const peakCount = findPeaks(this.magnitudes, this.peaks);
	            const stateA = (this.voiceAStates[channel] ??= new PeakRotatorState());
	            const stateB = (this.voiceBStates[channel] ??= new PeakRotatorState());
	            stateA.advance(this.peaks, peakCount, this.blockSize, factorA, this.hopSize);
	            stateB.advance(this.peaks, peakCount, this.blockSize, factorB, this.hopSize);
	            shiftPeaks(this.sourceSpectrum, this.voiceASpectrum, this.peaks, peakCount, this.blockSize, this.magnitudes.length, factorA, stateA);
	            shiftPeaks(this.sourceSpectrum, this.voiceBSpectrum, this.peaks, peakCount, this.blockSize, this.magnitudes.length, factorB, stateB);
	            this.outputSpectrum.fill(0);
	            for (let bin = 0; bin < this.magnitudes.length; bin++) {
	                const i = bin * 2;
	                this.outputSpectrum[i] =
	                    (dry * this.sourceSpectrum[i] + gainA * this.voiceASpectrum[i] + gainB * this.voiceBSpectrum[i]) * norm;
	                this.outputSpectrum[i + 1] =
	                    (dry * this.sourceSpectrum[i + 1] + gainA * this.voiceASpectrum[i + 1] + gainB * this.voiceBSpectrum[i + 1]) *
	                        norm;
	            }
	            this.fft.completeSpectrum(this.outputSpectrum);
	            this.fft.inverseTransform(this.timeComplex, this.outputSpectrum);
	            this.fft.fromComplexArray(this.timeComplex, output);
	            for (let i = 0; i < output.length; i++)
	                output[i] *= this.window[i];
	        }
	    }
	}
	registerProcessor("harmonizer", HarmonizerWorkletProcessor);

	exports.HarmonizerWorkletProcessor = HarmonizerWorkletProcessor;

	return exports;

})({});
//# sourceMappingURL=harmonizer-bundle.js.map
