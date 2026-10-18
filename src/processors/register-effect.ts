/** Terminal retirement is distinct from temporarily losing an input or bypassing an effect. */
export function registerEffectProcessor(name: string, Processor: AudioWorkletProcessorConstructor): void {
  class OwnedEffectProcessor extends Processor {
    private disposed = false;

    constructor(options?: AudioWorkletNodeOptions) {
      super(options);
      this.port.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (event.data !== "cacophony:dispose") return;
        this.disposed = true;
        this.port.postMessage("cacophony:disposed");
        this.port.close();
      });
      this.port.start();
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
      return !this.disposed && super.process(inputs, outputs, parameters);
    }
  }

  registerProcessor(name, OwnedEffectProcessor);
}
