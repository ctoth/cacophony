
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

## Core Concepts

### Sound vs Playback Architecture

Cacophony uses a two-tier architecture that separates audio assets from their playback instances:

- **Sound**: Represents an audio asset (file or buffer). Acts as a container managing multiple playback instances.
- **Playback**: Represents a single playback instance of a Sound. Each call to `play()` creates a new Playback.

This design allows the same sound to be played multiple times simultaneously with different settings (volume, position, playback rate, etc.).

```typescript
const cacophony = new Cacophony();
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

### When to Control Sound vs Playback

**Control the Sound when:**
- Setting default properties for future playbacks
- Stopping/pausing all instances at once
- Applying filters or effects to all current and future playbacks

**Control individual Playbacks when:**
- Each playback needs different volume, position, or playback rate
- Managing lifecycle of specific instances (e.g., pause one but not others)
- Implementing complex audio behaviors (overlapping, echoes, etc.)

## Detailed API Documentation

For a comprehensive overview of all classes, methods, and features, please refer to our [detailed documentation](https://cacophony.js.org).

## Sound Types

Cacophony supports three different sound types, each optimized for different use cases:

### SoundType.Buffer (Default)

Best for short to medium-length sounds that need precise control.

```typescript
const sound = await cacophony.createSound('sfx.mp3', SoundType.Buffer);
```

**Characteristics:**
- ✅ Entire audio file loaded into memory
- ✅ Instant playback, no latency
- ✅ Full seeking support
- ✅ Can be played multiple times simultaneously
- ❌ Higher memory usage for large files
- **Best for:** Sound effects, UI sounds, short music clips

### SoundType.HTML

Uses HTML5 Audio element, good for larger files.

```typescript
const sound = await cacophony.createSound('music.mp3', SoundType.HTML);
```

**Characteristics:**
- ✅ Streams from network, lower memory usage
- ✅ Good for large files (background music, podcasts)
- ✅ Supports seeking
- ⚠️ Slight latency on first play
- ❌ Browser autoplay policies may apply
- **Best for:** Background music, large audio files, podcasts

### SoundType.Streaming

For live streams and very large files.

```typescript
const sound = await cacophony.createStream('https://example.com/radio.m3u8');
```

**Characteristics:**
- ✅ Minimal memory footprint
- ✅ Ideal for live audio streams
- ⚠️ Seeking support depends on stream format
- ⚠️ Network-dependent playback quality
- **Best for:** Internet radio, live streams, very large files

### Comparison Table

| Feature | Buffer | HTML | Streaming |
|---------|--------|------|-----------|
| Memory Usage | High | Medium | Low |
| Latency | None | Low | Medium |
| Seeking | Full | Full | Limited |
| Multiple Instances | Yes | Limited | No |
| Network Dependency | Initial only | Continuous | Continuous |

## Audio Filters

Cacophony provides powerful audio filtering capabilities using BiquadFilterNode. Filters can be applied to Sounds, Synths, Playbacks, and Groups.

### Filter Types

#### Lowpass
Allows frequencies below the cutoff to pass through, attenuates higher frequencies.

```typescript
const lowpass = cacophony.createBiquadFilter({
  type: 'lowpass',
  frequency: 1000,  // Cutoff frequency in Hz
  Q: 1             // Resonance at cutoff
});
```
**Use cases:** Muffled sounds, distance effects, removing high-frequency noise

#### Highpass
Allows frequencies above the cutoff to pass through, attenuates lower frequencies.

```typescript
const highpass = cacophony.createBiquadFilter({
  type: 'highpass',
  frequency: 500,
  Q: 1
});
```
**Use cases:** Tinny/phone effects, removing rumble, radio effects

#### Bandpass
Allows frequencies within a range to pass through.

```typescript
const bandpass = cacophony.createBiquadFilter({
  type: 'bandpass',
  frequency: 1000,  // Center frequency
  Q: 2             // Width of the band (higher Q = narrower)
});
```
**Use cases:** Isolating specific frequency ranges, telephone effects

#### Lowshelf
Boosts or cuts frequencies below a certain point.

```typescript
const lowshelf = cacophony.createBiquadFilter({
  type: 'lowshelf',
  frequency: 200,
  gain: 10  // Boost low frequencies by 10dB
});
```
**Use cases:** Bass boost, EQ adjustments

#### Highshelf
Boosts or cuts frequencies above a certain point.

```typescript
const highshelf = cacophony.createBiquadFilter({
  type: 'highshelf',
  frequency: 5000,
  gain: -6  // Cut high frequencies by 6dB
});
```
**Use cases:** Treble adjustments, brightness control

#### Peaking
Boosts or cuts frequencies around a center frequency.

```typescript
const peaking = cacophony.createBiquadFilter({
  type: 'peaking',
  frequency: 1000,
  Q: 2,
  gain: 8  // Boost mid frequencies
});
```
**Use cases:** EQ, resonance effects, vocal enhancement

#### Notch
Removes frequencies around a center frequency (opposite of peaking).

```typescript
const notch = cacophony.createBiquadFilter({
  type: 'notch',
  frequency: 60,  // Remove 60Hz hum
  Q: 10          // Narrow notch
});
```
**Use cases:** Removing specific unwanted frequencies, hum removal

#### Allpass
Changes phase relationship without affecting frequency amplitude.

```typescript
const allpass = cacophony.createBiquadFilter({
  type: 'allpass',
  frequency: 1000,
  Q: 1
});
```
**Use cases:** Phase effects, creating flanging/phasing

### Applying Filters

```typescript
const cacophony = new Cacophony();
const sound = await cacophony.createSound('audio.mp3');

