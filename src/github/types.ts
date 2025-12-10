export interface MergedPr {
  repo: string; // "owner/name"
  number: number;
  title: string;
  body: string;
  labels: string[];
  mergedAt: string; // ISO
  author: string;
  htmlUrl: string;
}

export interface PrFileChange {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string; // The actual diff content
}

export interface MergedPrWithFiles extends MergedPr {
  files: PrFileChange[];
  // Commits info for richer context
  commits?: PrCommit[];
}

export interface PrCommit {
  sha: string;
  message: string;
  author: string;
}

