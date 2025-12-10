import { ChangelogEntry } from "./model.js";
import { formatDateKey } from "./dateUtils.js";

export interface DateGroup {
  dateKey: string; // "November 20th 2025"
  entries: ChangelogEntry[];
}

export function groupEntriesByDate(
  entries: ChangelogEntry[],
  timezone: string
): DateGroup[] {
  const groups = new Map<string, ChangelogEntry[]>();

  for (const entry of entries) {
    const dateKey = formatDateKey(entry.mergedAt, timezone);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(entry);
  }

  return Array.from(groups.entries())
    .map(([dateKey, entries]) => ({ dateKey, entries }))
    .sort((a, b) => {
      // Sort dates descending (newest first)
      // Simple string comparison works for this format
      return b.dateKey.localeCompare(a.dateKey);
    });
}

function getSectionRank(section: string): number {
  switch (section) {
    case "New":
      return 0;
    case "Improvements":
      return 1;
    case "Fixes":
      return 2;
    case "Internal":
      return 3;
    default:
      return 4;
  }
}

function formatFilesSummary(files: Array<{ filename: string; additions: number; deletions: number }>): string {
  if (!files || files.length === 0) return "";
  
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  
  // Show up to 5 most significant files
  const topFiles = files
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => `\`${f.filename}\``)
    .join(", ");
  
  const moreCount = files.length > 5 ? ` +${files.length - 5} more` : "";
  
  return `${topFiles}${moreCount} (+${totalAdditions}/-${totalDeletions})`;
}

export function renderMarkdown(
  groups: DateGroup[],
  options: { includeInternal: boolean } = { includeInternal: true }
): string {
  const parts: string[] = [];

  for (const group of groups) {
    parts.push(`## ${group.dateKey}\n`);

    // Sort entries by section precedence, then by mergedAt descending
    const sorted = group.entries
      .filter((entry) => options.includeInternal || !entry.hidden)
      .slice()
      .sort((a, b) => {
        const sectionCmp = getSectionRank(a.section) - getSectionRank(b.section);
        if (sectionCmp !== 0) return sectionCmp;
        return b.mergedAt.localeCompare(a.mergedAt);
      });

    for (const entry of sorted) {
      parts.push(`### ${entry.heading}\n`);
      
      // Add metadata line
      const metaParts: string[] = [];
      if (entry.repo) metaParts.push(`📁 **${entry.repo}**`);
      if (entry.author) metaParts.push(`👤 @${entry.author}`);
      if (entry.htmlUrl) metaParts.push(`[PR #${entry.prNumber}](${entry.htmlUrl})`);
      
      if (metaParts.length > 0) {
        parts.push(`> ${metaParts.join(" · ")}`);
      }
      
      // Add files changed summary
      if (entry.files && entry.files.length > 0) {
        parts.push(`> 📝 Files: ${formatFilesSummary(entry.files)}`);
      }
      
      parts.push(""); // blank line before content
      
      for (const bullet of entry.bullets) {
        // The bullet now contains the full narrative, not just a single line
        parts.push(bullet);
      }
      parts.push(""); // blank line after content
    }

    parts.push(""); // extra spacing between dates
  }

  return parts.join("\n");
}

