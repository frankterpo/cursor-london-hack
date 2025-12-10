import { MergedPrWithFiles } from "../github/types.js";
import { ChangelogSection } from "./model.js";

const EMOJI_MAP: Record<ChangelogSection, string[]> = {
  New: ["📍", "🌟", "🧠", "🦸", "🦄"],
  Improvements: ["✨", "🕵️‍♂️", "👁️", "📑"],
  Fixes: ["🐞"],
  Internal: ["⚙️"],
};

function extractSurfaceFromTitle(title: string): string {
  // Remove common verbs
  let surface = title
    .replace(/^(add|added|adding|new|create|created|creating|implement|implemented|implementing)\s+/i, "")
    .replace(/^(improve|improved|improving|enhance|enhanced|enhancing|refactor|refactored|refactoring)\s+/i, "")
    .replace(/^(fix|fixed|fixing|resolve|resolved|resolving)\s+/i, "")
    .trim();

  // Capitalize first letter
  if (surface.length > 0) {
    surface = surface.charAt(0).toUpperCase() + surface.slice(1);
  }

  return surface || title;
}

export function buildHeading(
  pr: MergedPrWithFiles,
  section: ChangelogSection
): string {
  const emojis = EMOJI_MAP[section];
  const emoji = emojis[0]; // Use first emoji for now

  const surface = extractSurfaceFromTitle(pr.title);

  switch (section) {
    case "New":
      // Check for specific patterns
      if (pr.title.toLowerCase().includes("api") || pr.title.toLowerCase().includes("endpoint")) {
        return `${emoji} New API Endpoints`;
      }
      if (pr.title.toLowerCase().includes("signal")) {
        return `${emoji} ${surface}`;
      }
      return `${emoji} ${surface}`;

    case "Improvements":
      if (surface.toLowerCase().includes("popover")) {
        return `🕵️‍♂️ Popover improvements`;
      }
      if (surface.toLowerCase().includes("table")) {
        return `👁️ Table View Improvements`;
      }
      return `${emoji} ${surface} improvements`;

    case "Fixes":
      return `${emoji} ${surface} bug fixes`;

    case "Internal":
      return `${emoji} Internal improvements`;

    default:
      return `${emoji} ${surface}`;
  }
}

