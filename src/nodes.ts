
export class MicrophoneStream extends AudioNodeWrapper {
    private stream?: MediaStream;
    private mediaStreamSource?: MediaStreamAudioSourceNode;

    constructor(context: AudioContext, soundSourceOptions: SoundSourceOptions) {
        super(new SoundSource(context.destination, soundSourceOptions), context);
    }

    async play() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaStreamSource = this.context.createMediaStreamSource(this.stream);
            this.mediaStreamSource.connect(this.soundSource.node);
        } catch (err) {
            console.error('Failed to access microphone', err);
            throw err;
        }
    }

    stop() {
        this.stream && this.stream.getTracks().forEach(track => track.stop());
        this.destructor();
    }
}

export class ConvolverSource extends AudioNodeWrapper {
    // The convolver node is used to apply reverb to the sound
    // The impulse response (IR) is the sound sample that the reverb effect is based on

    // The impulse response is stored in a buffer
    // The buffer is loaded from a URL


    private convolver: ConvolverNode;
    private _url: string;
    private _buffer!: AudioBuffer;

    constructor(context: AudioContext, soundSourceOptions: SoundSourceOptions, private url: string) {
        super(new SoundSource(context.destination, soundSourceOptions), context);
        this.convolver = this.context.createConvolver();
        this._url = url;
    }

    async load() {
        this._buffer = await CacheManager.getAudioBuffer(this._url, this.context);
        this.convolver.buffer = this._buffer;
    }

    play() {
        this.soundSource.node.connect(this.convolver);
        this.convolver.connect(this.context.destination);
    }
}


export class OscillatorSource extends AudioNodeWrapper {
    private oscillator: OscillatorNode;
    private _frequency: number;
    private _type: OscillatorType;

    constructor(context: AudioContext, soundSourceOptions: SoundSourceOptions, frequency: number = 440, type: OscillatorType = "sine") {
        super(new SoundSource(context.destination, soundSourceOptions), context);
        this._frequency = frequency;
        this._type = type;
        this.oscillator = this.context.createOscillator();
    }

    get frequency(): number {
        return this._frequency;
    }

    set frequency(value: number) {
        this._frequency = value;
        this.oscillator.frequency.value = this._frequency;
    }

    get type(): OscillatorType {
        return this._type;
    }

    set type(value: OscillatorType) {
        this._type = value;
        this.oscillator.type = this._type;
    }

    play() {
        this.oscillator.type = this._type;
        this.oscillator.frequency.value = this._frequency;

        // Apply filters
        if (this.filters.length > 0) {
            this.oscillator.connect(this.filters[0].node);
            this.rebuildFilterChain();
        } else {
            this.oscillator.connect(this.soundSource.node);
        }

        this.oscillator.start();
    }

    stop() {
        this.destructor();
        this.oscillator.stop();
    }
}