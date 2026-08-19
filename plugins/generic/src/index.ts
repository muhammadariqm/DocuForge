import { promises as fs } from "node:fs";
import path from "node:path";

import {
	createEmptyDFIR,
	type DFIRDocument,
	type Dependency,
	type ProjectMeta,
} from "@docuforge/core";

import type {
	DetectionResult,
	PluginMetadata,
	ProjectFile,
	ScanContext,
	Scanner,
} from "@docuforge/core";

/**
 * Generic project scanner.
 *
 * This scanner is intentionally framework-agnostic.
 * It acts as the fallback scanner when no specialized
 * framework plugin (Laravel, Express, FastAPI, etc.) matches.
 */
export class GenericScanner implements Scanner {
	metadata(): PluginMetadata {
		return {
			id: "generic",
			displayName: "Generic Project Scanner",
			language: "Multi-language",
			framework: "Generic",
			version: "0.1.0",
		};
	}

	/**
	 * Generic scanner is a fallback.
	 *
	 * It recognizes common project manifests and gives
	 * itself a low confidence score so specialized plugins
	 * can win when they match.
	 */
	async detect(rootPath: string): Promise<DetectionResult> {
		const files = await safeReadDirectory(rootPath);

		const hasPackageJson = files.includes("package.json");
		const hasComposerJson = files.includes("composer.json");
		const hasRequirements = files.includes("requirements.txt");
		const hasPyproject = files.includes("pyproject.toml");
		const hasGoMod = files.includes("go.mod");
		const hasCargo = files.includes("Cargo.toml");
		const hasPom = files.includes("pom.xml");
		const hasGradle = files.includes("build.gradle");

		const matched =
			hasPackageJson ||
			hasComposerJson ||
			hasRequirements ||
			hasPyproject ||
			hasGoMod ||
			hasCargo ||
			hasPom ||
			hasGradle;

		if (!matched) {
			return {
				matched: false,
				confidence: 0,
			};
		}

		const meta = await detectProjectMeta(rootPath, files);

		return {
			matched: true,

			// Intentionally low.
			// Laravel / Express / FastAPI plugins should win.
			confidence: 0.1,

			meta,
		};
	}

	/**
	 * Perform the generic scan.
	 *
	 * The generic scanner currently focuses on:
	 * - project metadata
	 * - package manager
	 * - dependencies
	 * - basic source structure
	 *
	 * Framework-specific concepts are intentionally left empty.
	 */
	async scan(ctx: ScanContext): Promise<DFIRDocument> {
		const files = ctx.files;

		const relativePaths = files.map((file) => file.path);

		const meta = await detectProjectMeta(ctx.rootPath, relativePaths);

		const document = createEmptyDFIR(meta);

		document.dependencies = await scanDependencies(ctx.rootPath, meta, files);

		return document;
	}
}

/* -------------------------------------------------------------------------- */
/* Project detection                                                          */
/* -------------------------------------------------------------------------- */

async function detectProjectMeta(
	rootPath: string,
	files: string[],
): Promise<ProjectMeta> {
	const name = path.basename(rootPath);

	if (files.includes("package.json")) {
		const packageJson = await readJson(path.join(rootPath, "package.json"));

		const language = detectNodeLanguage(files);

		return {
			name: packageJson?.name ?? name,
			language,
			languageVersion: detectTypeScriptVersion(files),
			packageManager: detectNodePackageManager(files),
			rootPath,
		};
	}

	if (files.includes("composer.json")) {
		return {
			name,
			language: "PHP",
			packageManager: "Composer",
			rootPath,
		};
	}

	if (files.includes("requirements.txt") || files.includes("pyproject.toml")) {
		return {
			name,
			language: "Python",
			packageManager: files.includes("pyproject.toml")
				? "pip / pyproject"
				: "pip",
			rootPath,
		};
	}

	if (files.includes("go.mod")) {
		return {
			name,
			language: "Go",
			packageManager: "Go Modules",
			rootPath,
		};
	}

	if (files.includes("Cargo.toml")) {
		return {
			name,
			language: "Rust",
			packageManager: "Cargo",
			rootPath,
		};
	}

	if (files.includes("pom.xml") || files.includes("build.gradle")) {
		return {
			name,
			language: "Java",
			packageManager: files.includes("pom.xml") ? "Maven" : "Gradle",
			rootPath,
		};
	}

	return {
		name,
		language: "Unknown",
		rootPath,
	};
}

