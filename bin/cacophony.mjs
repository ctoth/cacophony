#!/usr/bin/env node
// Thin entry for the cacophony CLI. Imports the BUILT dispatch from
// dist/cli/index.mjs (so `npm i -g cacophony` works) and runs it with argv.
import { main } from "../dist/cli/index.mjs";

await main(process.argv.slice(2));
