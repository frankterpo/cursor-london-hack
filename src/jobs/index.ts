import { runChangelogJob } from "./runChangelogJob.js";

// Show help if requested
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
📋 Changelog & X Post Generator

Usage: npm run changelog:run [options]

Options:
  --reset, --forget    Reset state and reprocess ALL PRs from scratch
  --clean              Used with --reset to also delete output files
  --since=YYYY-MM-DD   Only process PRs merged after this date
  --help, -h           Show this help message

Examples:
  npm run changelog:run                    # Process new PRs only
  npm run changelog:run --reset            # Forget all PRs, reprocess everything
  npm run changelog:run --reset --clean    # Full reset, delete all output files
  npm run changelog:run --since=2025-01-01 # Process PRs since Jan 1, 2025

Output Files:
  CHANGELOG.md                   Full changelog with all entries
  intercom-release-notes-latest.md  User-facing entries only
  x-posts-latest.md              X/Twitter posts in 3 tones
`);
  process.exit(0);
}

runChangelogJob().catch((err) => {
  console.error("Changelog job failed:", err);
  process.exit(1);
});
