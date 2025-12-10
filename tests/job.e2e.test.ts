import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "path";
import { tmpdir } from "os";
import { runChangelogJob } from "../src/jobs/runChangelogJob.js";
import { fetchNewMergedPrs } from "../src/github/fetchMergedPrs.js";
import { runPrSummarizationAgent } from "../src/cursor/agent.js";
import { MergedPrWithFiles } from "../src/github/types.js";

// Mock dependencies
vi.mock("../src/github/fetchMergedPrs.js");
vi.mock("../src/cursor/agent.js");
vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    githubToken: "test-token",
    githubRepos: [{ owner: "test", name: "repo" }],
    githubDefaultBranch: "main",
    timezone: "Europe/London",
    stateFilePath: ".changelog-state.json",
  }),
}));

describe("Changelog Job E2E", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "changelog-test-"));
    process.chdir(tempDir);
  });

  it("should create CHANGELOG.md with entries", async () => {
    const mockPrs: MergedPrWithFiles[] = [
      {
        repo: "test/repo",
        number: 123,
        title: "Add new feature",
        body: "Description",
        labels: ["feature"],
        mergedAt: "2025-11-20T12:00:00Z",
        author: "testuser",
        htmlUrl: "https://github.com/test/repo/pull/123",
        files: [
          {
            filename: "src/feature.ts",
            status: "added",
            additions: 50,
            deletions: 0,
          },
        ],
      },
    ];

    vi.mocked(fetchNewMergedPrs).mockResolvedValueOnce(mockPrs);
    vi.mocked(runPrSummarizationAgent).mockResolvedValueOnce(
      "Added new feature so you can do something useful. <!-- PR#123 -->"
    );

    await runChangelogJob();

    const changelog = await fs.readFile("CHANGELOG.md", "utf8");
    expect(changelog).toContain("## November 20th 2025");
    expect(changelog).toContain("Added new feature");

    const state = JSON.parse(
      await fs.readFile(".changelog-state.json", "utf8")
    );
    expect(state.lastProcessedMergedAtByRepo["test/repo"]).toBe(
      "2025-11-20T12:00:00Z"
    );
  });

  it("should handle no new PRs gracefully", async () => {
    vi.mocked(fetchNewMergedPrs).mockResolvedValueOnce([]);

    await runChangelogJob();

    // Should not throw and should not create CHANGELOG.md
    try {
      await fs.access("CHANGELOG.md");
      throw new Error("CHANGELOG.md should not exist");
    } catch (error: any) {
      expect(error.code).toBe("ENOENT");
    }
  });

  it("should generate intercom-release-notes-latest.md", async () => {
    const mockPrs: MergedPrWithFiles[] = [
      {
        repo: "test/repo",
        number: 123,
        title: "Add new feature",
        body: "Description",
        labels: ["feature"],
        mergedAt: "2025-11-20T12:00:00Z",
        author: "testuser",
        htmlUrl: "https://github.com/test/repo/pull/123",
        files: [],
      },
    ];

    vi.mocked(fetchNewMergedPrs).mockResolvedValueOnce(mockPrs);
    vi.mocked(runPrSummarizationAgent).mockResolvedValueOnce(
      "Added new feature. <!-- PR#123 -->"
    );

    await runChangelogJob();

    const intercomNotes = await fs.readFile(
      "intercom-release-notes-latest.md",
      "utf8"
    );
    expect(intercomNotes).toContain("November 20th 2025");
    expect(intercomNotes).toContain("Added new feature");
  });
});

