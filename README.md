Cacophony is a highly robust and versatile audio library for Typescript leveraging the WebAudio API, crafted to simplify audio management in complex applications. The core concept of Cacophony revolves around the creation and manipulation of three key elements: `Sound`, `Playback`, and `Group`.

- A `Sound` represents a distinct audio source, derived from an `AudioBuffer` or a URL string pointing to an audio file.
- A `Playback` refers to the act of playing a `Sound` and carries additional properties such as its position in a 3D audio scene, gain-node for volume control, and more.
- A `Group` encapsulates multiple `Sound` instances to handle them as one entity, permitting the grouped sounds to be played, paused, or stopped synchronously.

## Features

- Multiple Audio Sources: Handle buffers, URLs, groups of sounds, and playbacks seamlessly.
- Comprehensive Audio Control: Play, stop, pause, resume, infinite or finite loops, and volume adjustments.
- 3D Audio Positioning: Precise control on 3D spatial positioning of the audio source.
- Audio Filtering: Elevate audio output with filters - adding, removing, or applying directly to an audio source.
- Volume Control: Mute, unmute, and volume adjustments on a global scale.

## Quick Installation

Cacophony is provided as a regular NPM module. Install it using:

```bash
$ npm install cacophony
```

## Straightforward Usage

Utilizing Cacophony in the codebase is effortless, demonstrated below:

```typescript
import { Cacophony } from 'cacophony-ts';

async function playSampleSound() {
  const cacophony = new Cacophony();
  const sound = await cacophony.createSound('path/to/your/audio/file.mp3');

  sound.play();
  sound.moveTo(1, 1, 1); // Position the sound in 3D space
}

playSampleSound();
```

## Comprehensive Documentation

### Main Class: `Cacophony`

The centerpiece of the library delivers methods for creating sounds, managing global volumes, and more.

#### Method: `async createSound(bufferOrUrl: AudioBuffer | string): Promise<Sound>`

Crafts a `Sound` instance using either an `AudioBuffer` or a URL string leading to the desired audio file.

#### Method: `async createGroup(sounds: Sound[]): Promise<Group>`

Creates a `Group` entity from an array of `Sound` instances.

#### Method: `async createGroupFromUrls(urls: string[]): Promise<Group>`

Forms a `Group` instance from an array of URLs directing to the desired audio files.

#### Method: `createBiquadFilter(type: BiquadFilterType): BiquadFilterNode`

Generates a `BiquadFilterNode` ready to be applied to sounds.

#### Method: `pause()`

Halts all active audio.

#### Method: `resume()`

Resumes all paused audio.

#### Method: `stopAll()`

Complete cessation of all audio, irrespective of their current states.

#### Method: `setGlobalVolume(volume: number)`

Adjusts the global volume to the passed value.

#### Method: `mute()`

Silences all audio by setting the global volume to 0.

#### Method: `unmute()`

Resumes audio by restoring the global volume to its preceding value.

### Shared Methods Across Sound Sources

All classes representing sound sources (`Sound`, `Playback`, `Group`) offer the following methods for a consistent interface and user-friendly experience:

- `play()`
- `stop()`
- `pause()`
- `resume()`
- `addFilter(filter: BiquadFilterNode)`
- `removeFilter(filter: BiquadFilterNode)`
- `moveTo(x: number, y: number, z: number)`
- `loop(loopCount?: LoopCount)`: `LoopCount` can be a finite number or 'infinite'.

## License

Cacophony is freely available for incorporation into your projects under the [MIT License](LICENSE.txt).
