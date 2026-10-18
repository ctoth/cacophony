class ClipCapture extends AudioWorkletProcessor {
  alive = true;
  constructor() {
    super();
    this.port.onmessage = () => { this.alive = false; };
  }
  process(inputs) {
    const input = inputs[0];
    const left = new Float32Array(input?.[0] ?? 128);
    const right = new Float32Array(input?.[1] ?? 128);
    this.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    return this.alive;
  }
}
registerProcessor("clip-capture", ClipCapture);
