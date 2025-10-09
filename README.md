
# Cacophony: Advanced Browser Audio Library

Cacophony is a powerful and intuitive audio library designed for modern web applications. It provides a high-level interface to the Web Audio API, simplifying complex audio operations while offering fine-grained control.

## Key Features

- **Versatile Audio Source Handling**: Manage audio from buffers, URLs, synthesizers, and live microphone input
- **Comprehensive Playback Control**: Play, stop, pause, resume, loop, and seek
- **3D Audio Positioning**: Create immersive soundscapes with HRTF spatial audio
- **Advanced Audio Processing**: Apply and chain audio filters
- **Synthesizer Integration**: Create and manipulate oscillator-based sounds
- **Group Management**: Control multiple sounds or synthesizers as a single unit
- **Efficient Caching**: Smart caching with HTTP standards compliance

## Installation

```bash
npm install cacophony
```

## Quick Start

```typescript
import { Cacophony } from 'cacophony';

const cacophony = new Cacophony();

// Load and play a sound
const sound = await cacophony.createSound('audio.mp3');
sound.play();

// Create a synthesizer
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
synth.play();

// 3D positioning
sound.position = [5, 0, -10];

// Apply filters
const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
sound.addFilter(filter);
```

## Core Concepts

### Sound vs Playback Architecture

Cacophony uses a two-tier architecture:

- **Sound**: Represents an audio asset (file or buffer). Acts as a container managing multiple playback instances.
- **Playback**: Represents a single playback instance. Each call to `play()` creates a new Playback.

This allows the same sound to be played multiple times simultaneously with different settings.

```typescript
const sound = await cacophony.createSound('laser.mp3');

// Play the same sound three times with different settings
const [playback1] = sound.play();
playback1.volume = 0.3;

const [playback2] = sound.play();
playback2.playbackRate = 1.5;  // Higher pitched

const [playback3] = sound.play();
playback3.position = [5, 0, 0];  // Positioned to the right

// Control all playbacks at once
sound.stop();  // Stops all three
```

**When to control Sound vs Playback:**
- Control the **Sound** to set defaults or affect all instances
- Control individual **Playbacks** for independent volume, position, or playback rate

## Sound Types

Cacophony supports three sound types, each optimized for different use cases:

| Type | Memory | Latency | Seeking | Multiple Instances | Best For |
|------|--------|---------|---------|-------------------|----------|
| **Buffer** (default) | High | None | Full | Yes | Sound effects, UI sounds |
| **HTML** | Medium | Low | Full | Limited | Background music, large files |
| **Streaming** | Low | Medium | Limited | No | Internet radio, live streams |

```typescript
// Buffer - entire file loaded into memory
const sfx = await cacophony.createSound('explosion.mp3', SoundType.Buffer);

// HTML - streams from network
const music = await cacophony.createSound('bgm.mp3', SoundType.HTML);

// Streaming - for live streams
const radio = await cacophony.createStream('https://example.com/stream.m3u8');
```

## Audio Filters

Apply BiquadFilters to Sounds, Synths, Playbacks, or Groups. Supports: `lowpass`, `highpass`, `bandpass`, `lowshelf`, `highshelf`, `peaking`, `notch`, `allpass`.

```typescript
// Create and apply filters
const lowpass = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000, Q: 1 });
const highshelf = cacophony.createBiquadFilter({ type: 'highshelf', frequency: 5000, gain: -6 });

sound.addFilter(lowpass);
sound.addFilter(highshelf);

// Filters are applied in order (chaining)
// First lowpass, then highshelf
```

