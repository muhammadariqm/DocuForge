#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PluginRegistry,
  buildRelationships,
  walkProject,
  readDocuforgeIgnore,
  type DFIRDocument,
} from "@docuforge/core";
import { generateMarkdown, generateCombinedMarkdown } from "@docuforge/generator";
import { LaravelScanner } from "@docuforge/plugin-laravel";
import { GenericScanner } from "@docuforge/plugin-generic";

const DFIR_CACHE_PATH = ".docuforge/dfir.json";

function buildRegistry(): PluginRegistry {
	const registry = new PluginRegistry();

	// Specialized scanners first
	registry.register(new LaravelScanner());

	// Generic fallback
	registry.register(new GenericScanner());

	return registry;
}

async function cmdDetect(rootPath: string) {
  const registry = buildRegistry();
  const scanner = await registry.resolve(rootPath);
  if (!scanner) {
    console.log("No supported framework detected in this project.");
    return;
  }
  const meta = scanner.metadata();
  const detection = await scanner.detect(rootPath);
  console.log(`${detection.meta?.language ?? meta.language} ${detection.meta?.languageVersion ?? ""}`.trim());
  console.log(
    `${meta.displayName} ${detection.meta?.frameworkVersion ?? ""}`.trim()
  );
  if (detection.meta?.packageManager) console.log(detection.meta.packageManager);
}

async function cmdScan(rootPath: string): Promise<DFIRDocument> {
  const registry = buildRegistry();
  const scanner = await registry.resolve(rootPath);
  if (!scanner) {
    throw new Error(
      "No supported framework detected. Supported: Laravel (MVP)."
    );
  }

  const ignore = await readDocuforgeIgnore(rootPath);
  const allFiles = await walkProject(rootPath, { ignore });
  const files = allFiles.map((absolutePath) => ({
    path: path.relative(rootPath, absolutePath),
    absolutePath,
  }));

  console.log(`Scanning project with "${scanner.metadata().displayName}" plugin...`);
  const doc = await scanner.scan({ rootPath, files });
  doc.relationships = buildRelationships(doc);

  console.log(`✓ ${doc.routes.length} routes`);
  console.log(`✓ ${doc.controllers.length} controllers`);
  console.log(`✓ ${doc.models.length} models`);
  console.log(`✓ ${doc.database.tables.length} tables (migrations)`);
  console.log(`✓ ${doc.dependencies.length} dependencies`);

  await fs.mkdir(path.dirname(path.join(rootPath, DFIR_CACHE_PATH)), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(rootPath, DFIR_CACHE_PATH),
    JSON.stringify(doc, null, 2)
  );

  return doc;
}

async function cmdGenerate(rootPath: string, options: { split: boolean }) {
  const doc = await cmdScan(rootPath);

  console.log("Generating documentation...");
  const outDir = path.join(rootPath, "docs");
  await fs.mkdir(outDir, { recursive: true });

  if (options.split) {
    // Legacy layout: one file per topic (README, ARCHITECTURE, API, ...).
    const files = generateMarkdown(doc);
    for (const file of files) {
      await fs.writeFile(path.join(outDir, file.fileName), file.content);
      console.log(`✓ docs/${file.fileName}`);
    }
  } else {
    // Default: everything in one readable file with a table of contents.
    const file = generateCombinedMarkdown(doc);
    await fs.writeFile(path.join(outDir, file.fileName), file.content);
    console.log(`✓ docs/${file.fileName}`);
  }

  console.log("\nDone.");
}

async function cmdValidate(rootPath: string) {
  // Documentation Drift Detection (blueprint section 26) — MVP version:
  // re-scan and compare route sets against what's currently documented
  // in docs/ROUTES.md. Exits non-zero on drift so CI can fail the build.
  const doc = await cmdScan(rootPath);
  const combinedPath = path.join(rootPath, "docs", "DOCUMENTATION.md");
  const splitPath = path.join(rootPath, "docs", "ROUTES.md");

  let existing = "";
  try {
    existing = await fs.readFile(combinedPath, "utf-8");
  } catch {
    try {
      existing = await fs.readFile(splitPath, "utf-8");
    } catch {
      console.log("⚠ No docs/DOCUMENTATION.md found yet — run `docuforge generate` first.");
      process.exitCode = 1;
      return;
    }
  }

  const missing = doc.routes.filter(
    (r) => !existing.includes(r.path) || !existing.includes(r.method)
  );

  if (missing.length === 0) {
    console.log("✓ Documentation is up to date with source code.");
    return;
  }

  console.log("⚠ Documentation Drift Detected\n");
  for (const route of missing) {
    console.log(`  ${route.method} ${route.path} — not reflected in docs/ROUTES.md`);
  }
  process.exitCode = 1;
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const flags = rest.filter((a) => a.startsWith("--"));
  const positional = rest.filter((a) => !a.startsWith("--"));
  const rootPath = path.resolve(positional[0] ?? process.cwd());
  const split = flags.includes("--split");

  switch (command) {
    case "detect":
      await cmdDetect(rootPath);
      break;
    case "scan":
      await cmdScan(rootPath);
      break;
    case "generate":
      await cmdGenerate(rootPath, { split });
      break;
    case "validate":
      await cmdValidate(rootPath);
      break;
    case "serve":
      console.log(
        "`docuforge serve` (Web UI viewer, section 12) is planned for milestone M7 — not yet implemented in this MVP."
      );
      break;
    default:
      console.log(`DocuForge CLI (MVP v0.1)

Usage:
  docuforge detect   [path]            Detect language/framework
  docuforge scan     [path]            Scan project into DFIR (.docuforge/dfir.json)
  docuforge generate [path]            Scan + generate docs/DOCUMENTATION.md (single file)
  docuforge generate [path] --split    Same, but as 8 separate topic files (README, API, ...)
  docuforge validate [path]            Check docs against source for drift (CI-friendly)
  docuforge serve    [path]            (planned) serve interactive documentation portal
`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
