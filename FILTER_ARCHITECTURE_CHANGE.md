# Filter Architecture Breaking Change

## Summary

Fixed fundamental design flaw where filter instances were shared between Sound/Synth and their Playbacks, causing incorrect Web Audio graph topology. Filters are now cloned when creating playbacks, giving each playback independent filter chains.

## What Changed

### Before (Broken)
```javascript
const sound = cacophony.createSound(buffer);
const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });

sound.addFilter(filter);

const playback1 = sound.play()[0];
const playback2 = sound.play()[0];

// Both playbacks shared THE SAME filter instance
// This caused audio routing through a single node (incorrect topology)
playback1.filters[0] === filter  // true
playback2.filters[0] === filter  // true
playback1.filters[0] === playback2.filters[0]  // true

// Mutating the filter affected ALL playbacks
filter.frequency.value = 500;  // Changed playback1, playback2, and sound

// Adding filter to sound propagated to existing playbacks
const filter2 = cacophony.createBiquadFilter({ type: 'highpass' });
sound.addFilter(filter2);  // playback1 and playback2 got filter2 added
```

### After (Fixed)
```javascript
const sound = cacophony.createSound(buffer);
const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });

sound.addFilter(filter);

const playback1 = sound.play()[0];
const playback2 = sound.play()[0];

// Each playback gets CLONED filters (independent instances with same settings)
playback1.filters[0] !== filter  // true - different instance
playback2.filters[0] !== filter  // true - different instance
playback1.filters[0] !== playback2.filters[0]  // true - independent

// Each has correct settings
playback1.filters[0].type === 'lowpass'  // true
playback1.filters[0].frequency.value === 1000  // true

// Mutating the original filter does NOT affect playbacks
filter.frequency.value = 500;
// playback1 and playback2 still have frequency: 1000

// Adding filter to sound does NOT affect existing playbacks
const filter2 = cacophony.createBiquadFilter({ type: 'highpass' });
sound.addFilter(filter2);
playback1.filters.length === 1  // true - unchanged
playback2.filters.length === 1  // true - unchanged

// But NEW playbacks get both filters (as clones)
const playback3 = sound.play()[0];
playback3.filters.length === 2  // true
```

## Why This Matters

### Web Audio Graph Topology
When multiple playbacks shared the same BiquadFilterNode instance:
```
Playback1 → FilterNode F → (audio gets mixed here)
Playback2 → FilterNode F →
```

Both playback streams were routed through the SAME node, causing them to sum at that point. This is incorrect - each playback should have independent processing.

Correct topology (with cloned filters):
```
Playback1 → FilterNode F1 → destination
Playback2 → FilterNode F2 → destination
```

Each playback has its own filter chain and processes independently.

## Additional Changes

### Duplicate Prevention
```javascript
const filter = cacophony.createBiquadFilter();
sound.addFilter(filter);
sound.addFilter(filter);  // ERROR: Cannot add the same filter instance twice
```

Prevents adding the same BiquadFilterNode instance multiple times, which would create invalid graph connections.

### Stricter Error Handling
```javascript
const filter1 = cacophony.createBiquadFilter();
const filter2 = cacophony.createBiquadFilter();

sound.addFilter(filter1);
sound.removeFilter(filter2);  // ERROR: Cannot remove filter that was never added to this container
```

Removing a filter that wasn't added now throws an error instead of silently failing.

### Same Settings, Different Instances (Still Valid)
```javascript
const filter1 = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
const filter2 = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });

sound.addFilter(filter1);
sound.addFilter(filter2);  // OK - different instances with identical settings

sound.removeFilter(filter1);  // Removes only filter1, filter2 remains
```

## Migration Guide

### If you were relying on shared filter instances:
**Old pattern:**
```javascript
const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
sound.addFilter(filter);

const playback = sound.play()[0];

// Later, trying to modify playback's filter
filter.frequency.value = 500;  // Used to affect playback
```

**New pattern:**
```javascript
const filter = cacophony.createBiquadFilter({ type: 'lowpass', frequency: 1000 });
sound.addFilter(filter);

const playback = sound.play()[0];

// Modify the playback's filter directly
playback.filters[0].frequency.value = 500;  // Affects only this playback
```

### If you were adding filters after creating playbacks:
**Old pattern:**
```javascript
const playback1 = sound.play()[0];
const playback2 = sound.play()[0];

const filter = cacophony.createBiquadFilter();
sound.addFilter(filter);  // Used to propagate to playback1 and playback2
```

**New pattern:**
```javascript
const filter = cacophony.createBiquadFilter();
sound.addFilter(filter);  // Add BEFORE creating playbacks

const playback1 = sound.play()[0];  // Gets cloned filter
const playback2 = sound.play()[0];  // Gets cloned filter

// OR add filters directly to specific playbacks
const playback3 = sound.play()[0];
const playbackFilter = cacophony.createBiquadFilter();
playback3.addFilter(playbackFilter);
```

## Rationale

This change fixes a fundamental architectural flaw. The previous behavior:
1. Created incorrect Web Audio graph topology (multiple sources → single filter node)
2. Caused surprising action-at-a-distance (mutating filter affected all playbacks)
3. Made lifecycle management error-prone (what if playback outlives sound?)
4. Was inconsistent (Playback.clone() already cloned filters correctly)

The new behavior:
1. Creates correct graph topology (each playback has independent filter chain)
2. Follows principle of least surprise (playbacks are independent after creation)
3. Has clean ownership (each playback owns its filters)
4. Is consistent across all clone/preplay operations

## Future Work

For users who need "live updates across all playbacks", we can add explicit opt-in mechanisms:
- Group/bus filters (shared processing on summed output)
- Parameter linking (synchronized updates across independent filter instances)

See https://github.com/your-repo/cacophony/issues/XXX for discussion.

## Affected APIs

- `Sound.addFilter()` - no longer propagates to existing playbacks
- `Sound.removeFilter()` - no longer removes from existing playbacks
- `Sound.preplay()` - now clones filters instead of sharing
- `Synth.addFilter()` - no longer propagates to existing playbacks
- `Synth.removeFilter()` - no longer removes from existing playbacks
- `Synth.preplay()` - now clones filters instead of sharing
- `FilterManager.addFilter()` - now prevents duplicate instances
- `FilterManager.removeFilter()` - now throws if filter wasn't added
- `Group.addFilter()` - still delegates to sounds (but those sounds no longer propagate to playbacks)
- `Group.removeFilter()` - still delegates to sounds (but those sounds no longer propagate to playbacks)
