
# Cacophony: Advanced Browser Audio Library

Cacophony is a powerful and intuitive audio library designed for modern web applications. It provides a high-level interface to the Web Audio API, simplifying complex audio operations while offering fine-grained control. Cacophony is perfect for projects ranging from simple sound playback to sophisticated audio processing and 3D audio positioning.

## Key Features

- **Versatile Audio Source Handling**: Manage audio from various sources including `AudioBuffer`, URL strings, synthesizers, and live microphone input
- **Comprehensive Playback Control**: Play, stop, pause, resume, loop, and seek within audio with ease
- **3D Audio Positioning**: Create immersive soundscapes with precise spatial audio control
- **Advanced Audio Processing**: Apply and manage a variety of audio filters for enhanced sound manipulation
- **Dynamic Volume Control**: Adjust global and individual volume levels with support for smooth fading effects
- **Synthesizer Integration**: Create and manipulate synthesized sounds with customizable oscillator options
- **Efficient Group Management**: Organize and control multiple sounds or synthesizers as groups for streamlined audio management
- **Live Microphone Input**: Capture and process real-time audio input from the user's microphone
- **Audio Streaming**: Support for streaming audio directly from URLs
- **Flexible Caching**: Implement efficient audio caching strategies for improved performance

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

## Core Concepts

### Sound vs Playback Architecture

Cacophony uses a two-tier architecture that separates audio assets from their playback instances:

- **Sound**: Represents an audio asset (file or buffer). Acts as a container managing multiple playback instances.
- **Playback**: Represents a single playback instance of a Sound. Each call to `play()` creates a new Playback.

This design allows the same sound to be played multiple times simultaneously with different settings (volume, position, playback rate, etc.).

```typescript
const sound = await cacophony.createSound('laser.mp3');

// Play the same sound three times with different settings
const [playback1] = sound.play();
playback1.volume = 0.3;
playback1.playbackRate = 1.0;

const [playback2] = sound.play();
playback2.volume = 0.8;
playback2.playbackRate = 1.5;  // Higher pitched

const [playback3] = sound.play();
playback3.volume = 0.5;
playback3.position = [5, 0, 0];  // Positioned to the right

// Control individual playbacks
setTimeout(() => playback1.pause(), 1000);
setTimeout(() => playback2.stop(), 2000);

// Or control all playbacks through the Sound
sound.stop();  // Stops all three playbacks
```

## Sound Types

Cacophony supports three sound types, each optimized for different use cases:

| Type | Memory | Latency | Seeking | Multiple Instances | Best For |
|------|--------|---------|---------|-------------------|----------|
| **Buffer** (default) | High | None | Full | Yes | Sound effects, UI sounds, short music clips |
| **HTML** | Medium | Low | Full | Limited | Background music, large audio files, podcasts |
| **Streaming** | Low | Medium | Limited | No | Internet radio, live streams, very large files |

```typescript
// Buffer - entire file loaded into memory
const sfx = await cacophony.createSound('explosion.mp3', SoundType.Buffer);

// HTML - streams from network, good for large files
const music = await cacophony.createSound('bgm.mp3', SoundType.HTML);

// Streaming - for live streams
const radio = await cacophony.createStream('https://example.com/stream.m3u8');
```

## Playback Control

### Seeking

```typescript
const sound = await cacophony.createSound('podcast.mp3');
sound.play();

// Seek to 30 seconds
sound.seek(30);

// Seek on individual playback
const [playback] = sound.play();
playback.seek(45);

// Get current time
console.log(playback.currentTime);  // Current position in seconds
console.log(playback.duration);     // Total duration
```

### Playback Rate

Control the speed of playback (affects pitch):

```typescript
const sound = await cacophony.createSound('audio.mp3');

sound.playbackRate = 1.0;   // Normal speed
sound.playbackRate = 2.0;   // Double speed (higher pitch)
sound.playbackRate = 0.5;   // Half speed (lower pitch)

// Apply to individual playback
const [playback] = sound.play();
playback.playbackRate = 1.25;
```

### Looping

```typescript
const sound = await cacophony.createSound('music.mp3');

// Loop indefinitely
sound.loop('infinite');
sound.play();

// Loop exactly 3 times
sound.loop(3);
sound.play();

// No looping (default)
sound.loop(0);
```

## Volume Control

Cacophony provides a hierarchical volume control system:

