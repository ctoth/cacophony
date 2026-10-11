Adds `removeSend(busOrName)` to sources and Groups. Removal disconnects both send edges on every voice, removes future routing and bus registration, and preserves primary routing. Destroyed bus references remain valid for removal; names must resolve to registered buses.

`routeTo(busOrName, gain, { duration, type })` ramps existing sends in place using the audio clock. Interrupted ramps re-anchor at their interpolated value, and exponential fades become exactly silent at the endpoint. New sends and future voices start at the requested gain; instant changes remain the default. Bus drain reuses the complete teardown.

Closes #241

Verification:

- Regression-first unit and native rendering tests failed before implementation.
- `npm run build`
- `npm run typecheck`
- `npx biome ci .`
- `npx vitest run --typecheck`
- `npx playwright test --workers=4`
- `node scripts/changelog.mjs check`

Native Node rendering tests ran locally. Chromium and Firefox rendering passed; Windows WebKit skipped native audio checks because OfflineAudioContext is unavailable. The hosted Linux browser matrix covers WebKit.
