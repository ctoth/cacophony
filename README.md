
## Cacophony: Advanced Browser Audio Library

Cacophony is an intuitive and powerful audio library designed for the modern web. It's built to simplify audio management within browser-based applications, offering a straightforward interface to the Web Audio API. Cacophony is ideal for projects that require detailed audio control, from simple sound playback to complex audio processing and 3D audio positioning.

## Key Features

- **Rich Audio Source Management**: Handle audio sources from `AudioBuffer`, URL strings, synthesizers, or user's microphone with ease.
- **Detailed Audio Control**: Comprehensive control over audio playback including play, stop, pause, resume, and loop.
- **3D Audio Positioning**: Create immersive audio experiences by positioning sounds in a three-dimensional space.
- **Advanced Audio Effects**: Apply and manage a variety of audio filters for enhanced sound quality.
- **Dynamic Volume and Muting**: Global and individual volume control, complete with smooth fade-in and fade-out effects.
- **Live Audio Input**: Capture and process live audio input from the user's microphone.
- **Synthesizer Functionality**: Create and manipulate synthesized sounds with customizable oscillator options.
- **Group Management**: Organize and control multiple sounds or synthesizers as groups for efficient management.

## Installation

```bash
npm install cacophony
```

## Quick Start

```typescript
import { Cacophony } from 'cacophony';

async function playSampleSound() {
  const cacophony = new Cacophony();
  
  // Create and play a sound
  const sound = await cacophony.createSound('path/to/audio.mp3');
  sound.play();
  sound.position = [1, 1, 1]; // Set sound position in 3D space

  // Create and play a synthesizer
  const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
  synth.play();

  // Create a group of sounds
  const group = await cacophony.createGroupFromUrls(['sound1.mp3', 'sound2.mp3']);
  group.play(); // Play all sounds in the group
}

playSampleSound();
```

## Detailed API Documentation

For a complete overview of all functionality, classes, and methods, please refer to our [detailed documentation](https://cacophony.js.org).

## Synthesizer Functionality

Cacophony provides powerful synthesizer capabilities through the `Synth` class:

```typescript
const cacophony = new Cacophony();
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
synth.play();
synth.frequency = 880; // Change frequency
synth.type = 'square'; // Change waveform
```

## Group Functionality

Organize and control multiple sounds or synthesizers with the `Group` and `SynthGroup` classes:

```typescript
const soundGroup = await cacophony.createGroupFromUrls(['sound1.mp3', 'sound2.mp3']);
soundGroup.play(); // Play all sounds in the group

const synthGroup = new SynthGroup();
synthGroup.addSynth(synth1);
synthGroup.addSynth(synth2);
synthGroup.play(); // Play all synths in the group
```

## Additional Highlights

- **Streaming Audio**: Stream live audio directly from a URL.
- **Volume Transitions**: Employ `fadeIn` and `fadeOut` for nuanced volume control.
- **Flexible Synthesizer Options**: Create complex sounds with customizable oscillator settings.
- **Efficient Group Management**: Control multiple audio sources simultaneously for complex audio scenarios.

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt)
