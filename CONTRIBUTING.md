# Contributing to DocuForge

## Adding a new framework plugin

See the "Extending DocuForge" section in the root README. In short:
`plugins/<name>/` implements the `Scanner` interface from `@docuforge/core`
and never needs to touch `core`, `generator`, or the relationship engine.

## Development

```bash
npm install
npm run build
node packages/cli/dist/index.js generate tests/fixtures/laravel
```

## Adding a fixture project

Every plugin should ship a small hand-written fixture under
`tests/fixtures/<framework>/` (a handful of routes, one controller, one or two
models, one or two migrations is enough) so `docuforge generate` can be run
against it as an end-to-end smoke test without needing a real, large project.

## Principles (see blueprint)

1. Code is the source of truth.
2. Core stays framework-agnostic — framework knowledge lives only in plugins.
3. Local-first — no feature in the MVP requires network access.
4. AI is optional, never a requirement.
5. New frameworks are added via plugins, not core changes.
