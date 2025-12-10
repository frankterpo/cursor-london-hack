import { loadConfig } from "../config.js";
import { MergedPrWithFiles } from "./types.js";
import { listMergedPrsSince, listPrFiles, listPrCommits } from "./client.js";
import { loadState } from "../state/stateStore.js";

export async function fetchNewMergedPrs(): Promise<MergedPrWithFiles[]> {
  const config = loadConfig();
  const state = await loadState(config.stateFilePath, config);

  const results: MergedPrWithFiles[] = [];

  for (const repo of config.githubRepos) {
    const repoKey = `${repo.owner}/${repo.name}`;
    const since =
      state.lastProcessedMergedAtByRepo[repoKey] ?? "1970-01-01T00:00:00Z";

    console.log(`Fetching PRs for ${repoKey} since ${since}`);

    const prs = await listMergedPrsSince(
      repo,
      since,
      config.githubDefaultBranch,
      config.githubToken
    );

    console.log(`Found ${prs.length} merged PRs for ${repoKey}`);

    for (const pr of prs) {
      // Fetch files with diffs and commits in parallel
      const [files, commits] = await Promise.all([
        listPrFiles(repo, pr.number, config.githubToken),
        listPrCommits(repo, pr.number, config.githubToken),
      ]);
      results.push({ ...pr, files, commits });
    }
  }

  // Sort by mergedAt ascending for easier state updates
  results.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));

  return results;
}