See [TypeDoc](https://cacophony.js.org) for all filter parameters and options.

## Cloning

Clone sounds to create variations without reloading files. Clones share the same AudioBuffer but have independent settings.

### Enemy Footstep Variations

```typescript
const footstep = await cacophony.createSound('footstep.mp3');

class Enemy {
  footstepSound: Sound;

  constructor(position: [number, number, number], size: number) {
    this.footstepSound = footstep.clone({
      position,
      playbackRate: 1 / size,  // Bigger = slower/lower pitch
      volume: size * 0.5
    });
  }

  step() {
    this.footstepSound.play();
  }
}

const enemies = [
  new Enemy([10, 0, -5], 1.2),   // Large enemy
  new Enemy([-5, 0, -10], 0.8),  // Small enemy
  new Enemy([0, 0, -20], 1.0)    // Normal enemy
];
```

### Weapon Sound Variants

```typescript
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

weapons.pistol.play();
```

### Musical Instrument Samples

```typescript
const pianoC4 = await cacophony.createSound('piano_c4.mp3');

// Create a piano keyboard by pitch-shifting
const keyboard = {
  C4: pianoC4,
  D4: pianoC4.clone({ playbackRate: 1.122 }),  // +2 semitones
  E4: pianoC4.clone({ playbackRate: 1.260 }),  // +4 semitones
  F4: pianoC4.clone({ playbackRate: 1.335 }),  // +5 semitones
  G4: pianoC4.clone({ playbackRate: 1.498 }),  // +7 semitones
  A4: pianoC4.clone({ playbackRate: 1.682 }),  // +9 semitones
  B4: pianoC4.clone({ playbackRate: 1.888 })   // +11 semitones
};

// Play a chord
keyboard.C4.play();
keyboard.E4.play();
keyboard.G4.play();
```

## 3D Audio Positioning

Cacophony provides 3D spatial audio using HRTF (Head-Related Transfer Function) or simple stereo panning.

### Coordinate System

Right-handed coordinate system:
- **X-axis**: Left (-) to Right (+)
- **Y-axis**: Down (-) to Up (+)
- **Z-axis**: Front (+) to Back (-)

Units are arbitrary but consistent (common: 1 unit = 1 meter).

### Basic Example

```typescript
// HRTF: True 3D audio
const sound = await cacophony.createSound('footsteps.mp3', SoundType.Buffer, 'HRTF');

// Set listener position and orientation
cacophony.listenerPosition = [0, 0, 0];
cacophony.listenerOrientation = {
  forward: [0, 0, -1],
  up: [0, 1, 0]
};

// Position sound in 3D space
sound.position = [5, 0, -10];  // Right 5 units, forward 10 units

// Configure distance attenuation
sound.threeDOptions = {
  distanceModel: 'inverse',
  refDistance: 1,
  rolloffFactor: 1
};

sound.play();

// Stereo panning (simple L/R)
const stereoSound = await cacophony.createSound('audio.mp3', SoundType.Buffer, 'stereo');
stereoSound.stereoPan = 0.5;  // -1 (left) to 1 (right)
```

See [TypeDoc](https://cacophony.js.org) for distance models, cone effects, and advanced 3D audio options.

## Group Functionality

Groups allow controlling multiple sounds or synthesizers as a single unit.

```typescript
// Create from URLs
const footsteps = await cacophony.createGroupFromUrls([
  'footstep1.mp3',
  'footstep2.mp3',
  'footstep3.mp3',
  'footstep4.mp3'
]);

// Play random variation
footsteps.playRandom();

// Play in sequence
const dialog = await cacophony.createGroupFromUrls(['line1.mp3', 'line2.mp3', 'line3.mp3']);
dialog.playOrdered(true);  // Plays: 1, 2, 3, 1, 2, 3...

// Control all sounds at once
const ambient = await cacophony.createGroupFromUrls(['wind.mp3', 'birds.mp3', 'water.mp3']);
ambient.loop('infinite');
ambient.volume = 0.3;
ambient.play();
```

## Synthesizers

Create oscillator-based sounds with four waveform types: `sine`, `square`, `sawtooth`, `triangle`.

```typescript
// Create oscillator
const synth = cacophony.createOscillator({ frequency: 440, type: 'sine' });
synth.play();

// Change parameters in real-time
synth.frequency = 880;
synth.type = 'sawtooth';
synth.detune = 10;  // Cents (1/100th of a semitone)

// Layer multiple oscillators
const bass = cacophony.createOscillator({ frequency: 110, type: 'sine' });
const lead = cacophony.createOscillator({ frequency: 440, type: 'sawtooth' });
bass.volume = 0.7;
lead.volume = 0.5;
bass.play();
lead.play();
```

## Event System

Cacophony provides comprehensive events for monitoring loading, caching, playback, and errors.

### Cacophony Events

| Event | Description |
|-------|-------------|
| `loadingStart` | Audio loading begins |
| `loadingProgress` | Download progress update (includes `progress` 0-1) |
| `loadingComplete` | Loading succeeded |
| `loadingError` | Loading failed |
| `cacheHit` | Audio loaded from cache |
| `cacheMiss` | Audio not in cache |
| `globalPlay` | Any Sound or Synth starts playing |
| `globalStop` | Any Sound or Synth stops |
| `globalPause` | Any Sound or Synth pauses |

### Sound Events

| Event | Description |
|-------|-------------|
| `play` | Sound starts playing (receives Playback instance) |
| `stop` | Sound stops |
| `pause` | Sound pauses |
| `volumeChange` | Volume changes |
| `rateChange` | Playback rate changes |
| `soundError` | Playback error occurred |

### Synth Events

| Event | Description |
|-------|-------------|
| `play` | Synth starts playing |
| `stop` | Synth stops |
| `frequencyChange` | Frequency changes |
| `typeChange` | Waveform type changes |
| `detuneChange` | Detune changes |

### Example

```typescript
// Monitor loading progress
cacophony.on('loadingProgress', (event) => {
  updateProgressBar(event.progress);
});

// Track playback globally
cacophony.on('globalPlay', (event) => {
  console.log('Audio started:', event.source);
});

// React to sound events
sound.on('play', (playback) => {
  console.log('Playing:', playback.currentTime);
});
```

See [TypeDoc](https://cacophony.js.org) for complete event payloads and error handling.

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

// Works with groups too
const group = await cacophony.createGroupFromUrls(
  ['a.mp3', 'b.mp3', 'c.mp3'],
  SoundType.Buffer,
  'HRTF',
  controller.signal
);
```

## API Documentation

For complete API documentation including all methods, parameters, and options, see the [TypeDoc documentation](https://cacophony.js.org).

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt).
