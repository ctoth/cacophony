import OLAProcessor from './ola.ts';

const MAX_REVERB_DURATION = 5; // Maximum reverb duration in seconds

function generateImpulseResponse(sampleRate: number, duration: number, decay: number): Float32Array {
    const length = Math.min(sampleRate * duration, sampleRate * MAX_REVERB_DURATION);
    const impulseResponse = new Float32Array(length);
    
    for (let i = 0; i < length; i++) {
        impulseResponse[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
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
    private convBuffer: Float32Array;

    static get parameterDescriptors() {
        return [
            { name: 'roomSize', defaultValue: 0.8, minValue: 0, maxValue: 1 },
            { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'wetDryMix', defaultValue: 0.5, minValue: 0, maxValue: 1 }
        ];
    }

    constructor(options: ReverbNodeOptions) {
        super(options);
        
        const sampleRate = 44100; // Assuming a sample rate of 44.1kHz
        this.impulseResponse = generateImpulseResponse(sampleRate, 2, 0.5);
        this.convBuffer = new Float32Array(this.blockSize + this.impulseResponse.length - 1);
    }

    processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: AudioParamMap): void {
        const input = inputs[0][0];
        const output = outputs[0][0];

        // Get the latest parameter values
        const roomSize = parameters.roomSize[0];
        const damping = parameters.damping[0];
        const wetDryMix = parameters.wetDryMix[0];

        // Update impulse response if needed
        this.updateImpulseResponse(roomSize, damping);

        // Perform convolution
        this.convolve(input, this.impulseResponse, this.convBuffer);

        // Mix dry and wet signals
        for (let i = 0; i < this.blockSize; i++) {
            output[i] = (1 - wetDryMix) * input[i] + wetDryMix * this.convBuffer[i];
        }
    }

    private updateImpulseResponse(roomSize: number, damping: number): void {
        const sampleRate = 44100; // Assuming a sample rate of 44.1kHz
        const duration = 1 + roomSize * 4; // Map roomSize to duration between 1 and 5 seconds
        const decay = 1 + damping * 4; // Map damping to decay factor between 1 and 5
        this.impulseResponse = generateImpulseResponse(sampleRate, duration, decay);
    }

    private convolve(input: Float32Array, impulseResponse: Float32Array, output: Float32Array): void {
        output.fill(0);
        for (let i = 0; i < this.blockSize; i++) {
            for (let j = 0; j < impulseResponse.length; j++) {
                output[i + j] += input[i] * impulseResponse[j];
            }
        }
    }
}

registerProcessor("reverb-processor", ReverbProcessor);
console.log("ReverbProcessor registered");
