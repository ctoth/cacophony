Adds `Playback.setOcclusion(amount, duration?)` and the read-only requested `occlusion` amount. Each voice owns a lazy low-pass and attenuation stage after user effects and before the panner. Updates reuse the nodes and re-anchor interrupted ramps; reset restores the clear response without touching volume or fades. Clones copy the amount into independent nodes.

Documents clamping, invalid inputs, the rendering curve, and caller ownership of geometry, materials, and policy. Includes graph/lifecycle regressions and native/browser waveform checks.

Closes #221

Validation:
- `npx biome ci .`
- `npm run changelog:check`
- `npm run build`
- `npx vitest run --maxWorkers 4`
- `npx playwright test browser-tests/occlusion.spec.ts --project chromium --project firefox`

The full local browser run passed Chromium and Firefox. Windows WebKit skips audio tests because OfflineAudioContext is unavailable; three cache-fixture teardown failures passed an isolated rerun. Linux CI covers WebKit audio.
