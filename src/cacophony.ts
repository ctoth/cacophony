import { SoundSource as BaseSoundSource, SoundSourceOptions, createAudioContext, createSoundListener } from "sounts";
import { CacheManager } from "./cache";

export enum FadeType {
    EXPONENTIAL,
    LINEAR,
}

interface NodeWrapper {
    node: AudioNode;
    next?: NodeWrapper;
}

type AudioPosition = {
    x: number;
    y: number;
    z: number;
};

export abstract class AudioNodeWrapper {
    protected filters: NodeWrapper[] = [];
    protected effectsChain: NodeWrapper[] = [];

    constructor(public soundSource: BaseSoundSource, public context: AudioContext) { }

    get volume() {
        return this.soundSource.gainNode!.gain.value;
    }

    set volume(volume: number) {
        this.soundSource.setGain(volume);
    }

    get position(): AudioPosition {
        return { x: this.soundSource.node.positionX.value as number, y: this.soundSource.node.positionY.value as number, z: this.soundSource.node.positionZ.value as number }
    }

    set position(pos: { x?: number, y?: number, z?: number }) {
        const position = { ...this.position, ...pos };
        this.soundSource.setPosition(position.x!, position.y!, position.z!);
    }

    fade(duration: number, fadeType: FadeType = FadeType.EXPONENTIAL, fadeDirection: 'in' | 'out') {
        const target = this.context.currentTime + duration;
        const value = fadeDirection === 'in' ? 1 : 0.00001;
        switch (fadeType) {
            case FadeType.EXPONENTIAL:
                this.soundSource.gainNode!.gain.exponentialRampToValueAtTime(value, target);
                break;
            case FadeType.LINEAR:
                this.soundSource.gainNode!.gain.linearRampToValueAtTime(value, target);
                break;
        }
    }

    fadeIn(duration: number, fadeType: FadeType = FadeType.EXPONENTIAL) {
        this.fade(duration, fadeType, 'in');
    }

    fadeOut(duration: number, fadeType: FadeType = FadeType.EXPONENTIAL) {
        this.fade(duration, fadeType, 'out');
    }

    getEffectsChain(): AudioNode[] {
        return this.effectsChain.map(wrapper => wrapper.node);
    }

    addEffect(node: AudioNode) {
        this.effectsChain.push({ node });
    }

    removeEffect(node: AudioNode) {
        const index = this.filters.findIndex(wrapper => wrapper.node === node);
        if (index > -1) {
            this.filters.splice(index, 1);
            this.rebuildEffectsChain();
        }
    }

    addFilter(filter: BiquadFilterNode) {
        this.filters.push({ node: filter });
        this.rebuildFilterChain();
    }

    removeFilter(filter: BiquadFilterNode) {
        const index = this.filters.findIndex(wrapper => wrapper.node === filter);
        if (index > -1) {
            this.filters.splice(index, 1);
            this.rebuildFilterChain();
        }
    }

    protected rebuildFilterChain() {
        this.connectNodesInChain(this.filters);
    }

    protected rebuildEffectsChain() {
        this.connectNodesInChain(this.effectsChain);
    }

    protected connectNodesInChain(chain: NodeWrapper[]) {
        chain.forEach((wrapper, index) => {
            wrapper.node.disconnect();
            wrapper.next = chain[index + 1];
            if (wrapper.next) {
                wrapper.node.connect(wrapper.next.node);
            } else {
                wrapper.node.connect(this.context.destination);
            }
        });
    }

    destructor() {
        this.soundSource.node.disconnect();
        this.soundSource.gainNode!.disconnect();
    }
}


export class Sound {
    private pannerNode?: PannerNode;
    private soundEffectsChain: AudioNode[] = [];


    constructor(
        public source: AudioSource,
        private node: AudioBufferSourceNode,
        context: AudioContext,
        position?: AudioPosition,
    ) {

        if (position) {
            this.pannerNode = context.createPanner();
            this.pannerNode.positionX.value = position.x;
            this.pannerNode.positionY.value = position.y;
            this.pannerNode.positionZ.value = position.z;
            this.node.connect(this.pannerNode);
            this.pannerNode.connect(context.destination);
        } else {
            this.node.connect(context.destination);
        }
    }

    seek(time: number) {
        this.node.stop();
        this.node.start(0, time);
    }


