import OLAProcessor from './ola';
import FFT from 'fft.js';

const MAX_REVERB_DURATION = 10; // Maximum reverb duration in seconds

function generateImpulseResponse(sampleRate: number, roomSize: number, damping: number, density: number): Float32Array {
    const duration = 0.1 + roomSize * MAX_REVERB_DURATION;
    const length = Math.min(Math.floor(sampleRate * duration), sampleRate * MAX_REVERB_DURATION);
    const impulseResponse = new Float32Array(length);
    
    // Early reflections
    const numReflections = Math.floor(10 + roomSize * 20);
    for (let i = 0; i < numReflections; i++) {
        const time = Math.random() * roomSize * 0.1;
        const index = Math.floor(time * sampleRate);
        if (index < length) {
            impulseResponse[index] += (Math.random() * 2 - 1) * (1 - time / (roomSize * 0.1));
        }
    }
    
    // Late reverb
    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        impulseResponse[i] += (Math.random() * 2 - 1) * Math.exp(-t * damping) * Math.pow(t, density);
    }
    
    // Normalize
    const maxAmplitude = Math.max(...impulseResponse.map(Math.abs));
    if (maxAmplitude > 0) {
        for (let i = 0; i < length; i++) {
            impulseResponse[i] /= maxAmplitude;
        }
    }
    
    return impulseResponse;
}

interface ReverbNodeOptions extends AudioWorkletNodeOptions {
    processorOptions: {
        blockSize: number;
    };
}

class ReverbProcessor extends OLAProcessor {
    private impulseResponse: Float32Array;
    private fft: FFT;
    private fftSize: number;
    private freqComplexBuffer: Float32Array;
    private irFreqComplexBuffer: Float32Array;
    private timeComplexBuffer: Float32Array;
    private lastRoomSize: number;
    private lastDamping: number;
    private lastDensity: number;
    private sampleRate: number;

    static get parameterDescriptors() {
        return [
            { name: 'roomSize', defaultValue: 0.8, minValue: 0, maxValue: 1 },
            { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'density', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'wetDryMix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'preDelay', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'lowCutFreq', defaultValue: 20, minValue: 20, maxValue: 1000 },
            { name: 'highCutFreq', defaultValue: 20000, minValue: 1000, maxValue: 20000 }
        ];
    }

    constructor(options: ReverbNodeOptions) {
        super(options);
        
        this.sampleRate = 44100; // We'll update this in process()
        this.fftSize = 32768; // Adjust based on your needs
        this.fft = new FFT(this.fftSize);
        this.freqComplexBuffer = this.fft.createComplexArray();
        this.irFreqComplexBuffer = this.fft.createComplexArray();
        this.timeComplexBuffer = this.fft.createComplexArray();
        
        this.lastRoomSize = -1;
        this.lastDamping = -1;
        this.lastDensity = -1;
        
        this.updateImpulseResponse(0.8, 0.5, 0.5);
    }

    processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: AudioParamMap): void {
        const input = inputs[0][0];
        const output = outputs[0][1] || outputs[0][0]; // Use second channel if available, otherwise first

        // Update sample rate if needed
        const currentSampleRate = contextInfo.sampleRate;
        if (currentSampleRate !== this.sampleRate) {
            this.sampleRate = currentSampleRate;
            this.updateImpulseResponse(parameters.roomSize[0], parameters.damping[0], parameters.density[0]);
        }

        // Update impulse response if needed
        if (parameters.roomSize[0] !== this.lastRoomSize || 
            parameters.damping[0] !== this.lastDamping ||
            parameters.density[0] !== this.lastDensity) {
            this.updateImpulseResponse(parameters.roomSize[0], parameters.damping[0], parameters.density[0]);
        }

        // Perform convolution using FFT
        this.fft.realTransform(this.freqComplexBuffer, input);
        for (let i = 0; i < this.fftSize; i += 2) {
            const real = this.freqComplexBuffer[i] * this.irFreqComplexBuffer[i] - this.freqComplexBuffer[i+1] * this.irFreqComplexBuffer[i+1];
            const imag = this.freqComplexBuffer[i] * this.irFreqComplexBuffer[i+1] + this.freqComplexBuffer[i+1] * this.irFreqComplexBuffer[i];
            this.freqComplexBuffer[i] = real;
            this.freqComplexBuffer[i+1] = imag;
        }
        this.fft.inverseTransform(this.timeComplexBuffer, this.freqComplexBuffer);

        // Apply filters
        this.applyFilters(this.timeComplexBuffer, parameters.lowCutFreq[0], parameters.highCutFreq[0]);

        // Mix dry and wet signals with pre-delay
        const wetDryMix = parameters.wetDryMix[0];
        const preDelaySamples = Math.floor(parameters.preDelay[0] * this.sampleRate);
        for (let i = 0; i < this.blockSize; i++) {
            const wetSample = i + preDelaySamples < this.fftSize ? this.timeComplexBuffer[i + preDelaySamples] : 0;
            output[i] = (1 - wetDryMix) * input[i] + wetDryMix * wetSample;
        }
    }

    private updateImpulseResponse(roomSize: number, damping: number, density: number): void {
        this.impulseResponse = generateImpulseResponse(this.sampleRate, roomSize, damping, density);
        this.fft.realTransform(this.irFreqComplexBuffer, this.impulseResponse);
        this.lastRoomSize = roomSize;
        this.lastDamping = damping;
        this.lastDensity = density;
    }

    private applyFilters(buffer: Float32Array, lowCutFreq: number, highCutFreq: number): void {
        const lowCutCoeff = Math.exp(-2 * Math.PI * lowCutFreq / this.sampleRate);
        const highCutCoeff = Math.exp(-2 * Math.PI * highCutFreq / this.sampleRate);
        let lowPassOutput = 0;
        let highPassOutput = 0;

        for (let i = 0; i < buffer.length; i++) {
            lowPassOutput = lowPassOutput * lowCutCoeff + buffer[i] * (1 - lowCutCoeff);
            highPassOutput = highPassOutput * highCutCoeff + buffer[i] * (1 - highCutCoeff);
            buffer[i] = lowPassOutput - highPassOutput;
        }
    }
}

registerProcessor("reverb-processor", ReverbProcessor);
console.log("Enhanced ReverbProcessor registered");
