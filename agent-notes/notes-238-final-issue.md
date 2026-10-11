## Problem and outcome

A Sound with two phasers and two overlapping Playbacks needs a reference that identifies the intended attachment and resolves to the correct independent AudioParam in each voice. Reordering must not redirect it. A saved bus snapshot needs a compatible named address instead of a filter index or native handle.

Parameter facts are also duplicated across processor descriptors, options, alias tables, presets and CLI schemas. Identically named parameters can mean different things: phaser depth is octaves, modulated-delay depth is milliseconds, and tremolo depth is normalized amplitude.

Deliver shared definitions, stable attachments, strict binding and explicit readiness. Keep automation scheduling in #45 and snapshot application in #200. This issue can close independently of those consumers.

Baseline: [0986e1b3](https://github.com/ctoth/cacophony/tree/0986e1b3c5ad05ed2dade5582ffad96844f341b5), checked against local and GitHub master on 2026-09-18.

## Ownership and identity

Definitions belong to processor/effect types. Attachments belong to owners. Native values and timelines belong to live parameter instances.

| Concept | Contract |
| --- | --- |
| Definition | Stable definition id and parameter key, units, domain, defaults, encoding and supported operations. No live nodes. |
| Slot | One attachment of a recipe or admitted native node to a source, live Playback or Bus. An optional explicit name is unique within its owner. |
| Reference | An in-memory target tied to an attachment identity, or to an owner-level control. Source references resolve within a specified Playback. |
| Binding | A concrete parameter, its context and an inspectable validity state. Readiness settles once; subsequent removal, replacement or cleanup can invalidate the binding. |
| Serialized address | Owner-relative plain data for deliberate lookup in a reconstructed owner. It contains an address format version, explicit slot name or owner-control key, definition id and parameter key. |

These distinctions do not require five public classes. Keep the API small, typed and additive; exercise the vertical slice before fixing method names.

Source owners include Sound, Synth, MediaStreamSound and PcmStreamSound. Live BasePlayback descendants can also attach effects directly. A source's owner-level volume/pan reference describes the corresponding per-voice control, not a hidden source AudioParam. Group and SynthGroup effect inheritance is out of scope.

### Attachment changes

- A newly constructed Playback captures the source's current attachment identities/order. Source edits affect future materializations, not existing voices. An old reference can still resolve on a voice that captured that attachment; it cannot resolve on a later voice built from a replacement with the same name.
- Stream sources currently reuse one Playback. Repeated play/preplay calls do not recapture slots; source edits take effect only when a new voice is actually constructed.
- Removing a live Playback/Bus slot invalidates its bindings immediately, including pending bindings. Bypass and reorder retain identity. Bypass does not pause native automation.
- Allow one independent-building recipe in two explicitly named slots. Preserve duplicate rejection for legacy unnamed addEffect(recipe). Legacy removal by recipe works when unambiguous; multiple attachments produce an ambiguity error and require removal by slot. Never select an arbitrary first attachment.
- Resolve source-slot references by identity in the voice's captured-attachment map. A foreign voice, a voice predating the slot, or a clone that did not inherit it returns `not-attached`, even if names match.
- Unnamed legacy attachments have runtime identity but cannot be serialized. No generated-name persistence contract is needed. Use structured address fields rather than parsing dotted strings.
- Serialized addresses deliberately permit compatible reconstructed replacements by name. Old in-memory references/bindings never redirect this way. Missing saved targets are `unknown`; do not infer historical removal from a saved name. Reserve the `cacophony.` definition-id prefix for built-ins; incompatible semantic changes require a new definition id. Compatibility includes effective units/encoding and configuration-dependent semantics, not just a matching parameter name. An unsupported address version is `incompatible`.
- Addresses are relative to an explicitly supplied owner. #200 adds named-bus lookup around them; this issue does not invent a global Sound registry. Anonymous buses remain outside #200's serialized registry lookup.

### Shared nodes and chain order

ShareEffect and BiquadEffect retain their explicit native-node sharing, which can span owners. Third-party recipes that intentionally share must declare that ownership. Existing build-only recipes retain their per-playback build contract; no metadata is invented for them.

Reject a second attachment of the same known shared node within one owner at attach time, before building a voice. Keep duplicate-handle detection as a backstop. Rejection must not dispose an already-admitted shared graph. Dispose separately owned resources created by a rejected build exactly once; retain the existing cleanup of a distinct rejected graph. Binding invalidation for one owner must not invalidate another owner's valid binding to the same AudioParam. #45 owns one timeline per actual AudioParam, including cross-owner aliases.

Extend EffectChain's authoritative records and reservation lifecycle rather than maintaining a second ordered chain:

- Slot-based reorder takes a permutation of all public slots, including pending ones. Pending bypass is recorded and applies when the build resolves.
- Legacy handle reorder keeps its current behavior: permute built entries while reservations remain at their positions. Preserve BasePlayback's biquad-first legacy ordering.
- Legacy `filters` on sources/Playbacks continues to represent attachments made through addFilter; arbitrary addEffect slots must not suddenly appear there. Bus.filters retains its existing all-built-handles meaning. These are compatibility views, not separate authoritative orders.
- Internal pitch-shift materialization has an internal chain record, excluded from public slot enumeration and serialization. Public slot reordering preserves internal record positions.

## Shared definitions

There are 17 registered worklets, 13 exposing 62 AudioParam entries: 61 explicitly declare k-rate; phase-vocoder pitchFactor omits the rate and therefore defaults to a-rate. Its processor consumes the last value per invocation. Preserve the descriptor contract and describe DSP consumption separately; metadata extraction must not silently change either. The remaining four processors use messages or fixed processing and receive no fictional numeric controls. See the [Web Audio descriptor definition](https://webaudio.github.io/web-audio-api/#dictdef-audioparamdescriptor).

- Define units, native default/range/rate, continuous/integer/choice semantics and explicit numeric choice encodings. Distinguish processor defaults, factory preset defaults and configured initial values. Construction-only options remain distinct from live parameters.
- Preserve backend names and units. Dattorro preDelay remains samples with a sample-rate-relative bound; FDN preDelay remains seconds. Resolve context-dependent bounds at construction/binding time, including native biquad frequency. No incidental unit migration.
- Distinguish descriptor bounds from public semantic constraints and from DSP quantization/state transitions, including spectral freeze. The strict path rejects non-finite values, invalid choices, fractional counts and values outside its domain before mutation. Validate finite representability and compare native bounds/defaults in their float32 representation so a captured endpoint can round-trip. Discrete controls support scheduled steps through #45; ramps over choices/counts are unsupported unless explicitly defined.
- Strict rejection and legacy construction normalization intentionally differ. Preserve existing numeric factory clamping/quantization unless separately documented and tested. Unknown string aliases must be rejected at the shared definition boundary; this deliberate change from silent index-0 fallback needs a compatibility note.
- Definitions live in worklet-global-free modules and have per-processor exports. Derive descriptors, aliases and shared validation/normalization from them; reuse those facts in effect and CLI adapters. Remove duplicate alias tables and the repeated limiter sentinel. Processor cores and independent worklet IIFEs must not import the entire catalog or worklet globals.
- Preserve limiter's fixed ratio and omitted ratio option, gate defaults, modulated-delay presets, distortion/autopan presets and CLI reverb's decay-to-decayTime alias. Constructor schemas are projections with preset overrides and construction-only fields, not copies of every live parameter.
- Include definitions for Cacophony-built native gain, biquad frequency/detune/Q/gain and stereo pan using Web Audio's nominal domains. Effective biquad Q semantics depend on filter type. The strict playback-volume semantic domain is finite, nonnegative gain; bus output and exposed effect gains retain their signed nominal native domain. Existing unchecked legacy setters retain compatibility.
- Metadata is available through named package exports without loading processor implementations, worklet payloads, FFT or MediaBunny. Preserve lazy WORKLETS URL loaders, worklet tsconfig compatibility and consumer-bundle separation.
- Application mappings, such as decibels to linear gain, remain outside processor definitions. No expression language or application callback framework.

## Binding, immediate values and lifecycle

Slots exist when attached, including while a Bus build is pending. Definitions/references are available then; binding success requires an actual declared parameter compatible with the owner context.

- Support worklet parameters, Cacophony-built native parameters and explicitly exposed BuiltEffectGraph.params. Third-party recipes can opt into definitions and explicit bindings. Undeclared parameters are `unsupported`; the strict path has no reflective name-lookup fallback. Existing handle APIs retain their documented warning/no-op behavior.
- Configuration-dependent availability must be explicit. Preserve ImpulseResponseEffect's wet-only convolver optimization: dry/wet bindings are unsupported when dry=0 and wet=1, including when those values were explicitly supplied. The exposed graph configuration binds both. Lookup must not silently allocate a different graph.
- First-delivery owner adapters are playback user-volume gain, bus output gain and playback stereo pan. Master bus gain means `master.output.gain`; `cacophony.volume`/mute on `master.input.gain` remains outside this model. Stereo pan is unsupported under HRTF. Switching/replacing the panner invalidates old bindings; switching back requires fresh binding. Each future owner adapter must declare its own native-target replacement policy rather than inherit a universal rule incompatible with source recreation.
- Effect bindings survive pause/stop/replay while their attachment and graph survive. Cleanup invalidates the owner's bindings and releases owned graph references. A checked operation on a stale binding fails instead of writing a disconnected target. Native handles remain an escape hatch; external native writes and graph changes are not automatically tracked.
- Provide validated immediate assignment through the binding contract without adding a scheduler. Owner gain/pan assignments delegate to the existing owner setters after checking binding validity, retaining current cancellation semantics. Effect assignments use the same immediate scheduling primitive as EffectChain.rampParam; they do not cancel an existing ramp, whose future events remain scheduled. #45 owns replacement/cancellation policy and later routes these same operations and legacy convenience APIs through its common timeline; do not create separate interpolation/event bookkeeping here.
- Failures distinguish `unknown`, `not-attached`, `removed`, `incompatible`, `unsupported`, `failed-build` and `disposed`, with target identity and original cause where applicable. Pending is readiness, not a missing parameter. Readiness fulfills with a typed result rather than an unobserved rejecting promise. Existing promise-returning addEffect/addFilter APIs still reject on build failure; strict preparation rejects as specified below.
- Removal during a pending build settles `removed`; cleanup settles `disposed`. Late results release only their newly owned resources once, never connect, never invoke success callbacks and never emit a build-failure event for that cancellation. A previously fulfilled readiness result does not make a later-invalidated binding valid again. The promise already returned by a legacy addEffect/addFilter call rejects at invalidation with a typed cancellation error whose reason is `removed` or `disposed`, distinguishable from `failed-build` and carrying no build-failure cause. It never fulfills with a disposed handle or surfaces an EffectChain reservation guard error. The source materialization path handles that rejection silently: no warning or effect error event.

## Failure reporting and preparation

Preserve synchronous play() timing. Legacy source construction treats synchronous build throws as preparation failure, while asynchronous rejection can arrive after start and leaves the voice playing without that effect. Label this timing-dependent distinction as compatibility behavior. Sound and Synth already roll back synchronous construction failure; MediaStreamSound and PcmStreamSound need equivalent rollback so this work does not leave their partially constructed voices connected.

For source-declared asynchronous effect failure, replace the warning-only path with inspectable failed readiness and a playback error with `errorType: "effect"`, attachment identity, original cause and `recoverable: true`. Forward that discriminator and identity through Sound's error event. Source-originated internal pitch-build failures use the same category with an internal target identity. Direct playback.addEffect and Bus.addFilter callers receive their promise/readiness failure without a duplicate playback event.

Sound.play's pending play-event forwarder must ignore effect errors and still forward later successful media acceptance exactly once. It currently removes the listener on every error; `recoverable` is not a sufficient discriminator because failed media starts are also recoverable. Preserve actual source-start failure cleanup. The changelog must note the expanded error-type union and that inherited pitch-build failures, previously swallowed, become observable on source preplay/play.

### Strict buffered preparation

Add an explicit asynchronous preparation operation for a buffered Sound, reusing preplay construction and readiness rather than a second construction pipeline. A media-element Sound rejects as `unsupported` before constructing a voice:

1. Capture the source attachment set for this new voice. Reject known shared-node recipes before materialization: this operation promises an isolated, unstarted voice and cannot roll back changes to another live owner's shared graph. Third-party recipes must honor their declared ownership contract.
2. Await all captured effect builds **and inherited pitch-shift materialization**. Pitch readiness/failure/cancellation must participate even though public pitch-factor binding is deferred. Track the internal pitch node by ownership, never adopt an arbitrary user effect merely because it exposes pitchFactor. At most one internal pitch record exists per voice; the latest requested factor wins. Concurrent updates or a return to unity cannot insert a stale build; unity retains true passthrough.
3. Resolve and validate all requested effect-slot initial values before applying any. Initial values here cover this voice's exclusively owned effect parameters only; owner start values remain in PlayOptions. Return the unstarted Playback only after successful initialization. No source start or general automation events are scheduled by preparation.
4. On synchronous/asynchronous failure, caller AbortSignal cancellation, source stop or cleanup, reject and dispose only this new voice and its resources/subscriptions. Use identity-based removal from Sound holdings and playbacks; never truncate arrays to a pre-await length and discard another preparation's voice. Cancellation must settle without waiting for an uncooperative third-party build; late completion is ignored/disposed without cancelling shared module loads.

Reuse the normal source-control behavior while waiting; the captured attachment set is stable, and initial effect assignments occur after readiness. Caller play options applied later are explicit overrides. A future play({ panType }) can invalidate a previously acquired stereo-pan binding.

Preparation accepts no start deadline. The caller can compare context.currentTime after awaiting before calling play({ at }). Past-at behavior of existing play remains unchanged. Preparation alone does not promise meeting a scheduled start; deadline/automation policies belong to their consumers.

## Delivery and boundaries

Land incremental PRs under this issue:

1. A vertical slice: two named phaser slots, two overlapping Playbacks and one named bus gain; definitions, identity, strict resolution, immediate assignment, readiness and disposal.
2. Complete the built-in definition inventory and effect/CLI adapters, preserving presets, numeric compatibility and lazy bundles; include native biquad, stereo pan and an exposed multi-node graph.
3. Complete strict buffered preparation, legacy projections, lifecycle/error regressions, public type/bundle checks and documentation. Full metadata migration remains part of this issue's outcome; consumer feature implementation does not.

The public pitch-shift automation adapter is deferred, but its internal materialization/ownership/readiness requirements above are included. Oscillator/playback-rate adapters must address recreated source nodes in their own work. #207 adds envelope gain while retaining separate envelope and user-volume stages.

General slot cloning is deferred. Preserve existing clone behavior: legacy filters clone as today; arbitrary effect slots, names, references and timelines are not inherited. A clone that did not capture a slot returns `not-attached`. Playback.clone's existing best-effort pitch setup remains silent and is not a strict preparation path. A later clone feature must explicitly define recipe/name copying, fresh attachment identities, filter overrides, sharing and Playback.clone's auto-start behavior.

#45 owns managed timelines, native scheduling, cancellation, external-write tracking and promise settlement, including migration of existing setters/fades/ramps. #200 consumes compatible named addresses and #45 transitions; its filterIndex/direct-ramp/timer proposal is superseded by these integration contracts. #45 and #200 may build on PR 1's contract once merged; they need not wait for this issue to close. #198 remains pitch/gain variation and does not require effect references today. No consumer imports are needed to implement this foundation.

Out of scope: snapshot application, general automation, reactive graphs, application mappings, group inheritance, DSP-state serialization, algorithm replacement, general slot cloning and public virtual controls that create/remove processing nodes.

## Acceptance

1. One phaser recipe attached in two named slots produces four independent nodes across two overlapping Playbacks. A source reference reaches only its intended slot/voice; writes do not mutate another voice or recipe. Exercise bus gain through the same binding contract.
2. Source removal/replacement affects only newly constructed voices. Existing captured attachments remain resolvable. Foreign, predating and non-inheriting clone voices return `not-attached`. Test stream single-voice reuse explicitly.
3. Live removal/name reuse cannot revive stale bindings. Reorder/bypass preserve identity. Slot reorder and pending bypass work before out-of-order builds finish; legacy handle reorder and filter projections retain their existing semantics.
4. Serialized addresses round-trip through JSON and resolve compatible reconstructed targets. Wrong definition/version/semantics, missing targets and unnamed attachments give structured failures without index/name guessing. Master bus gain does not alter global volume/mute. Shared aliases identify the same native parameter; removing one owner's attachment leaves another valid.
5. Definition fixtures check expected defaults versus presets, choice/count domains, units, float32 endpoint round-trips, sample-rate-relative bounds, rates and preserved numeric construction behavior. Assert known contract values as well as descriptor consistency so a shared wrong constant cannot validate itself. Reject unknown aliases and unsupported operations.
6. Bind native biquad, worklet, graph and owner controls; verify default wet-only IR, HRTF pan and undeclared third-party parameters report unsupported. Test a third-party opt-in definition/binding. Panner replacement invalidates old bindings. Immediate owner assignments retain existing fade/ramp cancellation behavior.
7. Test synchronous throw, asynchronous rejection, removal, abort, stop and cleanup during pending builds. Readiness settles correctly without unhandled rejections; the legacy promise rejects with the typed cancellation reason for both pending removal and owner cleanup, never fulfilling with a disposed handle. No late connection, success callback, error-after-cancellation or double disposal. Reject duplicate shared attachment without harming the first; separately owned rejected graphs still dispose. Stream synchronous failure rolls back.
8. Media playback acceptance after a source-effect rejection still produces one Sound play event and the distinct recoverable effect error. Actual media-start rejection retains its behavior. Readiness failure remains observable to late subscribers.
9. Strict buffered preparation establishes effect initial values before start, awaits inherited pitch shift and starts nothing on failure. Shared recipes are rejected without changing existing voices. Concurrent successful and failed preparations preserve each other's holdings. Test a custom effect exposing pitchFactor so internal pitch ownership never hijacks it, and test unity/cancellation while pitch materialization is pending.
10. Document one source reference used for preparation and later binding, plus an owner-relative serialized bus target. Exercise audible first-start behavior through native/offline and browser lanes where timing matters. Optional Node tests use nodeBackendAvailable and must actually run in a supported environment before claiming native acceptance. API spies alone are insufficient.
11. Public type fixtures cover known parameter keys/choices and third-party opt-in. check:package-types and check:bundles cover metadata/reference imports: no eager worklet payloads, FFT or MediaBunny and the existing non-Cacophony size budget. Normal lint, typecheck, tests and build pass.

## Existing owners

- src/effects.ts: recipes, native wrappers, BuiltEffectGraph.params and option conversion.
- src/routableSource.ts / src/basePlayback.ts: source declarations and live materialization.
- src/effectChain.ts / src/bus.ts: reservations, ordering, graph lifecycle and handle APIs.
- src/sound.ts / src/playback.ts / src/mediaStream.ts / src/pcmStream.ts: construction, preparation, source recreation and error propagation.
- src/worklets.ts / src/processors/: lazy registration, descriptors and global-free core modules.
- src/cli/effects-registry.ts: construction schemas and aliases.
