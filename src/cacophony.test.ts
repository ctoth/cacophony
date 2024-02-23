import { Cacophony } from './cacophony';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioContext, AudioBuffer } from 'standardized-audio-context-mock';

let cacophony: Cacophony;
let audioContextMock: AudioContext;

beforeEach(() => {
    audioContextMock = new AudioContext();
    cacophony = new Cacophony(audioContextMock);
});

afterEach(() => {
    audioContextMock.close();
});

it('Cacophony is created with the correct context', () => {
    expect(cacophony.context).toBe(audioContextMock);
});

it('createSound creates a sound with the correct buffer', async () => {
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
