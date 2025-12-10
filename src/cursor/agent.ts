import { CursorAgent } from "@cursor-ai/january";
import { promises as fs } from "node:fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MergedPrWithFiles } from "../github/types.js";
import { ChangelogSection } from "../changelog/model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Pool of agents for parallel processing
// Reduced from 5 to 3 to avoid overwhelming the Cursor API
const POOL_SIZE = 3;
const agentPool: CursorAgent[] = [];
const agentAvailable: boolean[] = [];

function createAgent(): CursorAgent {
  return new CursorAgent({
    apiKey: process.env.CURSOR_API_KEY || "",
    model: "claude-4-sonnet",
    workingLocation: {
      type: "local",
      localDirectory: process.cwd(),
    },
  });
}

// Initialize the pool
for (let i = 0; i < POOL_SIZE; i++) {
  agentPool.push(createAgent());
  agentAvailable[i] = true;
}

// Get an available agent from the pool
async function acquireAgent(prNumber?: number): Promise<{ agent: CursorAgent; index: number }> {
  let waitCount = 0;
  // Try to find an available agent
  while (true) {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (agentAvailable[i]) {
        agentAvailable[i] = false;
        if (waitCount > 0) {
          console.log(`\n   [PR#${prNumber}] acquired agent ${i} after waiting ${waitCount * 100}ms`);
        }
        return { agent: agentPool[i], index: i };
      }
    }
    waitCount++;
    if (waitCount % 50 === 0) { // Log every 5 seconds
      console.log(`\n   [PR#${prNumber}] still waiting for agent... (${waitCount * 100}ms)`);
    }
    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function releaseAgent(index: number, prNumber?: number): void {
  agentAvailable[index] = true;
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
      const isRetryable = error?.isRetryable === true || 
                          error?.code === 14 || 
                          error?.message?.includes("fetch failed") ||
                          error?.message?.includes("ECONNRESET");
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.log(`\n   ${context} Retry ${attempt}/${maxRetries} after ${delay}ms (${error?.message?.slice(0, 50)}...)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

async function loadPrompt(name: string): Promise<string> {
  const promptPath = join(__dirname, "prompts", name);
  return fs.readFile(promptPath, "utf8");
}

function summariseFiles(files: Array<{ filename: string }>): string {
  return files.map((f) => f.filename).join("; ");
}

// Max total diff size to send to AI (to avoid timeouts on large PRs)
const MAX_DIFF_SIZE = 6000;

function buildDiffSummary(
  files: Array<{ filename: string; patch?: string; additions: number; deletions: number }>
): string {
  const parts: string[] = [];
  let totalSize = 0;
  
  // Sort by most significant changes first
  const sortedFiles = [...files].sort(
    (a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)
  );
  
  for (const file of sortedFiles) {
    if (totalSize >= MAX_DIFF_SIZE) {
      parts.push(`\n... and ${sortedFiles.length - parts.length} more files (truncated for size)`);
      break;
    }
    
    if (file.patch) {
      const entry = `### ${file.filename} (+${file.additions}/-${file.deletions})\n\`\`\`diff\n${file.patch}\n\`\`\``;
      if (totalSize + entry.length <= MAX_DIFF_SIZE) {
        parts.push(entry);
        totalSize += entry.length;
      } else {
        // Add truncated version
        parts.push(`### ${file.filename} (+${file.additions}/-${file.deletions}) [diff truncated]`);
        totalSize += 100;
      }
    } else {
      parts.push(`### ${file.filename} (+${file.additions}/-${file.deletions})`);
      totalSize += 50;
    }
  }
  
  return parts.join("\n\n");
}

// Timeout wrapper for agent calls
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function buildCommitSummary(
  commits?: Array<{ sha: string; message: string; author: string }>
): string {
  if (!commits || commits.length === 0) return "";
  
  return commits.map((c) => `- ${c.sha}: ${c.message} (by ${c.author})`).join("\n");
}

function normaliseBullet(text: string): string {
  // Remove leading "- " if present
  let cleaned = text.trim();
  if (cleaned.startsWith("- ")) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith("-")) {
    cleaned = cleaned.slice(1).trim();
  }

  // Remove any markdown code fences
  cleaned = cleaned.replace(/^```[\w]*\n?/g, "").replace(/```$/g, "");

  return cleaned.trim();
}

