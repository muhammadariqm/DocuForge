import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createEmptyDFIR,
  walkProject,
  type DFIRDocument,
  type DetectionResult,
  type PluginMetadata,
  type ScanContext,
  type Scanner,
  type Route,
  type Controller,
  type Model,
  type DatabaseTable,
  type HttpMethod,
} from "@docuforge/core";

/**
 * LaravelScanner — proof-of-concept implementation of the Scanner
 * interface (blueprint section 7 / section 34 "Urutan pembangunan").
 *
 * Deliberately regex/line-based rather than a full PHP AST parser:
 * good enough to validate that the DFIR + Scanner contract works end
 * to end, without pulling in a PHP parser dependency for the PoC.
 * A future iteration can swap this internals for tree-sitter-php
 * without touching the Scanner interface or DFIR shape at all.
 */
export class LaravelScanner implements Scanner {
  metadata(): PluginMetadata {
    return {
      id: "laravel",
      displayName: "Laravel",
      language: "PHP",
      framework: "Laravel",
      version: "0.1.0",
    };
  }

  async detect(rootPath: string): Promise<DetectionResult> {
    try {
      const composerRaw = await fs.readFile(
        path.join(rootPath, "composer.json"),
        "utf-8"
      );
      const composer = JSON.parse(composerRaw);
      const deps = {
        ...(composer.require ?? {}),
        ...(composer["require-dev"] ?? {}),
      };
      const laravelVersion: string | undefined = deps["laravel/framework"];
      if (!laravelVersion) {
        return { matched: false, confidence: 0 };
      }
      return {
        matched: true,
        confidence: 0.95,
        meta: {
          name: composer.name ?? path.basename(rootPath),
          language: "PHP",
          framework: "Laravel",
          frameworkVersion: laravelVersion.replace(/^\D*/, ""),
          packageManager: "composer",
        },
      };
    } catch {
      return { matched: false, confidence: 0 };
    }
  }

  async scan(ctx: ScanContext): Promise<DFIRDocument> {
    const detection = await this.detect(ctx.rootPath);
    const doc = createEmptyDFIR({
      name: detection.meta?.name ?? path.basename(ctx.rootPath),
      language: "PHP",
      framework: "Laravel",
      frameworkVersion: detection.meta?.frameworkVersion,
      packageManager: "composer",
      rootPath: ctx.rootPath,
    });

    const files =
      ctx.files.length > 0
        ? ctx.files.map((f) => f.absolutePath)
        : await walkProject(ctx.rootPath);

    const routeFiles = files.filter((f) =>
      /[\\/]routes[\\/].+\.php$/.test(f)
    );
    const controllerFiles = files.filter((f) =>
      /[\\/]Http[\\/]Controllers[\\/].+\.php$/.test(f)
    );
    const modelFiles = files.filter((f) =>
      /[\\/]Models[\\/].+\.php$/.test(f)
    );
    const migrationFiles = files.filter((f) =>
      /[\\/]database[\\/]migrations[\\/].+\.php$/.test(f)
    );
    const composerFile = files.find((f) => f.endsWith("composer.json"));

    const controllers: Controller[] = [];
    for (const file of controllerFiles) {
      controllers.push(await parseController(file, ctx.rootPath));
    }
    doc.controllers = controllers;

    const controllersByClassName = new Map(
      controllers.map((c) => [c.name, c])
    );

    const routes: Route[] = [];
    for (const file of routeFiles) {
      routes.push(...(await parseRoutes(file, ctx.rootPath, controllersByClassName)));
    }
    doc.routes = routes;

    const models: Model[] = [];
    for (const file of modelFiles) {
      models.push(await parseModel(file, ctx.rootPath));
    }
    doc.models = models;

    const tables: DatabaseTable[] = [];
    for (const file of migrationFiles) {
      const table = await parseMigration(file, ctx.rootPath);
      if (table) tables.push(table);
    }
    doc.database = { tables };

    if (composerFile) {
      doc.dependencies = await parseComposerDependencies(composerFile);
    }

    return doc;
  }
}

