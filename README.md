
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
- **Network-Backed Playback**: Play audio directly from URLs using media-element-backed sounds
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

## Mobile Autoplay Handling

Modern browsers — especially iOS Safari and Chrome on Android — refuse to
produce sound from an `AudioContext` that was constructed before any user
interaction. The context is created in `suspended` state and must be both
resumed AND have a node started from inside a real user-gesture call stack
before audio can play. Calling `context.resume()` alone is not enough on iOS.

Cacophony handles this transparently by default. When you construct a
`Cacophony` instance and the context is suspended, it installs one-time
`touchend` / `click` / `keydown` listeners on `document.body`. The first
user gesture resumes the context, plays a 1-sample silent primer buffer (the
iOS unlock primer), removes the listeners, and emits the `unlock` event.

```typescript
const cacophony = new Cacophony();

if (cacophony.locked) {
  // Mobile: waiting for the first user interaction.
  // Show a "tap to enable audio" affordance if you want one.
}

cacophony.on('unlock', () => {
  // Audio is now usable.
});
```

If you prefer to manage unlock yourself, opt out:

```typescript
const cacophony = new Cacophony(undefined, undefined, { autoUnlock: false });
// You are responsible for calling cacophony.resume() inside a user gesture.
```

The auto-unlock has no effect on offline contexts or in non-browser
environments (`typeof document === 'undefined'`).

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

### Audio Sprites for Games

Pack many short effects into one decoded WAV atlas while keeping each named
region as an ordinary, independently configurable `Sound`:

```bash
cacophony sprite sfx/laser.wav sfx/engine.wav \
  --out public/sfx-atlas.wav --map public/sfx-atlas.json --gap 10
```

```typescript
import { Cacophony, type SpriteMap } from 'cacophony';

const map = {
  laser: { start: 0, duration: 0.35 },
  engine: { start: 0.36, duration: 1.2, loopCount: 'infinite' },
} as const satisfies SpriteMap;

const cacophony = new Cacophony();
const sprite = await cacophony.createSprite('/sfx-atlas.wav', map);

// Literal keys stay typed. Each child uses the normal Sound API.
sprite.sounds.laser.volume = 0.7;
sprite.sounds.laser.play();

// Dynamic names use the checked lookup.
const selected: string = chooseEffectName();
if (sprite.has(selected)) sprite.get(selected).play();

// Child configuration is independent; the atlas has no shared play controls.
sprite.sounds.engine.loop('infinite');
sprite.sounds.engine.play();

sprite.cleanup();
```

All child Sounds share the atlas `AudioBuffer`. `cleanup()` owns those children
but not clones created with `sound.clone()`, which remain independently usable.

## Sound Types

Cacophony supports three URL-backed sound labels:

| Type | Memory | Latency | Seeking | Multiple Instances | Best For |
|------|--------|---------|---------|-------------------|----------|
| **Buffer** (default) | High | None | Full | Yes | Sound effects, UI sounds, short music clips |
| **HTML** | Medium | Low | Full | Yes | Media-element-backed background music, large audio files, and podcasts |
| **Streaming** | Bounded | Low | Range-backed | One stream per source | Sample-accurate URL audio with effects, panning, and metering |

```typescript
// Buffer - entire file loaded into memory
const sfx = await cacophony.createSound('explosion.mp3', 'buffer');

// HTML - media-element-backed playback, good for large files
const music = await cacophony.createSound('bgm.mp3', 'html');

// Streaming - incremental demux + WebCodecs decode into a PCM worklet
const radio = await cacophony.createStream('https://example.com/live-radio.mp3');
console.log(radio.streamCapabilities);
// { transport: 'webcodecs', seekable: false, live: true, duration: Infinity }
```

`createStream(url)` uses a fetch → demux → WebCodecs `AudioDecoder` → PCM
worklet path when WebCodecs is present and can decode the primary audio track.
The returned source has `soundType === 'streaming'` and uses the same volume,
pan/HRTF, filter, bus, send, and loudness-meter APIs as every other routable
source. MP3, ADTS/MP4 AAC, Ogg, FLAC, and WAVE containers are supported.

If WebCodecs is absent or the primary track has no WebCodecs decoder,
`createStream()` falls back to a media-element `Sound`. Check
`streamCapabilities.transport` for `'webcodecs'` or `'media-element'` rather
than assuming a tier.

