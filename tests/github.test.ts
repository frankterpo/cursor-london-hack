import { describe, it, expect, vi, beforeEach } from "vitest";
import { listMergedPrsSince, listPrFiles } from "../src/github/client.js";
import { RepoConfig } from "../src/config.js";

// Mock undici fetch
vi.mock("undici", () => ({
  fetch: vi.fn(),
}));

describe("GitHub Client", () => {
  const mockRepo: RepoConfig = { owner: "test", name: "repo" };
  const mockToken = "test-token";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMergedPrsSince", () => {
    it("should filter PRs by merged_at and defaultBranch", async () => {
      const { fetch } = await import("undici");
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 1,
            title: "PR 1",
            body: "",
            labels: [],
            merged_at: "2025-11-20T12:00:00Z",
            user: { login: "user1" },
            html_url: "https://github.com/test/repo/pull/1",
            base: { ref: "main" },
          },
          {
            number: 2,
            title: "PR 2",
            body: "",
            labels: [],
            merged_at: null, // Not merged
            user: { login: "user2" },
            html_url: "https://github.com/test/repo/pull/2",
            base: { ref: "main" },
          },
          {
            number: 3,
            title: "PR 3",
            body: "",
            labels: [],
            merged_at: "2025-11-19T12:00:00Z", // Too old
            user: { login: "user3" },
            html_url: "https://github.com/test/repo/pull/3",
            base: { ref: "main" },
          },
        ],
      } as any);

      const prs = await listMergedPrsSince(
        mockRepo,
        "2025-11-20T00:00:00Z",
        "main",
        mockToken
      );

      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(1);
    });

    it("should exclude PRs on other branches", async () => {
      const { fetch } = await import("undici");
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 1,
            title: "PR 1",
            body: "",
            labels: [],
            merged_at: "2025-11-20T12:00:00Z",
            user: { login: "user1" },
            html_url: "https://github.com/test/repo/pull/1",
            base: { ref: "develop" }, // Wrong branch
          },
        ],
      } as any);

      const prs = await listMergedPrsSince(
        mockRepo,
        "2025-11-20T00:00:00Z",
        "main",
        mockToken
      );

      expect(prs).toHaveLength(0);
    });
  });

  describe("listPrFiles", () => {
    it("should return file changes", async () => {
      const { fetch } = await import("undici");
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            filename: "src/file1.ts",
            status: "added",
            additions: 10,
            deletions: 0,
          },
          {
            filename: "src/file2.ts",
            status: "modified",
            additions: 5,
            deletions: 3,
          },
        ],
      } as any);

      const files = await listPrFiles(mockRepo, 1, mockToken);

      expect(files).toHaveLength(2);
      expect(files[0].filename).toBe("src/file1.ts");
      expect(files[0].status).toBe("added");
    });
  });
});