// ---------------------------------------------------------------------
// Parsing helpers (regex/line based — PoC level, see class doc comment)
// ---------------------------------------------------------------------

function relPath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
];

async function parseRoutes(
  file: string,
  root: string,
  controllersByClassName: Map<string, Controller>
): Promise<Route[]> {
  const content = await fs.readFile(file, "utf-8");
  const lines = content.split("\n");
  const routes: Route[] = [];

  // Matches: Route::get('/path', [CourseController::class, 'index']);
  // or:      Route::post('/path', [CourseController::class, 'store'])->middleware('auth');
  const routeRegex =
    /Route::(get|post|put|patch|delete|options|head)\(\s*['"]([^'"]+)['"]\s*,\s*\[?\s*([\w\\]+)::class\s*,\s*['"]([\w]+)['"]\s*\]?/gi;

  lines.forEach((line, idx) => {
    routeRegex.lastIndex = 0;
    const match = routeRegex.exec(line);
    if (!match) return;

    const [, methodRaw, routePath, controllerClass, controllerMethod] = match;
    const method = methodRaw.toUpperCase() as HttpMethod;
    if (!HTTP_METHODS.includes(method)) return;

    const middleware: string[] = [];
    const middlewareMatch = line.match(/->middleware\(([^)]+)\)/);
    if (middlewareMatch) {
      middleware.push(
        ...middlewareMatch[1]
          .split(",")
          .map((m) => m.trim().replace(/['"]/g, ""))
      );
    }

    const controller = controllersByClassName.get(controllerClass);

    routes.push({
      id: `route:${method}:${routePath}`,
      method,
      path: routePath,
      controllerId: controller?.id,
      controllerMethod,
      middleware,
      parameters: extractPathParameters(routePath),
      requiresAuth: middleware.some((m) => m.includes("auth")),
      location: { file: relPath(root, file), line: idx + 1 },
    });
  });

  return routes;
}

function extractPathParameters(routePath: string) {
  const params: { name: string; in: "path"; type?: string; required?: boolean }[] = [];
  const regex = /\{(\w+?)\??\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(routePath))) {
    params.push({
      name: m[1],
      in: "path",
      required: !routePath.includes(`{${m[1]}?}`),
    });
  }
  return params;
}

async function parseController(file: string, root: string): Promise<Controller> {
  const content = await fs.readFile(file, "utf-8");
  const nameMatch = content.match(/class\s+(\w+)/);
  const namespaceMatch = content.match(/namespace\s+([\w\\]+);/);
  const name = nameMatch ? nameMatch[1] : path.basename(file, ".php");
  const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
  const fqcn = namespace ? `${namespace}\\${name}` : name;

  const methods: Controller["methods"] = [];
  const methodRegex = /public function\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(content))) {
    if (m[1] === "__construct") continue;
    const before = content.slice(0, m.index);
    const line = before.split("\n").length;
    methods.push({
      name: m[1],
      calls: extractCalledIdentifiers(content, m.index),
      location: { file: relPath(root, file), line },
    });
  }

  const dependencies = extractConstructorDependencies(content);

  return {
    id: `controller:${fqcn}`,
    name,
    namespace,
    filePath: relPath(root, file),
    methods,
    dependencies,
    location: { file: relPath(root, file), line: 1 },
  };
}

function extractConstructorDependencies(content: string): string[] {
  const ctorMatch = content.match(/__construct\s*\(([^)]*)\)/s);
  if (!ctorMatch) return [];
  const params = ctorMatch[1];
  const typeRegex = /(?:private|protected|public)?\s*(?:readonly\s+)?([\w\\]+)\s+\$\w+/g;
  const deps: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = typeRegex.exec(params))) {
    deps.push(`service:${m[1]}`);
    deps.push(`model:${m[1]}`);
  }
  return deps;
}

