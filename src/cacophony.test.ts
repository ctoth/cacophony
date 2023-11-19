import { Cacophony, Sound } from './cacophony';
import { AudioContext } from 'standardized-audio-context-mock';

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
test('createSound creates a sound with the correct buffer', async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer) as Sound;
    expect(sound.buffer).toBe(buffer);
});
