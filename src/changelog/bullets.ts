import { runPrSummarizationAgent } from "../cursor/agent.js";
import { ChangelogEntry, ChangelogSection } from "./model.js";
import { MergedPrWithFiles } from "../github/types.js";
import { buildHeading } from "./heading.js";

export async function buildChangelogEntry(
  pr: MergedPrWithFiles,
  section: ChangelogSection
): Promise<ChangelogEntry> {
  const heading = buildHeading(pr, section);
  const bullet = await runPrSummarizationAgent(pr, section, heading);

  const hidden = section === "Internal"; // Hide internal from Intercom

  return {
    repo: pr.repo,
    prNumber: pr.number,
    mergedAt: pr.mergedAt,
    section,
    heading,
    bullets: [bullet],
    hidden,
    // Enhanced metadata
    author: pr.author,
    htmlUrl: pr.htmlUrl,
    files: pr.files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}

