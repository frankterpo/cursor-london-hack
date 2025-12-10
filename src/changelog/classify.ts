import { MergedPrWithFiles } from "../github/types.js";
import { ChangelogSection } from "./model.js";

export function classifySection(pr: MergedPrWithFiles): ChangelogSection {
  const labels = pr.labels.map((l) => l.toLowerCase());

  // Helper to check if any label contains a substring
  const hasLabelPart = (substr: string): boolean => {
    return labels.some((label) => label.includes(substr));
  };

  // Precedence: Fixes > New > Improvements > Internal

  // Fixes
  if (
    hasLabelPart("bug") ||
    hasLabelPart("fix") ||
    hasLabelPart("bugfix") ||
    hasLabelPart("hotfix") ||
    hasLabelPart("regression")
  ) {
    return "Fixes";
  }

  // New
  if (
    hasLabelPart("feature") ||
    hasLabelPart("feat") ||
    hasLabelPart("enhancement") ||
    hasLabelPart("new") ||
    hasLabelPart("launch") ||
    hasLabelPart("api") ||
    hasLabelPart("endpoint") ||
    hasLabelPart("release")
  ) {
    return "New";
  }

  // Improvements
  if (
    hasLabelPart("improvement") ||
    hasLabelPart("perf") ||
    hasLabelPart("performance") ||
    hasLabelPart("ux") ||
    hasLabelPart("ui") ||
    hasLabelPart("refactor") ||
    hasLabelPart("cleanup")
  ) {
    // Check if there's user-visible outcome
    const hasUserVisibleFiles = pr.files.some(
      (f) =>
        !f.filename.includes("/test") &&
        !f.filename.includes("/spec") &&
        !f.filename.includes("package.json") &&
        !f.filename.includes("yarn.lock") &&
        !f.filename.includes("pnpm-lock.yaml")
    );

    if (hasUserVisibleFiles) {
      return "Improvements";
    }
  }

  // Internal
  if (
    hasLabelPart("chore") ||
    hasLabelPart("deps") ||
    hasLabelPart("tests") ||
    hasLabelPart("infra") ||
    hasLabelPart("ci") ||
    hasLabelPart("internal")
  ) {
    return "Internal";
  }

  // Fallback: infer from title
  const titleLower = pr.title.toLowerCase();
  if (titleLower.includes("fix") || titleLower.includes("bug")) {
    return "Fixes";
  }
  if (
    titleLower.includes("add") ||
    titleLower.includes("new") ||
    titleLower.includes("feature")
  ) {
    return "New";
  }
  if (
    titleLower.includes("improve") ||
    titleLower.includes("enhance") ||
    titleLower.includes("refactor")
  ) {
    return "Improvements";
  }

  // Default to Internal if nothing matches
  return "Internal";
}