```typescript
const cacophony = new Cacophony();
const sound = await cacophony.createSound('audio.mp3');
const [playback] = sound.play();

// Global volume (affects all audio)
cacophony.volume = 0.5;  // 50% of original volume

// Sound volume (affects all playbacks of this sound)
sound.volume = 0.8;      // 80% of global volume

// Individual playback volume
playback.volume = 0.6;   // 60% of sound volume

// Final volume = global × sound × playback = 0.5 × 0.8 × 0.6 = 0.24

// Mute/unmute
cacophony.mute();
cacophony.unmute();
```

## Audio Filters

Cacophony provides powerful audio filtering capabilities using BiquadFilterNode. Filters can be applied to Sounds, Synths, Playbacks, and Groups.

Supported filter types: `lowpass`, `highpass`, `bandpass`, `lowshelf`, `highshelf`, `peaking`, `notch`, `allpass`.

```typescript
const cacophony = new Cacophony();
const sound = await cacophony.createSound('audio.mp3');

// Create filters
const lowpass = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000, Q: 1 });
const highshelf = cacophony.createBiquadFilter({ type: 'highshelf', frequency: 5000, gain: -6 });

// Apply filters (they are chained in order)
sound.addFilter(lowpass);
sound.addFilter(highshelf);

// Apply to Synth
const synth = cacophony.createOscillator({ frequency: 440, type: 'sawtooth' });
synth.addFilter(lowpass);

// Remove filters
sound.removeFilter(lowpass);
```

