import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// CHANGELOG.md follows Keep a Changelog 1.1.0 (https://keepachangelog.com/en/1.1.0/).
// Entries are written by hand under "## [Unreleased]" as part of each change; this
// script only does the mechanical parts: stamping a release, extracting one release's
// notes for GitHub, validating structure, and regenerating the compare links.
//
//   node scripts/changelog.mjs check [--fix] [--ready-to-release]
//                                                validate; --fix rewrites the link references
//   node scripts/changelog.mjs release [version]  move Unreleased under a new version heading
//   node scripts/changelog.mjs notes <version>    print one version's notes (for release bodies)
//
// `npm version <bump>` runs `release` automatically via the "version" lifecycle script.

export const REPO_URL = "https://github.com/ctoth/cacophony";
export const SUBSECTIONS = ["⚠ Breaking", "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const CHANGELOG_PATH = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\] - (\d{4}-\d{2}-\d{2})$/;
const LINK_REFERENCE = /^\[[^\]]+\]: \S+$/;

/** Split a changelog into its preamble, its sections (one per "## " heading), and nothing else. */
export function parse(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  const preamble = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      sections.push({ heading: line, body: [] });
    } else if (sections.length === 0) {
      preamble.push(line);
    } else {
      sections.at(-1).body.push(line);
    }
  }
  // Link references live at the very end of the file; they are derived, so drop them here.
  const last = sections.at(-1)?.body ?? preamble;
  while (last.length > 0 && (last.at(-1).trim() === "" || LINK_REFERENCE.test(last.at(-1)))) last.pop();
  for (const section of sections) {
    const match = VERSION_HEADING.exec(section.heading);
    section.version = match?.[1] ?? null;
    section.date = match?.[2] ?? null;
    section.body = trimBlankLines(section.body);
  }
  return { preamble: trimBlankLines(preamble), sections };
}

export function render({ preamble, sections }) {
  const blocks = [preamble.join("\n")];
  for (const section of sections) {
    blocks.push(section.body.length > 0 ? `${section.heading}\n\n${section.body.join("\n")}` : section.heading);
  }
  blocks.push(linkReferences(sections).join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

export function linkReferences(sections) {
  const versions = sections.filter((section) => section.version).map((section) => section.version);
  const refs = [];
  if (sections.some((section) => section.heading === "## [Unreleased]")) {
    refs.push(`[Unreleased]: ${REPO_URL}/compare/${versions.length > 0 ? `v${versions[0]}` : "HEAD"}...HEAD`);
  }
  versions.forEach((version, index) => {
    const previous = versions[index + 1];
    refs.push(
      previous
        ? `[${version}]: ${REPO_URL}/compare/v${previous}...v${version}`
        : `[${version}]: ${REPO_URL}/releases/tag/v${version}`,
    );
  });
  return refs;
}

/** Returns a list of human-readable problems; empty means the changelog is well formed. */
export function validate(text) {
  const problems = [];
  const changelog = parse(text);
  const { sections } = changelog;
  if (sections[0]?.heading !== "## [Unreleased]") problems.push('The first section must be "## [Unreleased]".');
  let previous = null;
  for (const section of sections.slice(1)) {
    if (!section.version) {
      problems.push(`Malformed version heading: "${section.heading}" (expected "## [X.Y.Z] - YYYY-MM-DD").`);
      continue;
    }
    if (previous && compareVersions(section.version, previous.version) >= 0) {
      problems.push(`${section.version} is listed below ${previous.version}; versions must be newest first.`);
    }
    if (previous && section.date > previous.date) {
      problems.push(`${section.version} (${section.date}) is dated after ${previous.version} (${previous.date}).`);
    }
    previous = section;
  }
  for (const section of sections) {
    for (const line of section.body) {
      const subsection = /^### (.*)$/.exec(line)?.[1];
      if (subsection !== undefined && !SUBSECTIONS.includes(subsection)) {
        problems.push(`Unknown subsection "### ${subsection}" under "${section.heading}".`);
      }
      if (/^#{1,2} |^#{4,} /.test(line)) problems.push(`Unexpected heading "${line}" under "${section.heading}".`);
    }
  }
  if (render(changelog) !== text.replace(/\r\n/g, "\n")) {
    problems.push("Link references or spacing are out of date; run `node scripts/changelog.mjs check --fix`.");
  }
  return problems;
}

export function release(text, version, date) {
  const changelog = parse(text);
  const [unreleased] = changelog.sections;
  if (unreleased?.heading !== "## [Unreleased]") throw new Error('No "## [Unreleased]" section to release.');
  if (!unreleased.body.some((line) => line.trim() !== "")) {
    throw new Error(
      `"## [Unreleased]" is empty. Describe what ${version} changes for users before releasing ` +
        '(or write "- Internal changes only." under "### Changed").',
    );
  }
  if (changelog.sections.some((section) => section.version === version)) {
    throw new Error(`CHANGELOG.md already has a ${version} section.`);
  }
  changelog.sections.splice(0, 1, { heading: "## [Unreleased]", body: [] }, {
    heading: `## [${version}] - ${date}`,
    body: unreleased.body,
    version,
    date,
  });
  return render(changelog);
}

export function notes(text, version) {
  const section = parse(text).sections.find((candidate) => candidate.version === version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  if (section.body.length === 0) throw new Error(`The ${version} section of CHANGELOG.md is empty.`);
  const [previous] = linkReferences(parse(text).sections)
    .filter((ref) => ref.startsWith(`[${version}]: `))
    .map((ref) => ref.slice(ref.indexOf(" ") + 1));
  return `${section.body.join("\n")}\n\n**Full diff:** ${previous}\n`;
}

export function compareVersions(a, b) {
  const [coreA, preA] = a.split("-");
  const [coreB, preB] = b.split("-");
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (partsA[index] !== partsB[index]) return partsA[index] - partsB[index];
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main([command, ...args]) {
  const text = readFileSync(CHANGELOG_PATH, "utf8");
  switch (command) {
    case "check": {
      if (args.includes("--fix")) writeFileSync(CHANGELOG_PATH, render(parse(text)));
      const problems = validate(readFileSync(CHANGELOG_PATH, "utf8"));
      // `npm version` runs this as "preversion" so an empty Unreleased fails before package.json is bumped.
      if (args.includes("--ready-to-release") && !parse(text).sections[0]?.body.some((line) => line.trim() !== "")) {
        problems.push('"## [Unreleased]" is empty; describe the release before running `npm version`.');
      }
      for (const problem of problems) console.error(`CHANGELOG.md: ${problem}`);
      return problems.length === 0 ? 0 : 1;
    }
    case "release": {
      const version = (args[0] ?? JSON.parse(readFileSync(PACKAGE_PATH, "utf8")).version).replace(/^v/, "");
      writeFileSync(CHANGELOG_PATH, release(text, version, today()));
      console.log(`CHANGELOG.md: released Unreleased as ${version}.`);
      return 0;
    }
    case "notes": {
      if (!args[0]) throw new Error("Usage: changelog.mjs notes <version>");
      process.stdout.write(notes(text, args[0].replace(/^v/, "")));
      return 0;
    }
    default:
      console.error("Usage: changelog.mjs check [--fix] | release [version] | notes <version>");
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`CHANGELOG.md: ${error.message}`);
    process.exitCode = 1;
  }
}