// Create filters
const lowpass = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
const reverb = cacophony.createBiquadFilter({ type: 'peaking', frequency: 2000, gain: 4 });

// Apply to Sound (affects all current and future playbacks)
sound.addFilter(lowpass);
sound.addFilter(reverb);

// Apply to Synth
const synth = cacophony.createOscillator({ frequency: 440, type: 'sawtooth' });
synth.addFilter(lowpass);

// Apply to Group (affects all sounds in the group)
const group = await cacophony.createGroupFromUrls(['s1.mp3', 's2.mp3']);
group.addFilter(lowpass);

// Remove filters
sound.removeFilter(lowpass);
```

### Chaining Multiple Filters

Filters are applied in the order they are added:

```typescript
// Create a complex filter chain
const lowpass = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 2000 });
const highpass = cacophony.createBiquadFilter({ type: 'highpass', frequency: 200 });
const peaking = cacophony.createBiquadFilter({ type: 'peaking', frequency: 1000, gain: 6, Q: 2 });

sound.addFilter(highpass);  // First: remove low rumble
sound.addFilter(peaking);   // Second: boost mids
sound.addFilter(lowpass);   // Third: soften highs
```

## Playback Control

Cacophony provides fine-grained control over audio playback including seeking, playback rate, and looping.

### Seeking

Jump to any point in the audio:

```typescript
const sound = await cacophony.createSound('podcast.mp3');
sound.play();

// Seek to 30 seconds
sound.seek(30);

// Seek on individual playback
const [playback] = sound.play();
playback.seek(45);  // Jump to 45 seconds

// Get current time
console.log(playback.currentTime);  // Current position in seconds
console.log(playback.duration);     // Total duration
```

### Playback Rate

Control the speed of playback (affects pitch):

```typescript
const sound = await cacophony.createSound('audio.mp3');

// Normal speed
sound.playbackRate = 1.0;

// Double speed (higher pitch)
sound.playbackRate = 2.0;

// Half speed (lower pitch)
sound.playbackRate = 0.5;

// Fast-forward effect
sound.playbackRate = 1.5;

// Apply to individual playback
const [playback] = sound.play();
playback.playbackRate = 1.25;
```

**Note:** Playback rate affects both speed and pitch. For time-stretching without pitch change, use audio worklets (advanced feature).

### Looping

Control how many times audio repeats:

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

// Get current loop setting
const loopCount = sound.loop();  // Returns current loop count
```

