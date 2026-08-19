# DFIR — DocuForge Intermediate Representation

**Version: 0.1**

DFIR is the framework-agnostic model every scanner plugin must produce and
every analyzer/generator must consume. It lives in code at
[`packages/core/src/types/dfir.ts`](../packages/core/src/types/dfir.ts) — this
document is the human-readable companion to that file, not a replacement for
it. If the two ever disagree, the TypeScript types win.

## Why a shared model

```
Laravel ───┐
Express ───┤
Django ────┤──→ DFIR ──→ Documentation
FastAPI ───┤
Spring ────┘
```

Without DFIR, we'd need N generators for N frameworks. With it, we need one
generator, one relationship engine, and N small scanners — each of which only
has to know how to translate *its own* framework's conventions into the
shared shape.

## Top-level shape

```ts
DFIRDocument {
  dfirVersion: "0.1"
  generatedAt: string        // ISO timestamp
  project: ProjectMeta
  routes: Route[]
  controllers: Controller[]
  services: Service[]
  models: Model[]
  database: { tables: DatabaseTable[] }
  dependencies: Dependency[]
  relationships: Relationship[]   // filled in by the Relationship Engine
  drift?: DriftIssue[]
}
```

## Design rules

1. **Never invent data.** If a scanner cannot determine a field (e.g. no
   `$table` property on a Laravel model), omit it or leave the array empty.
   Downstream generators must handle absence gracefully — DocuForge would
   rather under-document than hallucinate a wrong API shape.

2. **Stable, prefixed ids.** Every referenceable node has an `id` of the form
   `<kind>:<canonical-name>`, e.g. `controller:App\Http\Controllers\CourseController`,
   `table:courses`, `route:POST:/api/courses`. This lets the Relationship
   Engine link a `Route.controllerId` to a `Controller.id` without any
   framework-specific knowledge.

3. **Scanners produce raw structure; the Relationship Engine produces edges.**
   A scanner may optionally pre-populate `relationships`, but the chain
   described in the blueprint —
   `Route → Controller → Service → Model → Table` — is primarily built by
   [`buildRelationships()`](../packages/core/src/analyzer/relationships.ts)
   from ids the scanner already assigned. Keep scanners dumb; keep the engine
   smart.

4. **Every node keeps a `SourceLocation`.** `{ file, line? }` at minimum, so
   the (future) VS Code extension and Web UI can jump to source, and so
   Documentation Drift Detection can point at a specific place.

5. **Additive versioning.** A `0.1 → 0.2` bump should only *add* optional
   fields. Anything that requires generators to change how they read
   *existing* fields is a breaking change and needs a major bump plus a
   migration note here.

## Extending DFIR

Adding support for a new framework concept (e.g. GraphQL resolvers, queue
jobs, event listeners) that doesn't fit `routes`/`controllers`/`models` should
be proposed as a new **optional** top-level array (e.g. `jobs?: Job[]`) rather
than overloading an existing type — keeps every existing scanner/generator
compiling unchanged.