See [TypeDoc](https://cacophony.js.org) for complete filter parameters and options.

## Cloning

Clone sounds to create variations without reloading files. Clones share the same AudioBuffer but have independent settings.

```typescript
const footstep = await cacophony.createSound('footstep.mp3');

// Create variations for different enemy sizes
const largeEnemy = footstep.clone({
  position: [10, 0, -5],
  playbackRate: 0.8,  // Slower/lower pitch
  volume: 0.9
});

const smallEnemy = footstep.clone({
  position: [-5, 0, -10],
  playbackRate: 1.25,  // Faster/higher pitch
  volume: 0.4
});

largeEnemy.play();
smallEnemy.play();

// Weapon sound variants
const gunshotBase = await cacophony.createSound('gunshot.mp3');

const weapons = {
  pistol: gunshotBase.clone({ volume: 0.6, playbackRate: 1.2 }),
  rifle: gunshotBase.clone({ volume: 1.0, playbackRate: 1.0 }),
  shotgun: gunshotBase.clone({
    volume: 1.2,
    playbackRate: 0.8,
    filters: [cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1200 })]
  })
};

// Musical instrument samples by pitch-shifting
const pianoC4 = await cacophony.createSound('piano_c4.mp3');
const keyboard = {
  C4: pianoC4,
  D4: pianoC4.clone({ playbackRate: 1.122 }),  // +2 semitones
  E4: pianoC4.clone({ playbackRate: 1.260 }),  // +4 semitones
  F4: pianoC4.clone({ playbackRate: 1.335 }),  // +5 semitones
  G4: pianoC4.clone({ playbackRate: 1.498 }),  // +7 semitones
};
```

## Group Functionality

Groups allow controlling multiple sounds or synthesizers as a single unit.

```typescript
const cacophony = new Cacophony();

// Create from URLs
const soundGroup = await cacophony.createGroupFromUrls(['drum.mp3', 'bass.mp3', 'synth.mp3']);

// Play all sounds simultaneously
soundGroup.play();

// Control all sounds at once
soundGroup.volume = 0.7;
soundGroup.playbackRate = 1.2;
soundGroup.position = [5, 0, 0];
soundGroup.loop('infinite');

// Apply filters to entire group
const lowpass = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
soundGroup.addFilter(lowpass);

// Play random sound from group
const footsteps = await cacophony.createGroupFromUrls([
  'footstep1.mp3',
  'footstep2.mp3',
  'footstep3.mp3',
  'footstep4.mp3'
]);

footsteps.playRandom();  // Picks one at random

// Play sounds in sequence
const dialog = await cacophony.createGroupFromUrls(['line1.mp3', 'line2.mp3', 'line3.mp3']);
dialog.playOrdered(true);  // Plays: 1, 2, 3, 1, 2, 3...

// SynthGroup for synthesizers
const synthGroup = new SynthGroup();
const synth1 = cacophony.createOscillator({ frequency: 440, type: 'sine' });
const synth2 = cacophony.createOscillator({ frequency: 660, type: 'square' });
synthGroup.addSynth(synth1);
synthGroup.addSynth(synth2);
synthGroup.play();
synthGroup.setVolume(0.5);
```

## Synthesizer Functionality

Create oscillator-based sounds with four waveform types: `sine`, `square`, `sawtooth`, `triangle`.

```typescript
const cacophony = new Cacophony();

// Create oscillators
const sineOsc = cacophony.createOscillator({ frequency: 440, type: 'sine' });
sineOsc.play();

// Change parameters in real-time
sineOsc.frequency = 880;  // Change frequency
sineOsc.type = 'sawtooth';  // Change waveform
sineOsc.detune = 10;  // Detune in cents (1/100th of a semitone)

// Layer multiple oscillators
const bass = cacophony.createOscillator({ frequency: 110, type: 'sine' });
const lead = cacophony.createOscillator({ frequency: 440, type: 'sawtooth' });
bass.volume = 0.7;
lead.volume = 0.5;
bass.addFilter(cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 }));
bass.play();
lead.play();

// Modulate frequency over time
let time = 0;
setInterval(() => {
  const frequency = 440 + Math.sin(time) * 100;
  sineOsc.frequency = frequency;
  time += 0.1;
}, 50);
```

## 3D Audio Positioning

Create immersive soundscapes with precise spatial audio control using HRTF (Head-Related Transfer Function) or stereo panning.

```typescript
const cacophony = new Cacophony();

// Create sounds with HRTF panning
const ambience = await cacophony.createSound('forest_ambience.mp3', SoundType.Buffer, 'HRTF');
const birdSound = await cacophony.createSound('bird_chirp.mp3', SoundType.Buffer, 'HRTF');
const footsteps = await cacophony.createSound('footsteps.mp3', SoundType.Buffer, 'HRTF');

// Position sounds in 3D space
// Coordinate system: X (left- to right+), Y (down- to up+), Z (front+ to back-)
ambience.position = [0, 0, -5];  // Slightly behind the listener
birdSound.position = [10, 5, 0];  // To the right and above
footsteps.position = [-2, -1, 2];  // Slightly to the left and in front

// Configure distance attenuation
birdSound.threeDOptions = {
  distanceModel: 'inverse',  // 'linear', 'inverse', or 'exponential'
  refDistance: 1,
  rolloffFactor: 1
};

// Play the sounds
ambience.play();
birdSound.play();
footsteps.play();

// Set listener position and orientation
cacophony.listenerPosition = [0, 0, 0];
cacophony.listenerOrientation = {
  forward: [0, 0, -1],  // Looking towards negative Z
  up: [0, 1, 0]
};

// Animate bird sound position
let time = 0;
setInterval(() => {
  const x = Math.sin(time) * 10;
  birdSound.position = [x, 5, 0];
  time += 0.05;
}, 50);

// Stereo panning (simple left-right)
const stereoSound = await cacophony.createSound('audio.mp3', SoundType.Buffer, 'stereo');
stereoSound.stereoPan = 0.5;  // -1 (left) to 1 (right)
stereoSound.play();
```

See [TypeDoc](https://cacophony.js.org) for distance models, cone effects, and advanced 3D audio options.

## Microphone Input

Capture, process, and manipulate live audio input:

```typescript
const cacophony = new Cacophony();

try {
  const micStream = await cacophony.getMicrophoneStream();
  micStream.play();

  // Apply filters to microphone input
  const lowPassFilter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
  micStream.addFilter(lowPassFilter);

  // Control microphone volume
  micStream.volume = 0.8;

  // Pause and resume
  setTimeout(() => {
    micStream.pause();
    setTimeout(() => micStream.resume(), 2000);
  }, 5000);

} catch (error) {
  console.error("Error accessing microphone:", error);
}
```

## Audio Streaming

Stream audio content efficiently:

```typescript
const cacophony = new Cacophony();

try {
  const streamedSound = await cacophony.createStream('https://example.com/live_radio_stream');
  streamedSound.play();

  // Apply real-time effects to the stream
  const highPassFilter = cacophony.createBiquadFilter({ type: 'highpass', frequency: 500 });
  streamedSound.addFilter(highPassFilter);

  // Control streaming playback
  setTimeout(() => {
    streamedSound.pause();
    setTimeout(() => streamedSound.play(), 5000);
  }, 10000);

} catch (error) {
  console.error("Error streaming audio:", error);
}
```

## Event System

Cacophony provides a comprehensive event system for monitoring loading progress, cache performance, and audio playback state.

### Loading Progress

```typescript
const cacophony = new Cacophony();

cacophony.on('loadingStart', (event) => {
  console.log(`Started loading: ${event.url}`);
  showSpinner();
});

cacophony.on('loadingProgress', (event) => {
  const percent = event.progress * 100;
  updateProgressBar(event.progress);
});

cacophony.on('loadingComplete', (event) => {
  console.log(`Loaded: ${event.url} (${event.size} bytes)`);
  hideSpinner();
});

const sound = await cacophony.createSound('large-audio-file.mp3');
```

### Error Handling

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
    sound.play();
  } else {
    console.error('Unrecoverable error:', event.error);
  }
});
```

### Global Playback Events

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
```

