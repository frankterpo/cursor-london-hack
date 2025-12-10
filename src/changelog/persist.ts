import { promises as fs } from "node:fs";

export async function prependToChangelog(markdown: string): Promise<void> {
  const path = "CHANGELOG.md";
  let existing = "";

  try {
    existing = await fs.readFile(path, "utf8");
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    // File doesn't exist, that's fine
  }

  const combined = `${markdown.trim()}\n\n${existing}`;
  await fs.writeFile(path, combined, "utf8");
}