Native HLS (`.m3u8`) playback, notably in Safari, uses the media element
directly. In browsers without native HLS, `createStream()` lazily uses
`hls.js`, declared as an optional peer dependency:

```bash
npm install hls.js
```

If neither native HLS nor an installed, MSE-capable `hls.js` is available,
`createStream()` rejects with install guidance instead of leaving a media
element silently waiting. hls.js failures after loading are emitted through
the Sound's `soundError` event, and `sound.cleanup()` detaches and destroys the
hls.js instance.

### Format Fallback (Howler-style)

Pass an array of URLs and Cacophony picks the first one the browser can play.
It queries `HTMLAudioElement.canPlayType` per extension and fetches only the
chosen source (cache and loading events fire only for that URL). If the
selected source's `canPlayType` was `'maybe'` and decoding actually fails,
the next playable candidate is tried.

```typescript
// First playable source wins. Cacophony fetches only that one.
const boom = await cacophony.createSound([
  'sfx/boom.webm',  // small/modern, preferred when supported
  'sfx/boom.mp3',   // universal fallback
  'sfx/boom.wav',   // last-resort uncompressed
]);
boom.play();
```

Recognised extensions: `.webm`, `.mp3`, `.ogg`, `.wav`, `.flac`, `.m4a`,
`.aac`, `.opus`. If no candidate is reported playable, or every playable
candidate fails to decode, the promise rejects with an error naming the
URLs that were tried and the reason each failed (codec unsupported or
decode failure).

Only decode failures advance to the next candidate. Fetch/network/cache
failures of the selected source propagate immediately so the caller sees
the real cause instead of a silent format swap. Decode failures are
detected by the Web Audio spec marker -- `DOMException` with name
`EncodingError`.

v1 limitation: format fallback is only available for the default `'buffer'`
sound type. Passing an array together with `'html'` or `'streaming'`
rejects with a "not yet supported" error.

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

// Note: Filters are cloned to each playback for independent processing
const playback = sound.play()[0];
playback.filters[0].frequency.value = 500; // Only affects this playback
```

See [TypeDoc](https://cacophony.js.org) for complete filter parameters and options.

### Per-source effects

Use `addEffect` for source character such as distortion, EQ, tremolo, or pitch
processing. The source stores the `CacophonyEffect` as a recipe and builds a
fresh effect instance for every playback, before that playback's panner. The
returned playback handle can be automated without changing another playback.

```typescript
const guitar = await cacophony.createSound('guitar.mp3');
const distortion = cacophony.createDistortion({ drive: 4 });
guitar.addEffect(distortion);

const [take] = guitar.play();
const liveTremolo = await take.addEffect(cacophony.createTremolo({ rate: 5 }));
take.rampEffectParam(liveTremolo, 'depth', 0.8, { duration: 250 });

guitar.removeEffect(distortion); // future playbacks no longer build it
```

### Advanced paper-backed effects

The advanced suite adds five non-neural effects derived from published DSP
algorithms. They work as per-source recipes or shared bus effects and expose
their live controls through `rampEffectParam`.

```typescript
// Equal-Hz SSB translation: harmonic material becomes bell-like/inharmonic.
guitar.addEffect(cacophony.createFrequencyShifter({ frequency: 180 }));

// Endlessly descending notches (use a positive rate to reverse direction).
drums.addEffect(cacophony.createBarberpole({ rate: -0.1, stages: 32 }));

// Dry voice plus a fifth and octave, all produced in one STFT analysis pass.
vocals.addEffect(cacophony.createHarmonizer({
  semitonesA: 7,
  semitonesB: 12,
  gainA: 0.6,
  gainB: 0.45,
}));

// Capture/release a phase-continuing spectral texture at runtime.
const freeze = await playback.addEffect(cacophony.createSpectralFreeze());
playback.rampEffectParam(freeze, 'freeze', 1); // capture
playback.rampEffectParam(freeze, 'freeze', 0); // return to live input

