# Changelog

All notable changes to cacophony are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While cacophony is 0.x, a minor release
may contain breaking changes; they are always listed first under **⚠ Breaking** with a migration
note. Patch releases do not break.

Entries before 0.33.0 were reconstructed in September 2026 from the git history, pull requests,
and source diffs. Some versions were tagged but never published to npm; they are marked as such.

<!--
How to add an entry: put a bullet under "## [Unreleased]" in the same PR as the change, in the
right subsection (⚠ Breaking, Added, Changed, Deprecated, Removed, Fixed, Security). Write it for
someone upgrading, not as a commit message. `npm version` stamps the release; see CLAUDE.md.
-->

## [Unreleased]

### Added
- Sources and Groups can remove an aux send with `removeSend(busOrName)` and ramp an existing send with `routeTo(busOrName, gain, { duration, type })`. Removal disconnects every voice's send and prevents future voices or bus drains from recreating it, while preserving primary routing. Ramps reuse existing nodes, interrupt smoothly, and take milliseconds; instant changes remain the default. (#241)
- `Playback.setOcclusion(amount, duration?)` renders per-voice obstruction with a dedicated pre-panner low-pass and attenuation stage, independently of volume and fades. Amounts clamp to `[0, 1]`; transitions default to 50 ms; resetting to `0` restores the clear path. `Playback.occlusion` reports the requested amount. The caller owns geometry, materials, and policy. (#221)

### Changed
- `routeTo(busOrName, sendGain)` throws `RangeError` for a non-finite send gain instead of storing it, and `routeTo` throws `TypeError` when ramp options are passed without a send gain instead of ignoring them. (#241)

## [0.33.0] - 2026-09-26

### Fixed
- `Playback.cleanup()` (and so `Sound.cleanup()`) stops started native buffer sources instead of only disconnecting them. Looping sources no longer keep running and holding decoded audio after cleanup. Shared buffers, sibling voices, and replay of stopped playbacks are unaffected. (#239)

## [0.32.1] - 2026-09-13

### Fixed
- `Playback.seek()` emits the `seek` event (with the new time) once after an accepted seek on buffer and media-element playbacks. Rejected seeks emit nothing. `Sound` does not relay a collective `seek` event. (#213, #237)

## [0.32.0] - 2026-09-13

### ⚠ Breaking
- `play(options)` validates its options before creating a voice and throws on invalid values: a `RangeError` for out-of-range numbers such as a negative `fadeIn` or `at`, and an `Error` for controls the source cannot honor. For example, `Synth` and live streams now reject `fadeOut`, `fadeInPerLoop`, `playbackRate`, and `loopCount` where they used to ignore them. Migration: drop the unsupported fields from those calls. (#232, #236)
- `AudioCache` follows HTTP caching rules (via `http-cache-semantics`) for both the in-memory decoded cache and the persistent Cache API store. Responses marked `no-store` are no longer retained, and stale memory hits get revalidated. `setCacheExpirationTime()` now only sets the fallback TTL for responses that have no cache directives, expiry, or validators, and it throws a `RangeError` for negative or non-finite values. Persistent entries written by older versions are ignored and fetched again once. Migration: for static audio, use versioned URLs or send `Cache-Control` headers, and expose `ETag`/`Age`/`Vary` through CORS where freshness depends on them. (#229, #234)
- `sound.playbacks` no longer keeps stopped playbacks: they are removed when the next voice is prepared. A reaped `Playback` you still hold can be replayed and gets re-attached to the Sound's current routing. Migration: keep your own references if you need stopped voices to stay in that list. (#212, #235)

### Added
- `PlayOptions` accepts per-voice `volume`, `playbackRate`, `loopCount`, `panType`, `stereoPan`, `position`, and `threeDOptions`. They apply to the new voice before its source starts and leave the Sound's defaults and other voices alone. `Group.play(options)` checks the options against every member first. (#232, #236)
- `BasePlayback.state`: a read-only lifecycle state for any playback. (#235)
- New runtime dependency `http-cache-semantics` (pinned to 4.1.1). Its license is included in `THIRD_PARTY_NOTICES.md`. (#234)

### Fixed
- `Sound.clone({ filters: [] })` clears the inherited filters. Before this, an empty array fell back to the source's filters. (#231, #233)
- `AudioCache` fixes: cross-origin audio is cached again. An unreadable or missing persistent body is evicted and fetched again. Aborting a `data:` URL load counts as an abort. A progress callback that throws no longer breaks a shared load for other subscribers. Progress stays capped when `Content-Length` underestimates the body. Abort notifications to loading-error callbacks work again. (#234)
- If `play()` fails partway, the voices it just created are stopped and removed. A reused stream voice survives a failed replay. (#236)

## [0.31.0] - 2026-09-08

### ⚠ Breaking
- `Cacophony.createStereoToBFormatNode(signal?)` is now `createStereoToBFormatNode(options?, signal?)`. Migration: change `createStereoToBFormatNode(signal)` to `createStereoToBFormatNode({}, signal)`. (#193, #220)

### Added
- Audio sprites: `cacophony.createSprite(sourceUrlOrBuffer, map)` returns an `AudioSprite` whose named regions are ordinary `Sound`s over one shared `AudioBuffer`. Playback, seeking, looping, cloning, and time-stretching stay inside each region. Exports `AudioSprite`, `SpriteMap`, `SpriteRegion`, and `CreateSpriteOptions`. (#196, #223)
- `cacophony sprite <file...> --out atlas.wav --map atlas.json [--gap ms]` CLI command that packs files into a WAV atlas and a matching `SpriteMap`. It runs headless, with no audio output device needed. (#223, #224)
- Sample-accurate scheduling: `play({ at })` starts a buffer sound at an absolute `AudioContext` time, and a scheduled `fadeIn` starts at that time too. Media, PCM, microphone, and synth sources throw if you pass `at`. (#195, #222)
- Exported `Scheduler` class (lookahead callback scheduler on `AudioContext` time, with `ScheduledCallbackHandle.cancel()`). (#195, #222)
- BCC stereo-to-FOA encoder: `createStereoToBFormatNode({ algorithm: "bcc" })`. The default stays `"perceptual"`. `StereoToBFormatOptions` is exported. (#193, #220)
- `fadeTo()`/`fadeIn()` accept an optional `startTime` option (plus `startValue` for `fadeTo`) for scheduled fades. (#222)

### Changed
- MediaBunny (the WebCodecs streaming adapter) and each AudioWorklet bundle are loaded on demand instead of at import time. `package.json` declares `sideEffects` so bundlers can tree-shake unused modules. The PR reports a consumer bundle's initial gzip size dropping from about 275 KB to about 36 KB. `loadWorklets()` still preloads everything. Your bundler and host must serve the extra code-split chunks. (#225)
- `createWorkletNode()` accepts a worklet URL as a string or as an async loader (`() => Promise<string>`). A custom `resolveWorkletUrl` still receives a string. (#225)

### Fixed
- Autoplay unlock treats iOS Safari's `interrupted` context state like `suspended`, so audio comes back after the next gesture. (#215, #217)
- Setting `Bus.gain` cancels any scheduled gain ramps first, so a ramp no longer overrides a later direct assignment. (#214, #218)

## [0.30.4] - 2026-08-14

### Fixed
- The published TypeScript declarations include `BasePlayback`, `VolumeMixin`, and the public time-stretch types, which 0.30.3 was missing. (#192)

## [0.30.3] - 2026-08-14

_First npm release after 0.29.0 through 0.30.2, which were tagged but not published. Upgrading from an earlier npm version? Read those entries too._

### Fixed
- Firefox no longer crashes with `this.listener.forwardX is undefined`. Its native `AudioListener` has no position/orientation `AudioParam`s, so listener setters fall back to `setPosition()`/`setOrientation()` there (and on partial implementations), and getters return a cached pose. (#189, #190, #191)

### Changed
- The exported `AudioListener` type marks its `positionX`...`upZ` params as optional and adds optional `setPosition`/`setOrientation`. TypeScript code that reads those params directly may need a guard. (#190)

## [0.30.2] - 2026-08-14

_Tagged but not published to npm._

### Changed
- Failed release: the release workflow ran tests before building. Its contents were re-released as 0.30.3.

## [0.30.1] - 2026-08-13

_Tagged but not published to npm._

### Changed
- Version bump only. No code changes.

## [0.30.0] - 2026-08-11

_Tagged but not published to npm._

### ⚠ Breaking
- The public `applyFilters()` and `removeFilters()` methods are removed from `Sound`, `Playback`, and other `FilterManager` subclasses. Migration: call `removeFilter()` for each filter, and use `addFilter()`/`addFilters()` to build chains. (#161, #176)
- `Bus.addFilter()` throws synchronously when given a raw `AudioNode` (or a biquad from a different `AudioContext`) instead of returning a rejected Promise. Migration: wrap the call in `try`/`catch` as well as `.catch()`, or wrap the node with `cacophony.shareEffect()`. (#168, #170, #187, #188)

### Added
- Five new AudioWorklet effects: `createFrequencyShifter()`, `createBarberpole()`, `createHarmonizer()`, `createSpectralFreeze()`, and `createStereoWidener()`. Exports `FrequencyShifterEffect`, `BarberpoleEffect`, `HarmonizerEffect`, `SpectralFreezeEffect`, `StereoWidenerEffect`, and their `*Options` types. (#155)
- `MicrophoneStreamOptions.stopTracksOnStop` (default `true`). Set it to `false` to keep the microphone stream alive after stop or cleanup. (#160, #181)
- PCM and media-stream playbacks emit `resume` when resumed, like buffer and synth playbacks. (#173, #185)

### Changed
- Effect-chain guard errors have new messages, prefixed with the owning chain's scope. An effect whose `build()` returns something other than an `AudioNode` or `BuiltEffectGraph` is rejected with a clear error. (#168, #170)
- HLS errors say whether `hls.js` is not installed or Media Source Extensions are unsupported. Other import failures are re-thrown unchanged. hls.js errors are always reported with `recoverable: false`. (#162, #186)
- `FoaDecoder` rejects HRIR buffers with fewer than 4 channels and requires `createBuffer` support in the context. (#165, #184)
- Media-element streams: `seek()` throws when the element exposes no seekable range (for example, live streams). A loop setting made before playback applies to new playbacks. Cleanup clears and reloads the element's source. (#59, #154)

### Fixed
- Autoplay unlock re-arms whenever the context becomes suspended later on (not only at construction) and retries after a failed `resume()`. (#158, #179)
- `AudioCache`: one caller aborting a shared in-flight load no longer cancels it for other callers. The request is cancelled only after every caller aborts. (#159, #180)
- `MediaStreamPlayback` cleanup stops tracks it owns, and play/resume keep tracks you disabled on purpose disabled. (#160, #181)
- `Synth.clone()` produces independent oscillator options and position, and honors an empty `filters` override. (#156, #177)
- An effect graph rejected as a duplicate by `EffectChain` or `Bus` is disposed instead of leaked. (#157, #178)
- `Bus.addFilter()` keeps declaration order when several async effect builds are in flight at once. (#168, #187)
- WebCodecs streams report a seek during a decoder reopen separately from a disposed stream. (#163, #182)
- The WebCodecs streaming resampler writes into preallocated `Float32Array`s, so it no longer allocates boxed arrays for every chunk. (#164, #183)

## [0.29.0] - 2026-07-31

_Tagged but not published to npm._

### ⚠ Breaking
- `createStream()` now resolves to `Sound | WebCodecsStreamSound`. When `AudioDecoder` exists and the URL can be demuxed, the stream is decoded through WebCodecs into a PCM ring buffer instead of an `HTMLAudioElement`. Otherwise it falls back to the media-element `Sound`. Narrow the result before calling `Sound`-only methods. (#131, #137)
- Playback filters and pitch shifting now run before the panner (`source → effects → panner → gain`), not after it. There is no option to keep the old post-panner placement, so an effect chain on an HRTF-panned sound will sound different. (#140, #150)
- `Sound.resume()` and `Synth.resume()` only resume paused playbacks. Before this, they also restarted playbacks that had been stopped or never played. (#105, #123)
- `cacophony.volume = 0` no longer counts as muted. `muted` is now tracked separately from the gain value, and a later nonzero volume applies immediately. (#103, #139)
- `setGlobalVolume()` called while muted is deferred until `unmute()`, the same as the `volume` setter. Before, it unmuted the output. (#141, #149)
- `cacophony.master.destroy()` throws. Destroying the master bus used to silence the instance permanently. (#142, #147)
- The microphone was rebuilt on `MediaStreamSound`. `MicrophoneStream` now extends `MediaStreamSound`, `MicrophonePlayback` is an alias of `MediaStreamPlayback`, and microphone output goes through the master bus. `getMicrophoneStream(options?)` takes `constraints`, `panType`, `stereoPan` and `threeDOptions`, and acquisition failures reject the promise. (#102, #110, #153)
- `AudioCache` keeps decoded buffers and in-flight requests per audio context, and `clearMemoryCache()` clears only the instance it is called on. Before, one context could receive a buffer decoded at another context's sample rate. (#107, #124)
- `mediabunny` is a new required runtime dependency, used for WebCodecs demuxing. `node-web-audio-api` is a new `optionalDependency`, so npm installs it by default unless you pass `--omit=optional`.

### Added
- `cacophony/node` entry point with `createNodeCacophony()` and `createOfflineNodeCacophony()`, plus `decodeAudioFile()`, for running the engine headlessly on `node-web-audio-api`. The native backend is loaded lazily and needs Node 22 or later. (#93)
- `cacophony` CLI (`bin/cacophony.mjs`) with `render`, `play`, `synth`, `meter` and `repl` commands. Set `CACOPHONY_SINK=none` for machines with no audio device. (#93)
- `createPcmStreamSound()` / `PcmStreamSound`: a push-based PCM source backed by an AudioWorklet ring buffer, with backpressure, underrun/drain/ended events, pause/resume and `AbortSignal` teardown. (#130, #134)
- HLS: `.m3u8` URLs passed to `createStream()` use native HLS when the browser supports it. Otherwise they load the optional `hls.js` peer dependency. (#132, #138)
- `StreamCapabilities` (`transport`, `seekable`, `live`, `duration`) reported on streamed sounds. `createStream()` accepts a `panType` argument. (#137, #145)
- Per-source effects: `addEffect()` / `removeEffect()` on `Sound`, `Synth`, PCM streams and media streams. Each playback gets its own copy of the effect, in declaration order. (#113, #151)
- Playback effect chains support reordering, bypass and parameter automation (`setFilterOrder`, `setFilterBypassed`, `isFilterBypassed`), matching `Bus`. (#140, #150)
- `MediaStreamSound.routeTo()`, so live streams can be routed through buses like `Sound` and `Synth`. (#112, #127)
- `Group.resetOrder()` restarts ordered playback after a non-looping sequence runs out. `Group.play()`, `playRandom()` and `playOrdered()` accept `PlayOptions`. (#109, #136)
- `Playback.isPaused`, and one shared playback state machine across all playback types. (#106, #125)
- `Cacophony.createOffline()` takes a third `runtimeOptions` argument. (#108, #135)
- `RuntimeOptions.logger` (`CacophonyLogger`, `consoleLogger`, `noopLogger`), `RuntimeOptions.quiet` and `RuntimeOptions.resolveWorkletUrl`. (#93)
- `MicrophoneStream` and `MicrophoneStreamOptions` are exported. (#145, #153)

### Changed
- `AudioCache` falls back to fetch-only when the Cache API is unavailable, as in Node. (#93)
- The unused chunked-WAV `stream.ts` decoder was removed, and the docs now say that `"streaming"` sounds are backed by a media element. (#129, #133)

### Fixed
- Changing `panType` on a live playback, or cloning with a `panType` override, no longer leaves it silent. (#101, #122)
- `Playback.clone()` connects the clone to the origin's route, really starts clones of playing buffer playbacks, and registers them on `Sound.playbacks`. (#100, #121)
- `Playback.clone()` keeps fade-in/fade-out settings and pitch shift, with its own worklet node. (#143, #148)
- Group playback goes through `Sound.play()`, so member `play` events fire and fades apply. (#109, #136)
- `createSound(urls[])` format fallback works under Node, where there is no `Audio` global. (#144, #146)
- `SynthPlayback` inherits from `BasePlayback` directly. This removes the `OscillatorMixin` trap that restarted oscillators unconditionally. (#111, #120)
- `SynthPlayback` emits playback and global lifecycle events. An unset synth `detune` defaults to `0`. A failed send-gain allocation is disposed. (#145, #152)
- The first HTML/streaming playback reuses the media element already loaded for metadata, instead of fetching the media twice. (#114, #128)
- An empty `SynthGroup` returns `detune` `0`. (#114, #128)
- Offline fades resolve on context time, not wall-clock time. (#114, #128)
- A media stream whose tracks ended on `stop()` refuses to replay instead of reporting a dead replay as active. (#114, #128)
- Worklet effects load under Node. (#93)

## [0.28.0] - 2026-06-12

_First npm release after 0.26.0, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Added
- `createImpulseResponse(source, options?)` / `ImpulseResponseEffect`: native `ConvolverNode` convolution from an `AudioBuffer` or URL. URL impulse responses are fetched once per context and URL. `normalize` defaults to `false`, and optional `dry`/`wet` settings expose automatable params. (#94)
- `createFoaDecoderEffect()` / `FoaDecoderEffect`: an FOA-to-binaural decoder usable as a bus filter. (#94)
- `CacophonyEffect.build()` may return a `BuiltEffectGraph` (`input`, `output`, optional `params` and `dispose`) for multi-node effects. The new `BuiltEffect` and `BuiltEffectGraph` types are exported, along with the `ConvolverNode` type. (#94)
- `MediaStreamSoundOptions.primeWithMediaElement` (default `true`).

### Changed
- The return type of `CacophonyEffect.build()` widened from `AudioNode` to `BuiltEffect`. Code that calls `build()` on an effect directly and treats the result as an `AudioNode` must handle the graph form. (#94)

### Fixed
- Remote WebRTC streams in Chromium no longer play as silence through `MediaStreamSound`. Playback attaches the stream to a muted `HTMLAudioElement` to start decoding. Opt out with `primeWithMediaElement: false`.
- An aborted impulse-response load no longer breaks concurrent or later loads of the same URL. (#94)
- `Bus.destroy()` finishes cleanup even if an effect's `dispose()` throws. (#94)

## [0.26.0] - 2026-06-03

_Tagged but not published to npm._

### ⚠ Breaking
- Removed the per-worklet public methods on `Cacophony`: `loadPhaseVocoder`, `createPhaseVocoderNode`, `loadDattorroReverb`, `createDattorroReverbNode`, `loadDynamics`, `createDynamicsNode`, `loadFdnReverb`, `createFdnReverbNode`, `loadWaveshaper`, `createWaveshaperNode`, `loadModulatedDelay`, `createModulatedDelayNode`, `loadPhaser`, `createPhaserNode`, `loadTremolo`, `createTremoloNode`, `loadLoudnessMeter` and `createLoudnessMeterNode`. Use the effect factories (`createReverb()`, `createCompressor()`, ...) or `loadWorklets()` plus `buildWorkletEffect()`. (#92)
- Worklet effect classes (`ReverbEffect`, `DynamicsEffect`, `FdnReverbEffect`, `WaveshaperEffect`, `ModulatedDelayEffect`, `PhaserEffect`, `TremoloEffect`) now extend a shared `WorkletEffect` base with the constructor `(host: WorkletEffectHost, options)`. Build them through the `Cacophony` factory methods instead of calling the constructors. (#92)

## [0.25.1] - 2026-06-03

### Added
- `Bus.drainTo(target)` and `bus.destroy({ drainTo })` move live routed `Sound` and `Synth` instances to another bus before teardown. (#91)
- `Bus.setFilterOrder()`, `Bus.setFilterBypassed()` / `isFilterBypassed()` and `rampFilterParam()` for live effect-chain control. (#91)
- The `shape` option on waveshaper and tremolo effects and the `interpolation` option on modulated-delay effects accept string aliases as well as numeric indices. (#91)

### Changed
- `Bus.addFilter()` resolves to the built `AudioNode` instead of `void`. (#91)
- Bus filter-chain changes rewire only the edges that changed, instead of rebuilding the whole chain. (#91)

### Fixed
- Sounds routed to a bus only through sends are tracked correctly when that bus is drained. (#91)
- Synth routes are registered for bus draining. (#91)

## [0.25.0] - 2026-06-03

### Changed
- Version bump only. No code changes since 0.24.0.

## [0.24.0] - 2026-06-02

### Added
- DSP effects built on AudioWorklets, each with a `Cacophony` factory:
  - dynamics: `createCompressor`, `createLimiter`, `createGate`
  - reverb: `createFdnReverb`
  - distortion: `createWaveshaper`, `createDistortion` (antialiased)
  - modulated delay: `createDelay`, `createChorus`, `createFlanger`, `createVibrato`, `createDoubling`
  - `createPhaser`
  - tremolo: `createTremolo`, `createAutoPan`
  
  The matching `*Effect` classes and `*Options` types are exported. (#88, #90)
- Pitch shifting through the phase vocoder: `Sound.setPitchShift(factor)` / `pitchShift`, also on playbacks. (#88)
- Offline time-stretching: `Sound.timeStretch(factor)`, `Cacophony.timeStretchBuffer()`, and the exported `timeStretch` / `timeStretchChannels`. (#88)
- ITU-R BS.1770-5 loudness metering: `createLoudnessMeter()` / `LoudnessMeter`, plus the exported `integratedLoudness`, `loudnessRange`, `KWeightingFilter`, `TruePeakDetector`, `truePeakDb` and related helpers. (#88)
- `createFoaDecoder()` / `FoaDecoder` for FOA-to-binaural decoding, and `encodeMonoToFoaSN3D()`. (#88)
- Per-worklet `load*()` / `create*Node()` methods. These were removed again in 0.26.0. (#88, #90)

### Changed
- `loadWorklets()` loads every bundled worklet: phase vocoder, stereo-to-B-format, Dattorro and FDN reverb, dynamics, waveshaper, modulated delay, phaser, tremolo and loudness meter. (#88, #90)

## [0.23.0] - 2026-05-30

### ⚠ Breaking
- `SoundType` is now a type-only string union, `"html" | "streaming" | "buffer" | "oscillator"`, instead of an enum. Replace `SoundType.HTML`, `SoundType.Streaming`, `SoundType.Buffer` and `SoundType.Oscillator` with the lowercase strings, and switch the import to `import type`. (#79)
- `Cacophony.pause()` and `Cacophony.resume()` are now `async` and return `Promise<void>`. (#79)
- The decoded-buffer memory cache is limited to 64 MiB, estimated from buffer size, instead of 100 entries.
- `stereoPan` on sound containers is typed `number` instead of `number | null`, and `threeDOptions` uses the new `ThreeDOptions` type instead of `any` or `PannerOptions`. (#79)

### Added
- Buses and sends: the `Bus` class, `cacophony.master`, `createBus()`, `getBus()`, `listBuses()`, and `routeTo(bus | name, sendGain?)` on `Sound`, `Synth` and `Group`. `bus.connect(target, gain?)` adds a gained send. (#83)
- An effect interface for bus chains: `CacophonyEffect`, `BiquadEffect`, `ShareEffect` (`shareEffect(node)`), and `createReverb()` / `ReverbEffect`, which uses the bundled Dattorro reverb worklet. (#83)
- `SynthPlayback` gains `outputNode`, `connect()` and `disconnect()`, matching `Playback`. (#83)
- Autoplay unlock: when the context starts suspended, the first touch, click or key press resumes it. Adds `cacophony.locked` and an `unlock` event. Opt out with `RuntimeOptions.autoUnlock: false`. (#81, #86)
- `createSound([url1, url2, ...])` picks the first URL whose format the browser can play, and falls back to the next one on a decode `EncodingError`. Only `"buffer"` sounds support this. (#82, #85)
- New type exports: `HrtfPannerOptions`, `PanCloneOverrides`, `ThreeDOptions` and `AudioWorklet`. The package entry now lists every export by name instead of re-exporting whole modules; no previously exported names were removed. (#79)

### Fixed
- The microphone stream's gain node is connected to the output (`context.destination`). Before, it was created but never connected, so microphone input that used to be silent is now audible (monitoring). (#80)
- `Cacophony.resume()` always calls through to the context. This fixes resuming after the context was suspended outside Cacophony. (#79)
- Media-element sources are cloned per playback. `loopEnded` waits for the source to be ready. A race in `stopWithFade` is fixed. (#79)
- `Sound` rolls back its preplay state when playback creation fails, and unregisters playback listeners on cleanup. (#79)
- A cancelled fade resolves its promise and snaps to the final value. (#79)
- The event emitter copies its listener list before emitting, so `once` listeners are removed correctly while an event is being emitted. (#79)
- Numeric options accept `0`: defaults use `??` instead of `||`. (#79)
- Phase vocoder options are no longer overwritten. (#79)
- `createSound(buffer, soundType)` honors the `soundType` argument instead of always creating a buffer sound. (#79)
- Worklet modules are tracked per `BaseContext`, so a second context loads its own copy. (#83)
- Cache metadata keys are handled consistently when entries are written, read and removed.

## [0.21.0] - 2026-05-11

### Added
- `MediaStreamSound` and `MediaStreamPlayback`, created with `cacophony.createMediaStreamSound(stream, { panType?, stopTracksOnStop? })`. They play a live `MediaStream`, such as WebRTC or a capture, through Cacophony's panning, volume and filters. `stopTracksOnStop` defaults to `true`. (#78)

### Changed
- `GlobalPlaybackEvent.source` is typed `BaseSound | Sound | Synth`, so `MediaStreamSound` can fire global play, pause and stop events. (#78)

## [0.20.8] - 2026-05-09

### Changed
- The `stereo-to-bformat` upmix worklet steers less high-frequency energy into the side (Y) channel: treble only moves sideways when the band is both off-center and side-dominant, so centered vocals stop drifting to the sides.

## [0.20.7] - 2026-05-09

### Changed
- The `stereo-to-bformat` upmix worklet gates direction with per-band stereo coherence: centered (in-phase) material feeds the front (X) cue and is kept out of the side (Y) cue, while hard-panned, anti-phase and diffuse material keeps its side cue.

## [0.20.6] - 2026-05-09

### Changed
- Internal changes only (dependency lockfile refresh).

## [0.20.5] - 2026-05-09

### Changed
- The `stereo-to-bformat` upmix worklet now writes a frontal cue to the X channel from mid and high-band center content. Before this, X was always silent.

## [0.20.4] - 2026-05-09

### Changed
- The `stereo-to-bformat` upmix worklet splits the signal into three bands (crossovers at 250 Hz and 2 kHz) and weights W and Y per band. Lows stay mostly omnidirectional and the upper bands carry the horizontal cue. This replaces the plain mid/side mapping, so the output sounds different.

## [0.20.3] - 2026-05-09

### Changed
- Internal changes only (version bump; no source changes).

## [0.20.2] - 2026-05-09

### ⚠ Breaking
- `createStereoToBFormatNode()` now outputs first-order ambisonics in ACN channel order (W, Y, Z, X) instead of W, X, Y, Z. If you route its four output channels by index, swap channel 1 and channel 3.

### Changed
- The `stereo-to-bformat` worklet logs per-channel peak statistics to the console with `console.info` about every 750 render quanta (roughly 2 seconds at 48 kHz).

## [0.20.1] - 2026-05-09

### Changed
- `createWorkletNode()` remembers which worklet modules it has already loaded and skips repeat `addModule()` calls. It now logs each construct and load step with `console.info`/`console.warn` under a `[cacophony/worklet]` prefix.
- `loadWorklets()` loads the `stereo-to-bformat` module without constructing a node.

## [0.20.0] - 2026-05-09

### Added
- `Cacophony.createStereoToBFormatNode()` returns an `AudioWorkletNode` that takes a stereo input and outputs a 4-channel first-order ambisonic (B-format) signal. `loadStereoToBFormatWorklet()` preloads its module, and `loadWorklets()` loads it too.
- `Cacophony.createSplitter(numChannels)` and `Cacophony.createMerger(numChannels)` create channel splitter and merger nodes. They throw if the context doesn't support those nodes.
- `createWorkletNode()` accepts an optional fourth argument of `AudioWorkletNodeOptions`. The `RuntimeOptions.createAudioWorkletNode` factory receives these options.
- The `AudioWorkletNode`, `ChannelSplitterNode` and `ChannelMergerNode` types are exported. `BaseContext` gains optional `createChannelSplitter`/`createChannelMerger` methods.

## [0.19.0] - 2026-04-15

### ⚠ Breaking
- `standardized-audio-context` is no longer a dependency. It is now an optional peer dependency, and `new Cacophony()` with no arguments creates the browser's native `AudioContext`. If you want the `standardized-audio-context` implementation, install it yourself and pass its `AudioContext` to the constructor. (#56)
- Public types now use structural interfaces (`BaseContext`, `AudioNode`, `GainNode`, `PannerNode`, ...) exported from the package root instead of `standardized-audio-context`'s `I*` types. `Cacophony.context` and `Sound.context` are typed as `BaseContext`. Code that relied on those properties having `standardized-audio-context` types may need casts or type updates. (#56)
- Setting `stereoPan` outside `-1..1` throws a `RangeError` instead of clamping silently. Clamp the value yourself before you assign it.
- `SynthGroup.setVolume(v)` is removed. Use `synthGroup.volume = v` instead. (#71)
- `createSound()` with `SoundType.HTML` or `SoundType.Streaming`, and `createStream()`, now wait for the media element's `loadedmetadata` event before resolving. They reject when the media fails to load or the `AbortSignal` fires. Before, they resolved immediately.
- Event payloads that were typed `void` (`stop`, `pause`, `resume`, `ended`, `loopEnd`, `fadeEnd`, `fadeCancel`, `mute`, `unmute`, `suspend`) are now typed `undefined`. This only matters for code that names these event types explicitly.

### Added
- Offline rendering: `Cacophony.createOffline({ numberOfChannels, length, sampleRate })`, `cacophony.isOffline`, and `cacophony.startRendering()`. (#56)
- The `Cacophony` constructor takes an optional third `RuntimeOptions` argument. Its `createAudioWorkletNode` factory lets non-native contexts build worklet nodes without the global `AudioWorkletNode`. (#56)
- `AudioCache` is exported from the package root.
- `on()` on `Cacophony`, `Sound`, `Synth` and playbacks returns an unsubscribe function.
- `Sound.resume()` and `Synth.resume()` resume paused playbacks. Synth playbacks now pause for real and resume from a fresh oscillator that keeps its settings. (#53, #68)
- `SynthGroup` has the same core controls as `Group`. `play()` returns the playbacks, and the group gains `pause()`, `resume()`, `isPlaying`, `addFilter()`/`removeFilter()`, fades, `stopWithFade()`, the `volume` getter/setter, and `stereoPan`, `position`, `frequency`, `detune` and `type` accessors. (#71)
- Events that were declared but never fired now fire: `ended` and `loopEnd` on `Sound`/`Playback`, `resume` on playbacks and sounds, and `mute`, `unmute`, `suspend`, `resume` and `volumeChange` on `Cacophony`. `volumeChange` also fires on `Playback` and `Synth`. (#53)
- Sounds are registered with a `FinalizationRegistry`, so if a `Sound` is garbage-collected without `cleanup()`, its source and gain nodes are disconnected and its media elements are released. (#74)

### Changed
- For HTML/media-element playbacks, `play()` sets `isPlaying` and emits `play`/`globalPlay` only after `HTMLMediaElement.play()` resolves. If it rejects (for example, because of autoplay policy), the state reverts and an `error` event is emitted. (#50)
- `Sound` emits `play` once for each playback, after that playback actually starts, not synchronously with the first playback. A rejected media playback no longer produces a false `play` event on the sound. (#70)
- Playbacks that end on their own (all loops done) are removed from `Sound.playbacks`. (#49)
- Revalidated cache hits (HTTP 304) report `cacheType: "conditional"` in `cacheHit` events instead of `"browser"`.
- `loadingComplete` reports the real decoded `duration` instead of `0`. `loadingError` events carry an `errorType` of `"network"`, `"decode"` or `"abort"`.
- `createStream()` no longer starts a hidden, uncontrollable background stream alongside the `Sound` it returns. The returned `Sound` is the only playback path. (#56)
- Creating media-element or media-stream sources on a context that doesn't support them (such as an `OfflineAudioContext`) throws a clear error. (#56)

### Fixed
- `cacophony.on('loadingError', ...)` fires on network and decode failures. Before, the callback was never invoked. (#47)
- `Group.playOrdered(false)` returns `undefined` after the last sound instead of crashing. (#48)
- The `Group.volume` getter returns `1` for an empty group instead of `NaN`. (#51)
- Oscillator `frequency: 0` and `detune: 0` are applied instead of being ignored, and the `frequency` getter no longer turns `0` into `440`. (#52)
- `getMicrophoneStream()` makes a single `getUserMedia` request (one permission prompt), and the first `play()` returns the playback instead of `[]`. (#54)
- `MicrophonePlayback` keeps its panner in the chain when filters are added or removed. (#55)
- `Playback.cleanup()` fully stops a media-backed playback (pauses and resets the element and detaches handlers) before it disconnects nodes. (#69)
- `setGlobalVolume()` with the current value no longer emits a `volumeChange` event.

## [0.18.3] - 2026-02-20

_First npm release after 0.18.0 through 0.18.2, which were tagged but not published. Upgrading from an earlier npm version? Read those entries too._

### Changed
- Internal changes only (release workflow moved to npm trusted publishing).

## [0.18.2] - 2026-02-20

_Tagged but not published to npm._

### Fixed
- `stop()` on a `Sound` or `Synth` also cleans up each playback it drops, so stopped playbacks no longer leave orphaned audio nodes.

## [0.18.1] - 2026-02-19

_Tagged but not published to npm._

### Changed
- Internal changes only (release workflow and dev-dependency updates).

## [0.18.0] - 2026-02-19

_Tagged but not published to npm._

### Added
- Fades on playbacks, sounds, synths and groups: `fadeTo(value, ms, type?)`, `fadeIn(ms, type?)`, `fadeOut(ms, type?)`, `stopWithFade(ms, type?)`, `cancelFade()`, and an `isFading` getter. `Playback.fadeIn()`/`fadeOut()` were last available in 0.8.7; these replace them. Each fade returns a promise that resolves when the fade finishes, and `type` is `"linear"` (the default) or `"exponential"`.
- `Sound.play(options?)` takes `PlayOptions`: `fadeIn`, `fadeOut` (applied when the last loop ends), `fadeType`, and `fadeInPerLoop` (fade in again on every loop).
- Playbacks emit `fadeStart` (`{ target, duration, type }`), `fadeEnd` and `fadeCancel` events.
- Event types from `events.ts` (such as `PlaybackEvents`, `SoundEvents` and `CacophonyEvents`) are exported from the package root.

### Changed
- Setting `volume` directly, or calling `stop()`, cancels any fade in progress.

## [0.17.1] - 2025-11-18

_First npm release after 0.17.0, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Fixed
- Type-checking fix for the filter cloning added in 0.17.0.

## [0.17.0] - 2025-11-18

_Tagged but not published to npm._

### ⚠ Breaking
- Filters added to a `Sound` or `Synth` are cloned into each new playback instead of being shared. Changing the original `BiquadFilterNode` no longer affects playbacks that already exist. To change the sound of a playback that is already playing, adjust that playback's own filters.
- `addFilter()`/`removeFilter()` on a `Sound`, `Synth` or `Group` only affect future playbacks, not ones already playing.
- `addFilter()` throws if the same filter instance is added twice. `removeFilter()` throws if the filter was never added. Guard those calls if you relied on them being no-ops.

## [0.16.1] - 2025-11-17

_First npm release after 0.16.0, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Fixed
- `removeFilter()` removes the exact filter instance you pass in. Before, it compared property values and could remove the wrong filters or fail to remove one.
- The package `exports` map lists `types` first, so TypeScript resolves the bundled type definitions correctly under `moduleResolution: "bundler"`/`"node16"`.

### Changed
- `emit()`, `emitAsync()` and `eventEmitter` on playbacks are now public.

## [0.16.0] - 2025-10-09

_Tagged but not published to npm._

### Added
- `Playback.outputNode`, `Playback.connect(destination)` and `Playback.disconnect(destination?)` let you route a playback's output into your own Web Audio graph.

## [0.15.3] - 2025-10-08

### Fixed
- `globalPlay`, `globalStop` and `globalPause` now fire from `Playback.play()`/`stop()`/`pause()`, so they also fire for sounds started through `Group.play()`, `Group.playOrdered()` and `Group.playRandom()`, not only through `Sound.play()`. `Synth` still emits them from `Synth.play()`/`stop()`/`pause()`.
- `Playback` emits its `pause` event. The event was declared in 0.15.0 but never fired.

## [0.15.2] - 2025-10-03

### Added
- Global playback events on `Cacophony`: `globalPlay`, `globalStop` and `globalPause`, each with a `{ source, timestamp }` payload where `source` is the `Sound` or `Synth`. In this release they fire only from `Sound.play()`/`stop()`/`pause()` and the matching `Synth` methods.
- `Cacophony.emit()` and `Cacophony.emitAsync()` are now public (previously `protected`).
- `Sound` and `Synth` constructors take an optional trailing `cacophony` argument, and `Sound.clone()`/`Synth.clone()` carry it over. The factory methods (`createSound`, `createStream`, `createOscillator`) pass it for you.

## [0.15.1] - 2025-10-02

### Changed
- Internal changes only (dev-dependency updates and a test fix).

## [0.15.0] - 2025-08-14

### Added
- Typed event system. `Cacophony`, `Sound`, `Synth` and every `Playback` expose `on(event, listener)` and `off(event, listener)`. (#23)
  - `Cacophony`: `loadingStart`, `loadingProgress` (`{ url, loaded, total, progress }`, where `progress` is `-1` when the size is unknown), `loadingComplete`, `cacheHit` (`cacheType`: `memory` / `browser`), `cacheMiss` (`reason`: `not-found` / `expired`) and `cacheError`.
  - `Sound`: `play` (receives the `Playback`), `stop`, `pause`, `volumeChange`, `rateChange` and `soundError`, which forwards playback errors.
  - `Synth`: `play`, `stop`, `pause`, `frequencyChange`, `detuneChange` and `typeChange`.
  - `Playback`: `play`, `stop` and `error`.
- `AbortSignal` support. `createSound(url, soundType, panType, signal)`, `createGroupFromUrls(urls, soundType, panType, signal)`, `createStream(url, signal)`, `loadWorklets(signal)` and `createWorkletNode(name, url, signal)` accept an optional signal that cancels the fetch, stream read or worklet load. (#22)
- Download progress reporting. `AudioCache` reads response bodies as a stream and reports progress to every caller waiting on the same URL.
- `AudioCache` honors `Cache-Control`. A cached entry within its `max-age` is served without a network request, and `no-cache`, `no-store` and `must-revalidate` force revalidation.
- `Sound.cleanup()` cleans up all of the sound's playbacks and removes its event listeners. `Playback.cleanup()` also disconnects the panner, gain node and filters and removes listeners.

### Changed
- `createSound(url, SoundType.Streaming)` returns a streaming `Sound` right away instead of downloading and decoding the whole file through the cache.
- `createStream()` again starts the internal chunked stream reader in the background, as in 0.13.0–0.13.2. That reader plays decoded chunks straight to `context.destination`, alongside the returned `Sound`.
- `Playback.addFilter()` inserts the filter node you pass instead of cloning it. `Sound` therefore reuses its own filter nodes in every playback it creates. `Playback.removeFilter()` now uses the shared `FilterManager` matching logic and no longer disconnects the removed node. `addFilter()`/`removeFilter()` throw on a cleaned-up playback.
- `createWorkletNode()` rethrows the original error (such as an `AbortError`) instead of a generic "Could not load worklet" error. It loads modules with `credentials: "same-origin"`.
- The custom-cache interface's `getAudioBuffer(context, url, signal?, callbacks?)` has two new optional parameters, so existing custom caches keep working.

### Fixed
- `AudioCache` recovers when metadata exists but the cached body is missing: it refetches from the network instead of failing.
- Streams that fail to fetch or read log the error instead of producing an unhandled rejection.

## [0.14.2] - 2025-07-02

### Changed
- `AudioCache` sends a conditional request (`If-None-Match` / `If-Modified-Since`) every time a URL is not in memory and its cached entry has an `ETag` or `Last-Modified`. The 24-hour TTL (`AudioCache.setCacheExpirationTime()`) applies only to entries with no validators. In 0.14.0, entries without validators were always refetched and entries with validators were only rechecked after the TTL.

### Fixed
- If the server returns `304 Not Modified` but the cached body has disappeared, the cache fetches the file again without validators instead of failing.

## [0.14.1] - 2025-05-13

### Fixed
- `Playback.pause()` stops the underlying `AudioBufferSourceNode` instead of only disconnecting it.
- A replaced source's `onended` handler is detached, so a stale source finishing after a pause or seek no longer triggers the loop/stop logic.
- Looping buffer-backed playbacks restart through `play()` at the loop boundary, which avoids calling `start()` twice on the same source node.

## [0.14.0] - 2025-02-11

### ⚠ Breaking
- Build output renamed and reduced. The package now ships only `dist/index.mjs` (ESM) and `dist/index.cjs` (CJS), declared through an `exports` map. The old `dist/cacophony.es.js`, `dist/cacophony.cjs.js`, `dist/cacophony.umd.js` and `dist/cacophony.iife.js` are gone. Import from `"cacophony"` instead of a file path. UMD and IIFE `<script>` users need a bundler or an ESM `<script type="module">`.

### Changed
- `AudioCache` revalidates cached entries with `ETag`/`Last-Modified` once the TTL has passed. Before, it reused them indefinitely. A `304` response refreshes the stored timestamp.
- Concurrent requests for the same URL share one in-flight load, whether it comes from the network or the browser cache.

### Fixed
- If writing to the browser cache fails, `AudioCache` deletes the partial body and metadata so a later load does not read a half-written entry.

## [0.13.5] - 2024-10-28

_First npm release after 0.13.4, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Fixed
- Fixes a TypeScript type error in `Playback.addFilter()` introduced in 0.13.4.

## [0.13.4] - 2024-10-28

_Tagged but not published to npm._

### ⚠ Breaking
- `Group.playRandom()`, `Group.preplayRandom()`, `Group.playOrdered()` and `Group.preplayOrdered()` return `Playback | undefined` and return `undefined` for an empty group. Before, `preplayOrdered()`/`playOrdered()` threw and the random variants failed. Add a check for `undefined`.
- Setting `Playback.playbackRate` to `0` or a negative value throws `"Playback rate must be greater than 0"`.

### Added
- `new Cacophony(context?, cache?)` accepts a custom cache object with `getAudioBuffer(context, url)` and `clearMemoryCache()`, for example to stub loading in tests.

### Fixed
- `Playback.addFilter()` appends to the filter chain again instead of replacing the existing filters (regression in 0.13.1).
- `Sound.clone()` applies the cloned volume, playback rate, loop count and panning through the public setters, so the values reach the clone correctly. It sets `position`/`threeDOptions` only for `HRTF` sounds and `stereoPan` only for `stereo` sounds, and it honors a `position` override even when it is falsy.

## [0.13.3] - 2024-10-14

### Fixed
- Replaying or seeking an HTML/streaming playback after it stops reuses its media element instead of swapping in an empty buffer source.
- `Playback.duration` no longer throws for media-element sources without a decoded buffer. It returns the element's duration, or `NaN` when the duration is unknown.
- `createStream()` no longer starts a second background fetch that played audio straight to the destination, bypassing volume and panning.

## [0.13.2] - 2024-10-14

_First npm release after 0.13.1, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Fixed
- `loop(n)` sets `loopCount` to `n` again (0.13.1 stored `n - 1`, so a playback repeated one time fewer than requested). Calling `loop(n)` on a playback that is already playing also stores `n` now; before 0.13.1 it stored `n - 1`.

## [0.13.1] - 2024-10-14

_Tagged but not published to npm._

### Changed
- `Playback` timing rewrite. `currentTime` accounts for `playbackRate`, changing the rate mid-play keeps the position, and `pause()`/`play()` resumes from the paused position.
- `Playback.seek()` keeps the current play/pause state and throws `"Invalid time value for seek"` for negative or non-finite times.
- `Playback.play()` does nothing on a playback that is already playing.
- Reading `playbackRate` no longer throws after cleanup, and setting it after cleanup is a silent no-op.
- `Playback.clone()` copies position, state, current loop, playback rate and filters (as fresh filter nodes). If the original is playing, the clone starts playing too.
- `loop(n)` stores `n - 1` (reverted in 0.13.2).

### Fixed
- Filter clones now copy `gain`, and removing a filter disconnects its node.

## [0.13.0] - 2024-10-08

### ⚠ Breaking
- `Sound.duration` returns `NaN` instead of `0` when the duration is unknown. When the sound has playbacks, it returns the first playback's duration, so HTML and streaming sounds report the media element's duration. Replace `duration === 0` checks with `Number.isNaN(duration)`.

### Added
- `Playback.duration` returns the media element's duration for HTML/streaming playbacks.

## [0.12.10] - 2024-09-23

### Fixed
- HTML and streaming sounds can be played again. Since 0.12.0 `Playback.play()` tried to rebuild a buffer source for every source type and threw "Cannot recreate source of a sound that has been cleaned up" for non-buffer sounds; now it only rebuilds buffered sources.
- `setPanType()` does nothing when the pan type is unchanged and a panner already exists. When the type does change, it disconnects the old panner first, so panners no longer pile up in the graph.

## [0.12.9] - 2024-08-22

### Fixed
- `stop()` on an infinitely looping playback now stops it. The playback is marked stopped before the source node is stopped, and the loop-end handler ignores `ended` events from playbacks that are not playing, so stopping no longer restarts the loop.

## [0.12.8] - 2024-08-22

### Changed
- `Playback.stop()` no longer wraps the source stop in `try`/`finally`. If the underlying node throws, the error propagates and the playback's state is left unchanged.

## [0.12.7] - 2024-08-21

### ⚠ Breaking
- `Playback.loop(count)` now returns the stored loop count (a number or `'infinite'`) instead of `'infinite'`/`0`. It sets the native `loop` flag only for `'infinite'`, so a finite count is handled by replaying the source. Calling it on a playing playback treats the current pass as the first. Code that compared the return value against `'infinite'`/`0` should read `loopCount` instead.
- `Playback.handleLoop` is renamed to `loopEnded`. Update any code that called or reassigned it.

### Fixed
- Looping works again. The loop handler still checked the `_playing` flag that 0.12.0 stopped updating, so loops did not repeat correctly in 0.12.0–0.12.6. A sound can now also switch from looping to non-looping (and back) while it plays.
- `Playback.stop()` no longer silently swallows errors thrown by the underlying source node.

## [0.12.6] - 2024-08-21

### Added
- `Group.randomSound()` returns a random `Sound` from the group without playing it. It throws on an empty group. `preplayRandom()` now uses it.

## [0.12.5] - 2024-08-19

### Changed
- Internal changes only (README updates).

## [0.12.4] - 2024-08-19

### Fixed
- Cache entries written by versions before 0.12.3 have no timestamp. These entries (when they also lack `ETag`/`Last-Modified`) are now treated as expired and refetched instead of being served indefinitely.

## [0.12.3] - 2024-08-19

### Changed
- The persistent audio cache now expires entries after 24 hours, but only entries that have no `ETag` or `Last-Modified` header. Entries that have one of those headers are served from the Cache API without a network request. The expiry is set through the internal `AudioCache.setCacheExpirationTime()`, which the package does not export.

## [0.12.2] - 2024-08-15

### Added
- `Group.preplayRandom()` and `Group.preplayOrdered(shouldLoop)` return a prepared, not-yet-started `Playback`. `playRandom()` and `playOrdered()` are now built on them.

### Changed
- Empty-group errors from the random and ordered methods now say "Cannot prepare …" instead of "Cannot play …".

## [0.12.1] - 2024-08-12

_First npm release after 0.12.0, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Changed
- Internal changes only (tests).

## [0.12.0] - 2024-08-12

_Tagged but not published to npm._

### ⚠ Breaking
- `Playback.resume()` (added in 0.11.1) is removed again. Call `play()` on a paused playback to continue from where it paused.
- The public `Playback.pauseTime` and `Playback.startTime` fields are removed. Read the new `currentTime` getter instead.

### Added
- `Playback.currentTime` getter returns the current position in seconds.

### Changed
- `Playback` now tracks an explicit state (unplayed, playing, paused, stopped). `isPlaying` is true only in the playing state, and `pause()` does nothing unless the playback is playing. `seek(time)` stores the offset and restarts playback only if it was playing, so a later `play()` starts from the seeked position.

## [0.11.1] - 2024-08-09

### Added
- `Playback.resume()` continues a paused playback from its pause position.

### Fixed
- Pausing and resuming buffered playbacks resumes at the right offset. `play()` and `seek()` now record the start time, which pause offsets are measured from. Pausing an HTML-backed playback also remembers its position.

## [0.11.0] - 2024-08-05

### ⚠ Breaking
- The `Playback` constructor is now `new Playback(origin: Sound, source, gainNode)`. Context, loop count and pan type come from the origin `Sound`. `SynthPlayback` likewise becomes `new SynthPlayback(origin: Synth, source, gainNode)`. Code that built playbacks directly must pass the owning `Sound`/`Synth` first.

### Added
- Playbacks have an `origin` property that points back to the `Sound` or `Synth` that created them.

### Fixed
- `Playback.clone()` copies the source playback's volume.

## [0.10.4] - 2024-07-15

### Added
- `createOscillator(options, panType)` accepts an optional `panType` (`'HRTF'` by default), so a synth can use stereo panning.

## [0.10.3] - 2024-07-12

### Changed
- `BasePlayback` moved to its own module and is no longer exported from the package entry point.
- Source formatting sweep across `playback.ts` and `container.ts` (no behavior change).

### Fixed
- Seeking a stopped or paused playback now takes effect: the next `play()` starts from the seeked time instead of from 0.

## [0.10.2] - 2024-07-02

_First npm release after 0.9.7 through 0.10.1, which were tagged but not published. Upgrading from an earlier npm version? Read those entries too._

### Fixed
- `MicrophonePlayback` is exported from the package entry point correctly (0.10.0 imported it from a bare `'microphone'` path).

## [0.10.1] - 2024-07-02

_Tagged but not published to npm._

### Fixed
- The internal `MicrophoneStream` import in `cacophony.ts` now uses a relative path.

## [0.10.0] - 2024-07-02

_Tagged but not published to npm._

### ⚠ Breaking
- The microphone classes moved to `microphone.ts`, and only `MicrophonePlayback` is exported from the package. `MicrophoneStream` is no longer importable from `cacophony`; get it from `Cacophony.getMicrophoneStream()` instead of importing the class.

## [0.9.7] - 2024-07-01

_Tagged but not published to npm._

### ⚠ Breaking
- `Sound.type` and `Synth.type` (the `SoundType`) are renamed to `soundType`. On `Synth`, `type` now means the oscillator waveform. Rename `.type` to `.soundType` wherever you read the source kind.

### Added
- `SynthGroup` (exported) for controlling several synths together: `addSynth()`, `removeSynth()`, `play()`, `stop()`, `setVolume()`, and `stereoPan`/`position` setters.
- `Synth` and `SynthPlayback` get `frequency`, `detune` and `type` accessors. On a `Synth`, setting one updates all of its active playbacks.

### Changed
- `play()`/`preplay()` on a container are typed to return that container's own playback type (e.g. `SynthPlayback[]` for a `Synth`).

## [0.9.6] - 2024-06-25

### Changed
- Internal changes only (the build now runs `tsc --noEmit` first).

## [0.9.5] - 2024-06-24

### Changed
- Members of the mixin-based classes (`playbacks`, `_volume`, `_position`, `panner`, `gainNode`, `_filters`, and others) are now public. TypeScript mixins cannot have private or protected members, and this let the type declarations be emitted. `Sound.playbacks` is accessible again.
- `index.ts` exports `Sound` and `Synth` by name instead of re-exporting their whole modules.

## [0.9.4] - 2024-06-24

### Changed
- Internal typing fixes (`Playback.source` is declared public on the base class).

## [0.9.3] - 2024-06-24

### Changed
- The npm package no longer ships the `src` directory, only `dist`, `docs` and `README.md`.

## [0.9.2] - 2024-06-24

### Fixed
- Several modules imported siblings through bare specifiers (`"pannerMixin"`, `"volumeMixin"`, `"oscillatorMixin"`). These are now relative imports, so builds and type resolution work in consuming projects.

## [0.9.1] - 2024-06-24

### Fixed
- Synth oscillator options (`frequency`, `detune`, `type`) are applied to the oscillator's `AudioParam` values. Before, they were `Object.assign`ed onto the node, which did not set them. (#7)
- `Synth.clone()` defaults `stereoPan` to `0` when the source has none.

## [0.9.0] - 2024-06-21

### ⚠ Breaking
- `Cacophony.createOscillator(options)` now returns a `Synth` (with `play()`, `stop()`, `volume`, `position`, filters, `clone()`, …) instead of a raw `OscillatorNode` connected to the output. Call `synth.play()` instead of `oscillator.start()`. (#6)
- `Playback.fadeIn()` and `Playback.fadeOut()` are removed, with no replacement in this release.
- `Sound.playbacks` became `protected` (it is public again in 0.9.5).
- The `BaseSound` interface no longer requires `playbackRate`, `loop` or `duration`, and gains optional `position` and `threeDOptions`.

### Added
- `Synth` class (exported) for oscillator-based sound with the same volume, panning, 3D-position and filter controls as `Sound`, plus `oscillatorOptions`. `SoundType.Oscillator` identifies it. (#6)

### Changed
- `Sound`, `Playback` and `Synth` are now composed from shared mixins (`PlaybackContainer`, `VolumeMixin`, `PannerMixin`). The existing volume, stereo pan, position and `threeDOptions` accessors behave the same. (#5)

## [0.8.7] - 2024-06-11

### Changed
- The in-memory decoded-buffer cache is capped at 100 entries (down from 500).

## [0.8.6] - 2024-06-11

### Added
- `Cacophony.clearMemoryCache()` empties the in-memory decoded-buffer cache and clears pending requests.

## [0.8.5] - 2024-06-11

### Changed
- The in-memory decoded-buffer cache is now an LRU with a size limit (500 entries) instead of growing without bound.

### Fixed
- A failed load now clears its pending request, so the next request for the same URL retries instead of getting the failed promise.

## [0.8.4] - 2024-05-23

### Changed
- Decoded `AudioBuffer`s are kept in memory by URL, so creating several sounds from the same URL decodes the audio only once. The data: URL path is cached the same way.

## [0.8.3] - 2024-04-01

### Added
- Loading audio from the network stores the `ETag`/`Last-Modified` headers and sends `If-None-Match`/`If-Modified-Since` on later fetches. A `304` reuses the cached body.

### Fixed
- Non-OK responses stored in the browser cache are no longer used as audio data.

## [0.8.2] - 2024-03-04

### Changed
- `Playback.addFilter()` adds a copy of the filter (type, frequency, Q), so the same filter node is never wired into more than one playback. `removeFilter()` matches filters by their parameter values instead of node identity, so the filter you passed in can still be removed.

## [0.8.1] - 2024-02-23

### Fixed
- Loop counting and `isPlaying` are correct when a sound finishes naturally: `isPlaying` becomes `false` at the end of the last loop.
- `stop()` ignores errors thrown by the underlying node (e.g. stopping a source that already ended).
- Seeking a buffered playback keeps its end-of-playback handler (so looping continues after a seek), and the source is no longer connected to the gain node twice.

## [0.8.0] - 2024-02-23

### Fixed
- Looping sounds can be stopped. Before this, the end-of-loop handler restarted the source after `stop()`. Stopping a sound twice and then playing it again also works.

## [0.7.0] - 2024-02-23

### ⚠ Breaking
- `resume()` is removed from `Sound`, `Playback`, `Group` and the `BaseSound` interface. Call `play()` on a paused playback to continue.
- `pause()` no longer suspends the whole `AudioContext` (which paused every sound). It now stops only that playback and records the position; `play()` restarts from there.

### Fixed
- Setting `threeDOptions` accepts `0` for numeric options (cone angles and gain, distances, rolloff, position and orientation). Before, `0` was ignored and the previous value kept.

## [0.6.2] - 2024-02-23

### Changed
- `isPlaying` is tracked by the playback itself instead of inferred from the node. It returns `false` rather than throwing after cleanup.

### Fixed
- `Sound.clone()` honors falsy overrides (`volume: 0`, `loopCount: 0`, `stereoPan: 0`) and copies `stereoPan` to the clone.
- `createSound()` accepts any `AudioBuffer`-like object, not only instances of the global `AudioBuffer` class (e.g. buffers from `standardized-audio-context`).
- `stop()` stops buffer-backed playbacks again. From 0.5.22 through 0.6.1, `isPlaying` was always `false` for them, so `Playback.stop()` and `Sound.stop()` returned without stopping anything.
- A finite loop count no longer plays one extra repetition.

## [0.6.1] - 2024-02-22

### Fixed
- `Playback.clone()` uses the newly created source node instead of reusing the original one.

## [0.6.0] - 2024-02-21

### ⚠ Breaking
- `isPlaying` is now a getter instead of a method on `Sound`, `Playback`, `Group`, `MicrophonePlayback`, `MicrophoneStream` and the `BaseSound` interface. Replace `x.isPlaying()` with `x.isPlaying`.

### Added
- `new Group(sounds)` accepts an initial array of sounds.

## [0.5.23] - 2024-02-21

### Changed
- `Playback.clone()` now builds a fresh source node (a new `AudioBufferSourceNode` sharing the same `AudioBuffer`, or a new media-element source). However, the clone is still constructed with the original's source node, so a cloned playback continues to share the source of the playback it was cloned from. Fixed in 0.6.1.

## [0.5.22] - 2024-02-21

### Changed
- `Playback.isPlaying()` inspects the underlying node instead of an internal flag: HTML-audio playbacks report `!mediaElement.paused`. Buffer playbacks check a `playbackState` property that Web Audio source nodes don't have, so they always report `false`. Because `Playback.stop()` returns early when `isPlaying()` is false, `stop()` (and `Sound.stop()`) no longer stops buffer-backed playbacks. This regression is fixed in 0.6.2.
- When a finite loop runs out, the playback calls `stop()` instead of just clearing its playing flag.

## [0.5.21] - 2024-02-21

### Changed
- `Sound.stop()` empties `sound.playbacks` after stopping them, so stopped playbacks are no longer tracked by (or updated through) the sound.

## [0.5.20] - 2024-02-21

### Fixed
- `Sound.clone()` and `Playback.clone()` can be called with no arguments again; `overrides` is optional and every field in it is optional.

## [0.5.19] - 2024-02-20

_First npm release after 0.5.18, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Changed
- Internal change only: reordered the loop-count condition in the loop-restart handler. No change in behavior.

## [0.5.18] - 2024-02-20

_Tagged but not published to npm._

### Changed
- Reworked the end-of-loop check in `Playback` so it compares `currentLoop > loopCount` and only restarts the source while repeats remain.

## [0.5.17] - 2024-02-20

### Added
- `Playback.clone({ loopCount?, panType? })` creates a new `Playback` with its own gain node.

### Changed
- `Sound.clone()` overrides are typed as a dedicated options shape (`panType`, `stereoPan`, `threeDOptions`, `loopCount`, `playbackRate`, `volume`, `position`, `filters`) instead of `Partial<Sound>`.

## [0.5.16] - 2024-02-20

_First npm release after 0.5.15, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### ⚠ Breaking
- `Sound.clone(overrides)` takes a required `overrides` object (`panType`, `threeDOptions`, `loopCount`, `playbackRate`, `volume`, `position`, `filters`, ...). Calling `clone()` with no argument throws at runtime. Pass `{}` for a plain copy until 0.5.20 makes the argument optional.

### Fixed
- Cloned sounds get their own copy of the filter list instead of sharing the original's filter array.

## [0.5.15] - 2024-02-19

_Tagged but not published to npm._

### Changed
- First attempt at `Sound.clone(overrides)`. The constructor call passed arguments in the wrong positions, so this version's clone was broken; it was replaced in 0.5.16.

## [0.5.14] - 2024-02-16

### Added
- `filters` read-only getter on `Sound` and `Playback` exposes the current filter chain.
- `addFilters(filters)` and `removeFilters(filters)` add or remove several filters in one call.

## [0.5.13] - 2024-02-16

### Fixed
- Removed debug `console.log` output from the loop callback (added in 0.5.11).

## [0.5.12] - 2024-02-15

_First npm release after 0.5.11, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Fixed
- Looping buffer playbacks: when a finite loop restarts, the new source goes through the panner and filter chain only. It is no longer also wired straight to the gain node, which bypassed panning and filters.
- The loop callback does nothing after the playback has been cleaned up.

## [0.5.11] - 2024-02-15

_Tagged but not published to npm._

### Fixed
- Finite loop counts replay the sound: the loop callback connects the re-created buffer source, re-arms its `onended` handler, and starts it. Earlier versions re-created the source without connecting it. This version logs every loop iteration to the console.

## [0.5.10] - 2024-02-14

### Fixed
- `loop()` on a buffer-backed `Playback` works again. It no longer relies on an `instanceof AudioBufferSourceNode` check, which failed for standardized-audio-context nodes and threw `Unsupported source type`.

## [0.5.9] - 2024-02-14

### Fixed
- Attempted fix for looping broken by a type-only import in `Playback`. It did not work; see 0.5.10.

## [0.5.8] - 2024-02-13

### Added
- `seek()` works on HTML-audio (`SoundType.HTML`) playbacks by setting the media element's `currentTime`. Before, it only worked for buffer sounds.

### Changed
- Listener orientation and playback position set the `AudioParam.value` directly instead of using `setValueAtTime`, to avoid ordering races in calling code.
- `Position` is a labeled tuple (`[x, y, z]`). Added JSDoc for `Cacophony` and `Playback`.

## [0.5.7] - 2024-02-12

_First npm release after 0.5.6, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Changed
- Internal type-alias fixes for standardized-audio-context types.

## [0.5.6] - 2024-02-12

_Tagged but not published to npm._

### Fixed
- `Sound.loop(count)` applies the loop setting to active playbacks through `Playback.loop()` instead of only setting the native `loop` flag.
- The loop-restart handler is bound to its `Playback`.

## [0.5.5] - 2024-02-07

### Fixed
- Published type declarations include the shared context types. In 0.5.0–0.5.4 the `.d.ts` files imported a `./context` module that wasn't shipped, which broke type checking for TypeScript consumers.

## [0.5.4] - 2024-02-05

### Added
- `createGroupFromUrls(urls, soundType?, panType?)` passes the sound type and pan type through to each created sound.

## [0.5.3] - 2024-02-05

### Fixed
- `createBiquadFilter({ frequency: 0 })` and `createOscillator({ frequency: 0 })` honor a frequency of `0` instead of replacing it with the default (350 Hz and 440 Hz).

## [0.5.2] - 2024-02-05

### Changed
- `stereoPan` values outside −1..1 are clamped instead of throwing.

### Fixed
- `createOscillator()` without a `frequency` defaults to 440 Hz instead of setting an undefined frequency.

## [0.5.1] - 2024-02-05

### Fixed
- Stereo panning (`panType: 'stereo'`) works: `stereoPan` no longer relies on an `instanceof StereoPannerNode` check, which always failed, so the getter returned `null` and the setter threw.
- `createSound(url, SoundType.HTML, panType)` honors `panType` for HTML-audio sounds.

## [0.5.0] - 2024-02-05

### Changed
- The library source is split into modules (`sound.ts`, `playback.ts`, `group.ts`, `filters.ts`). `index` now re-exports `Sound`, `Playback` and `Group` from their own modules. Public signatures are unchanged.
- `BaseSound` is exported again (it was unexported in 0.4.2).

## [0.4.6] - 2024-02-05

### Changed
- The `Playback` constructor throws `Invalid pan type` for a `panType` other than `'HRTF'` or `'stereo'`.

## [0.4.5] - 2024-02-05

### Changed
- Internal changes only (redundant `panType` assignment and doc comments).

## [0.4.4] - 2024-02-05

### Added
- `createSound()` accepts base64 `data:` URLs, which are decoded directly instead of fetched or cached.

### Changed
- The second parameter of `createSound()` is renamed from `type` to `soundType`. This only affects the parameter name.

### Fixed
- `createOscillator()` no longer throws when no `periodicWave` is given.

## [0.4.3] - 2024-02-05

### Added
- `createSound(urlOrBuffer, soundType?, panType?)` takes a `panType` (`'HRTF'` or `'stereo'`), so buffer sounds can use stereo panning.

## [0.4.2] - 2024-02-05

### ⚠ Breaking
- `BaseSound` is no longer exported, and it no longer requires `position` or `threeDOptions`. Code that imported it must use `Sound`, `Playback` or `Group` instead until 0.5.0 exports it again.
- `Group.sounds` and `Group.addSound()` accept only `Sound` instances instead of any `BaseSound`.
- The `Playback` constructor's fifth parameter changed from `hrtf: boolean` to `panType: PanType`. Pass `'HRTF'` or `'stereo'` instead of `true` or `false`.

### Added
- `PanType` type (`'HRTF' | 'stereo'`) and `Sound.panType`. New playbacks get either a 3D panner or a stereo panner based on it.
- `Sound.stereoPan` getter and setter, applied to the sound's current and future playbacks.

## [0.4.1] - 2024-02-01

### Added
- Stereo panning: `Playback` can use a `StereoPannerNode` instead of an HRTF `PannerNode`, controlled with the `stereoPan` getter and setter (−1..1). On stereo playbacks, `position` and `threeDOptions` throw.

## [0.4.0] - 2024-01-22

_First npm release after 0.3.13, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Added
- `Group.playRandom()` plays one random sound from the group and returns its `Playback`.
- `Group.playOrdered(shouldLoop = true)` plays the group's sounds one at a time in order, one per call, and wraps around when `shouldLoop` is set.
- JSDoc for most `Sound` and `Playback` methods.

### Changed
- `Sound.pause()` and `Sound.resume()` delegate to each of the sound's playbacks instead of suspending or resuming the `AudioContext` directly. With no playbacks they now do nothing.

## [0.3.13] - 2024-01-22

_Tagged but not published to npm._

### Added
- `Group.playRandom()` and `Group.playOrdered()` (first published in 0.4.0).

### Changed
- This version imports an event-emitter module that isn't in the repository, so it doesn't build. 0.4.0 removed that import.

## [0.3.12] - 2024-01-02

### Added
- `Sound.clone()` returns a new `Sound` with the same buffer, loop count, playback rate, volume, position, 3D options and filters.

## [0.3.11] - 2024-01-01

### Changed
- The prebuilt AudioWorklet bundles (phase vocoder and overlap-add processors) are committed to the repository, and the phase-vocoder processing was restored to its original algorithm.

## [0.3.10] - 2024-01-01

### Added
- `Cacophony.createWorkletNode(name, url)` creates an `AudioWorkletNode` and loads the module from `url` if the processor isn't registered yet.

### Changed
- Audio worklets are built in a separate Rollup step and embedded in the package, so `loadWorklets()` can load the phase-vocoder worklet from the published build.

## [0.3.9] - 2023-12-28

### ⚠ Breaking
- `createBiquadFilter()` takes an options object `{ type, frequency, gain, Q }` instead of a filter type string. Replace `createBiquadFilter('lowpass')` with `createBiquadFilter({ type: 'lowpass' })`. The defaults are `lowpass`, 350 Hz, gain 0 and Q 1.

### Added
- `createPanner(options)` creates a `PannerNode` from a partial `IPannerOptions` object.

## [0.3.8] - 2023-12-28

### Added
- `createOscillator({ frequency, type, periodicWave })` creates an `OscillatorNode` connected to the global output. It throws when `periodicWave` is omitted until 0.4.4.

## [0.3.7] - 2023-12-26

_First npm release after 0.3.6, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Added
- `duration` on `Sound`, `Playback`, `Group` (the longest sound in the group) and the microphone classes (always `0`). `duration` is now a required member of `BaseSound`.

## [0.3.6] - 2023-12-26

_Tagged but not published to npm._

### Added
- `duration` on `Sound`, `Playback`, `Group` and `MicrophoneStream` (first published in 0.3.7). HTML and streaming sounds report `0`.

## [0.3.5] - 2023-12-24

### Changed
- Build changes to bundle the phase-vocoder AudioWorklet; no public API changes.

## [0.3.4] - 2023-12-24

### Changed
- Worklet bundling change (the phase-vocoder URL is imported as a worker URL); no public API changes.

## [0.3.3] - 2023-12-23

_First npm release after 0.3.2, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Added
- `Cacophony.loadWorklets()` registers the phase-vocoder AudioWorklet when the context supports AudioWorklet (first published here; added in 0.3.2). Nothing in the public API uses the worklet yet.
- New runtime dependency: `fft.js`.

## [0.3.2] - 2023-12-23

_Tagged but not published to npm._

### Added
- Initial AudioWorklet support: phase-vocoder and overlap-add processors plus `Cacophony.loadWorklets()`.

### Changed
- The chunked WAV streaming helper moved to its own module.

## [0.3.1] - 2023-12-17

### Changed
- Version bump only; no code changes.

## [0.3.0] - 2023-12-17

### Changed
- Version bump only; no code changes since 0.2.1. The minor bump marks the switch to the Vite build and module format shipped in 0.2.1.

## [0.2.1] - 2023-12-17

### ⚠ Breaking
- The package is built with Vite and declares `"type": "module"`. `main` changed from `dist/index.js` to `dist/cacophony.cjs.js`, a new `module` entry points to `dist/cacophony.es.js`, and UMD and IIFE bundles are also shipped. Deep imports of the old `dist/*.js` files no longer work. The CommonJS file uses a `.js` extension inside a `"type": "module"` package, so Node's `require()` treats it as ESM and fails; use `import` or a bundler. (#1)

### Changed
- The TypeScript sources (`src/`) are included in the published package.

## [0.2.0] - 2023-12-16

### ⚠ Breaking
- `playbackRate` is a required member of `BaseSound`. Custom `BaseSound` implementations must add it. `MicrophonePlayback` no longer declares that it implements `BaseSound`.

### Added
- `playbackRate` getter and setter on `Sound`, `Playback` and `Group`. On a `Sound` it applies to current and future playbacks. It works for buffer and HTML-audio sources.
- TypeDoc API docs are generated on build and shipped in the package (`docs/`), and the README links to https://cacophony.js.org.

## [0.1.39] - 2023-12-13

### ⚠ Breaking
- Removed `Cacophony.stopAll()`, which closed the `AudioContext` permanently. Stop sounds individually, or call `pause()` to suspend the context.

## [0.1.38] - 2023-12-06

### ⚠ Breaking
- `Cacophony.listenerOrientation` is an `Orientation` object `{ forward: Position, up: Position }` instead of a forward vector. Use the new `listenerForwardOrientation` for the old behavior.

### Added
- `Orientation` type, plus `listenerForwardOrientation` and `listenerUpOrientation` getters and setters on `Cacophony`.

## [0.1.37] - 2023-12-06

### Added
- `Cacophony.listenerPosition` and `Cacophony.listenerOrientation` getters and setters control the 3D audio listener.
- Generated TypeDoc API documentation site; the README was rewritten to match the current API.

## [0.1.36] - 2023-12-06

### Fixed
- 3D positioning works when filters are attached. Filters sit between the panner and the gain node; before, they replaced the panner in the chain.

## [0.1.35] - 2023-12-06

### Changed
- The default `coneOuterAngle` for sounds is 360 instead of 0, so sounds are audible in all directions by default.
- Updated `standardized-audio-context` to ^25.3.60.

## [0.1.34] - 2023-12-05

### Changed
- `Playback.position` schedules the change with `setValueAtTime` instead of assigning `value` directly.

## [0.1.33] - 2023-12-05

### Fixed
- New playbacks inherit the sound's `threeDOptions`.
- The source is no longer connected straight to the gain node in addition to the panner, which had let the unpanned signal through.

## [0.1.32] - 2023-12-04

### Changed
- `Playback.threeDOptions` assigns each panner property explicitly instead of using `Object.assign`. Falsy values such as `0` are ignored and keep the current setting.

## [0.1.31] - 2023-11-29

### Added
- `Sound.threeDOptions` getter and setter (panner cone, distance model, rolloff and so on), merged into the sound's current playbacks. `Sound.position` is stored in these options.

## [0.1.30] - 2023-11-26

### Fixed
- HTML-audio sounds set `crossOrigin = 'anonymous'` on the audio element that is actually played, so cross-origin media can be routed through Web Audio when the server allows CORS.

## [0.1.29] - 2023-11-26

### Changed
- CORS adjustment to the HTML-audio path in `createSound()`. The element it touches isn't the one used for playback, so behavior is unchanged; see 0.1.30.

## [0.1.28] - 2023-11-25

### Changed
- Sets `crossOrigin = 'anonymous'` on an audio element created in `createSound(url, SoundType.HTML)`. That element isn't the one used for playback, so this had no effect; see 0.1.30.

## [0.1.27] - 2023-11-25

### Added
- `createSound(url, SoundType.HTML)` creates a sound backed by an HTML `<audio>` element instead of downloading and decoding the whole file.

### Fixed
- `createSound(buffer, type)` always creates a buffer sound, whatever `type` is passed.

## [0.1.26] - 2023-11-25

### ⚠ Breaking
- The `Sound` constructor's fifth parameter changed from `html: boolean` to `type: SoundType`, and the `Sound.html` property was replaced by `Sound.type`.

### Added
- `SoundType` enum (`HTML`, `Streaming`, `Buffer`) and an optional `type` parameter on `createSound()`.
- Experimental chunked streaming in `createStream()`: the URL is fetched and decoded chunk by chunk, assuming a 44-byte WAV header. This audio goes straight to the context destination and bypasses the global volume.

## [0.1.25] - 2023-11-22

### Fixed
- Setting `Sound.volume` changes only that sound's playbacks. Before, it also set the global gain, so one sound's volume affected everything. New playbacks start at the sound's volume.
- `Playback.cleanup()` is safe to call more than once.

## [0.1.24] - 2023-11-20

### Fixed
- Setting `Cacophony.volume` while muted only stores the value to restore on unmute instead of unmuting.

## [0.1.23] - 2023-11-20

### Fixed
- Setting `Cacophony.volume` while muted updates the volume that `unmute()` restores.

## [0.1.22] - 2023-11-20

### Fixed
- Calling `mute()` twice no longer loses the volume to restore, and `unmute()` does nothing when not muted.

## [0.1.21] - 2023-11-20

### Added
- `Cacophony.muted` getter and setter.

## [0.1.20] - 2023-11-19

### ⚠ Breaking
- `createStream(url)` returns a `Sound` (backed by an HTML `<audio>` element) instead of a `Playback`. Call `sound.play()` to start it.
- The `Sound` constructor takes an optional fifth `html` flag, and `buffer` may be `undefined`.

### Changed
- `createSound()` is typed as returning `Promise<Sound>` again (it was `Promise<BaseSound>` since 0.1.13).

## [0.1.19] - 2023-11-19

### ⚠ Breaking
- The `Sound` constructor takes the source `url` as its first parameter: `new Sound(url, buffer, context, globalGainNode)`.

### Changed
- `Playback` tracks its own playing state. `isPlaying()` reflects `play()` and `stop()` instead of the context state, and it throws after `cleanup()`.
- `stop()` on a playback that isn't playing does nothing, and `seek()` on a stopped playback moves the position without starting playback.
- Loops restart only while the playback is still playing.

## [0.1.18] - 2023-11-19

_First npm release after 0.1.16 and 0.1.17, which were tagged but not published. Upgrading from an earlier npm version? Read those entries too._

### Changed
- Internal changes only (release workflow permissions).

## [0.1.17] - 2023-11-19

_Tagged but not published to npm._

### Changed
- Internal changes only (release workflow).

## [0.1.16] - 2023-11-19

_Tagged but not published to npm._

### Changed
- Looping HTML-audio playbacks restart by seeking to 0; buffer playbacks re-create their source on each loop.
- Added a GitHub Actions workflow that builds and publishes to npm on tag, and updated the README (microphone input, fades, `cleanup()`).

## [0.1.15] - 2023-11-19

### ⚠ Breaking
- `isPlaying()` is a required member of `BaseSound`.

### Added
- `Group.isPlaying()`, `MicrophoneStream.isPlaying()` and `MicrophonePlayback.isPlaying()`.

## [0.1.14] - 2023-11-19

_First npm release after 0.1.13, which was tagged but not published. Upgrading from an earlier npm version? Read that entry too._

### Changed
- Internal changes only (tests).

## [0.1.13] - 2023-11-19

_Tagged but not published to npm._

### Changed
- `createSound()` is typed as returning `Promise<BaseSound>` (reverted in 0.1.20).
- `Group.addSound()` accepts any `BaseSound`, and `Group.resume()` calls each member's `resume()`.

## [0.1.12] - 2023-11-19

### Added
- `Playback` is exported.

## [0.1.11] - 2023-11-19

### Changed
- `createStream(url)` returns a single `Playback` again (reverting 0.1.10).

## [0.1.10] - 2023-11-19

### Changed
- `createStream(url)` returns `Promise<Playback[]>`.

## [0.1.9] - 2023-11-19

### ⚠ Breaking
- `StreamPlayback` is renamed to `MicrophonePlayback`.

### Added
- `Cacophony.createStream(url)` plays audio through an HTML `<audio>` element routed into Web Audio. `Playback` supports media-element sources for play, stop, loop and seek.

### Fixed
- Creating a `Playback` no longer starts its source immediately. `Sound.play()` had been starting the same source node twice.

## [0.1.8] - 2023-11-19

### Added
- `isPlaying()` on `Sound` and `Playback`.
- `Playback.threeDOptions` getter and setter for the underlying `PannerNode` settings; `threeDOptions` is an optional `BaseSound` member.

## [0.1.7] - 2023-11-18

### Fixed
- The npm package includes the compiled library. Earlier tarballs (verified for 0.1.3–0.1.6) shipped only `dist/index.js`, which re-exported a module missing from the tarball, so the package could not be imported.

## [0.1.6] - 2023-11-18

### Added
- `seek(time)` on `Sound`, `Playback` and `Group`.
- Microphone input: `Cacophony.getMicrophoneStream()` returns a `MicrophoneStream`, played through a `StreamPlayback`, with volume, filters, pause and resume.
- `Playback.sourceLoop` setter.

### Changed
- `BaseSound.play()` returns `BaseSound[]`; `seek` and `loop` are optional `BaseSound` members.
- `Sound.globalGainNode` and the internal nodes of `Playback` (`context`, `source`, `gainNode`, `panner`, `buffer`) are private.
- `Sound.play()` starts playbacks through `Playback.play()`.

## [0.1.5] - 2023-11-18

### ⚠ Breaking
- `moveTo(x, y, z)` is replaced by a `position` property on `Sound`, `Playback` and `Group`. Replace `sound.moveTo(x, y, z)` with `sound.position = [x, y, z]`.

### Added
- `Position` and `LoopCount` types are exported.

### Changed
- `Group.volume` returns the average volume of its sounds instead of the first sound's volume.

## [0.1.4] - 2023-11-18

### Added
- `Playback.cleanup()` disconnects and releases a playback's nodes; later calls on the playback throw.

### Fixed
- `Playback.fadeIn()` ramps from 0 to full volume using Web Audio automation and supports the `'exponential'` fade type. The old version used an interval timer that finished almost immediately.

## [0.1.3] - 2023-10-06

_0.1.0–0.1.2 were published to npm but not tagged; this block covers everything from the first commit to 0.1.3._

### Added
- First release. `Cacophony` wraps a (standardized-audio-context) `AudioContext` with a global gain node and provides `createSound(url | AudioBuffer)`, `createGroup(sounds)`, `createGroupFromUrls(urls)`, `createBiquadFilter(type)`, `pause()`, `resume()`, `stopAll()`, `setGlobalVolume()`, a `volume` property, `mute()` and `unmute()`.
- `Sound` holds a decoded buffer and creates a `Playback` for each `play()` call. It supports `stop()`, `pause()`, `resume()`, `loop(count | 'infinite')`, `volume`, `moveTo(x, y, z)` for 3D positioning, and `addFilter()`/`removeFilter()` for filters.
- `Group` controls several sounds together.
- Sounds loaded from URLs are cached with the browser Cache API (`CacheManager`), and concurrent loads of the same URL are de-duplicated.
- `Playback.fadeIn()` and `Playback.fadeOut()` with `'linear'` or `'exponential'` fades.

[Unreleased]: https://github.com/ctoth/cacophony/compare/v0.33.0...HEAD
[0.33.0]: https://github.com/ctoth/cacophony/compare/v0.32.1...v0.33.0
[0.32.1]: https://github.com/ctoth/cacophony/compare/v0.32.0...v0.32.1
[0.32.0]: https://github.com/ctoth/cacophony/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/ctoth/cacophony/compare/v0.30.4...v0.31.0
[0.30.4]: https://github.com/ctoth/cacophony/compare/v0.30.3...v0.30.4
[0.30.3]: https://github.com/ctoth/cacophony/compare/v0.30.2...v0.30.3
[0.30.2]: https://github.com/ctoth/cacophony/compare/v0.30.1...v0.30.2
[0.30.1]: https://github.com/ctoth/cacophony/compare/v0.30.0...v0.30.1
[0.30.0]: https://github.com/ctoth/cacophony/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/ctoth/cacophony/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/ctoth/cacophony/compare/v0.26.0...v0.28.0
[0.26.0]: https://github.com/ctoth/cacophony/compare/v0.25.1...v0.26.0
[0.25.1]: https://github.com/ctoth/cacophony/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/ctoth/cacophony/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/ctoth/cacophony/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/ctoth/cacophony/compare/v0.21.0...v0.23.0
[0.21.0]: https://github.com/ctoth/cacophony/compare/v0.20.8...v0.21.0
[0.20.8]: https://github.com/ctoth/cacophony/compare/v0.20.7...v0.20.8
[0.20.7]: https://github.com/ctoth/cacophony/compare/v0.20.6...v0.20.7
[0.20.6]: https://github.com/ctoth/cacophony/compare/v0.20.5...v0.20.6
[0.20.5]: https://github.com/ctoth/cacophony/compare/v0.20.4...v0.20.5
[0.20.4]: https://github.com/ctoth/cacophony/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/ctoth/cacophony/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/ctoth/cacophony/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/ctoth/cacophony/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/ctoth/cacophony/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/ctoth/cacophony/compare/v0.18.3...v0.19.0
[0.18.3]: https://github.com/ctoth/cacophony/compare/v0.18.2...v0.18.3
[0.18.2]: https://github.com/ctoth/cacophony/compare/v0.18.1...v0.18.2
[0.18.1]: https://github.com/ctoth/cacophony/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/ctoth/cacophony/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/ctoth/cacophony/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/ctoth/cacophony/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/ctoth/cacophony/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/ctoth/cacophony/compare/v0.15.3...v0.16.0
[0.15.3]: https://github.com/ctoth/cacophony/compare/v0.15.2...v0.15.3
[0.15.2]: https://github.com/ctoth/cacophony/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/ctoth/cacophony/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/ctoth/cacophony/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/ctoth/cacophony/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/ctoth/cacophony/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/ctoth/cacophony/compare/v0.13.5...v0.14.0
[0.13.5]: https://github.com/ctoth/cacophony/compare/v0.13.4...v0.13.5
[0.13.4]: https://github.com/ctoth/cacophony/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/ctoth/cacophony/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/ctoth/cacophony/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/ctoth/cacophony/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/ctoth/cacophony/compare/v0.12.10...v0.13.0
[0.12.10]: https://github.com/ctoth/cacophony/compare/v0.12.9...v0.12.10
[0.12.9]: https://github.com/ctoth/cacophony/compare/v0.12.8...v0.12.9
[0.12.8]: https://github.com/ctoth/cacophony/compare/v0.12.7...v0.12.8
[0.12.7]: https://github.com/ctoth/cacophony/compare/v0.12.6...v0.12.7
[0.12.6]: https://github.com/ctoth/cacophony/compare/v0.12.5...v0.12.6
[0.12.5]: https://github.com/ctoth/cacophony/compare/v0.12.4...v0.12.5
[0.12.4]: https://github.com/ctoth/cacophony/compare/v0.12.3...v0.12.4
[0.12.3]: https://github.com/ctoth/cacophony/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/ctoth/cacophony/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/ctoth/cacophony/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/ctoth/cacophony/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/ctoth/cacophony/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/ctoth/cacophony/compare/v0.10.4...v0.11.0
[0.10.4]: https://github.com/ctoth/cacophony/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/ctoth/cacophony/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/ctoth/cacophony/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/ctoth/cacophony/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/ctoth/cacophony/compare/v0.9.7...v0.10.0
[0.9.7]: https://github.com/ctoth/cacophony/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/ctoth/cacophony/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/ctoth/cacophony/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/ctoth/cacophony/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/ctoth/cacophony/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/ctoth/cacophony/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/ctoth/cacophony/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/ctoth/cacophony/compare/v0.8.7...v0.9.0
[0.8.7]: https://github.com/ctoth/cacophony/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/ctoth/cacophony/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/ctoth/cacophony/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/ctoth/cacophony/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/ctoth/cacophony/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/ctoth/cacophony/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/ctoth/cacophony/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/ctoth/cacophony/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ctoth/cacophony/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/ctoth/cacophony/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/ctoth/cacophony/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/ctoth/cacophony/compare/v0.5.23...v0.6.0
[0.5.23]: https://github.com/ctoth/cacophony/compare/v0.5.22...v0.5.23
[0.5.22]: https://github.com/ctoth/cacophony/compare/v0.5.21...v0.5.22
[0.5.21]: https://github.com/ctoth/cacophony/compare/v0.5.20...v0.5.21
[0.5.20]: https://github.com/ctoth/cacophony/compare/v0.5.19...v0.5.20
[0.5.19]: https://github.com/ctoth/cacophony/compare/v0.5.18...v0.5.19
[0.5.18]: https://github.com/ctoth/cacophony/compare/v0.5.17...v0.5.18
[0.5.17]: https://github.com/ctoth/cacophony/compare/v0.5.16...v0.5.17
[0.5.16]: https://github.com/ctoth/cacophony/compare/v0.5.15...v0.5.16
[0.5.15]: https://github.com/ctoth/cacophony/compare/v0.5.14...v0.5.15
[0.5.14]: https://github.com/ctoth/cacophony/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/ctoth/cacophony/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/ctoth/cacophony/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/ctoth/cacophony/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/ctoth/cacophony/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/ctoth/cacophony/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/ctoth/cacophony/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/ctoth/cacophony/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/ctoth/cacophony/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/ctoth/cacophony/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/ctoth/cacophony/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/ctoth/cacophony/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/ctoth/cacophony/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ctoth/cacophony/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ctoth/cacophony/compare/v0.4.6...v0.5.0
[0.4.6]: https://github.com/ctoth/cacophony/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/ctoth/cacophony/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/ctoth/cacophony/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/ctoth/cacophony/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ctoth/cacophony/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ctoth/cacophony/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ctoth/cacophony/compare/v0.3.13...v0.4.0
[0.3.13]: https://github.com/ctoth/cacophony/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/ctoth/cacophony/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/ctoth/cacophony/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/ctoth/cacophony/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/ctoth/cacophony/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/ctoth/cacophony/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/ctoth/cacophony/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/ctoth/cacophony/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/ctoth/cacophony/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/ctoth/cacophony/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/ctoth/cacophony/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ctoth/cacophony/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ctoth/cacophony/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ctoth/cacophony/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/ctoth/cacophony/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ctoth/cacophony/compare/v0.1.39...v0.2.0
[0.1.39]: https://github.com/ctoth/cacophony/compare/v0.1.38...v0.1.39
[0.1.38]: https://github.com/ctoth/cacophony/compare/v0.1.37...v0.1.38
[0.1.37]: https://github.com/ctoth/cacophony/compare/v0.1.36...v0.1.37
[0.1.36]: https://github.com/ctoth/cacophony/compare/v0.1.35...v0.1.36
[0.1.35]: https://github.com/ctoth/cacophony/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/ctoth/cacophony/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/ctoth/cacophony/compare/v0.1.32...v0.1.33
[0.1.32]: https://github.com/ctoth/cacophony/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/ctoth/cacophony/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/ctoth/cacophony/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/ctoth/cacophony/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/ctoth/cacophony/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/ctoth/cacophony/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/ctoth/cacophony/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/ctoth/cacophony/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/ctoth/cacophony/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/ctoth/cacophony/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/ctoth/cacophony/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/ctoth/cacophony/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/ctoth/cacophony/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/ctoth/cacophony/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/ctoth/cacophony/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/ctoth/cacophony/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/ctoth/cacophony/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/ctoth/cacophony/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/ctoth/cacophony/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/ctoth/cacophony/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/ctoth/cacophony/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/ctoth/cacophony/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/ctoth/cacophony/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/ctoth/cacophony/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ctoth/cacophony/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ctoth/cacophony/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ctoth/cacophony/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ctoth/cacophony/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ctoth/cacophony/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ctoth/cacophony/releases/tag/v0.1.3
