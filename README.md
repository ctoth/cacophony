Cacophony is a comprehensive and versatile audio library for TypeScript, utilizing the Web Audio API to streamline audio management in sophisticated applications. At the heart of Cacophony lies the creation and manipulation of key elements: `Sound`, `Playback`, `Group`, and now `MicrophoneStream` for live audio input.

- A `Sound` represents a distinct audio source, derived from an `AudioBuffer` or a URL string pointing to an audio file, with advanced filter management.
- A `Playback` refers to the act of playing a `Sound`, with additional properties such as position in a 3D audio scene, gain-node for volume control, and methods for fading audio in and out.
- A `Group` encapsulates multiple `Sound` instances to handle them as one entity, allowing for synchronous control of playback.
- A `MicrophoneStream` captures live audio input from the user's microphone, providing real-time audio streaming capabilities.

## Key Features

- Multiple Audio Sources: Seamlessly manage buffers, URLs, groups of sounds, playbacks, and live microphone input.
- Comprehensive Audio Control: Play, stop, pause, resume, loop (finite or infinite), and adjust volume with ease.
- 3D Audio Positioning: Precisely position audio sources in a 3D space for an immersive experience.
- Advanced Audio Filtering: Add, remove, or apply filters directly to audio sources for enhanced sound quality.
- Dynamic Volume Control: Mute, unmute, and adjust volume globally or individually, with fade-in and fade-out effects.

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
  sound.position = [1, 1, 1]; // Position the sound in 3D space
}

playSampleSound();
```

## Comprehensive Documentation

### Main Class: `Cacophony`

The centerpiece of the library delivers methods for creating sounds, managing global volumes, and more.

#### Method: `createSound(bufferOrUrl: AudioBuffer | string): Promise<Sound>`

Crafts a `Sound` instance using either an `AudioBuffer` or a URL string leading to the desired audio file.

#### Method: `createGroup(sounds: Sound[]): Promise<Group>`

Creates a `Group` entity from an array of `Sound` instances.

#### Method: `createGroupFromUrls(urls: string[]): Promise<Group>`

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

### Unified Methods Across Sound Sources

All classes representing sound sources (`Sound`, `Playback`, `Group`, `MicrophoneStream`) and the `BaseSound` interface offer the following methods for a consistent interface and user-friendly experience:

- `play()`: Initiates playback of the sound.
- `seek(time: number)`: Seeks the current playback to the specified time in seconds (not applicable to `MicrophoneStream`).
- `stop()`: Stops the sound and resets playback.
- `pause()`: Pauses the sound without resetting playback.
- `resume()`: Resumes paused sound.
- `addFilter(filter: BiquadFilterNode)`: Adds a filter to the sound.
- `removeFilter(filter: BiquadFilterNode)`: Removes a filter from the sound.
- `position`: A tuple `[x: number, y: number, z: number]` representing the position of the sound in 3D space, with both getter and setter (not applicable to `MicrophoneStream`).
- `loop(loopCount?: LoopCount)`: Sets the loop count for the sound, which can be a finite number or 'infinite'.
- `fadeIn(time: number, fadeType?: FadeType)`: Gradually increases the volume of the sound over the specified time.
- `fadeOut(time: number, fadeType?: FadeType)`: Gradually decreases the volume of the sound over the specified time.
- `cleanup()`: Cleans up resources associated with the sound (applicable to `Playback`).

## License

Cacophony is freely available for incorporation into your projects under the [MIT License](LICENSE.txt).