/* -------------------------------------------------------------------------- */
/* Node / TypeScript detection                                                */
/* -------------------------------------------------------------------------- */

function detectNodeLanguage(files: string[]): string {
	if (
		files.includes("tsconfig.json") ||
		files.some((file) => file.endsWith(".ts"))
	) {
		return "TypeScript";
	}

	return "JavaScript";
}

function detectTypeScriptVersion(files: string[]): string | undefined {
	if (
		files.includes("tsconfig.json") ||
		files.some((file) => file.endsWith(".ts"))
	) {
		return "TypeScript";
	}

	return undefined;
}

function detectNodePackageManager(files: string[]): string {
	if (files.includes("pnpm-lock.yaml")) {
		return "pnpm";
	}

	if (files.includes("yarn.lock")) {
		return "Yarn";
	}

	if (files.includes("package-lock.json")) {
		return "npm";
	}

	if (files.includes("bun.lockb") || files.includes("bun.lock")) {
		return "Bun";
	}

	return "npm";
}

/* -------------------------------------------------------------------------- */
/* Dependency scanning                                                        */
/* -------------------------------------------------------------------------- */

async function scanDependencies(
	rootPath: string,
	meta: ProjectMeta,
	files: ProjectFile[],
): Promise<Dependency[]> {
	if (meta.language === "TypeScript" || meta.language === "JavaScript") {
		return scanPackageJson(rootPath);
	}

	if (meta.language === "PHP") {
		return scanComposerJson(rootPath);
	}

	if (meta.language === "Python") {
		return scanPythonDependencies(rootPath, files);
	}

	return [];
}

async function scanPackageJson(rootPath: string): Promise<Dependency[]> {
	const packageJson = await readJson(path.join(rootPath, "package.json"));

	if (!packageJson) {
		return [];
	}

	const dependencies: Dependency[] = [];

	const runtimeDependencies = packageJson.dependencies ?? {};

	const devDependencies = packageJson.devDependencies ?? {};

	for (const [name, version] of Object.entries(runtimeDependencies)) {
		dependencies.push({
			name,
			version: String(version),
			type: "external",
			ecosystem: "npm",
		});
	}

	for (const [name, version] of Object.entries(devDependencies)) {
		dependencies.push({
			name,
			version: String(version),
			type: "external",
			ecosystem: "npm",
		});
	}

	return dependencies;
}

async function scanComposerJson(rootPath: string): Promise<Dependency[]> {
	const composer = await readJson(path.join(rootPath, "composer.json"));

	if (!composer) {
		return [];
	}

	const dependencies: Dependency[] = [];

	const require = composer.require ?? {};
	const requireDev = composer["require-dev"] ?? {};

	for (const [name, version] of Object.entries(require)) {
		dependencies.push({
			name,
			version: String(version),
			type: "external",
			ecosystem: "composer",
		});
	}

	for (const [name, version] of Object.entries(requireDev)) {
		dependencies.push({
			name,
			version: String(version),
			type: "external",
			ecosystem: "composer",
		});
	}

	return dependencies;
}

async function scanPythonDependencies(
	rootPath: string,
	files: ProjectFile[],
): Promise<Dependency[]> {
	const dependencies: Dependency[] = [];

	if (files.some((file) => file.path === "requirements.txt")) {
		const filePath = path.join(rootPath, "requirements.txt");

		try {
			const content = await fs.readFile(filePath, "utf8");

			for (const rawLine of content.split(/\r?\n/)) {
				const line = rawLine.trim();

				if (!line || line.startsWith("#") || line.startsWith("-")) {
					continue;
				}

				const match = line.match(
					/^([A-Za-z0-9_.-]+)(?:\s*(?:==|>=|<=|~=|>|<)\s*(.+))?$/,
				);

				if (!match) {
					continue;
				}

				dependencies.push({
					name: match[1],
					version: match[2],
					type: "external",
					ecosystem: "pip",
				});
			}
		} catch {
			// Ignore unreadable requirements files.
		}
	}

	return dependencies;
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

async function readJson(
	filePath: string,
): Promise<Record<string, any> | undefined> {
	try {
		const content = await fs.readFile(filePath, "utf8");

		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

async function safeReadDirectory(rootPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(rootPath);

		return entries;
	} catch {
		return [];
	}
}
