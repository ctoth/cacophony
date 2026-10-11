Moving-source and listener updates can opt into exponential smoothing through a time constant in seconds. The default remains immediate; new voices start at their requested pose, interrupted updates preserve the current envelope, and spatial getters return requested targets.

Source settings reach current/future voices, per-voice overrides and clones retain their configuration, and partial spatial updates preserve independently positioned voices. Legacy listener methods remain immediate. Doppler is outside this change; occlusion shipped in #221.

Closes #201

Verification:
- `npm run lint`
- `npm run build` (includes packed-package type consumer)
- `npm run ci:test`
- `npx playwright test browser-tests/spatial-smoothing.spec.ts browser-tests/listener.spec.ts`
- `npx playwright test browser-tests/cache.spec.ts --project webkit --grep 'cors-browser|cors-age|cors-vary'`

Native rendering covers interrupted stereo transitions, tau changes, and source/listener HRTF distance-motion controls. Firefox skips offline retargeting because it lacks suspend/resume; Windows WebKit skips native audio checks because it lacks OfflineAudioContext. Linux browser CI covers WebKit.

The complete Windows browser run (`npx playwright test`) hits three cache-suite teardown failures with `Server is not running`. The same three failures reproduce on unchanged master `cd694bbf`; their focused rerun passes. The smoothing tests pass on supported local engines.
