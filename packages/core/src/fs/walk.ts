import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  "vendor",
  "storage",
  ".docuforge",
  "dist",
  "build",
];

export interface WalkOptions {
  ignore?: string[];
}

/** Recursively lists files under `rootPath`, skipping common noise
 * directories and anything matched by .docuforgeignore (section 18). */
export async function walkProject(
  rootPath: string,
  options: WalkOptions = {}
): Promise<string[]> {
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const results: string[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  await walk(rootPath);
  return results;
}

export async function readDocuforgeIgnore(rootPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(
      path.join(rootPath, ".docuforgeignore"),
      "utf-8"
    );
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}
