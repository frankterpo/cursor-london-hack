import { fetch } from "undici";
import { RepoConfig } from "../config.js";
import { MergedPr, PrFileChange, PrCommit } from "./types.js";

interface GitHubPrResponse {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  merged_at: string | null;
  user: { login: string };
  html_url: string;
  base: { ref: string };
}

interface GitHubFileResponse {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string; // The actual diff content
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name: string };
  };
}

async function githubRequest(
  url: string,
  token: string
): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${token}`,
      "User-Agent": "specter-changelog-agent",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}\n${text}`
    );
  }

  return response.json();
}

async function githubRequestPaginated(
  url: string,
  token: string
): Promise<any[]> {
  const allResults: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageUrl = `${url}${url.includes("?") ? "&" : "?"}page=${page}&per_page=${perPage}`;
    const results = await githubRequest(pageUrl, token);

    if (!Array.isArray(results)) {
      throw new Error("Expected array from GitHub API");
    }

    if (results.length === 0) {
      break;
    }

    allResults.push(...results);
    page++;

    // GitHub API limit
    if (results.length < perPage) {
      break;
    }
  }

  return allResults;
}

export async function listMergedPrsSince(
  repo: RepoConfig,
  sinceIso: string,
  defaultBranch: string,
  token: string
): Promise<MergedPr[]> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?state=closed&sort=updated&direction=desc`;

  const prs = await githubRequestPaginated(url, token);

  const merged: MergedPr[] = [];

  for (const pr of prs) {
    const prData = pr as GitHubPrResponse;

    // Only include merged PRs on the default branch
    if (
      prData.merged_at &&
      prData.base.ref === defaultBranch &&
      prData.merged_at > sinceIso
    ) {
      merged.push({
        repo: `${repo.owner}/${repo.name}`,
        number: prData.number,
        title: prData.title,
        body: prData.body || "",
        labels: prData.labels.map((l) => l.name.toLowerCase()),
        mergedAt: prData.merged_at,
        author: prData.user.login,
        htmlUrl: prData.html_url,
      });
    }
  }

  return merged;
}

export async function listPrFiles(
  repo: RepoConfig,
  prNumber: number,
  token: string
): Promise<PrFileChange[]> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${prNumber}/files`;

  const files = await githubRequestPaginated(url, token);

  return files.map((file: GitHubFileResponse) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    // Include the actual diff patch (truncate if too large)
    patch: file.patch ? truncatePatch(file.patch, 2000) : undefined,
  }));
}

export async function listPrCommits(
  repo: RepoConfig,
  prNumber: number,
  token: string
): Promise<PrCommit[]> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${prNumber}/commits`;

  const commits = await githubRequestPaginated(url, token);

  return commits.map((commit: GitHubCommitResponse) => ({
    sha: commit.sha.slice(0, 7),
    message: commit.commit.message.split("\n")[0], // First line only
    author: commit.commit.author.name,
  }));
}

// Truncate large patches to avoid token limits
function truncatePatch(patch: string, maxLength: number): string {
  if (patch.length <= maxLength) return patch;
  return patch.slice(0, maxLength) + "\n... [truncated]";
}