// Convert mono or stereo material to transient-preserving decorrelated stereo.
ambience.addEffect(cacophony.createStereoWidener({
  width: 0.75,
  decorrelation: 1,
  transientProtection: 0.8,
}));
```

`createFrequencyShifter` implements Wardle's Hilbert-transform single-sideband
modulator (DAFx-98). `createBarberpole` implements the warped spectral-delay SSB
structure of Esqueda, Valimaki and Parker (DAFx-15). `createHarmonizer` extends
the Laroche-Dolson identity-phase-locked peak shifter to two simultaneous
voices. `createSpectralFreeze` preserves measured inter-frame phase advance
instead of looping one static FFT frame. `createStereoWidener` uses sparse
velvet-noise decorrelation and temporarily retreats to the direct path for
transients.

Keep shared space effects such as reverb on a bus and feed them with a wet
send. This leaves the playback's dry character chain intact while every source
sent to the bus shares one live reverb instance.

```typescript
const vocals = await cacophony.createSound('vocals.mp3');
vocals.addEffect(cacophony.createDistortion({ drive: 1.5 })); // dry, per playback

const chamber = cacophony.createBus('chamber');
await chamber.addFilter(cacophony.createReverb({ wet: 1, dry: 0 }));
vocals.routeTo(chamber, 0.25); // 25% wet send; primary output stays on master

vocals.play();
```

## Custom Audio Routing

Cacophony exposes the underlying Web Audio graph through Playback instances, enabling manual routing through custom effects chains. This is the low-level foundation for building complex audio processing pipelines.

### Accessing the Audio Graph

Every Playback instance exposes its output node and standard Web Audio connection methods:

```typescript
const sound = await cacophony.createSound('audio.mp3');
const [playback] = sound.play();

// Access the output node (final node in the internal chain)
const outputNode = playback.outputNode;  // Returns GainNode

// Connect to custom destination
const customEffect = cacophony.context.createDelay(0.5);
playback.connect(customEffect);
customEffect.connect(cacophony.context.destination);

// Disconnect from default routing
playback.disconnect();  // Disconnect from all
playback.disconnect(specificNode);  // Disconnect from specific node
```

### Building Effect Chains

Route playbacks through multiple effects:

```typescript
const sound = await cacophony.createSound('guitar.mp3');
const [playback] = sound.play();

// Create effect nodes
const distortion = cacophony.context.createWaveShaper();
const delay = cacophony.context.createDelay(1.0);
const reverb = cacophony.context.createConvolver();

// Chain: playback → distortion → delay → reverb → destination
playback.disconnect();  // Disconnect from default
playback.connect(distortion)
        .connect(delay)
        .connect(reverb)
        .connect(cacophony.context.destination);
```

### Parallel Effects (Send/Return)

For mixing-console-style routing — named buses, shared effects, and
per-edge send gain — use the first-class [Buses and Sends](#buses-and-sends)
API documented below. The Bus class supersedes the older user-built
`playback.connect()` send/return pattern.

## Buses and Sends

A `Bus` is a named summing node with its own filter chain and per-edge
gain on outgoing connections. Sounds and synths route to buses via
`routeTo`; buses can carry rich effects (not just BiquadFilter) by
adding a `CacophonyEffect` to their filter chain. The built-in
`cacophony.createReverb()` and `cacophony.createImpulseResponse()` effects
are ready to drop into a bus.

```typescript
// 1. Create a named bus
const reverbBus = cacophony.createBus('reverb');

// 2. Add a DattorroReverb effect to the bus
const reverb = cacophony.createReverb({ wet: 0.6, dry: 0.4, decay: 0.7 });
await reverbBus.addFilter(reverb);

// 3. Lower the bus's level a bit before it hits master
reverbBus.gain = 0.5;

// 4. Route one sound's primary output to the bus
const vocals = await cacophony.createSound('vocals.mp3');
vocals.routeTo(reverbBus);
vocals.play();

