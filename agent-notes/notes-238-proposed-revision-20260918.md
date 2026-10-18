# Issue #238: proposed revision

Reviewed against local HEAD and GitHub master `0986e1b3c5ad05ed2dade5582ffad96844f341b5` on 2026-09-18. This is a proposed issue body, not an implementation or a published edit.

## Findings driving this revision

- The 62-parameter inventory is correct, but “all k-rate” is not: `src/processors/phase-vocoder.ts:53` omits automationRate, which defaults to a-rate. Its DSP reads the final parameter value per invocation (`:94`). Preserve the declared backend contract and describe consumption separately; changing DSP behavior is separate work. See the [Web Audio descriptor definition](https://webaudio.github.io/web-audio-api/#dictdef-audioparamdescriptor).
- `RoutableSource.removeEffect` changes future materializations only (`src/routableSource.ts:39`). “Removal invalidates live bindings” needs an owner distinction; applying it globally would change existing voices.
- Live playbacks also own attachments (`src/basePlayback.ts:45`), but the issue's owner inventory omits them. Recipe reuse also makes legacy `removeEffect(recipe)` ambiguous.
- Synchronous build throws escape `BasePlayback.materializeEffect` (`src/basePlayback.ts:67`) and trigger `Sound.preplay` rollback (`src/sound.ts:291`). Only promise rejection reaches the warning-and-continue path. The existing issue conflates these cases.
- `ImpulseResponseEffect.build` returns a plain convolver at dry=0/wet=1 (`src/effects.ts:240`), even when those values are explicitly supplied. That configuration has no exposed dry/wet AudioParams. A type-wide promise of bindable controls would be false.
- `Playback.setPitchShift` discovers the first node exposing `pitchFactor`, removes it at unity, and rebuilds later (`src/playback.ts:709`). Owner-level pitch cannot safely inherit this name-based lookup, and cannot promise a permanently present AudioParam.
- Panner switching replaces the native node (`src/pannerMixin.ts:68`); buffer and oscillator playback also recreate source nodes. Binding lifetime must be about the actual target, not merely whether the playback object still exists.
- `Playback.clone` can start its new voice immediately and retains no general recipe provenance (`src/playback.ts:827`). General slot cloning is more than copying an array. The initial issue should not silently acquire that feature.
- #200 still proposes filter indices and independent ramp/timer logic. #238's completion criteria must not require shipping #200 or #45; their integration work needs an explicit downstream boundary.

---

# Shared parameter definitions and stable effect-slot references

## Problem and outcome

Cacophony can build effect recipes and automate live node handles, but cannot name the same intended control before and after materialization. A Sound with two phasers and two overlapping Playbacks needs a reference that distinguishes the two attachments and resolves to the correct independent AudioParam in each voice. Reordering must not redirect that reference. A saved bus snapshot needs a compatible named address instead of a filter index.

Parameter facts are also duplicated across processor descriptors, effect options, aliases, presets and CLI schemas. Identically named parameters can mean different things: phaser depth is octaves, modulated-delay depth is milliseconds, and tremolo depth is normalized amplitude.

Deliver shared definitions, named attachments, strict resolution and observable readiness. Automation execution and timeline policy remain in #45; snapshots remain in #200.

## Ownership and identity

Definitions belong to processor/effect types. Attachment identity belongs to an owner. Native values and timelines belong to live parameter instances.

| Concept | Contract |
| --- | --- |
| Definition | Stable type/parameter identity, units, domain, default, encoding and supported operations. No live nodes. |
| Slot | One attachment of a recipe to a source, live Playback or Bus. An optional explicit name is unique within its owner. |
| Reference | An in-memory target tied to its owner and attachment identity. Source references resolve against a specified Playback derived from that source attachment. |
| Binding | One concrete target and lifetime. Pending materialization is explicit; removal or target replacement invalidates it. |
| Serialized address | Plain structured data for deliberate lookup in a reconstructed owner, with type/parameter compatibility information. It is not an in-memory reference or native handle. |

These distinctions do not require five public classes. Keep the public API small, typed and additive; exercise the vertical slice below before fixing method names.

Source owners include Sound, Synth, MediaStreamSound and PcmStreamSound. Live BasePlayback descendants can also attach effects directly. Group and SynthGroup effect inheritance is out of scope.

### Attachment changes and references

- Source slot lists describe future Playbacks. Each new Playback captures the current attachment identities/order. Editing the source afterward does not reconfigure an existing voice. An old reference can still resolve against an existing voice that captured that attachment, but cannot resolve against a later voice built from a replacement, even if its name is reused.
- Removing a slot on a live Playback or Bus invalidates that attachment's bindings immediately. Removing a pending slot also prevents its eventual build from reconnecting. Bypass and reorder retain bindings; bypass does not pause native automation.
- Allow the same independent-building recipe in two explicitly named slots. Keep legacy unnamed `addEffect(recipe)` duplicate rejection and unambiguous `removeEffect(recipe)` behavior. If a recipe has multiple attachments, removal by recipe must report ambiguity; removal by slot is explicit. Never arbitrarily choose the first attachment.
- A source reference cannot resolve on an unrelated source's Playback merely because its slot names match. A Playback-local attachment is addressed within that Playback only.
- ShareEffect and BiquadEffect retain their explicit native-node sharing. Bindings disclose that sharing; it can span owners. Reject duplicate handles within a chain. Invalidating one owner's attachment must not invalidate another owner's still-valid access to a shared target. #45 must maintain one timeline per actual AudioParam, including aliases across owners.
- Generated names for legacy attachments are runtime-only. Serialization requires an explicit name. Use structured address fields rather than parsing a dotted string, so names containing punctuation are unambiguous.
- Serialized addresses carry a format version and stable definition compatibility identity, not a constructor name, array index or random runtime token. They may intentionally resolve a compatible replacement by name after reconstruction; old in-memory references and bindings never redirect this way. Missing targets are reported as unknown; removed is meaningful for an in-memory identity, not something to infer from a saved name.

## Shared definitions

At the reviewed commit there are 17 registered worklets, 13 exposing 62 AudioParam entries: 61 explicitly declare k-rate; phase-vocoder pitchFactor omits the rate and therefore defaults to a-rate. The four remaining processors use messages or fixed processing and receive no fictional numeric controls.

- Define identity, units, backend defaults/ranges/rate, continuous/integer/choice semantics and choice encodings. Distinguish a processor's default from a recipe's configured initial value and factory preset overrides. Snapshot capture reads live state through the consumer's contract, not a metadata default.
- Preserve existing backend units. Dattorro preDelay remains samples with a sample-rate-relative upper bound; FDN preDelay remains seconds. Resolve context-dependent bounds at binding/construction time. Native biquad frequency also has a context-dependent bound. Avoid an incidental unit migration.
- Distinguish native descriptor limits from stricter public semantic domains, such as positive pitch factors. Do not silently narrow a descriptor or change its automation rate while extracting metadata. Report discrete quantization and state transitions, including spectral freeze, separately from the native rate.
- The new strict reference path rejects non-finite values, invalid choices, fractional integer values and values outside its declared domain before mutation. Discrete controls support scheduled steps; continuous ramps over choice/count controls are unsupported unless a definition deliberately specifies them. #45 enforces operation compatibility when it implements scheduling.
- Unknown string aliases must be rejected at the definition boundary. Preserve existing numeric factory clamping/normalization behavior unless a separate compatibility change is documented and tested; extracting definitions is not authority to alter every existing input policy.
- Definitions live in worklet-global-free modules. Export per-processor definitions so independent worklet IIFEs do not pull in the entire catalog. Derive descriptors, shared validation/normalization and alias encodings from them; reuse the same facts in effect/CLI adapters. Remove duplicate alias tables and the repeated limiter sentinel. Keep processor cores independent of worklet globals.
- Factory adapters retain preset overrides and construction-only options. Preserve limiter's fixed ratio and omitted ratio option, gate defaults, modulated-delay presets, distortion/autopan presets, and CLI reverb's decay-to-decayTime alias. Construction schemas and live parameter definitions are different views; not every constructor option is automatable.
- Include Cacophony-built native gain, biquad and stereo-pan definitions using Web Audio's nominal domains. Native defaults, Cacophony defaults and configured values must remain distinguishable. Biquad parameter meaning can depend on filter type; metadata must not label Q with one misleading universal unit.
- Expose definitions as named package exports without loading processor implementations, worklet payloads, FFT or MediaBunny. Preserve lazy WORKLETS URL loaders and validate the new exports with the existing package type and consumer-bundle checks.
- Application mappings, such as decibels to linear gain, stay outside processor metadata. This issue introduces no expression language or arbitrary application callbacks.

## Binding and supported targets

Reuse EffectChain's reservations, parameter exposure and disposal; extend its authoritative attachment records instead of maintaining a second independently ordered chain. Source declarations and their per-voice materializations are distinct records linked by identity.

Slots exist when attached, including while a Bus build is pending. Definitions and references are available then; a successful binding is available only after its actual parameter exists and passes compatibility/context checks.

- Support worklet parameters, native Cacophony-built parameters and explicitly exposed BuiltEffectGraph.params through the same contract. Third-party recipes can opt into definitions and explicit bindings. Existing build-only recipes remain valid effects; undeclared parameters return unsupported, with no reflective name fallback in the strict path.
- Configuration-dependent availability must be visible before resolution where knowable. In the initial implementation, preserve ImpulseResponseEffect's wet-only convolver optimization: its dry/wet controls are unsupported in that configuration. The exposed graph configuration advertises and binds both. Do not promise them universally or allocate extra nodes as an undocumented side effect of lookup.
- Owner-level controls have an explicit namespace: implement playback user-volume gain, bus output gain and stereo pan as the initial native adapters. Stereo pan is unsupported while the owner uses HRTF. Switching panner nodes invalidates old bindings; switching back requires a fresh binding. Existing bindings are not silently rebound.
- Preserve effect bindings across pause/replay when their actual effect nodes survive. Any replaced native target invalidates its binding, even when the Playback survives. Cleanup invalidates all bindings owned by that instance and releases graph references. Calling a stale binding must fail rather than write a disconnected node.
- Return typed failures for unknown, removed, incompatible, unsupported, failed-build and disposed targets, with target identity and original cause where applicable. Pending is readiness, not a missing parameter. Consumers choose whether to display, skip or abort.
- Keep legacy handle APIs and their warning/no-op behavior. Project legacy filters/order operations from attachment records while preserving the existing biquad-first Playback ordering and pending reservation positions. No independent authoritative filter order may drift from the slots.

Pitch-shift factor is a follow-up owner adapter, not a permanently present AudioParam in this first delivery. The existing unity setting removes its node, and lookup currently chooses by parameter name. That follow-up must establish dedicated ownership, preserve unity passthrough, settle concurrent builds, and define absent/rebuilt-target behavior before promising automation through #45. It must never adopt an unrelated effect merely because it exposes pitchFactor. Oscillator controls, playback-rate recreation and #207's envelope gain likewise integrate when their lifecycle-owning work lands; they do not block this foundation.

## Readiness and initial values

Existing synchronous play() keeps its timing. Preserve the current distinction: synchronous construction failures abort preparation and roll back; asynchronous build failures can arrive after playback has started. Replace warning-only asynchronous failures with observable binding failure plus a recoverable playback error carrying attachment identity. Readiness failure remains inspectable even if an event listener was attached late. Bus callers receive the failure through attachment readiness; do not invent a Playback event for a Bus.

Add an explicit asynchronous preparation path for a buffered Sound: create an unstarted Playback, capture its source slots, await all required builds, validate/bind requested initial values, and apply them before returning it to the caller for play(). This path must not start audio itself. Failed preparation disposes the new voice and removes its retained source bookkeeping, without disturbing existing voices. Cleanup/cancellation while waiting settles promptly; late results are disposed and cannot resurrect it. Reuse this readiness mechanism for other source kinds without promising buffer-style scheduling where their backends cannot provide it.

Scheduling a synchronous play({ at }) sufficiently far in the future is not itself a readiness guarantee. For guaranteed initial values, preparation must finish before issuing start. If the requested start deadline has already passed, the prepared-start path fails without starting or applying missed values late. Timeline scheduling/cancellation remains #45's responsibility; this issue adds no event evaluator or fade scheduler.

The completed foundation can demonstrate one source reference reused for initial configuration and later resolution to the same live target. Its bindings expose enough identity, context and validity for #45 to own scheduling. Direct native writes remain outside managed timeline tracking, as specified in #45.

## Scope and delivery

Land incremental PRs under this issue:

1. Exercise the contract with two named phaser slots, two Playbacks, and one named bus gain. Establish definitions, source/slot identity, strict resolution, readiness and disposal.
2. Migrate the remaining built-in definition facts and adapters, preserving presets, backend behavior, CLI compatibility and lazy bundles. Cover a native biquad and an exposed multi-node graph.
3. Complete buffered preparation, legacy API projections, package exports, failure tests and documentation.

General clone support is separate work: existing clones drop arbitrary effect recipes, and Playback.clone may auto-start. Preserve current clone behavior here and document that named slot/reference inheritance is not yet supported by clone APIs. A future clone contract must create independent attachment identities, copy explicit names and recipes deliberately, define filter overrides, preserve explicit shared recipes, and never copy native bindings or timelines. Do not pass off copying an array as completed clone support.

#45 owns the managed timeline and migration of direct-set/fade/ramp helpers. #200 consumes compatible named addresses and #45 transitions; its filterIndex, direct ramp and setTimeout proposal is superseded by those integration contracts. #198 remains pitch/gain variation and does not block on effect references. #207 retains separate envelope and user-volume gains. Consumer feature implementations are not acceptance requirements for closing #238.

Out of scope: snapshot application, general automation, reactive graphs, group inheritance, DSP-state serialization, algorithm replacement, general slot cloning and virtual controls that create/remove processing nodes.

## Acceptance

1. Two explicitly named phaser slots using one recipe produce four independent nodes across two overlapping Playbacks. A source reference resolves only to the correct slot/voice. A foreign source with matching names is rejected. Bus gain uses the same definition/binding contract.
2. Source changes affect future voices only. Existing voices retain captured attachments. Live removal and same-name replacement cannot revive stale bindings. Reorder/bypass retain identity; pending reordering/removal preserves declaration semantics.
3. Serialized addresses round-trip through JSON and deliberately resolve compatible reconstructed named targets. Wrong type/schema, unknown targets and anonymous/generated names produce structured failures without index/name guessing. Shared-node aliases identify the same underlying AudioParam while preserving each attachment's validity.
4. Definition fixtures cover defaults versus presets, choice/integer domains, units, context bounds at multiple sample rates, explicit and omitted automation rates, alias rejection, and preserved numeric construction behavior. Test expected contract values as well as generated descriptor consistency so a shared wrong value cannot validate itself.
5. Native biquad, worklet and multi-node graph parameters bind correctly. Default wet-only IR, HRTF stereo pan and build-only third-party recipes report unsupported. Panner replacement and cleanup invalidate old bindings. A third-party opt-in definition/binding fixture works.
6. Out-of-order resolution, synchronous throw, asynchronous rejection, cancellation, removal and cleanup during build all settle correctly. No late binding or graph resurrection; disposal runs once. Async failure remains inspectable and emits the recoverable error on a surviving voice. Failed strict preparation never starts a source and leaves no retained voice.
7. A buffered preparation example establishes an initial value before source start. Test missed deadlines and delayed/rejected builds with native/offline rendering and browser coverage where timing matters; API spies alone do not establish audible correctness. Optional Node-backend tests follow the repository's nodeBackendAvailable guard and are actually run in a supported environment before claiming native acceptance.
8. Existing handle-based APIs retain their documented behavior. Type fixtures exercise known parameter keys/choice values and third-party opt-in. check:package-types and check:bundles cover metadata/reference imports, including no eager worklet payloads, FFT or MediaBunny and the existing non-Cacophony size budget. Run the normal repository lint, typecheck, test and build gates for implementation.
