import { fetchNewMergedPrs } from "../github/fetchMergedPrs.js";
import { classifySection } from "../changelog/classify.js";
import { buildChangelogEntry } from "../changelog/bullets.js";
import {
  groupEntriesByDate,
  renderMarkdown,
} from "../changelog/assembleMarkdown.js";
import { prependToChangelog } from "../changelog/persist.js";
import { loadState, saveState } from "../state/stateStore.js";
import { loadConfig } from "../config.js";
import { ChangelogEntry } from "../changelog/model.js";
import { MergedPrWithFiles } from "../github/types.js";
import {
  generateXPostsInParallel,
  formatXPostsAsMarkdown,
  formatXPostsAsJson,
} from "../cursor/xPostAgent.js";
import { promises as fs } from "node:fs";

// Parallel processing with concurrency limit
// Reduced from 5 to 3 to avoid overwhelming the Cursor API
const CONCURRENCY = 3;

async function processInParallel<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  let completed = 0;

  async function processNext(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      try {
        results[index] = await processor(item, index);
        completed++;
        const percent = Math.round((completed / items.length) * 100);
        process.stdout.write(`\r⚡ Progress: ${completed}/${items.length} PRs (${percent}%)`);
      } catch (error) {
        console.error(`\n❌ Error processing item ${index}:`, error);
        throw error;
      }
    }
  }

  // Start `concurrency` number of workers
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => processNext());

  await Promise.all(workers);
  console.log(""); // New line after progress
  return results;
}

export async function runChangelogJob(): Promise<void> {
  const config = loadConfig();
  
  // Check for --reset flag to forget all processed PRs
  const resetFlag = process.argv.includes("--reset") || process.argv.includes("--forget");
  if (resetFlag) {
    console.log("🔄 Resetting state - forgetting all processed PRs...");
    try {
      await fs.unlink(config.stateFilePath);
      console.log(`   Deleted ${config.stateFilePath}`);
    } catch (e) {
      // File might not exist, that's fine
    }
    // Also clear the changelog if --clean flag is present
    if (process.argv.includes("--clean")) {
      try {
        await fs.unlink("CHANGELOG.md");
        console.log("   Deleted CHANGELOG.md");
      } catch (e) {}
      try {
        await fs.unlink("intercom-release-notes-latest.md");
        console.log("   Deleted intercom-release-notes-latest.md");
      } catch (e) {}
      try {
        await fs.unlink("x-posts-latest.md");
        console.log("   Deleted x-posts-latest.md");
      } catch (e) {}
    }
    console.log("✅ State reset complete. Processing all PRs from scratch.\n");
  }
  
  let state = await loadState(config.stateFilePath, config);

  // Check for CLI override --since=YYYY-MM-DD
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  if (sinceArg) {
    const overrideSince = sinceArg.split("=")[1];
    console.log(`Overriding state with --since=${overrideSince}`);
    const overrideDate = new Date(overrideSince).toISOString();

    for (const repo of config.githubRepos) {
      const key = `${repo.owner}/${repo.name}`;
      state.lastProcessedMergedAtByRepo[key] = overrideDate;
    }
  }

  const prs = await fetchNewMergedPrs();
  if (prs.length === 0) {
    console.log("No new merged PRs to process.");
    return;
  }

  console.log(`\n🚀 Processing ${prs.length} PRs with ${CONCURRENCY} parallel agents...\n`);

  // Process PRs in parallel with concurrency limit
  const startTime = Date.now();
  
  const entries = await processInParallel(
    prs,
    CONCURRENCY,
    async (pr: MergedPrWithFiles, index: number) => {
      const section = classifySection(pr);
      return buildChangelogEntry(pr, section);
    }
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  Processed ${prs.length} PRs in ${duration}s`);

  const groups = groupEntriesByDate(entries, config.timezone);

  const markdownForChangelog = renderMarkdown(groups, {
    includeInternal: true,
  });
  const markdownForIntercom = renderMarkdown(
    groups.filter((g) => !g.entries.some((e) => e.hidden)),
    { includeInternal: false }
  );

  await prependToChangelog(markdownForChangelog);
  await fs.writeFile(
    "intercom-release-notes-latest.md",
    markdownForIntercom,
    "utf8"
  );

  // Generate X posts for public PRs
  const xPosts = await generateXPostsInParallel(prs, entries);
  
  if (xPosts.length > 0) {
    // Write markdown version
    const xPostsMarkdown = formatXPostsAsMarkdown(xPosts);
    await fs.writeFile("x-posts-latest.md", xPostsMarkdown, "utf8");
    
    // Write JSON for the dashboard
    const xPostsJson = formatXPostsAsJson(xPosts);
    await fs.writeFile("x-posts-data.json", xPostsJson, "utf8");
    
    console.log(`\n🐦 Generated ${xPosts.length} X posts`);
    console.log(`   → x-posts-latest.md (markdown)`);
    console.log(`   → x-posts-data.json (dashboard data)`);
    console.log(`   → Open dashboard.html to browse & copy tweets!`);
  }

  // Update state with max mergedAt per repo
  for (const pr of prs) {
    const key = pr.repo;
    const prev = state.lastProcessedMergedAtByRepo[key];
    if (!prev || pr.mergedAt > prev) {
      state.lastProcessedMergedAtByRepo[key] = pr.mergedAt;
    }
  }

  await saveState(config.stateFilePath, state);

  console.log("\n✅ Changelog job completed successfully!");
  console.log(`   - Processed ${prs.length} PRs`);
  console.log(`   - Created ${groups.length} date groups`);
  console.log(`   - Updated CHANGELOG.md`);
  console.log(`   - Generated intercom-release-notes-latest.md`);
  if (xPosts.length > 0) {
    console.log(`   - Generated ${xPosts.length} X posts → x-posts-latest.md`);
  }
}