// 5. Send another sound to the bus at 30% (primary route still goes to master)
const drums = await cacophony.createSound('drums.mp3');
drums.routeTo(reverbBus, 0.3);
drums.play();
```

### Looking up buses by name

```typescript
const fx = cacophony.createBus('fx');
cacophony.getBus('fx');       // → same Bus instance
cacophony.listBuses();        // → ['master', 'fx']
sound.routeTo('fx');          // string lookup via the registry
```

### The master bus

`cacophony.master` is the built-in master bus. Its `input` is literally
the same node as `cacophony.globalGainNode`, so the existing
`cacophony.volume` and `cacophony.mute` APIs continue to work
transparently. Routing a sound to `cacophony.master` (or never calling
`routeTo`) sends it through the master path.

### Bus-to-bus routing with per-edge gain

```typescript
const groupBus = cacophony.createBus('group');
const sendBus = cacophony.createBus('aux');
groupBus.connect(sendBus, 0.2);   // 20% send: groupBus.output → sendGain(0.2) → sendBus.input
groupBus.disconnect(sendBus);     // tears down the sendGain too
```

### Native impulse responses

`createImpulseResponse()` builds a native `ConvolverNode` effect from an
`AudioBuffer` or URL. URL-backed IRs are fetched and decoded once per audio
context and URL; failed loads are evicted so a later call can retry. Convolver
normalization defaults to `false`, preserving measured IR gain.

```typescript
// Wet-only send bus: returns a single ConvolverNode internally.
const chamber = cacophony.createBus('chamber');
await chamber.addFilter(cacophony.createImpulseResponse('/irs/chamber.wav'));
vocals.routeTo(chamber, 0.25);

// Inline dry/wet graph: exposes dry/wet AudioParams for bus automation.
const room = cacophony.createImpulseResponse('/irs/room.wav', {
  dry: 0.7,
  wet: 0.3,
  normalize: false,
});
const handle = await bus.addFilter(room);
bus.rampFilterParam(handle, 'wet', 0.6, { duration: 500 });
```

### Adding custom effects to a bus

Bus filter chains accept Cacophony-built BiquadFilters and any
`CacophonyEffect`. Raw third-party AudioNodes are rejected unless you
wrap them explicitly with `cacophony.shareEffect(node)` — this surfaces
the shared-state intent (the same node will run on every bus that adds it).
An effect can build either a single `AudioNode` or a `BuiltEffectGraph` with
separate `input`/`output` endpoints for multi-node processors.

```typescript
const eq = cacophony.createBiquadFilter({ type: 'highshelf', frequency: 4000, gain: 3 });
await bus.addFilter(eq);

const sharedWorklet = new AudioWorkletNode(cacophony.context, 'my-fx');
await bus.addFilter(cacophony.shareEffect(sharedWorklet));
```

FOA binaural decoding is available in both forms. Use
`createFoaDecoder()` when you want explicit custom wiring through
`decoder.input` and `decoder.output`; use `createFoaDecoderEffect()` only on a
dedicated 4-channel ACN/SN3D FOA bus, typically as the first and only filter
that converts that bus to stereo binaural output.

For physically correct mono positioning, use `encodeMonoToFoaSN3D()` and feed
its ACN/SN3D `[W, Y, Z, X]` output to the decoder. Stereo recordings can instead
be perceptually upmixed with `createStereoToBFormatNode()`. The default
`algorithm: 'perceptual'` path preserves the existing three-band front cue;
`algorithm: 'bcc'` uses frequency-domain coherence and pan analysis:

```typescript
const upmixer = await cacophony.createStereoToBFormatNode({ algorithm: 'bcc' });
const decoder = await cacophony.createFoaDecoder();
stereoSource.connect(upmixer);
upmixer.connect(decoder.input);
decoder.output.connect(cacophony.context.destination);

// BCC analysis is stateful. Reset it after a seek or other discontinuity.
upmixer.port.postMessage({ type: 'reset' });
```

Both stereo upmix algorithms emit ACN `[W, Y, Z, X]` but are perceptual
approximations, neither N3D nor SN3D. The BCC path produces W/Y only and keeps
Z/X at zero, trading the default path's front cue for per-band spatial analysis.

### Cleaning up

```typescript
reverbBus.destroy();   // disconnects everything, deregisters the name
```

Sounds still routed to a destroyed bus fall back to master on their
next playback with a `console.warn`.

### Legacy: user-built send/return

Before buses existed, send/return was a manual `playback.connect()`
chain (see the [Custom Audio Routing](#custom-audio-routing) section
for the low-level pattern). New code should use a Bus and `routeTo`.

### Dynamic Routing

Change routing in real-time:

```typescript
const sound = await cacophony.createSound('audio.mp3');
const [playback] = sound.play();

const cleanPath = cacophony.context.destination;
const fxPath = cacophony.context.createConvolver();
fxPath.connect(cacophony.context.destination);