### Playback Events

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

// Playback instance events
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

### Synth Events

```typescript
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });

synth.on('frequencyChange', (freq) => {
  console.log('Frequency changed to:', freq, 'Hz');
});

synth.on('typeChange', (type) => {
  console.log('Waveform changed to:', type);
});

synth.frequency = 880;  // Triggers frequencyChange event
synth.type = 'square';  // Triggers typeChange event
```

### Complete Event Reference

#### Cacophony Events

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

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `Playback` | Fired when sound starts playing. Receives the Playback instance. |
| `stop` | `void` | Fired when sound stops. |
| `pause` | `void` | Fired when sound pauses. |
| `volumeChange` | `number` | Fired when volume changes. Receives new volume value. |
| `rateChange` | `number` | Fired when playback rate changes. Receives new rate value. |
| `soundError` | `SoundErrorEvent` | Fired on playback errors. Contains `url`, `error`, `errorType`, `timestamp`, `recoverable`. |

#### Playback Events

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `BasePlayback` | Fired when playback starts. Receives the Playback instance. |
| `stop` | `void` | Fired when playback stops. |
| `error` | `PlaybackErrorEvent` | Fired on playback errors. Contains `error`, `errorType`, `timestamp`, `recoverable`. |

#### Synth Events

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

## Caching

Cacophony implements intelligent three-layer caching for optimal performance:

**Memory Cache (LRU)** → **Browser Cache API** → **Network**

The cache system is fully automatic and HTTP-compliant, respecting standard cache headers (ETag, Last-Modified). When cache validation tokens are available, Cacophony makes lightweight conditional requests (304 responses have no body). When tokens are unavailable, it falls back to TTL-based caching (24 hours default).

```typescript
const cacophony = new Cacophony();

// First load - fetches from network, stores in cache
const sound1 = await cacophony.createSound('audio.mp3');

// Second load - instant from memory cache
const sound2 = await cacophony.createSound('audio.mp3');

// Monitor cache performance via events
cacophony.on('cacheHit', (event) => {
  console.log(`${event.cacheType} cache hit: ${event.url}`);
  // cacheType: 'memory' | 'browser' | 'conditional'
});

cacophony.on('cacheMiss', (event) => {
  console.log(`Cache miss: ${event.url} - ${event.reason}`);
  // reason: 'not-found' | 'expired' | 'invalid'
});

// Clear memory cache (browser cache persists)
cacophony.clearMemoryCache();

// Optional: configure TTL for when no validation tokens exist
import { AudioCache } from 'cacophony';
AudioCache.setCacheExpirationTime(60 * 60 * 1000); // 1 hour
```

The caching system requires no configuration in most cases. It automatically optimizes for performance while respecting HTTP standards.

## Cancellation with AbortSignal

Cancel audio loading operations:

```typescript
const controller = new AbortController();

const soundPromise = cacophony.createSound(
  'large-file.mp3',
  SoundType.Buffer,
  'HRTF',
  controller.signal
);

// Cancel loading
router.on('navigate', () => controller.abort());

try {
  const sound = await soundPromise;
  sound.play();
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Loading was cancelled');
  }
}

// Works with groups too
const group = await cacophony.createGroupFromUrls(
  ['a.mp3', 'b.mp3', 'c.mp3'],
  SoundType.Buffer,
  'HRTF',
  controller.signal
);
```

## Resource Management

Call `cleanup()` when done with sounds to free resources:

```typescript
const sound = await cacophony.createSound('temp.mp3');
sound.play();
sound.cleanup();  // Disconnects nodes, removes playbacks, clears listeners

// Clear memory cache
cacophony.clearMemoryCache();
```

Cacophony uses `FinalizationRegistry` for automatic cleanup when objects are garbage collected, but explicit cleanup is recommended for large applications.

## Audio Context Control

Suspend and resume the entire audio context to pause all audio processing. Useful for mobile apps when entering background mode or for performance optimization:

```typescript
const cacophony = new Cacophony();

// Suspend audio context (pauses ALL audio, saves battery)
cacophony.pause();

// Resume audio context
cacophony.resume();

// Example: pause when app goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cacophony.pause();
  } else {
    cacophony.resume();
  }
});
```

Note: This is different from `sound.pause()` which pauses individual sounds. `cacophony.pause()` suspends the entire audio engine.

## API Documentation

For complete API documentation including all methods, parameters, and options, see the [TypeDoc documentation](https://cacophony.js.org).

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt).
