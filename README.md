
# Cacophony: Advanced Browser Audio Library

Cacophony is a powerful and intuitive audio library designed for modern web applications. It provides a high-level interface to the Web Audio API, simplifying complex audio operations while offering fine-grained control. Cacophony is perfect for projects ranging from simple sound playback to sophisticated audio processing and 3D audio positioning.

## Key Features

- **Versatile Audio Source Handling**: Manage audio from various sources including `AudioBuffer`, URL strings, synthesizers, and live microphone input.
- **Comprehensive Playback Control**: Play, stop, pause, resume, loop, and seek within audio with ease.
- **3D Audio Positioning**: Create immersive soundscapes with precise spatial audio control.
- **Advanced Audio Processing**: Apply and manage a variety of audio filters for enhanced sound manipulation.
- **Dynamic Volume Control**: Adjust global and individual volume levels with support for smooth fading effects.
- **Synthesizer Integration**: Create and manipulate synthesized sounds with customizable oscillator options.
- **Efficient Group Management**: Organize and control multiple sounds or synthesizers as groups for streamlined audio management.
- **Live Microphone Input**: Capture and process real-time audio input from the user's microphone.
- **Audio Streaming**: Support for streaming audio directly from URLs.
- **Flexible Caching**: Implement efficient audio caching strategies for improved performance.

## Installation

```bash
npm install cacophony
```

## Quick Start

```typescript
import { Cacophony } from 'cacophony';

async function audioDemo() {
  const cacophony = new Cacophony();
  
  // Create and play a sound with 3D positioning
  const sound = await cacophony.createSound('path/to/audio.mp3');
  sound.play();
  sound.position = [1, 0, -1]; // Set sound position in 3D space

  // Create and play a synthesizer
  const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
  synth.play();

  // Apply a filter to the synth
  const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
  synth.addFilter(filter);

  // Create a group of sounds
  const group = await cacophony.createGroupFromUrls(['sound1.mp3', 'sound2.mp3']);
  group.play(); // Play all sounds in the group

  // Capture microphone input
  const micStream = await cacophony.getMicrophoneStream();
  micStream.play();
}

audioDemo();
```

## Detailed API Documentation

For a comprehensive overview of all classes, methods, and features, please refer to our [detailed documentation](https://cacophony.js.org).

## Audio Filters

Cacophony provides powerful audio filtering capabilities:

```typescript
const cacophony = new Cacophony();

// Create a lowpass filter
const lowpassFilter = cacophony.createBiquadFilter({
  type: 'lowpass',
  frequency: 1000,
  Q: 1
});

// Apply filter to a Sound
const sound = await cacophony.createSound('path/to/audio.mp3');
sound.addFilter(lowpassFilter);
sound.play();

// Apply filter to a Synth
const synth = cacophony.createOscillator({ frequency: 440, type: 'sawtooth' });
synth.addFilter(lowpassFilter);
synth.play();
```

## Synthesizer Functionality

Create and manipulate synthesized sounds with ease:

```typescript
const cacophony = new Cacophony();
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
synth.play();
synth.frequency = 880; // Change frequency
synth.type = 'square'; // Change waveform
synth.detune = 50; // Detune by 50 cents
```

## Group Functionality

Efficiently manage multiple sounds or synthesizers:

```typescript
const soundGroup = await cacophony.createGroupFromUrls(['sound1.mp3', 'sound2.mp3']);
soundGroup.play(); // Play all sounds in the group
soundGroup.volume = 0.5; // Set volume for all sounds in the group

const synthGroup = new SynthGroup();
synthGroup.addSynth(synth1);
synthGroup.addSynth(synth2);
synthGroup.play(); // Play all synths in the group
synthGroup.setVolume(0.8); // Set volume for all synths in the group
```

## Microphone Input

Capture and process live audio input:

```typescript
const cacophony = new Cacophony();
const micStream = await cacophony.getMicrophoneStream();
micStream.play();

// Apply effects to microphone input
const echoFilter = cacophony.createBiquadFilter({ type: 'delay', delayTime: 0.5 });
micStream.addFilter(echoFilter);
```

## 3D Audio Positioning

Create immersive audio experiences with spatial positioning:

```typescript
const sound = await cacophony.createSound('path/to/audio.mp3', SoundType.Buffer, 'HRTF');
sound.position = [1, 0, -1]; // Set position in 3D space
sound.play();

// Update listener position
cacophony.listenerPosition = [0, 0, 0];
```

## Additional Highlights

- **Efficient Caching**: Implement smart caching strategies for improved performance and reduced bandwidth usage.
- **Flexible Sound Types**: Support for various sound types including buffered audio, HTML5 audio, and streaming.
- **Advanced Looping Control**: Fine-grained control over audio looping, including infinite loops and specific loop counts.
- **Detailed Playback Information**: Access and control various playback parameters such as current time, duration, and playback rate.

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt).
