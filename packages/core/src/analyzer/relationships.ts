import type { DFIRDocument, Relationship } from "../types/dfir.js";

/**
 * Walks a DFIR document and materializes the chain described in
 * blueprint section 10:
 *
 *   Route -> Controller -> Service -> Model -> Database table
 *
 * This is intentionally framework-agnostic: it only looks at ids the
 * scanner already assigned (controllerId, dependencies, table, etc.),
 * never at framework-specific naming conventions. It's additive: any
 * relationships a scanner already produced are kept, duplicates are
 * dropped.
 */
export function buildRelationships(doc: DFIRDocument): Relationship[] {
  const relationships: Relationship[] = [...doc.relationships];
  const seen = new Set(relationships.map(edgeKey));

  const push = (rel: Relationship) => {
    const key = edgeKey(rel);
    if (!seen.has(key)) {
      seen.add(key);
      relationships.push(rel);
    }
  };

  const modelsByName = new Map(doc.models.map((m) => [m.name, m]));
  const tablesByName = new Map(doc.database.tables.map((t) => [t.name, t]));
  const servicesById = new Map(doc.services.map((s) => [s.id, s]));

  // Route -> Controller
  for (const route of doc.routes) {
    if (route.controllerId) {
      push({ from: route.id, to: route.controllerId, kind: "route->controller" });
    }
  }

  // Controller -> Service (via declared dependencies)
  for (const controller of doc.controllers) {
    for (const depId of controller.dependencies) {
      if (servicesById.has(depId)) {
        push({ from: controller.id, to: depId, kind: "controller->service" });
      }
    }
  }

  // Service -> Model (via declared dependencies that match a model id)
  const modelsById = new Map(doc.models.map((m) => [m.id, m]));
  for (const service of doc.services) {
    for (const depId of service.dependencies) {
      if (modelsById.has(depId)) {
        push({ from: service.id, to: depId, kind: "service->model" });
      }
    }
  }

  // Controller -> Model directly, when there's no intermediate service
  // dependency but the controller depends on something matching a model id.
  for (const controller of doc.controllers) {
    for (const depId of controller.dependencies) {
      if (modelsById.has(depId)) {
        push({ from: controller.id, to: depId, kind: "controller->service" });
      }
    }
  }

  // Model -> Table
  for (const model of doc.models) {
    const tableName = model.table ?? guessTableName(model.name);
    const table = tablesByName.get(tableName);
    if (table) {
      push({ from: model.id, to: table.id, kind: "model->table" });
    }
  }

  // Model -> Model (via relationships like hasMany/belongsTo)
  for (const model of doc.models) {
    for (const rel of model.relationships) {
      const target = modelsByName.get(rel.target);
      if (target) {
        push({ from: model.id, to: target.id, kind: "model->model" });
      }
    }
  }

  return relationships;
}

function edgeKey(rel: Relationship): string {
  return `${rel.from}::${rel.to}::${rel.kind}`;
}

/** Best-effort Laravel-style snake_case plural table name guess, used
 * only as a fallback when a model doesn't declare `table` explicitly. */
function guessTableName(modelName: string): string {
  const snake = modelName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return snake.endsWith("s") ? snake : `${snake}s`;
}
