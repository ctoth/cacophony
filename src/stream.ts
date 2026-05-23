import type { AudioBuffer, AudioNode, BaseContext } from "./context";

/**
 * Copy a typed-array view into a freshly allocated ArrayBuffer.
 *
 * `Uint8Array.buffer` returns the underlying ArrayBuffer, which may be
 * pooled and larger than the view. Always slice by the view's
 * `byteOffset`/`byteLength` before handing the bytes to APIs that consume
 * an ArrayBuffer.
 */
const viewToArrayBuffer = (view: Uint8Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);

const appendBuffer = (buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer => {
  const joined = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  joined.set(new Uint8Array(buffer1), 0);
  joined.set(new Uint8Array(buffer2), buffer1.byteLength);
  return joined.buffer;
};

/**
 * Fetch a WAV stream from `url` and play it through `context` chunk by chunk.
 *
 * The WAV header (first 44 bytes of the first chunk) is prepended to later
 * chunks so each decode receives a self-describing WAV buffer.
 *
 * Fire-and-forget: errors are reported via `console.error`. Pass an
 * `AbortSignal` to cancel the in-flight stream.
 *
 * Pass `outputNode` to route the decoded audio through a shared gain node
 * (typically the library's `globalGainNode`) so global volume / mute apply.
 * If omitted, audio connects directly to `context.destination` and bypasses
 * any global gain — preserved only for backward compatibility.
 */
export function createStream(url: string, context: BaseContext, signal?: AbortSignal, outputNode?: AudioNode): void {
  const audioStack: AudioBuffer[] = [];
  let nextTime = 0;

  // Check if already aborted
  if (signal?.aborted) {
    console.error("Stream error:", new DOMException("Operation was aborted", "AbortError"));
    return;
  }

  fetch(url, signal ? { signal } : undefined)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error, status = ${response.status}`);
      }
      if (!response.body) {
        throw new Error("Missing body");
      }

      const reader = response.body.getReader();
      let header = new ArrayBuffer(0);

      // Set up abort listener to cancel the reader
      const abortListener = (): void => {
        audioStack.length = 0; // Clear decoded buffers to free memory
        reader.cancel("Stream aborted").catch(() => {
          // Ignore cancel errors - reader might already be closed
        });
      };

      signal?.addEventListener("abort", abortListener);

      function read(): Promise<void> {
        if (signal?.aborted) {
          abortListener();
          return Promise.resolve();
        }

        return reader
          .read()
          .then(({ value, done }) => {
            if (signal?.aborted) {
              abortListener();
              return;
            }

            if (value) {
              let audioBuffer: ArrayBuffer;
              if (!header.byteLength) {
                header = viewToArrayBuffer(value.subarray(0, 44));
                audioBuffer = viewToArrayBuffer(value);
              } else {
                audioBuffer = appendBuffer(header, viewToArrayBuffer(value));
              }

              context
                .decodeAudioData(
                  audioBuffer,
                  (buffer) => {
                    if (signal?.aborted) {
                      return;
                    }
                    audioStack.push(buffer);
                    scheduleBuffers();
                  },
                  (err) => {
                    console.error("Stream decode error:", err);
                  },
                )
                .catch((err: unknown) => {
                  // The callback overload also rejects the returned promise
                  // on decode failure. Avoid unhandled-rejection noise; the
                  // errorCallback above is the primary reporting channel.
                  if (signal?.aborted) {
                    return;
                  }
                  console.error("Stream decode error:", err);
                });
            }

            if (done) {
              signal?.removeEventListener("abort", abortListener);
              return;
            }
            //read next buffer
            return read();
          })
          .catch((error: unknown) => {
            if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
              // Expected abort, cleanup handled by abort listener
              return;
            }
            console.error("Stream read error:", error);
          });
      }
      return read();
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("Stream error:", error);
    });

  function scheduleBuffers(): void {
    while (audioStack.length) {
      const buffer = audioStack.shift();
      const source = context.createBufferSource();
      if (!buffer) {
        return;
      }
      source.buffer = buffer;
      source.connect(outputNode ?? context.destination);
      if (nextTime === 0) nextTime = context.currentTime + 0.02; /// add 50ms latency to work well across systems - tune this if you like
      source.start(nextTime);
      nextTime += source.buffer.duration; // Make the next buffer wait the length of the last buffer before being played
    }
  }
}