### Pause and Resume

```typescript
const sound = await cacophony.createSound('audio.mp3');
const [playback] = sound.play();

// Pause individual playback
playback.pause();

// Resume from where it paused
playback.play();

// Pause all playbacks of a sound
sound.pause();

// Stop (resets to beginning)
playback.stop();
```

### Complete Playback Control Example

```typescript
const cacophony = new Cacophony();
const sound = await cacophony.createSound('song.mp3');

// Play with custom settings
const [playback] = sound.play();
playback.volume = 0.7;
playback.playbackRate = 1.0;

// Create scrubbing interface
function scrubTo(percentage: number) {
  const time = (percentage / 100) * playback.duration;
  playback.seek(time);
}

// Fast forward 10 seconds
function fastForward() {
  playback.seek(playback.currentTime + 10);
}

// Rewind 10 seconds
function rewind() {
  playback.seek(Math.max(0, playback.currentTime - 10));
}

// Toggle playback speed
let normalSpeed = true;
function toggleSpeed() {
  playback.playbackRate = normalSpeed ? 1.5 : 1.0;
  normalSpeed = !normalSpeed;
}
```

## Volume & Fading

Cacophony provides a hierarchical volume control system with global, sound, and playback levels.

### Volume Hierarchy

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
```

### Global Volume Control

```typescript
// Set master volume
cacophony.volume = 0.7;

// Mute all audio
cacophony.mute();

// Unmute (restores previous volume)
cacophony.unmute();

// Check mute status
if (cacophony.muted) {
  console.log('Audio is muted');
}

// Toggle mute
cacophony.muted = !cacophony.muted;
```

### Smooth Fading

Create smooth volume transitions using the Web Audio API's scheduling:

```typescript
const sound = await cacophony.createSound('music.mp3');
const [playback] = sound.play();

// Fade in over 2 seconds (linear)
function fadeIn(playback: Playback, duration: number) {
  const gainNode = playback.gainNode;
  if (gainNode) {
    const currentTime = gainNode.context.currentTime;
    gainNode.gain.setValueAtTime(0, currentTime);
    gainNode.gain.linearRampToValueAtTime(1, currentTime + duration);
  }
}

// Fade out over 1 second (exponential for natural sound)
function fadeOut(playback: Playback, duration: number) {
  const gainNode = playback.gainNode;
  if (gainNode) {
    const currentTime = gainNode.context.currentTime;
    gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + duration);
    setTimeout(() => playback.stop(), duration * 1000);
  }
}

// Use the fade functions
fadeIn(playback, 2);
setTimeout(() => fadeOut(playback, 1), 5000);
```

### Crossfading Between Sounds

```typescript
const track1 = await cacophony.createSound('song1.mp3');
const track2 = await cacophony.createSound('song2.mp3');

const [playback1] = track1.play();
const [playback2] = track2.play();

// Start track 2 at zero volume
playback2.volume = 0;

// Crossfade over 3 seconds
function crossfade(from: Playback, to: Playback, duration: number) {
  const startTime = from.gainNode!.context.currentTime;

  // Fade out current track
  from.gainNode!.gain.setValueAtTime(from.volume, startTime);
  from.gainNode!.gain.linearRampToValueAtTime(0, startTime + duration);

  // Fade in next track
  to.gainNode!.gain.setValueAtTime(0, startTime);
  to.gainNode!.gain.linearRampToValueAtTime(1, startTime + duration);
}

crossfade(playback1, playback2, 3);
```

### Volume Event Monitoring

```typescript
const sound = await cacophony.createSound('audio.mp3');

sound.on('volumeChange', (newVolume) => {
  console.log(`Volume changed to ${newVolume}`);
  updateVolumeSlider(newVolume);
});

sound.volume = 0.5;  // Triggers volumeChange event
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
