const WEBAUDIO_BLOCK_SIZE = 128;
const DEFAULT_BLOCK_SIZE = 1024; // Default block size if not provided in options

/** Overlap-Add Node */
export default abstract class OLAProcessor extends AudioWorkletProcessor {
    nbInputs: number;
    nbOutputs: number;
    blockSize: number;
    hopSize: number;
    nbOverlaps: number;
    inputBuffers: Float32Array[][] = [];
    inputBuffersHead: Float32Array[][] = [];
    inputBuffersToSend: Float32Array[][] = [];
    outputBuffers: Float32Array[][] = [];
    outputBuffersToRetrieve: Float32Array[][] = [];

    constructor(options: AudioWorkletNodeOptions) {
        super(options);
        this.nbInputs = options.numberOfInputs || 1;
        this.nbOutputs = options.numberOfOutputs || 1;
        this.blockSize = options.processorOptions.blockSize || DEFAULT_BLOCK_SIZE;
        this.hopSize = WEBAUDIO_BLOCK_SIZE;
        this.nbOverlaps = Math.floor(this.blockSize / this.hopSize);

        this.initializeBuffers();
    }

    private initializeBuffers() {
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

    private allocateInputChannels(inputIndex: number, nbChannels: number) {
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

    private allocateOutputChannels(outputIndex: number, nbChannels: number) {
        this.outputBuffers[outputIndex] = new Array(nbChannels);
        this.outputBuffersToRetrieve[outputIndex] = new Array(nbChannels);

        for (let i = 0; i < nbChannels; i++) {
            this.outputBuffers[outputIndex][i] = new Float32Array(this.blockSize);
            this.outputBuffers[outputIndex][i].fill(0);
            this.outputBuffersToRetrieve[outputIndex][i] = new Float32Array(this.blockSize);
        }
    }

    private reallocateChannelsIfNeeded(inputs: Float32Array[][], outputs: Float32Array[][]) {
        for (let i = 0; i < this.nbInputs; i++) {
            let nbChannels = inputs[i].length;
            if (nbChannels !== this.inputBuffers[i].length) {
                this.allocateInputChannels(i, nbChannels);
            }
        }

        for (let i = 0; i < this.nbOutputs; i++) {
            let nbChannels = outputs[i].length;
            if (nbChannels !== this.outputBuffers[i].length) {
                this.allocateOutputChannels(i, nbChannels);
            }
        }
    }

    private readInputs(inputs: Float32Array[][]) {
        for (let i = 0; i < this.nbInputs; i++) {
            for (let j = 0; j < this.inputBuffers[i].length; j++) {
                let webAudioBlock = inputs[i][j];
                this.inputBuffers[i][j].set(webAudioBlock, this.blockSize);
            }
        }
    }

    private writeOutputs(outputs: Float32Array[][]) {
        for (let i = 0; i < this.nbOutputs; i++) {
            for (let j = 0; j < this.outputBuffers[i].length; j++) {
                let webAudioBlock = outputs[i][j];
                webAudioBlock.set(this.outputBuffers[i][j].subarray(0, WEBAUDIO_BLOCK_SIZE));
            }
        }
    }

    private shiftInputBuffers() {
        for (let i = 0; i < this.nbInputs; i++) {
            for (let j = 0; j < this.inputBuffers[i].length; j++) {
                this.inputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
            }
        }
    }

    private shiftOutputBuffers() {
        for (let i = 0; i < this.nbOutputs; i++) {
            for (let j = 0; j < this.outputBuffers[i].length; j++) {
                this.outputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
                this.outputBuffers[i][j].fill(0, this.blockSize - WEBAUDIO_BLOCK_SIZE);
            }
        }
    }

    private prepareInputBuffersToSend() {
        for (let i = 0; i < this.nbInputs; i++) {
            for (let j = 0; j < this.inputBuffers[i].length; j++) {
                this.inputBuffersToSend[i][j].set(this.inputBuffersHead[i][j]);
            }
        }
    }

    private handleOutputBuffersToRetrieve() {
        for (let i = 0; i < this.nbOutputs; i++) {
            for (let j = 0; j < this.outputBuffers[i].length; j++) {
                for (let k = 0; k < this.blockSize; k++) {
                    this.outputBuffers[i][j][k] += this.outputBuffersToRetrieve[i][j][k] / this.nbOverlaps;
                }
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: AudioParamMap): boolean {
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

    abstract processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: AudioParamMap): void;
}
