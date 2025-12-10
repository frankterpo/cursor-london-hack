import { promises as fs } from "node:fs";
import { Config } from "../config.js";

export interface ChangelogState {
  lastProcessedMergedAtByRepo: Record<string, string>;
}

const DEFAULT_STATE: ChangelogState = {
  lastProcessedMergedAtByRepo: {},
};

export async function loadState(
  path: string,
  config: Config
): Promise<ChangelogState> {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as ChangelogState;
  } catch (error: any) {
    // File doesn't exist - first run
    if (error.code === "ENOENT") {
      const initialSince =
        config.initialSince ?? "1970-01-01T00:00:00Z";

      const state: ChangelogState = {
        lastProcessedMergedAtByRepo: {},
      };

      // Initialize state for all repos
      for (const repo of config.githubRepos) {
        const key = `${repo.owner}/${repo.name}`;
        state.lastProcessedMergedAtByRepo[key] = initialSince;
      }

      return state;
    }
    throw error;
  }
}

export async function saveState(
  path: string,
  state: ChangelogState
): Promise<void> {
  await fs.writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

