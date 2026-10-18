Moving-source and listener updates can opt into exponential smoothing through a time constant in seconds. The default remains immediate; new voices start at their requested pose, interrupted updates preserve the current envelope, and spatial getters return requested targets.

Source settings reach current/future voices, per-voice overrides and clones retain their configuration, and partial spatial updates preserve independently positioned voices. Legacy listener methods remain immediate. Doppler is outside this change; occlusion shipped in #221.

Closes #201

Verification:
- `npm run lint`
- `npm run build` (includes packed-package type consumer)
- `npm run ci:test`
- `npx playwright test`

Native rendering covers interrupted stereo transitions, tau changes, and source/listener HRTF distance-motion controls. Firefox skips offline retargeting because it lacks suspend/resume; Windows WebKit skips native audio checks because it lacks OfflineAudioContext. Linux browser CI covers WebKit.
