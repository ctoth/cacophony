/**
 * Bespoke RIFF/WAVE encoder for the CLI render path.
 *
 * `node-web-audio-api` ships no WAV encoder, so the CLI carries its own. This
 * is the only new "algorithm" in the CLI: it turns a rendered `AudioBuffer`
 * into a canonical 44-byte-header WAV `Buffer`, either 16-bit PCM (default) or
 * 32-bit IEEE float. Pure — needs no audio context — and round-trippable, so
 * it is independently unit-testable (the 32-bit path round-trips exactly and
 * serves as the reference oracle for the 16-bit path).
 */

/** Bit depth of the encoded WAV. 16 = PCM s16, 32 = IEEE float. */
export type WavBitDepth = 16 | 32;

/** Options for {@link encodeWav}. */
export interface EncodeWavOptions {
  /** Sample format / bit depth. @default 16 */
  bitDepth?: WavBitDepth;
}

/**
 * The minimal slice of `AudioBuffer` this encoder needs. Accepting this shape
 * (rather than the DOM `AudioBuffer`) keeps the encoder testable with a plain
 * object built from `Float32Array`s, with no audio context required.
 */
export interface EncodableBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  copyFromChannel(destination: Float32Array, channelNumber: number): void;
}

/**
 * Encode an `AudioBuffer` (or any {@link EncodableBuffer}) into a WAV `Buffer`.
 *
 * Channels are read via `copyFromChannel` and interleaved frame-by-frame.
 * 16-bit clamps to [-1, 1] and scales asymmetrically (`x < 0 ? x*0x8000 :
 * x*0x7FFF`) so full-scale negatives map to -32768 and positives to +32767.
 * 32-bit writes the float samples verbatim (no clamping — lossless).
 */
export function encodeWav(buffer: EncodableBuffer, options: EncodeWavOptions = {}): Buffer {
  const bitDepth: WavBitDepth = options.bitDepth ?? 16;
  const numChannels = buffer.numberOfChannels;
  const numFrames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
  const audioFormat = bitDepth === 32 ? 3 : 1; // 3 = IEEE float, 1 = PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLen = numFrames * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLen, 40);

  const data = Buffer.alloc(dataLen);

  // Pull each channel out once, then interleave from the cached arrays.
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const arr = new Float32Array(numFrames);
    buffer.copyFromChannel(arr, ch);
    channels.push(arr);
  }

  let offset = 0;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch][frame];
      if (bitDepth === 32) {
        data.writeFloatLE(sample, offset);
      } else {
        const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
        const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        data.writeInt16LE(Math.round(int16), offset);
      }
      offset += bytesPerSample;
    }
  }

  return Buffer.concat([header, data]);
}
