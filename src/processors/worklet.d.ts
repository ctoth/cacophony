// Type definitions for AudioWorklet context.
// Worklet build does not load DOM lib (tsconfig.worklets.json sets
// lib=["ESNext","WebWorker"]); this declares the AudioWorklet globals
// (Web Audio API §1.32) needed by processors in this folder.

type AutomationRate = "a-rate" | "k-rate";

interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: AutomationRate;
}

interface AudioWorkletNodeOptions {
  numberOfInputs?: number;
  numberOfOutputs?: number;
  outputChannelCount?: number[];
  parameterData?: Record<string, number>;
  processorOptions?: unknown;
}

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

interface AudioWorkletProcessorConstructor {
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
  parameterDescriptors?: AudioParamDescriptor[];
}

declare function registerProcessor(name: string, processorCtor: AudioWorkletProcessorConstructor): void;

declare var sampleRate: number;
declare var currentFrame: number;
declare var currentTime: number;

// sample rate is 44100 Hz, buffer size is 128 frames
declare const BUFFER_SIZE = 128;