export async function runPrSummarizationAgent(
  pr: MergedPrWithFiles,
  section: ChangelogSection,
  heading: string
): Promise<string> {
  const basePrompt = await loadPrompt("pr-summarization-prompt.md");

  // Load examples from specter-release-notes.md
  const examplesPath = join(
    __dirname,
    "..",
    "..",
    "scope",
    "specter-release-notes.md"
  );
  let examples = "";
  try {
    examples = await fs.readFile(examplesPath, "utf8");
    // Truncate to ~8000 chars to avoid token limits
    examples = examples.slice(0, 8000);
  } catch (error) {
    console.warn("Could not load examples file:", error);
  }

  // Append examples to the prompt if available
  const systemPrompt = examples
    ? `${basePrompt}\n\n## Examples from Specter Release Notes\n\n${examples}`
    : basePrompt;

  const fileSummary = summariseFiles(pr.files);
  const diffSummary = buildDiffSummary(pr.files);
  const commitSummary = buildCommitSummary(pr.commits);

  // Limit files to top 20 by change size to avoid huge payloads
  const topFiles = [...pr.files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 20);

  const payload = {
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    body: pr.body?.slice(0, 2000) || "", // Truncate body too
    labels: pr.labels,
    mergedAt: pr.mergedAt,
    author: pr.author,
    htmlUrl: pr.htmlUrl,
    files: topFiles.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    totalFiles: pr.files.length,
    fileSummary: fileSummary.slice(0, 1000), // Truncate file summary
    section,
    heading,
  };

  // Build enhanced context with actual code diffs
  const enhancedContext = `
## PR Metadata
- **Repository**: ${pr.repo}
- **Author**: @${pr.author}
- **Merged At**: ${pr.mergedAt}
- **PR Link**: ${pr.htmlUrl}

## Commits
${commitSummary || "No commit details available"}

## Code Changes (Diffs)
${diffSummary || "No diff details available"}
`;

  // Acquire an agent from the pool
  const { agent, index } = await acquireAgent(pr.number);
  
  // Inner function to process with the agent
  async function processWithAgent(): Promise<string> {
    let userMessage = `${systemPrompt}\n\n## PR Data\n${JSON.stringify(payload, null, 2)}\n\n${enhancedContext}`;
    
    // Hard limit: if message is still too big, truncate the enhanced context
    const MAX_MESSAGE_SIZE = 30000; // ~30KB max
    if (userMessage.length > MAX_MESSAGE_SIZE) {
      console.log(`\n   [PR#${pr.number}] Message too large (${userMessage.length}), truncating...`);
      // Just use the basic payload without diffs
      userMessage = `${systemPrompt}\n\n## PR Data\n${JSON.stringify(payload, null, 2)}\n\n(Diffs truncated due to size)`;
    }
    
    const startTime = Date.now();
    console.log(`\n   [PR#${pr.number}] Starting AI call (agent ${index}, msg size: ${userMessage.length} chars)`);
    
    const result = agent.submit({
      message: userMessage,
  });

    // Consume the stream to collect text deltas
    let raw = "";
    let tokenCount = 0;
    for await (const update of result.stream) {
      if (update.type === "text-delta") {
        raw += update.text;
        tokenCount++;
      }
    }
    
    console.log(`\n   [PR#${pr.number}] Stream done (${tokenCount} chunks, ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

    // Wait for conversation to complete and extract final assistant message
    const conversation = await result.conversation;
    console.log(`\n   [PR#${pr.number}] Conversation complete (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);
    
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
    // Wrap in retry logic for network failures
    const raw = await withRetry(
      () => processWithAgent(),
      3,
      2000,
      `[PR#${pr.number}]`
    );
  const bullet = normaliseBullet(raw);

  // Append PR number comment if available
  if (pr.number) {
    return `${bullet} <!-- PR#${pr.number} -->`;
  }

  return bullet;
  } finally {
    // Always release the agent back to the pool
    releaseAgent(index, pr.number);
  }
}

