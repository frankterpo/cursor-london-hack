import { describe, it, expect } from "vitest";
import { classifySection } from "../src/changelog/classify.js";
import { MergedPrWithFiles } from "../src/github/types.js";

function createMockPr(overrides: Partial<MergedPrWithFiles>): MergedPrWithFiles {
  return {
    repo: "test/repo",
    number: 1,
    title: "Test PR",
    body: "",
    labels: [],
    mergedAt: "2025-01-01T00:00:00Z",
    author: "test",
    htmlUrl: "https://github.com/test/repo/pull/1",
    files: [],
    ...overrides,
  };
}

describe("classifySection", () => {
  it("should classify feature labels as New", () => {
    const pr = createMockPr({ labels: ["feature"] });
    expect(classifySection(pr)).toBe("New");
  });

  it("should classify bug labels as Fixes", () => {
    const pr = createMockPr({ labels: ["bug"] });
    expect(classifySection(pr)).toBe("Fixes");
  });

  it("should classify chore labels as Internal", () => {
    const pr = createMockPr({ labels: ["chore"] });
    expect(classifySection(pr)).toBe("Internal");
  });

  it("should prioritize Fixes over New", () => {
    const pr = createMockPr({ labels: ["bug", "feature"] });
    expect(classifySection(pr)).toBe("Fixes");
  });

  it("should infer Fixes from title containing 'fix'", () => {
    const pr = createMockPr({
      labels: [],
      title: "Fix critical bug in search",
    });
    expect(classifySection(pr)).toBe("Fixes");
  });

  it("should infer New from title containing 'add'", () => {
    const pr = createMockPr({
      labels: [],
      title: "Add new API endpoint",
    });
    expect(classifySection(pr)).toBe("New");
  });

  it("should classify improvement labels as Improvements", () => {
    const pr = createMockPr({
      labels: ["improvement"],
      files: [{ filename: "src/component.tsx", status: "modified", additions: 10, deletions: 5 }],
    });
    expect(classifySection(pr)).toBe("Improvements");
  });

  it("should default to Internal when nothing matches", () => {
    const pr = createMockPr({
      labels: [],
      title: "Random change",
    });
    expect(classifySection(pr)).toBe("Internal");
  });
});

