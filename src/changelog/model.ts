export type ChangelogSection = "New" | "Improvements" | "Fixes" | "Internal";

export interface FileStats {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
}

export interface ChangelogEntry {
  repo: string;
  prNumber: number;
  mergedAt: string; // ISO
  section: ChangelogSection;
  heading: string;
  bullets: string[]; // bullet texts without "- " prefix
  hidden?: boolean; // true => show in local CHANGELOG, skip Intercom
  // Enhanced metadata
  author: string;
  htmlUrl: string;
  files: FileStats[];
}