// Toggle between clean and effects
let useFx = false;
button.addEventListener('click', () => {
  playback.disconnect();

  if (useFx) {
    playback.connect(fxPath);
  } else {
    playback.connect(cleanPath);
  }

  useFx = !useFx;
});
```

### Integrating with Web Audio Nodes

Cacophony works seamlessly with any Web Audio API nodes:

```typescript
const [playback] = sound.play();

// Built-in nodes
const analyser = cacophony.context.createAnalyser();
const compressor = cacophony.context.createDynamicsCompressor();
const panner = cacophony.context.createStereoPanner();

// AudioWorklet processors
const customProcessor = new AudioWorkletNode(cacophony.context, 'my-processor');

// Chain them together
playback.disconnect();
playback.connect(compressor)
        .connect(analyser)
        .connect(panner)
        .connect(customProcessor)
        .connect(cacophony.context.destination);

// Visualize with analyser
const dataArray = new Uint8Array(analyser.frequencyBinCount);
function draw() {
  analyser.getByteFrequencyData(dataArray);
  // ... draw visualization
  requestAnimationFrame(draw);
}
```

### Architecture Notes

- **Internal chain**: `source → panner → [filters] → gainNode`
- **outputNode** exposes the final `gainNode` in this chain
- Default routing: `outputNode → globalGainNode → destination`
- Calling `disconnect()` breaks the default routing, allowing full manual control

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

// Or create from existing Sound instances
const sound1 = await cacophony.createSound('drum.mp3');
const sound2 = await cacophony.createSound('bass.mp3');
const sound3 = await cacophony.createSound('synth.mp3');
const soundGroup2 = await cacophony.createGroup([sound1, sound2, sound3]);

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

// Advance through sounds in sequence, one call at a time
const dialog = await cacophony.createGroupFromUrls(['line1.mp3', 'line2.mp3', 'line3.mp3']);
dialog.playOrdered(true);   // Plays line1, then advances internal order
dialog.playOrdered(true);   // Plays line2
dialog.playOrdered(true);   // Plays line3
dialog.playOrdered(true);   // Plays line1 again because looping is enabled

// SynthGroup for synthesizers
const synthGroup = new SynthGroup();
const synth1 = cacophony.createOscillator({ frequency: 440, type: 'sine' });
const synth2 = cacophony.createOscillator({ frequency: 660, type: 'square' });
synthGroup.addSynth(synth1);
synthGroup.addSynth(synth2);
synthGroup.play();
synthGroup.volume = 0.5;
synthGroup.type = 'triangle';
synthGroup.pause();
synthGroup.resume();

// Remove a synth from the group
synthGroup.removeSynth(synth1);
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

// Pause and resume the active synth playback without losing its settings
sineOsc.pause();
sineOsc.resume();
```

`synth.pause()` keeps the existing synth playback object so `synth.resume()` can restart it with the current frequency, detune, type, volume, pan, and filter settings. `synth.play()` still creates a fresh playback instance, just like `Sound.play()`.

## 3D Audio Positioning

Create immersive soundscapes with precise spatial audio control using HRTF (Head-Related Transfer Function) or stereo panning.

```typescript
const cacophony = new Cacophony();

// Create sounds with HRTF panning
const ambience = await cacophony.createSound('forest_ambience.mp3', 'buffer', 'HRTF');
const birdSound = await cacophony.createSound('bird_chirp.mp3', 'buffer', 'HRTF');
const footsteps = await cacophony.createSound('footsteps.mp3', 'buffer', 'HRTF');

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
const stereoSound = await cacophony.createSound('audio.mp3', 'buffer', 'stereo');
stereoSound.stereoPan = 0.5;  // -1 (left) to 1 (right)
stereoSound.play();
```

