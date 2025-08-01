import { AudioContext, IAudioBuffer } from 'standardized-audio-context';


const appendBuffer = (buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer => {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}


export function createStream(url: string, context: AudioContext, signal?: AbortSignal) {
    const audioStack: IAudioBuffer[] = [];
    let nextTime = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    // Check if already aborted
    if (signal?.aborted) {
        console.error('Stream error:', new DOMException('Operation was aborted', 'AbortError'));
        return;
    }

    fetch(url, { signal }).then(function (response) {
        if (!response.ok) {
            throw new Error('HTTP error, status = ' + response.status);
        }
        if (!response.body) {
            throw new Error('Missing body');
        }

        reader = response.body.getReader();
        let header = new ArrayBuffer(0);//first 44bytes

        // Set up abort listener to cancel the reader
        const abortListener = () => {
            audioStack.length = 0; // Clear decoded buffers to free memory
            if (reader) {
                reader.cancel('Stream aborted').catch(() => {
                    // Ignore cancel errors - reader might already be closed
                });
            }
        };

        signal?.addEventListener('abort', abortListener);

        function read() {
            if (signal?.aborted) {
                abortListener();
                return Promise.resolve();
            }

            return reader!.read().then(({ value, done }) => {
                if (signal?.aborted) {
                    abortListener();
                    return;
                }

                let audioBuffer = null;
                if (!value) {
                    return;
                }

                if (!header.byteLength) {
                    //copy first 44 bytes (wav header)
                    header = value.buffer.slice(0, 44);
                    audioBuffer = value.buffer;
                } else {
                    audioBuffer = appendBuffer(header, value.buffer);
                }

                context.decodeAudioData(audioBuffer, function (buffer) {
                    if (signal?.aborted) {
                        return;
                    }

                    audioStack.push(buffer);
                    if (audioStack.length) {
                        scheduleBuffers();
                    }
                }, function (err) {
                    console.log("err(decodeAudioData): " + err);
                });
                if (done) {
                    console.log('done');
                    signal?.removeEventListener('abort', abortListener);
                    return;
                }
                //read next buffer
                read();
            }).catch(error => {
                if (signal?.aborted || error.name === 'AbortError') {
                    // Expected abort, cleanup handled by abort listener
                    return;
                }
                console.error('Stream read error:', error);
            });
        }
        read();
    }).catch(function (error) {
        console.error('Stream error:', error);
    })

    function scheduleBuffers() {
        while (audioStack.length) {
            let buffer = audioStack.shift();
            const source = context.createBufferSource();
            if (!buffer) {
                return;
            }
            source.buffer = buffer;
            source.connect(context.destination);
            if (nextTime == 0)
                nextTime = context.currentTime + 0.02;  /// add 50ms latency to work well across systems - tune this if you like
            source.start(nextTime);
            nextTime += source.buffer.duration; // Make the next buffer wait the length of the last buffer before being played
        };
    }
}

