import { describe, it, expect } from "vitest";
import {
  groupEntriesByDate,
  renderMarkdown,
} from "../src/changelog/assembleMarkdown.js";
import { ChangelogEntry } from "../src/changelog/model.js";

function createEntry(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    repo: "test/repo",
    prNumber: 1,
    mergedAt: "2025-11-20T12:00:00Z",
    section: "New",
    heading: "📍 Test Feature",
    bullets: ["Test bullet"],
    ...overrides,
  };
}

describe("groupEntriesByDate", () => {
  it("should group entries by date", () => {
    const entries = [
      createEntry({
        mergedAt: "2025-11-20T12:00:00Z",
        heading: "Entry 1",
      }),
      createEntry({
        mergedAt: "2025-11-20T14:00:00Z",
        heading: "Entry 2",
      }),
      createEntry({
        mergedAt: "2025-11-21T10:00:00Z",
        heading: "Entry 3",
      }),
    ];

    const groups = groupEntriesByDate(entries, "Europe/London");
    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toHaveLength(1); // Nov 21 (newest first)
    expect(groups[1].entries).toHaveLength(2); // Nov 20
  });

  it("should sort dates descending", () => {
    const entries = [
      createEntry({ mergedAt: "2025-11-19T12:00:00Z" }),
      createEntry({ mergedAt: "2025-11-21T12:00:00Z" }),
      createEntry({ mergedAt: "2025-11-20T12:00:00Z" }),
    ];

    const groups = groupEntriesByDate(entries, "Europe/London");
    expect(groups[0].dateKey).toContain("21st");
    expect(groups[1].dateKey).toContain("20th");
    expect(groups[2].dateKey).toContain("19th");
  });
});

describe("renderMarkdown", () => {
  it("should render entries in correct order", () => {
    const groups = [
      {
        dateKey: "November 20th 2025",
        entries: [
          createEntry({
            section: "Fixes",
            heading: "🐞 Bug fixes",
            bullets: ["Fixed bug"],
          }),
          createEntry({
            section: "New",
            heading: "📍 New feature",
            bullets: ["Added feature"],
          }),
        ],
      },
    ];

    const markdown = renderMarkdown(groups);
    expect(markdown).toContain("## November 20th 2025");
    expect(markdown.indexOf("📍 New feature")).toBeLessThan(
      markdown.indexOf("🐞 Bug fixes")
    );
  });

  it("should exclude hidden entries when includeInternal is false", () => {
    const groups = [
      {
        dateKey: "November 20th 2025",
        entries: [
          createEntry({
            section: "New",
            heading: "📍 New feature",
            bullets: ["Added feature"],
            hidden: false,
          }),
          createEntry({
            section: "Internal",
            heading: "⚙️ Internal improvements",
            bullets: ["Internal change"],
            hidden: true,
          }),
        ],
      },
    ];

    const markdown = renderMarkdown(groups, { includeInternal: false });
    expect(markdown).toContain("📍 New feature");
    expect(markdown).not.toContain("⚙️ Internal improvements");
  });

  it("should include hidden entries when includeInternal is true", () => {
    const groups = [
      {
        dateKey: "November 20th 2025",
        entries: [
          createEntry({
            section: "Internal",
            heading: "⚙️ Internal improvements",
            bullets: ["Internal change"],
            hidden: true,
          }),
        ],
      },
    ];

    const markdown = renderMarkdown(groups, { includeInternal: true });
    expect(markdown).toContain("⚙️ Internal improvements");
  });

  it("should format markdown correctly", () => {
    const groups = [
      {
        dateKey: "November 20th 2025",
        entries: [
          createEntry({
            heading: "📍 Test Feature",
            bullets: ["Test bullet"],
          }),
        ],
      },
    ];

    const markdown = renderMarkdown(groups);
    expect(markdown).toContain("## November 20th 2025");
    expect(markdown).toContain("### 📍 Test Feature");
    expect(markdown).toContain("- Test bullet");
  });
});

