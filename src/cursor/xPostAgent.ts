import { CursorAgent } from "@cursor-ai/january";
import { promises as fs } from "node:fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MergedPrWithFiles } from "../github/types.js";
import { ChangelogEntry, ChangelogSection } from "../changelog/model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Pool of agents for parallel X post generation
// Keep small to avoid overwhelming the Cursor API
const X_POOL_SIZE = 2;
const xAgentPool: CursorAgent[] = [];
const xAgentAvailable: boolean[] = [];

function createXAgent(): CursorAgent {
  return new CursorAgent({
    apiKey: process.env.CURSOR_API_KEY || "",
    model: "claude-4-sonnet",
    workingLocation: {
      type: "local",
      localDirectory: process.cwd(),
    },
  });
}

// Initialize the X post agent pool
for (let i = 0; i < X_POOL_SIZE; i++) {
  xAgentPool.push(createXAgent());
  xAgentAvailable[i] = true;
}

async function acquireXAgent(): Promise<{ agent: CursorAgent; index: number }> {
  while (true) {
    for (let i = 0; i < X_POOL_SIZE; i++) {
      if (xAgentAvailable[i]) {
        xAgentAvailable[i] = false;
        return { agent: xAgentPool[i], index: i };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function releaseXAgent(index: number): void {
  xAgentAvailable[index] = true;
}

async function loadXPrompt(): Promise<string> {
  const promptPath = join(__dirname, "prompts", "x-post-prompt.md");
  return fs.readFile(promptPath, "utf8");
}

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000,
  context: string = ""
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error?.isRetryable === true ||
        error?.code === 14 ||
        error?.message?.includes("fetch failed");

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`\n   ${context} Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Tone types for X posts
export type XPostTone = "refined" | "silly" | "shitpost";

export const ALL_TONES: XPostTone[] = ["refined", "silly", "shitpost"];

export interface XPost {
  prNumber: number;
  repo: string;
  author: string;
  section: ChangelogSection;
  tone: XPostTone;
  tweet: string;
  htmlUrl: string;
}

export async function generateXPost(
  pr: MergedPrWithFiles,
  changelogEntry: ChangelogEntry,
  tone: XPostTone = "refined"
): Promise<XPost> {
  const { agent, index } = await acquireXAgent();

  async function processWithAgent(): Promise<string> {
    const prompt = await loadXPrompt();

    const context = {
      tone, // Specify the tone for this generation
      pr: {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        body: pr.body?.slice(0, 500) || "",
        author: pr.author,
        htmlUrl: pr.htmlUrl,
        mergedAt: pr.mergedAt,
        labels: pr.labels,
      },
      files: pr.files.slice(0, 10).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      commits: pr.commits?.slice(0, 5).map((c) => c.message) || [],
      changelog: {
        section: changelogEntry.section,
        heading: changelogEntry.heading,
        bullets: changelogEntry.bullets,
      },
    };

    const userMessage = `${prompt}\n\n## PR Data\n${JSON.stringify(context, null, 2)}`;

    const result = agent.submit({
      message: userMessage,
    });

    let raw = "";
    for await (const update of result.stream) {
      if (update.type === "text-delta") {
        raw += update.text;
      }
    }

    const conversation = await result.conversation;
    const lastTurn = conversation[conversation.length - 1];
    if (lastTurn?.type === "agentConversationTurn") {
      const steps = lastTurn.turn.steps;
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if (step?.type === "assistantMessage") {
          raw = step.message.text;
          break;
        }
      }
    }

    return raw;
  }

  try {
    const raw = await withRetry(
      () => processWithAgent(),
      3,
      2000,
      `[XPost PR#${pr.number} ${tone}]`
    );

    // Clean up the tweet
    let tweet = raw.trim();
    // Remove markdown code blocks if present
    tweet = tweet.replace(/^```[\w]*\n?/g, "").replace(/```$/g, "").trim();

    return {
      prNumber: pr.number,
      repo: pr.repo,
      author: pr.author,
      section: changelogEntry.section,
      tone,
      tweet,
      htmlUrl: pr.htmlUrl,
    };
  } finally {
    releaseXAgent(index);
  }
}

// Generate all tone variations for a single PR
export async function generateAllTonesForPr(
  pr: MergedPrWithFiles,
  changelogEntry: ChangelogEntry
): Promise<XPost[]> {
  const posts: XPost[] = [];

  // Generate sequentially to avoid overwhelming the API
  for (const tone of ALL_TONES) {
    const post = await generateXPost(pr, changelogEntry, tone);
    posts.push(post);
  }

  return posts;
}

export async function generateXPostsInParallel(
  prs: MergedPrWithFiles[],
  entries: ChangelogEntry[]
): Promise<XPost[]> {
  // Create a map of PR number to changelog entry
  const entryMap = new Map<number, ChangelogEntry>();
  for (const entry of entries) {
    entryMap.set(entry.prNumber, entry);
  }

  // Filter PRs that have changelog entries and are NOT internal
  const publicPrs = prs.filter((pr) => {
    const entry = entryMap.get(pr.number);
    return entry && entry.section !== "Internal";
  });

  if (publicPrs.length === 0) {
    console.log("📱 No public PRs to generate X posts for.");
    return [];
  }

  const totalPosts = publicPrs.length * ALL_TONES.length;
  console.log(
    `\n📱 Generating ${totalPosts} X posts (${publicPrs.length} PRs × ${ALL_TONES.length} tones)...`
  );

  const allPosts: XPost[] = [];
  let completed = 0;

  // Process PRs one at a time, but generate all tones for each
  for (const pr of publicPrs) {
    const entry = entryMap.get(pr.number)!;

    for (const tone of ALL_TONES) {
      const post = await generateXPost(pr, entry, tone);
      allPosts.push(post);
      completed++;
      process.stdout.write(
        `\r🐦 Progress: ${completed}/${totalPosts} posts (PR#${pr.number} - ${tone})`
      );
    }
  }

  console.log(""); // New line after progress

  return allPosts;
}

// Export as JSON for the live dashboard
export function formatXPostsAsJson(posts: XPost[]): string {
  const byPr = new Map<number, XPost[]>();
  for (const post of posts) {
    if (!byPr.has(post.prNumber)) {
      byPr.set(post.prNumber, []);
    }
    byPr.get(post.prNumber)!.push(post);
  }

  const data = {
    generated: new Date().toISOString(),
    totalPosts: posts.length,
    prs: Array.from(byPr.entries()).map(([prNumber, prPosts]) => ({
      prNumber,
      repo: prPosts[0].repo,
      author: prPosts[0].author,
      section: prPosts[0].section,
      htmlUrl: prPosts[0].htmlUrl,
      tweets: prPosts.map((p) => ({
        tone: p.tone,
        text: p.tweet,
        charCount: p.tweet.length,
      })),
    })),
  };

  return JSON.stringify(data, null, 2);
}

// Format with all tones grouped by PR
export function formatXPostsAsMarkdown(posts: XPost[]): string {
  const parts: string[] = [
    "# 🐦 X Posts - Choose Your Fighter\n",
    `Generated: ${new Date().toISOString()}\n`,
    "Each PR has 3 tone variations. Pick the one that matches your vibe!\n",
    "---\n",
  ];

  // Group by PR number
  const byPr = new Map<number, XPost[]>();
  for (const post of posts) {
    if (!byPr.has(post.prNumber)) {
      byPr.set(post.prNumber, []);
    }
    byPr.get(post.prNumber)!.push(post);
  }

  // Sort by PR number descending (newest first)
  const sortedPrs = Array.from(byPr.entries()).sort((a, b) => b[0] - a[0]);

  for (const [prNumber, prPosts] of sortedPrs) {
    const firstPost = prPosts[0];
    const sectionEmoji =
      firstPost.section === "New"
        ? "🚀"
        : firstPost.section === "Improvements"
          ? "⚡"
          : "🐛";

    parts.push(`## ${sectionEmoji} PR #${prNumber} - ${firstPost.repo}\n`);
    parts.push(`**Author**: @${firstPost.author}`);
    parts.push(`**Link**: ${firstPost.htmlUrl}\n`);

    // Sort by tone order
    const toneOrder: XPostTone[] = ["refined", "silly", "shitpost"];
    const sortedPosts = prPosts.sort(
      (a, b) => toneOrder.indexOf(a.tone) - toneOrder.indexOf(b.tone)
    );

    for (const post of sortedPosts) {
      const toneEmoji =
        post.tone === "refined"
          ? "👔"
          : post.tone === "silly"
            ? "🎪"
            : "🔥";
      const toneLabel =
        post.tone === "refined"
          ? "Professional"
          : post.tone === "silly"
            ? "Playful"
            : "Shitpost";

      parts.push(`### ${toneEmoji} ${toneLabel}\n`);
      parts.push("```");
      parts.push(post.tweet);
      parts.push("```");
      parts.push(`*${post.tweet.length} characters*\n`);
    }

    parts.push("---\n");
  }

  return parts.join("\n");
}