    addEffect(node: AudioNode) {
        this.soundEffectsChain.push(node);
    }

    removeEffect(node: AudioNode) {
        const index = this.soundEffectsChain.indexOf(node);
        if (index !== -1) {
            this.soundEffectsChain.splice(index, 1);
        }
    }

    play() {
        const sourceEffectsChain = this.source.getEffectsChain();
        this.connectNodes(this.node, [...sourceEffectsChain, ...this.soundEffectsChain], this.source.context.destination);
    }

    protected connectNodes(startNode: AudioNode, chain: AudioNode[], endNode: AudioNode) {
        chain.unshift(startNode);
        chain.push(endNode);

        for (let i = 0; i < chain.length - 1; i++) {
            chain[i].connect(chain[i + 1]);
        }
    }

    stop() {
        this.node.stop();
        this.source.destructor();
    }


    get looping() {
        return this.node.loop;
    }

    set looping(loop: boolean) {
        this.node.loop = loop;
    }

    get position() {
        if (this.pannerNode) {
            return { x: this.pannerNode.positionX.value as number, y: this.pannerNode.positionY.value as number, z: this.pannerNode.positionZ.value as number }
        } else {
            return this.source.position;
        }
    }

    set position(pos: AudioPosition) {
        if (this.pannerNode) {
            this.pannerNode.positionX.value = pos.x;
            this.pannerNode.positionY.value = pos.y;
            this.pannerNode.positionZ.value = pos.z;
        } else {
            this.source.position = pos;
        }
    }


    get playbackRate() {
        return this.node.playbackRate.value;
    }

    set playbackRate(rate: number) {
        this.node.playbackRate.value = rate;
    }

}

export class AudioSource extends AudioNodeWrapper {
    private url: string;
    private group: string;

    constructor(url: string, group: string, context: AudioContext, soundSourceOptions: SoundSourceOptions, public loop: boolean = false, public channel: string = "default") {
        super(new BaseSoundSource(context.destination, soundSourceOptions), context);
        this.url = url;
        this.group = group;
    }

    async play(position?: AudioPosition): Promise<Sound> {
        const buffer = await CacheManager.getAudioBuffer(this.url, this.context);
        const playing = this.soundSource.playOnChannel(this.channel, buffer);
        return new Sound(this, playing, this.context, position);
    }

    async playStream() {
        const audioElement = new Audio(this.url);
        const mediaElementSource = this.context.createMediaElementSource(audioElement);
        mediaElementSource.connect(this.soundSource.node);
        audioElement.play();
        return audioElement;
    }

    stop() {
        this.soundSource.stopAll();
        this.destructor();
    }
}

export class SoundManager {

    private listener = createSoundListener(this.context);
    private sources: Map<string, AudioSource> = new Map();
    private soundGroups: Map<string, Set<string>> = new Map();

    constructor(private context: AudioContext = createAudioContext()) { }

    get listenerPosition() {
        return { x: this.listener.node.positionX.value, y: this.listener.node.positionY.value, z: this.listener.node.positionZ.value }
    }

    set listenerPosition({ x, y, z }: AudioPosition) {
        this.listener.setPosition(x, y, z);
    }

    getSource(url: string, group: string = "default", soundSourceOptions: SoundSourceOptions = {}): AudioSource {
        let source = this.sources.get(url);

        if (!source) {
            source = new AudioSource(url, group, this.context, soundSourceOptions);
            this.sources.set(url, source);

            if (!this.soundGroups.has(group)) {
                this.soundGroups.set(group, new Set());
            }

            if (!this.soundGroups.get(group)?.has(url)) {
                this.soundGroups.get(group)?.add(url);
            }
        }

        return source;
    }

    playSource(url: string, volume: number = 1.0) {
        const source = this.getSource(url);
        source.volume = volume;
        source.play();
    }

    playStream(url: string, volume: number = 1.0) {
        const stream = this.getSource(url);
        stream.volume = volume;
        stream.playStream();
    }

    stopAll() {
        for (const source of this.sources.values()) {
            source.stop();
        }
    }

    stopSoundGroup(group: string) {
        const soundUrls = this.soundGroups.get(group);
        if (soundUrls) {
            for (let url of soundUrls) {
                const source = this.sources.get(url);
                source && source.stop();
            }
        }
    }
}
