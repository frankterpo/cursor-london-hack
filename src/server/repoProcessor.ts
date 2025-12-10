import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { config } from "dotenv";

config();

import { listMergedPrsSince, listPrFiles, listPrCommits } from "../github/client.js";
import { classifySection } from "../changelog/classify.js";
import { buildChangelogEntry } from "../changelog/bullets.js";
import { generateAllTonesForPr, XPost } from "../cursor/xPostAgent.js";
import type { MergedPrWithFiles } from "../github/types.js";
import type { ChangelogEntry } from "../changelog/model.js";

const ROOT = process.cwd();

export interface PopulateResult {
  repo: string;
  prsProcessed: number;
  tweetsGenerated: number;
  error?: string;
}

export type ProgressCallback = (event: {
  type: 'start' | 'fetching' | 'pr' | 'tweet' | 'complete' | 'error';
  message: string;
  repo?: string;
  prNumber?: number;
  prIndex?: number;
  totalPrs?: number;
  tone?: string;
  tweetsGenerated?: number;
  error?: string;
}) => void;

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function fetchPrsForRepo(
  repoFullName: string,
  onProgress?: ProgressCallback
): Promise<PopulateResult> {
  const [owner, name] = repoFullName.split("/");
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error("GITHUB_TOKEN not set");
  }

  onProgress?.({ type: 'start', message: `Starting population for ${repoFullName}`, repo: repoFullName });
  console.log(`📥 Fetching PRs for ${repoFullName}...`);

  // Get repo info to find default branch
  const repoResponse = await fetch(
    `https://api.github.com/repos/${owner}/${name}`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${token}`,
        "User-Agent": "tweet-generator",
      },
    }
  );

  if (!repoResponse.ok) {
    throw new Error(`Failed to fetch repo: ${repoResponse.status}`);
  }

  const repoInfo = await repoResponse.json();
  const defaultBranch = repoInfo.default_branch;

  // Fetch all merged PRs (no date cutoff)
  const since = "1970-01-01T00:00:00Z";
  
  const repo = { owner, name };
  onProgress?.({ type: 'fetching', message: `Fetching merged PRs...`, repo: repoFullName });
  const prs = await listMergedPrsSince(repo, since, defaultBranch, token);
  
  console.log(`   Found ${prs.length} merged PRs`);
  onProgress?.({ type: 'fetching', message: `Found ${prs.length} merged PRs`, repo: repoFullName, totalPrs: prs.length });

  if (prs.length === 0) {
    onProgress?.({ type: 'complete', message: `No PRs found`, repo: repoFullName, prsProcessed: 0, tweetsGenerated: 0 });
    return { repo: repoFullName, prsProcessed: 0, tweetsGenerated: 0 };
  }

  // Fetch files and commits for each PR
  const prsWithFiles: MergedPrWithFiles[] = [];
  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    onProgress?.({ type: 'fetching', message: `Fetching files for PR #${pr.number}`, repo: repoFullName, prNumber: pr.number, prIndex: i + 1, totalPrs: prs.length });
    const files = await listPrFiles(repo, pr.number, token);
    const commits = await listPrCommits(repo, pr.number, token);
    prsWithFiles.push({ ...pr, files, commits });
  }

  // Build changelog entries and generate tweets
  const entries: ChangelogEntry[] = [];
  const allPosts: XPost[] = [];

  console.log(`🤖 Generating tweets for ${prsWithFiles.length} PRs...`);
  onProgress?.({ type: 'fetching', message: `Starting tweet generation...`, repo: repoFullName, totalPrs: prsWithFiles.length });

  for (let i = 0; i < prsWithFiles.length; i++) {
    const pr = prsWithFiles[i];
    const section = classifySection(pr);
    
    console.log(`   Processing PR #${pr.number} (${i + 1}/${prsWithFiles.length})...`);
    onProgress?.({ type: 'pr', message: `Processing PR #${pr.number}`, repo: repoFullName, prNumber: pr.number, prIndex: i + 1, totalPrs: prsWithFiles.length });
    
    const entry = await withRetry(() => buildChangelogEntry(pr, section));
    entries.push(entry);

    // Generate all 3 tones
    const tones = ['refined', 'silly', 'shitpost'];
    for (const tone of tones) {
      onProgress?.({ type: 'tweet', message: `Generating ${tone} tweet for PR #${pr.number}`, repo: repoFullName, prNumber: pr.number, tone });
    }
    
    const posts = await withRetry(() => generateAllTonesForPr(pr, entry));
    allPosts.push(...posts);
    
    console.log(`   ✓ PR #${pr.number}: ${posts.length} tweets generated`);
    onProgress?.({ type: 'pr', message: `Completed PR #${pr.number}`, repo: repoFullName, prNumber: pr.number, prIndex: i + 1, totalPrs: prsWithFiles.length, tweetsGenerated: allPosts.length });
  }

  // Merge with existing data
  let existingData: { prs: any[]; totalPosts: number } = { prs: [], totalPosts: 0 };
  try {
    const existing = await readFile(join(ROOT, "x-posts-data.json"), "utf8");
    existingData = JSON.parse(existing);
  } catch {
    // No existing data
  }

  // Remove existing PRs from this repo and add new ones
  const otherRepoPrs = existingData.prs.filter((p: any) => p.repo !== repoFullName);
  
  // Convert new posts to the JSON format
  const newPrsMap = new Map<number, any>();
  for (const post of allPosts) {
    if (!newPrsMap.has(post.prNumber)) {
      newPrsMap.set(post.prNumber, {
        prNumber: post.prNumber,
        repo: post.repo,
        author: post.author,
        section: post.section,
        htmlUrl: post.htmlUrl,
        tweets: [],
      });
    }
    newPrsMap.get(post.prNumber)!.tweets.push({
      tone: post.tone,
      text: post.tweet,
      charCount: post.tweet.length,
    });
  }

  const mergedPrs = [...otherRepoPrs, ...Array.from(newPrsMap.values())];
  const totalPosts = mergedPrs.reduce((sum, pr) => sum + pr.tweets.length, 0);

  const outputData = {
    generated: new Date().toISOString(),
    totalPosts,
    prs: mergedPrs,
  };

  await writeFile(
    join(ROOT, "x-posts-data.json"),
    JSON.stringify(outputData, null, 2),
    "utf8"
  );

  console.log(`✅ Done! ${allPosts.length} tweets for ${repoFullName}`);
  onProgress?.({ type: 'complete', message: `Completed! Generated ${allPosts.length} tweets`, repo: repoFullName, prsProcessed: entries.length, tweetsGenerated: allPosts.length });

  return {
    repo: repoFullName,
    prsProcessed: entries.length,
    tweetsGenerated: allPosts.length,
  };
}

