Platform audio interruptions are now observable and recover automatically while the page is visible. Explicit user pauses remain paused through foreground signals, gestures, and previously pending recovery attempts. Context state events share one deduplicating publisher, and `dispose()` removes the instance's platform, gesture, and public event listeners without taking ownership of the caller's context or sounds.

Output selection delegates to the actual browser or Node context through `setOutputDevice()`; `outputDevice` reads its current sink. `sinkChange` reports the active sink, while `devicechange` reports available audio outputs. Device enumeration discards stale asynchronous inventories. Switching preserves the context and graph, permissions remain with the app, and platform errors propagate unchanged. Unsupported contexts use the interim Error permitted by #203 until #169 lands.

Adds red-first regressions, real Node sink coverage, native browser transition/device/sink tests, published-type consumer coverage, and a documented mobile hardware/interruption test matrix. The existing autoplay watcher gets a user-pause guard so its gesture fallback follows the same pause intent as session recovery.

Validation:
- `npx vitest run --maxWorkers 4` (104 files, 1399 tests passed), followed by the final focused suite covering two additional regressions (30 tests passed).
- `npm run build` (types, worklets, ESM/CJS, package consumer, bundle checks, documentation).
- `npm run check:package-types` with the new public API consumer.
- `npx biome ci .` and `npm run changelog:check`.
- `npx playwright test` (64 passed, 20 capability skips on Windows; Chromium/Firefox session tests pass, Chromium silent sink passes). Linux WebKit is exercised by CI; physical hot-plug and iOS interruptions remain documented manual checks.

Closes #209
Closes #203