See [TypeDoc](https://cacophony.js.org) for distance models, cone effects, and advanced 3D audio options.

## Microphone Input

Capture, process, and manipulate live audio input:

```typescript
const cacophony = new Cacophony();

try {
  const micStream = await cacophony.getMicrophoneStream({
    panType: 'stereo',
    stereoPan: 0,
    constraints: {
      audio: { echoCancellation: true }
    }
  });

  // Apply filters to microphone input
  const lowPassFilter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
  micStream.addFilter(lowPassFilter);

  // Control microphone volume
  micStream.volume = 0.8;
  micStream.play();

  // Pause and resume
  setTimeout(() => {
    micStream.pause();
    setTimeout(() => micStream.resume(), 2000);
  }, 5000);

} catch (error) {
  // Permission and device failures reject getMicrophoneStream().
  console.error("Error accessing microphone:", error);
}
```

Microphone monitoring is routed through the master bus, so global volume,
mute, master effects, and metering apply. Each playback exposes the standard
play, pause, stop, and error event surface and is fully disconnected when the
microphone is stopped.

## Audio Streaming

`createStream()` incrementally fetches and demuxes MP3, ADTS/MP4 AAC, Ogg,
FLAC, and WAVE audio. A WebCodecs `AudioDecoder` produces PCM chunks, which are
resampled to the active audio context and written into the same AudioWorklet
ring buffer used by `createPcmStreamSound()`. The returned stream is therefore
sample-accurately scheduled, pannable, filterable, bus-routable, and meterable.

The current streaming resampler uses linear interpolation without an
anti-aliasing filter. When downsampling, source frequencies above the target
Nyquist frequency can alias into the audible band; this is an accepted v1
quality trade-off pending a future band-limited resampler.

```typescript
const controller = new AbortController();
const stream = await cacophony.createStream('/music.ogg', controller.signal, 'stereo');

console.log(stream.streamCapabilities);
// {
//   transport: 'webcodecs',
//   seekable: true,
//   live: false,
//   duration: 183.42,
// }

stream.routeTo(musicBus);
stream.addFilter(cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1800 }));
await cacophony.createLoudnessMeter(musicBus);
stream.play();
stream.seek(30); // reopens the decoder at 30s when the server supports byte ranges

controller.abort(); // cancels fetch/decoder work and tears down the PCM worklet
```

`seekable` becomes `true` only after the server answers a byte-range request
with a range response. Live sources report `live: true`, `seekable: false`, and
`duration: Infinity`; calling `seek()` on one throws a clear error. A finite
file whose duration metadata is unavailable also reports `Infinity` rather
than inventing a duration.

When `AudioDecoder` is unavailable, or the primary audio track cannot be
decoded by WebCodecs, `createStream()` returns the compatibility
media-element tier. Its `streamCapabilities.transport` is `'media-element'`;
the browser owns buffering, seeking, and live-stream behavior in that tier.

### Media-element streaming contract

`createSound(url, 'streaming')` selects the media-element tier directly.
`createStream(url)` returns the same tier when WebCodecs is unavailable or
cannot decode the primary track, and always uses it for HLS. After metadata
loads, `streamCapabilities` reports the browser's duration and whether it
currently exposes a seekable range. A live source has `live: true` and
`duration: Infinity`; an ordinary finite resource reports its real duration.
The `Sound` itself has `duration === NaN` while unplayed because it has no
playback yet. After `preplay()` or `play()`, `sound.duration` and
`playback.duration` read the loaded media element and return the finite value
or `Infinity` for a live source.

Media playback moves from unplayed to playing only after the element's
`play()` promise resolves. `pause()` moves it to paused, `resume()` calls
`play()` again and returns it to playing, and `stop()` moves it to stopped and
resets it. Playback events follow those accepted transitions: `play`, `pause`,
then both `play` and `resume` on a resume, followed by `stop`. The owning
`Sound` emits `play` after the initial accepted play, plus its collective
`pause`, `resume`, and `stop` events.

`seek(time)` writes the media element's `currentTime` only when the browser
exposes a seekable range. A live or finite media source without such a range
throws a descriptive error and remains at its current position. Infinite
looping uses the media element's native `loop`; finite loop counts are managed
by Cacophony and emit `loopEnd` between iterations before the final `ended`.

Every `preplay()` creates an independent media element, so a media-backed
`Sound` supports concurrent playback instances. `cleanup()` pauses each
element, clears its `src`, calls `load()` to release the resource, disconnects
its Web Audio nodes, and removes the playback. Offline `timeStretch()` requires
a decoded `AudioBuffer`, so calling `timeStretch()` on this tier throws a
predictable buffer-required error.

For audio that arrives as decoded samples instead of a URL, use the
AudioWorklet-backed push source:

```typescript
const pcm = await cacophony.createPcmStreamSound({
  channelCount: 1,
  bufferDuration: 1,
  latency: 0.05,
  signal: abortController.signal,
});

pcm.on('underrun', () => console.warn('PCM producer fell behind'));
pcm.on('drain', () => writeNextChunk());
pcm.on('ended', () => console.log('PCM playback finished'));

pcm.play();
const hasCapacity = pcm.write(samples); // interleaved Float32Array at context.sampleRate
if (!hasCapacity) {
  // The accepted write filled the ring buffer, or the chunk was rejected
  // because it would exceed capacity. Wait for drain before writing again.
}
console.log(pcm.bufferedDuration);
pcm.end(); // no more writes; "ended" fires after buffered PCM is consumed
```

`bufferDuration` fixes the ring-buffer capacity; `latency` sets how much PCM is
collected before initial consumption. `write()` returns `false` when the buffer
needs producer backpressure. An accepted write that fills the buffer also
returns `false`; a chunk that would exceed remaining capacity is rejected and
must be retried after `drain`.

PCM underrun emits silence plus one `underrun` event per underrun episode;
writing more samples recovers playback without repeating stale audio.
`pause()` stops consuming and `resume()` continues from the buffered frame.
Volume, stereo/HRTF pan, filters, buses, and sends use the same public APIs as
other sources. Seek is not supported for a push PCM source. Loop is not
supported because the source does not retain consumed samples.

Adaptive HLS/DASH and DRM are outside the WebCodecs pull transport. `.m3u8`
URLs use the media tier: native HLS where `HTMLAudioElement.canPlayType()`
reports support (notably Safari), then the optional `hls.js` peer in
MSE-capable browsers. Install that peer with `npm install hls.js`. DASH and DRM
remain outside this integration.

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
| `volumeChange` | `number` | Fired when global volume changes. Receives new volume value. |
| `mute` | `void` | Fired when audio is muted globally. |
| `unmute` | `void` | Fired when audio is unmuted globally. |
| `suspend` | `void` | Fired when audio context is suspended. |
| `resume` | `void` | Fired when audio context is resumed. |

#### Sound Events

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `Playback` | Fired when sound starts playing. Receives the Playback instance. |
| `stop` | `void` | Fired when sound stops. |
| `pause` | `void` | Fired when sound pauses. |
| `resume` | `void` | Fired when sound resumes after being paused. |
| `ended` | `void` | Fired when sound playback ends naturally. |
| `loopEnd` | `void` | Fired when a loop iteration completes. |
| `volumeChange` | `number` | Fired when volume changes. Receives new volume value. |
| `rateChange` | `number` | Fired when playback rate changes. Receives new rate value. |
| `soundError` | `SoundErrorEvent` | Fired on playback errors. Contains `url`, `error`, `errorType`, `timestamp`, `recoverable`. |

#### Playback Events

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `BasePlayback` | Fired when playback starts. Receives the Playback instance. |
| `stop` | `void` | Fired when playback stops. |
| `pause` | `void` | Fired when playback pauses. |
| `resume` | `void` | Fired when playback resumes after being paused. |
| `ended` | `void` | Fired when playback ends naturally. |
| `seek` | `number` | Fired when playback position changes. Receives new time in seconds. |
| `volumeChange` | `number` | Fired when playback volume changes. Receives new volume value. |
| `error` | `PlaybackErrorEvent` | Fired on playback errors. Contains `error`, `errorType`, `timestamp`, `recoverable`. |

#### Synth Events

| Event | Payload | Description |
|-------|---------|-------------|
| `play` | `SynthPlayback` | Fired when synth starts playing. Receives the SynthPlayback instance. |
| `stop` | `void` | Fired when synth stops. |
| `pause` | `void` | Fired when synth pauses. |
| `resume` | `void` | Fired when synth resumes after being paused. |
| `ended` | `void` | Fired when synth playback ends naturally. |
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
  'buffer',
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
  'buffer',
  'HRTF',
  controller.signal
);
```

## Resource Management

Call `cleanup()` when done with sounds to free resources:

```typescript
const sound = await cacophony.createSound('temp.mp3');
sound.play();
sound.cleanup();  // Tears down playbacks, including pausing and resetting active HTML/streaming media

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
