var spectralFreeze = (function (exports) {
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

	const wrapPhase = (phase) => Math.atan2(Math.sin(phase), Math.cos(phase));
	/** Stateful spectral-frame freezer with phase continuation and 3-frame magnitude smear. */
	class SpectralFreezeState {
	    binCount;
	    fftSize;
	    hopSize;
	    previous;
	    heldMagnitude;
	    heldPhase;
	    phaseStep;
	    magnitudeHistory;
	    historyIndex = 0;
	    historyCount = 0;
	    wasFrozen = false;
	    hasPrevious = false;
	    constructor(binCount, fftSize, hopSize) {
	        this.binCount = binCount;
	        this.fftSize = fftSize;
	        this.hopSize = hopSize;
	        this.previous = new Float32Array(fftSize * 2);
	        this.heldMagnitude = new Float32Array(binCount);
	        this.heldPhase = new Float64Array(binCount);
	        this.phaseStep = new Float64Array(binCount);
	        this.magnitudeHistory = Array.from({ length: 3 }, () => new Float32Array(binCount));
	    }
	    process(input, output, frozen, smear, mix) {
	        const currentMagnitudes = this.magnitudeHistory[this.historyIndex];
	        for (let bin = 0; bin < this.binCount; bin++) {
	            const i = bin * 2;
	            currentMagnitudes[bin] = Math.hypot(input[i], input[i + 1]);
	        }
	        this.historyIndex = (this.historyIndex + 1) % this.magnitudeHistory.length;
	        this.historyCount = Math.min(this.magnitudeHistory.length, this.historyCount + 1);
	        if (frozen && !this.wasFrozen) {
	            const smearAmount = Math.max(0, Math.min(1, smear));
	            for (let bin = 0; bin < this.binCount; bin++) {
	                const i = bin * 2;
	                let average = 0;
	                for (let h = 0; h < this.historyCount; h++)
	                    average += this.magnitudeHistory[h][bin];
	                average /= this.historyCount;
	                this.heldMagnitude[bin] = currentMagnitudes[bin] * (1 - smearAmount) + average * smearAmount;
	                this.heldPhase[bin] = Math.atan2(input[i + 1], input[i]);
	                if (this.hasPrevious) {
	                    const crossReal = input[i] * this.previous[i] + input[i + 1] * this.previous[i + 1];
	                    const crossImag = input[i + 1] * this.previous[i] - input[i] * this.previous[i + 1];
	                    this.phaseStep[bin] = Math.atan2(crossImag, crossReal);
	                }
	                else {
	                    this.phaseStep[bin] = (2 * Math.PI * bin * this.hopSize) / this.fftSize;
	                }
	            }
	        }
	        const wet = Math.max(0, Math.min(1, mix));
	        if (frozen) {
	            for (let bin = 0; bin < this.binCount; bin++) {
	                if (this.wasFrozen)
	                    this.heldPhase[bin] = wrapPhase(this.heldPhase[bin] + this.phaseStep[bin]);
	                const i = bin * 2;
	                const heldReal = this.heldMagnitude[bin] * Math.cos(this.heldPhase[bin]);
	                const heldImag = this.heldMagnitude[bin] * Math.sin(this.heldPhase[bin]);
	                output[i] = input[i] * (1 - wet) + heldReal * wet;
	                output[i + 1] = input[i + 1] * (1 - wet) + heldImag * wet;
	            }
	        }
	        else {
	            output.set(input);
	        }
	        this.previous.set(input);
	        this.hasPrevious = true;
	        this.wasFrozen = frozen;
	    }
	}

	const BLOCK_SIZE = 2048;
	class SpectralFreezeWorkletProcessor extends OLAProcessor {
	    fft;
	    window;
	    inputSpectrum;
	    outputSpectrum;
	    timeComplex;
	    states = [];
	    static get parameterDescriptors() {
	        return [
	            { name: "freeze", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
	            { name: "smear", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
	            { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
	        ];
	    }
	    constructor(options) {
	        const workletOptions = options ?? {};
	        workletOptions.processorOptions = { blockSize: BLOCK_SIZE, ...(workletOptions.processorOptions ?? {}) };
	        super(workletOptions);
	        this.fft = new FFT(this.blockSize);
	        this.window = new Float32Array(this.blockSize);
	        for (let i = 0; i < this.blockSize; i++)
	            this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.blockSize));
	        this.inputSpectrum = this.fft.createComplexArray();
	        this.outputSpectrum = this.fft.createComplexArray();
	        this.timeComplex = this.fft.createComplexArray();
	    }
	    processOLA(inputs, outputs, parameters) {
	        const frozen = parameters.freeze[parameters.freeze.length - 1] >= 0.5;
	        const smear = parameters.smear[parameters.smear.length - 1];
	        const mix = parameters.mix[parameters.mix.length - 1];
	        const bins = this.blockSize / 2 + 1;
	        for (let channel = 0; channel < inputs[0].length; channel++) {
	            const input = inputs[0][channel];
	            const output = outputs[0][channel];
	            for (let i = 0; i < input.length; i++)
	                input[i] *= this.window[i];
	            this.fft.realTransform(this.inputSpectrum, input);
	            const state = (this.states[channel] ??= new SpectralFreezeState(bins, this.blockSize, this.hopSize));
	            state.process(this.inputSpectrum, this.outputSpectrum, frozen, smear, mix);
	            this.fft.completeSpectrum(this.outputSpectrum);
	            this.fft.inverseTransform(this.timeComplex, this.outputSpectrum);
	            this.fft.fromComplexArray(this.timeComplex, output);
	            for (let i = 0; i < output.length; i++)
	                output[i] *= this.window[i];
	        }
	    }
	}
	registerProcessor("spectral-freeze", SpectralFreezeWorkletProcessor);

	exports.SpectralFreezeWorkletProcessor = SpectralFreezeWorkletProcessor;

	return exports;

})({});
//# sourceMappingURL=spectral-freeze-bundle.js.map