function extractCalledIdentifiers(content: string, fromIndex: number): string[] {
  // Best-effort: look for `$this->somethingService->` or `Model::` usage
  // within a small window after the method signature.
  const snippet = content.slice(fromIndex, fromIndex + 800);
  const calls = new Set<string>();
  const propRegex = /\$this->(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(snippet))) {
    calls.add(m[1]);
  }
  return [...calls];
}

async function parseModel(file: string, root: string): Promise<Model> {
  const content = await fs.readFile(file, "utf-8");
  const nameMatch = content.match(/class\s+(\w+)/);
  const namespaceMatch = content.match(/namespace\s+([\w\\]+);/);
  const name = nameMatch ? nameMatch[1] : path.basename(file, ".php");
  const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
  const fqcn = namespace ? `${namespace}\\${name}` : name;

  const tableMatch = content.match(/protected\s+\$table\s*=\s*['"](\w+)['"]/);

  const fields: Model["fields"] = [];
  const fillableMatch = content.match(/\$fillable\s*=\s*\[([^\]]*)\]/s);
  if (fillableMatch) {
    const items = fillableMatch[1].match(/['"](\w+)['"]/g) ?? [];
    for (const item of items) {
      fields.push({ name: item.replace(/['"]/g, "") });
    }
  }

  const relationships: Model["relationships"] = [];
  const relRegex =
    /public function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[\w\\]+\s*)?\{\s*return\s+\$this->(hasOne|hasMany|belongsTo|belongsToMany|morphMany|morphTo)\(\s*([\w\\]+)::class/g;
  let m: RegExpExecArray | null;
  while ((m = relRegex.exec(content))) {
    relationships.push({
      type: m[2] as Model["relationships"][number]["type"],
      target: m[3],
    });
  }

  return {
    id: `model:${fqcn}`,
    name,
    namespace,
    filePath: relPath(root, file),
    table: tableMatch ? tableMatch[1] : undefined,
    fields,
    relationships,
    location: { file: relPath(root, file), line: 1 },
  };
}

async function parseMigration(
  file: string,
  root: string
): Promise<DatabaseTable | undefined> {
  const content = await fs.readFile(file, "utf-8");
  const createMatch = content.match(
    /Schema::create\(\s*['"](\w+)['"]\s*,\s*function[^{]*\{([\s\S]*?)\n\s*\}\s*\)/
  );
  if (!createMatch) return undefined;

  const [, tableName, body] = createMatch;
  const columns: DatabaseTable["columns"] = [];

  const columnRegex =
    /\$table->(\w+)\(\s*['"]?([\w]*)['"]?\s*\)([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = columnRegex.exec(body))) {
    const [, type, colName, modifiers] = m;
    if (type === "id") {
      columns.push({ name: colName || "id", type: "bigint", isPrimaryKey: true });
      continue;
    }
    if (type === "timestamps") {
      columns.push({ name: "created_at", type: "timestamp", nullable: true });
      columns.push({ name: "updated_at", type: "timestamp", nullable: true });
      continue;
    }
    if (type === "foreignId") {
      columns.push({
        name: colName,
        type: "bigint",
        isForeignKey: true,
      });
      continue;
    }
    if (!colName) continue;
    columns.push({
      name: colName,
      type,
      nullable: /->nullable\(/.test(modifiers),
    });
  }

  return {
    id: `table:${tableName}`,
    name: tableName,
    columns,
    migrationFile: relPath(root, file),
  };
}

async function parseComposerDependencies(composerFile: string) {
  const raw = await fs.readFile(composerFile, "utf-8");
  const composer = JSON.parse(raw);
  const deps = [];
  for (const [name, version] of Object.entries(composer.require ?? {})) {
    if (name === "php") continue;
    deps.push({
      name,
      version: String(version),
      type: name.startsWith("app/") ? ("internal" as const) : ("external" as const),
      ecosystem: "composer",
    });
  }
  return deps;
}
