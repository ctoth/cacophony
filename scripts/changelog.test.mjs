import { describe, expect, it } from "vitest";
import { compareVersions, notes, parse, release, render, validate } from "./changelog.mjs";

const PREAMBLE = "# Changelog\n\nAll notable changes.";
const URL = "https://github.com/ctoth/cacophony";

function changelog(body) {
  return render(parse(`${PREAMBLE}\n\n${body}`));
}

const CURRENT = changelog(`## [Unreleased]

### Added
- \`Sound.fade()\`.

## [0.2.0] - 2026-02-01

### ⚠ Breaking
- Renamed \`foo\` to \`bar\`.

## [0.1.0] - 2026-01-01

### Added
- First release.`);

describe("changelog", () => {
  it("renders compare links newest first, ending at the first release tag", () => {
    expect(CURRENT.trimEnd().split("\n").slice(-3)).toEqual([
      `[Unreleased]: ${URL}/compare/v0.2.0...HEAD`,
      `[0.2.0]: ${URL}/compare/v0.1.0...v0.2.0`,
      `[0.1.0]: ${URL}/releases/tag/v0.1.0`,
    ]);
  });

  it("round-trips a well-formed file unchanged and reports no problems", () => {
    expect(render(parse(CURRENT))).toBe(CURRENT);
    expect(validate(CURRENT)).toEqual([]);
    expect(validate(CURRENT.replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("stamps Unreleased as a dated version and leaves a fresh Unreleased", () => {
    const released = release(CURRENT, "0.3.0", "2026-03-01");
    expect(validate(released)).toEqual([]);
    expect(released).toContain("## [Unreleased]\n\n## [0.3.0] - 2026-03-01\n\n### Added\n- `Sound.fade()`.");
    expect(released).toContain(`[Unreleased]: ${URL}/compare/v0.3.0...HEAD`);
    expect(released).toContain(`[0.3.0]: ${URL}/compare/v0.2.0...v0.3.0`);
  });

  it("refuses to release with nothing written under Unreleased", () => {
    const empty = release(CURRENT, "0.3.0", "2026-03-01");
    expect(() => release(empty, "0.4.0", "2026-04-01")).toThrow(/empty/);
  });

  it("refuses to release a version twice", () => {
    expect(() => release(CURRENT, "0.2.0", "2026-03-01")).toThrow(/already has/);
  });

  it("extracts one version's notes with a diff link for the release body", () => {
    expect(notes(CURRENT, "0.2.0")).toBe(
      `### ⚠ Breaking\n- Renamed \`foo\` to \`bar\`.\n\n**Full diff:** ${URL}/compare/v0.1.0...v0.2.0\n`,
    );
    expect(() => notes(CURRENT, "9.9.9")).toThrow(/no section/);
  });

  it("flags out-of-order versions, bad headings, unknown subsections, and stale links", () => {
    const broken = CURRENT.replace("## [0.1.0] - 2026-01-01", "## [0.3.0] - 2026-01-01")
      .replace("### Added\n- First", "### New stuff\n- First")
      .replace("## [0.2.0] - 2026-02-01", "## 0.2.0");
    const problems = validate(broken).join("\n");
    expect(problems).toMatch(/Malformed version heading: "## 0.2.0"/);
    expect(problems).toMatch(/Unknown subsection "### New stuff"/);
    expect(problems).toMatch(/Link references/);
    expect(validate(CURRENT.replace("## [0.1.0]", "## [0.9.0]")).join("\n")).toMatch(/newest first/);
    expect(validate(CURRENT.replace("## [Unreleased]", "## [0.3.0] - 2026-03-01"))[0]).toMatch(/Unreleased/);
  });

  it("orders versions numerically, with prereleases before their release", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});
