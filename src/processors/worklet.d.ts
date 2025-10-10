// Type definitions based on @types/audioworklet
// https://www.npmjs.com/package/@types/audioworklet

interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

interface AudioWorkletProcessorImpl extends AudioWorkletProcessor {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

interface AudioParamDescriptor {
  name: string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: AutomationRate;
}

declare function registerProcessor(
  name: string,
  processorCtor: (new (
    options?: AudioWorkletNodeOptions
  ) => AudioWorkletProcessorImpl) & {
    parameterDescriptors?: AudioParamDescriptor[];
  }
): void;


// sample rate is 44100 Hz, buffer size is 128 frames
declare const BUFFER_SIZE = 128;
declare const sampleRate= 44100;
