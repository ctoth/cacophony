import { AudioBuffer, AudioContext } from 'standardized-audio-context-mock';
import { afterEach, beforeEach, describe, expect, it, test, } from 'vitest';
import { Cacophony } from './cacophony';
import { Sound } from './sound';

let cacophony: Cacophony;
let audioContextMock: AudioContext;

beforeEach(() => {
    audioContextMock = new AudioContext();
    cacophony = new Cacophony(audioContextMock);
});

afterEach(() => {
    audioContextMock.close();
});

test('Cacophony is created with the correct context', () => {
    expect(cacophony.context).toBe(audioContextMock);
});

test('that createSound creates a sound with the correct buffer', async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer);
    expect(sound.buffer).toBe(buffer);
});
it('createOscillator creates an oscillator with default parameters when none are provided', () => {
    const oscillator = cacophony.createOscillator({});
    expect(oscillator.type).toBe('sine');
    expect(oscillator.frequency.value).toBe(440);
});

it('createOscillator creates an oscillator with the provided parameters', () => {
    const oscillator = cacophony.createOscillator({ frequency: 880, type: 'square' });
    expect(oscillator.type).toBe('square');
    expect(oscillator.frequency.value).toBe(880);
});

it('createGroup creates a Group instance with the provided Sound instances', async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound1 = await cacophony.createSound(buffer);
    const sound2 = await cacophony.createSound(buffer);
    const group = await cacophony.createGroup([sound1, sound2]);
    expect(group.sounds.length).toBe(2);
    expect(group.sounds[0]).toBe(sound1);
    expect(group.sounds[1]).toBe(sound2);
});

it('createBiquadFilter creates a BiquadFilterNode with default parameters when none are provided', () => {
    const filter = cacophony.createBiquadFilter({});
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(350);
    expect(filter.gain.value).toBe(0);
    expect(filter.Q.value).toBe(1);
});

it('createBiquadFilter creates a BiquadFilterNode with the provided parameters', () => {
    const filter = cacophony.createBiquadFilter({ type: 'highpass', frequency: 5000, gain: 5, Q: 0.5 });
    expect(filter.type).toBe('highpass');
    expect(filter.frequency.value).toBe(5000);
    expect(filter.gain.value).toBe(5);
    expect(filter.Q.value).toBe(0.5);
});

import { SoundType } from './cacophony';

describe('Sound class', () => {
    let sound: Sound;
    let buffer: AudioBuffer;

    beforeEach(() => {
        buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
        sound = new Sound('test-url', buffer, audioContextMock, audioContextMock.createGain());
    });

    it('is created with correct properties', () => {
        expect(sound.url).toBe('test-url');
        expect(sound.buffer).toBe(buffer);
        expect(sound.context).toBe(audioContextMock);
        expect(sound.type).toBe(SoundType.Buffer);
        expect(sound.panType).toBe('HRTF');
    });

    it('can play and stop a sound', async () => {
        const playbacks = sound.play();
        expect(playbacks.length).toBeGreaterThan(0);
        expect(playbacks[0].isPlaying).toBe(true);
        sound.stop();
        expect(playbacks[0].isPlaying).toBe(false);
    });

    it('can pause and resume a sound', async () => {
        const playbacks = sound.play();
        sound.pause();
        expect(playbacks[0].isPlaying).toBe(false);
        sound.playbacks[0].play();
        expect(playbacks[0].isPlaying).toBe(true);
    });

    it('can set and get volume', () => {
        sound.volume = 0.5;
        expect(sound.volume).toBe(0.5);
    });

    it('can set and get playbackRate', () => {
        sound.playbackRate = 0.75;
        expect(sound.playbackRate).toBe(0.75);
    });

    it('can add and remove filters', () => {
        const filter = audioContextMock.createBiquadFilter();
        sound.addFilter(filter);
        expect(sound.filters.length).toBe(1);
        sound.removeFilter(filter);
        expect(sound.filters.length).toBe(0);
    });
});

test('A sound loops the correct number of times', async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = new Sound('test-url', buffer, audioContextMock, audioContextMock.createGain());
    const playbacks = sound.play();
    const playback = playbacks[0];
    expect(playback.isPlaying).toBe(true);
    // Set the sound to loop 3 times
    playback.loop(3);

    // Simulate the end of playback to trigger looping
    for (let i = 0; i < 3; i++) {
        playback.handleLoop();
    }

    // The sound should have looped 3 times
    expect(playback.currentLoop).toBe(3);

    // The sound should not be playing after 3 loops
    expect(playback.isPlaying).toBe(false);
});
