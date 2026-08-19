import type { DFIRDocument, ProjectMeta } from "../types/dfir.js";

/**
 * Result of the detection phase (blueprint section 6 — Project Detector).
 * A plugin says "yes, this is my kind of project" and how confident it is,
 * so the core can pick the best-matching plugin without hardcoding
 * framework knowledge.
 */
export interface DetectionResult {
  matched: boolean;
  confidence: number; // 0..1
  meta?: Partial<ProjectMeta>;
}

/** Files under the project root, already filtered by .docuforgeignore
 * and the config's include/exclude globs, handed to the plugin. */
export interface ProjectFile {
  path: string; // relative to root
  absolutePath: string;
}

export interface ScanContext {
  rootPath: string;
  files: ProjectFile[];
  /** Set on incremental runs (section 19): only these files changed
   * since the last scan. Absent on a full/first scan. */
  changedFiles?: string[];
  config?: Record<string, unknown>;
}

export interface PluginMetadata {
  id: string; // "laravel", "express", "fastapi", ...
  displayName: string;
  language: string;
  framework: string;
  version: string; // plugin's own semver, not the framework's
}

/**
 * The contract every framework plugin (Laravel, Express, FastAPI, ...)
 * must implement. This is intentionally small: detect + scan + metadata.
 * Everything downstream (analysis, relationship resolution, generation)
 * operates only on the DFIRDocument the plugin returns, so a new plugin
 * never has to touch core, analyzer, or generator code (blueprint
 * section 22 — Plugin Architecture).
 */
export interface Scanner {
  metadata(): PluginMetadata;

  /** Cheap, fast check: does this project look like mine? Should only
   * inspect manifest files (composer.json, package.json, ...), never
   * do a full source walk. */
  detect(rootPath: string): Promise<DetectionResult> | DetectionResult;

  /** Full (or incremental, if ctx.changedFiles is set) scan. Must
   * return a DFIRDocument — partial is fine, core will merge it with
   * any previous document on incremental runs. */
  scan(ctx: ScanContext): Promise<DFIRDocument> | DFIRDocument;
}

/** Simple in-process plugin registry. A CLI or host app registers the
 * plugins it ships with; `resolve()` runs detection across all of them
 * and returns the best match. */
export class PluginRegistry {
  private scanners: Scanner[] = [];

  register(scanner: Scanner): void {
    this.scanners.push(scanner);
  }

  list(): Scanner[] {
    return [...this.scanners];
  }

  async resolve(rootPath: string): Promise<Scanner | undefined> {
    const results = await Promise.all(
      this.scanners.map(async (scanner) => ({
        scanner,
        result: await scanner.detect(rootPath),
      }))
    );

    const matches = results.filter((r) => r.result.matched);
    if (matches.length === 0) return undefined;

    matches.sort((a, b) => b.result.confidence - a.result.confidence);
    return matches[0].scanner;
  }
}
