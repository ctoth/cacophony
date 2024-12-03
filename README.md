
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

## Audio Context Support

Cacophony supports both the standard Web Audio API and the `standardized-audio-context` package. You can use either:

```typescript
// Using standard Web Audio API
const context = new AudioContext();
const cacophony = new Cacophony(context);

// Using standardized-audio-context
import { AudioContext } from 'standardized-audio-context';
const standardizedContext = new AudioContext();
const cacophony = new Cacophony(standardizedContext);
```

## Quick Start

```typescript
import { Cacophony } from 'cacophony';

async function audioDemo() {
  // Using standard Web Audio API
  const context = new AudioContext();
  const cacophony = new Cacophony(context);
  
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

Create and manipulate synthesized sounds with advanced control:

```typescript
const cacophony = new Cacophony();

// Create a simple sine wave oscillator
const sineOsc = cacophony.createOscillator({ frequency: 440, type: 'sine' });
sineOsc.play();

// Create a complex sound with multiple oscillators
const complexSynth = cacophony.createOscillator({ frequency: 220, type: 'sawtooth' });
const subOsc = cacophony.createOscillator({ frequency: 110, type: 'sine' });
complexSynth.addFilter(cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 }));
complexSynth.play();
subOsc.play();

// Modulate frequency over time
let time = 0;
setInterval(() => {
  const frequency = 440 + Math.sin(time) * 100;
  sineOsc.frequency = frequency;
  time += 0.1;
}, 50);

// Apply envelope to volume
complexSynth.volume = 0;
complexSynth.fadeIn(0.5, 'linear');
setTimeout(() => complexSynth.fadeOut(1, 'exponential'), 2000);
```

## Group Functionality

Efficiently manage and control multiple sounds or synthesizers:

```typescript
const cacophony = new Cacophony();

// Create a group of sounds
const soundGroup = await cacophony.createGroupFromUrls(['drum.mp3', 'bass.mp3', 'synth.mp3']);

// Play all sounds in the group
soundGroup.play();

// Control volume for all sounds
soundGroup.volume = 0.7;

// Apply 3D positioning to the entire group
soundGroup.position = [1, 0, -1];

// Create a group of synthesizers
const synthGroup = new SynthGroup();
const synth1 = cacophony.createOscillator({ frequency: 440, type: 'sine' });
const synth2 = cacophony.createOscillator({ frequency: 660, type: 'square' });
synthGroup.addSynth(synth1);
synthGroup.addSynth(synth2);

// Play and control all synths in the group
synthGroup.play();
synthGroup.setVolume(0.5);
synthGroup.stereoPan = -0.3; // Pan slightly to the left

// Remove a synth from the group
synthGroup.removeSynth(synth2);
```

## Microphone Input

Capture, process, and manipulate live audio input:

```typescript
const cacophony = new Cacophony();

async function setupMicrophone() {
  try {
    const micStream = await cacophony.getMicrophoneStream();
    micStream.play();

    // Apply a low-pass filter to the microphone input
    const lowPassFilter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
    micStream.addFilter(lowPassFilter);

    // Add a delay effect
    const delayFilter = cacophony.createBiquadFilter({ type: 'delay', delayTime: 0.5 });
    micStream.addFilter(delayFilter);

    // Control microphone volume
    micStream.volume = 0.8;

    // Pause and resume microphone input
    setTimeout(() => {
      micStream.pause();
      console.log("Microphone paused");
      setTimeout(() => {
        micStream.resume();
        console.log("Microphone resumed");
      }, 2000);
    }, 5000);

  } catch (error) {
    console.error("Error accessing microphone:", error);
  }
}

setupMicrophone();
```

## 3D Audio Positioning

Create immersive soundscapes with precise spatial audio control:

```typescript
const cacophony = new Cacophony();

async function create3DAudioScene() {
  // Create sounds with HRTF panning
  const ambience = await cacophony.createSound('forest_ambience.mp3', SoundType.Buffer, 'HRTF');
  const birdSound = await cacophony.createSound('bird_chirp.mp3', SoundType.Buffer, 'HRTF');
  const footsteps = await cacophony.createSound('footsteps.mp3', SoundType.Buffer, 'HRTF');

  // Position sounds in 3D space
  ambience.position = [0, 0, -5]; // Slightly behind the listener
  birdSound.position = [10, 5, 0]; // To the right and above
  footsteps.position = [-2, -1, 2]; // Slightly to the left and in front

  // Play the sounds
  ambience.play();
  birdSound.play();
  footsteps.play();

  // Update listener position and orientation
  cacophony.listenerPosition = [0, 0, 0];
  cacophony.listenerOrientation = {
    forward: [0, 0, -1],
    up: [0, 1, 0]
  };

  // Animate bird sound position
  let time = 0;
  setInterval(() => {
    const x = Math.sin(time) * 10;
    birdSound.position = [x, 5, 0];
    time += 0.05;
  }, 50);

  // Change listener position over time
  setTimeout(() => {
    cacophony.listenerPosition = [0, 0, 5];
    console.log("Listener moved forward");
  }, 5000);
}

create3DAudioScene();
```

## Audio Streaming

Stream audio content efficiently:

```typescript
const cacophony = new Cacophony();

async function streamAudio() {
  try {
    const streamedSound = await cacophony.createStream('https://example.com/live_radio_stream');
    streamedSound.play();

    // Apply real-time effects to the stream
    const highPassFilter = cacophony.createBiquadFilter({ type: 'highpass', frequency: 500 });
    streamedSound.addFilter(highPassFilter);

    // Control streaming playback
    setTimeout(() => {
      streamedSound.pause();
      console.log("Stream paused");
      setTimeout(() => {
        streamedSound.play();
        console.log("Stream resumed");
      }, 5000);
    }, 10000);

  } catch (error) {
    console.error("Error streaming audio:", error);
  }
}

streamAudio();
```

## Additional Highlights

- **Efficient Caching**: Implement smart caching strategies for improved performance and reduced bandwidth usage.
- **Flexible Sound Types**: Support for various sound types including buffered audio, HTML5 audio, and streaming.
- **Advanced Looping Control**: Fine-grained control over audio looping, including infinite loops and specific loop counts.
- **Detailed Playback Information**: Access and control various playback parameters such as current time, duration, and playback rate.

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt).
