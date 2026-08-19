/**
 * DocuForge Intermediate Representation (DFIR) — v0.1
 *
 * This is the framework-agnostic "universal model" described in the
 * DocuForge blueprint (section 8). Every language/framework scanner
 * (Laravel, Express, FastAPI, Django, Spring, ...) must produce a
 * document that conforms to this shape. Every analyzer and generator
 * consumes ONLY this shape — never framework-specific structures.
 *
 * Design goals:
 * - Framework A produces the same DFIR shape as Framework B.
 * - Fields that a scanner cannot determine are simply omitted / left
 *   as empty arrays, never invented.
 * - Every node that can be the target of a relationship carries a
 *   stable `id` so the RelationshipEngine can link across sections
 *   (route -> controller -> service -> model -> table) without
 *   re-parsing source.
 */

export type DFIRVersion = "0.1";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/** Where in the source a piece of information came from. Used for
 * traceability, "jump to source" in the Web UI/VS Code extension, and
 * for Documentation Drift Detection (section 26). */
export interface SourceLocation {
  file: string; // path relative to project root
  line?: number;
  column?: number;
}

export interface ProjectMeta {
  name: string;
  language: string; // "PHP" | "JavaScript" | "TypeScript" | "Python" | ...
  framework?: string; // "Laravel" | "Express" | "FastAPI" | ...
  frameworkVersion?: string;
  languageVersion?: string;
  packageManager?: string; // "composer" | "npm" | "pip" | ...
  rootPath: string;
}

export interface RouteParameter {
  name: string;
  in: "path" | "query" | "body" | "header";
  type?: string;
  required?: boolean;
  description?: string;
}

export interface Route {
  id: string; // stable id, e.g. "route:POST:/api/courses"
  method: HttpMethod;
  path: string;
  name?: string; // named route, if the framework supports it
  controllerId?: string; // -> Controller.id
  controllerMethod?: string; // method name invoked on the controller
  middleware: string[];
  parameters: RouteParameter[];
  requiresAuth?: boolean;
  location: SourceLocation;
}

export interface ControllerMethod {
  name: string;
  httpMethod?: HttpMethod;
  calls: string[]; // ids of services/models this method references
  location: SourceLocation;
}

export interface Controller {
  id: string; // stable id, e.g. "controller:App\\Http\\Controllers\\CourseController"
  name: string;
  namespace?: string;
  filePath: string;
  methods: ControllerMethod[];
  dependencies: string[]; // ids of injected services/repositories
  location: SourceLocation;
}

export interface Service {
  id: string;
  name: string;
  namespace?: string;
  filePath: string;
  methods: string[];
  dependencies: string[];
  location: SourceLocation;
}

export interface ModelField {
  name: string;
  type?: string;
  nullable?: boolean;
  default?: string;
}

export interface ModelRelationship {
  type: "hasOne" | "hasMany" | "belongsTo" | "belongsToMany" | "morphMany" | "morphTo" | "unknown";
  target: string; // related model name (best-effort, resolved to id.later by RelationshipEngine)
  foreignKey?: string;
}

export interface Model {
  id: string; // stable id, e.g. "model:App\\Models\\Course"
  name: string;
  namespace?: string;
  filePath: string;
  table?: string;
  fields: ModelField[];
  relationships: ModelRelationship[];
  location: SourceLocation;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  references?: { table: string; column: string };
}

export interface DatabaseTable {
  id: string; // stable id, e.g. "table:courses"
  name: string;
  columns: DatabaseColumn[];
  indexes?: string[];
  migrationFile?: string;
  location?: SourceLocation;
}

export interface DatabaseSchema {
  tables: DatabaseTable[];
}

export interface Dependency {
  name: string;
  version?: string;
  type: "internal" | "external";
  ecosystem?: string; // "composer" | "npm" | "pip" | ...
}

/** A generic, already-resolved edge in the architecture graph. Produced
 * by the RelationshipEngine (section 10), not by scanners directly. */
export interface Relationship {
  from: string; // node id
  to: string; // node id
  kind: "route->controller" | "controller->service" | "service->model" | "model->table" | "model->model" | "other";
}

export interface DriftIssue {
  type: "missing-route" | "missing-doc" | "signature-mismatch" | "stale-description";
  message: string;
  location?: SourceLocation;
}

/**
 * The root DFIR document. This is what every Scanner.scan() call must
 * eventually produce (directly, or merged from multiple partial scans
 * during incremental analysis — see section 19).
 */
export interface DFIRDocument {
  dfirVersion: DFIRVersion;
  generatedAt: string; // ISO timestamp
  project: ProjectMeta;
  routes: Route[];
  controllers: Controller[];
  services: Service[];
  models: Model[];
  database: DatabaseSchema;
  dependencies: Dependency[];
  relationships: Relationship[];
  drift?: DriftIssue[];
}

/** Convenience factory so scanners don't have to hand-roll an empty
 * skeleton with every field spelled out. */
export function createEmptyDFIR(project: ProjectMeta): DFIRDocument {
  return {
    dfirVersion: "0.1",
    generatedAt: new Date().toISOString(),
    project,
    routes: [],
    controllers: [],
    services: [],
    models: [],
    database: { tables: [] },
    dependencies: [],
    relationships: [],
  };
}
