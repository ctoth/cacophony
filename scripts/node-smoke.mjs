// Built-dist smoke test for the cacophony/node adapter.
//
// Imports the BUILT adapter (../dist/node.mjs), does a REAL offline render of
// an oscillator synth through cacophony.createDistortion on the master bus, and
// prints clean-vs-distorted peak/mean. A change between the two runs proves the
// AudioWorklet data: URLs load and compute through the shipped adapter headless.
//
// Run: node scripts/node-smoke.mjs
import { createOfflineNodeCacophony } from "../dist/node.mjs";

function peakMean(buf) {
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    sum += a;
  }
  return { peak: +peak.toFixed(4), mean: +(sum / d.length).toFixed(5) };
}

async function renderSynth(withDistortion) {
  const { cacophony, context } = createOfflineNodeCacophony({
    numberOfChannels: 2,
    length: 48000 * 0.3,
    sampleRate: 48000,
    quiet: true,
  });
  if (withDistortion) {
    await cacophony.master.addFilter(
      cacophony.createDistortion({ drive: 50, shape: 1, mix: 1, output: 0.7 }),
    );
  }
  const synth = await cacophony.createOscillator({ frequency: 220, type: "sawtooth" });
  synth.volume = 0.4;
  synth.play();
  const out = await context.startRendering();
  return peakMean(out);
}

console.log("cacophony/node adapter (built dist) — offline render:");
const clean = await renderSynth(false);
console.log("  synth -> master (clean)            :", JSON.stringify(clean));
const dirty = await renderSynth(true);
console.log("  synth -> master + createDistortion :", JSON.stringify(dirty));
const changed = dirty.peak !== clean.peak || dirty.mean !== clean.mean;
console.log(
  changed
    ? "  => distortion altered the signal through the shipped adapter. PASS."
    : "  => WARN: no change — worklet effect did not run.",
);
process.exit(changed ? 0 : 1);
