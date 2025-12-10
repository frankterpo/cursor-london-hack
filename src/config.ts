import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", ".env") });

export interface RepoConfig {
  owner: string;
  name: string;
}

export interface Config {
  githubToken: string;
  githubRepos: RepoConfig[];
  githubDefaultBranch: string;

  intercomAccessToken?: string;
  intercomReleaseNotesArticleId?: string;

  timezone: string;
  stateFilePath: string;
  initialSince?: string;
}

function parseRepos(reposStr: string): RepoConfig[] {
  return reposStr
    .split(",")
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0)
    .map((repo) => {
      const parts = repo.split("/");
      if (parts.length !== 2) {
        throw new Error(
          `Invalid repo format: ${repo}. Expected format: owner/name`
        );
      }
      return { owner: parts[0], name: parts[1] };
    });
}

export function loadConfig(): Config {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const githubReposStr = process.env.GITHUB_REPOS;
  if (!githubReposStr) {
    throw new Error("GITHUB_REPOS is required (comma-separated list: owner/repo)");
  }

  const githubRepos = parseRepos(githubReposStr);
  if (githubRepos.length === 0) {
    throw new Error("GITHUB_REPOS must contain at least one repository");
  }

  const githubDefaultBranch =
    process.env.GITHUB_DEFAULT_BRANCH || "main";

  const intercomAccessToken = process.env.INTERCOM_ACCESS_TOKEN;
  const intercomReleaseNotesArticleId =
    process.env.INTERCOM_RELEASE_NOTES_ARTICLE_ID;

  const timezone = process.env.TIMEZONE || "Europe/London";
  const stateFilePath =
    process.env.CHANGELOG_STATE_FILE || ".changelog-state.json";
  const initialSince = process.env.CHANGELOG_INITIAL_SINCE;

  return {
    githubToken,
    githubRepos,
    githubDefaultBranch,
    intercomAccessToken,
    intercomReleaseNotesArticleId,
    timezone,
    stateFilePath,
    initialSince,
  };
}

