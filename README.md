
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

## Event System

Cacophony provides a comprehensive event system for monitoring loading progress, cache performance, and audio playback state:

### Loading Progress

Track download progress with real-time updates:

```typescript
const cacophony = new Cacophony();

// Show loading progress
cacophony.on('loadingStart', (event) => {
  console.log(`Started loading: ${event.url}`);
  showSpinner();
});

cacophony.on('loadingProgress', (event) => {
  const percent = event.progress * 100;
  console.log(`Progress: ${percent.toFixed(1)}%`);
  updateProgressBar(event.progress);
});

cacophony.on('loadingComplete', (event) => {
  console.log(`Loaded: ${event.url} (${event.size} bytes)`);
  hideSpinner();
});

const sound = await cacophony.createSound('large-audio-file.mp3');
```

### Error Handling

Handle loading and playback errors:

```typescript
// Global error handling
cacophony.on('loadingError', (event) => {
  console.error(`Failed to load ${event.url}:`, event.error);
  showErrorToast(`Failed to load audio: ${event.errorType}`);
});

// Sound-specific error handling
sound.on('soundError', (event) => {
  if (event.recoverable) {
    console.log('Retrying...');
    sound.play(); // Retry playback
  } else {
    console.error('Unrecoverable error:', event.error);
  }
});
```

### Cache Monitoring

Monitor cache performance:

```typescript
cacophony.on('cacheHit', (event) => {
  console.log(`Cache hit: ${event.url} (${event.cacheType})`);
});

cacophony.on('cacheMiss', (event) => {
  console.log(`Cache miss: ${event.url} (${event.reason})`);
});
```

### Global Playback Events

Track all audio activity across your application:

```typescript
// Monitor all playback globally
cacophony.on('globalPlay', (event) => {
  console.log('Audio started:', event.source);
  showGlobalAudioIndicator();
});

cacophony.on('globalStop', (event) => {
  console.log('Audio stopped:', event.source);
  hideGlobalAudioIndicator();
});

cacophony.on('globalPause', (event) => {
  console.log('Audio paused:', event.source);
});

// Use case: pause all audio when app backgrounds
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Global events let you track what's playing without manual state management
    console.log('App backgrounded - track via global events');
  }
});
```

### Playback Events

React to playback state changes:

```typescript
const sound = await cacophony.createSound('audio.mp3');

sound.on('play', (playback) => {
  console.log('Playing:', playback);
  updatePlayButton('pause');
});

sound.on('pause', () => {
  updatePlayButton('play');
});

sound.on('volumeChange', (volume) => {
  updateVolumeSlider(volume);
});
```

### Complete Event Reference

#### Cacophony Events

The main Cacophony instance emits global events for loading, caching, and errors:

| Event | Payload | Description |
|-------|---------|-------------|
| `loadingStart` | `LoadingStartEvent` | Fired when audio loading begins. Contains `url` and `timestamp`. |
| `loadingProgress` | `LoadingProgressEvent` | Fired during download. Contains `url`, `loaded`, `total`, `progress` (0-1), `timestamp`. |
| `loadingComplete` | `LoadingCompleteEvent` | Fired when loading succeeds. Contains `url`, `duration`, `size`, `timestamp`. |
| `loadingError` | `LoadingErrorEvent` | Fired when loading fails. Contains `url`, `error`, `errorType`, `timestamp`. |
| `cacheHit` | `CacheHitEvent` | Fired on cache hit. Contains `url`, `cacheType` ('memory'\|'browser'\|'conditional'), `timestamp`. |
| `cacheMiss` | `CacheMissEvent` | Fired on cache miss. Contains `url`, `reason` ('not-found'\|'expired'\|'invalid'), `timestamp`. |
| `cacheError` | `CacheErrorEvent` | Fired on cache operation error. Contains `url`, `error`, `operation`, `timestamp`. |
| `globalPlay` | `GlobalPlaybackEvent` | Fired when any Sound or Synth starts playing. Contains `source`, `timestamp`. |
| `globalStop` | `GlobalPlaybackEvent` | Fired when any Sound or Synth stops. Contains `source`, `timestamp`. |
| `globalPause` | `GlobalPlaybackEvent` | Fired when any Sound or Synth pauses. Contains `source`, `timestamp`. |

#### Sound Events

Sound instances emit events for playback state and property changes:

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `Playback` | Fired when sound starts playing. Receives the Playback instance. |
| `stop` | `void` | Fired when sound stops. |
| `pause` | `void` | Fired when sound pauses. |
| `volumeChange` | `number` | Fired when volume changes. Receives new volume value. |
| `rateChange` | `number` | Fired when playback rate changes. Receives new rate value. |
| `soundError` | `SoundErrorEvent` | Fired on playback errors. Contains `url`, `error`, `errorType`, `timestamp`, `recoverable`. |

#### Playback Events

Individual Playback instances emit fine-grained playback events:

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `BasePlayback` | Fired when playback starts. Receives the Playback instance. |
| `stop` | `void` | Fired when playback stops. |
| `error` | `PlaybackErrorEvent` | Fired on playback errors. Contains `error`, `errorType`, `timestamp`, `recoverable`. |

```typescript
const sound = await cacophony.createSound('audio.mp3');
const [playback] = sound.play();

playback.on('play', (pb) => {
  console.log('Playback started:', pb.currentTime);
});

playback.on('error', (event) => {
  if (event.recoverable) {
    console.log('Recoverable error, retrying...');
    playback.play();
  }
});
```

#### Synth Events

Synth instances emit events for synthesis parameter changes:

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `SynthPlayback` | Fired when synth starts playing. Receives the SynthPlayback instance. |
| `stop` | `void` | Fired when synth stops. |
| `pause` | `void` | Fired when synth pauses. |
| `frequencyChange` | `number` | Fired when frequency changes. Receives new frequency in Hz. |
| `typeChange` | `OscillatorType` | Fired when waveform type changes. Receives new type ('sine'\|'square'\|'sawtooth'\|'triangle'). |
| `detuneChange` | `number` | Fired when detune changes. Receives new detune value in cents. |
| `volumeChange` | `number` | Fired when volume changes. Receives new volume value. |
| `error` | `PlaybackErrorEvent` | Fired on playback errors. Contains `error`, `errorType`, `timestamp`, `recoverable`. |

```typescript
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });

synth.on('frequencyChange', (freq) => {
  console.log('Frequency changed to:', freq, 'Hz');
  updateFrequencyDisplay(freq);
});

synth.on('typeChange', (type) => {
  console.log('Waveform changed to:', type);
  updateWaveformDisplay(type);
});

synth.frequency = 880; // Triggers frequencyChange event
synth.type = 'square'; // Triggers typeChange event
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
