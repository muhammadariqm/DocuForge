# DocuForge

> Automatically understand your codebase. Generate, visualize, and maintain documentation.

DocuForge analyzes your source code, builds a framework-agnostic model of your
project (**DFIR — DocuForge Intermediate Representation**), and generates
technical documentation, API references, database docs, and an architecture
diagram from it — then tells you when that documentation drifts out of sync
with the code.

```bash
docuforge generate
```

This is the **MVP v0.1** implementation: Project Detector, a full **Laravel**
scanner, the Universal Model (DFIR), the Relationship Engine, and a Markdown
generator — exactly the slice recommended in the blueprint before adding more
frameworks.

## Quick start

```bash
npm install
npm run build

# against your own Laravel project
node packages/cli/dist/index.js detect   /path/to/your/laravel/app 
node packages/cli/dist/index.js scan     /path/to/your/laravel/app 
node packages/cli/dist/index.js generate "D:\Codingan\Berita" <--- ini untuk doc.md
node packages/cli/dist/index.js validate /path/to/your/laravel/app   
# drift check, CI-friendly

# or try it against the bundled fixture project
node packages/cli/dist/index.js generate tests/fixtures/laravel
cat tests/fixtures/laravel/docs/README.md
```

`generate` writes `docs/README.md`, `ARCHITECTURE.md`, `API.md`, `ROUTES.md`,
`DATABASE.md`, `MODELS.md`, `CONTROLLERS.md`, and `DEPENDENCIES.md` into your
project, plus a cached `.docuforge/dfir.json` used for incremental scans.

## Repository layout

```
docuforge/
├── packages/
│   ├── core/        DFIR types, Scanner/Plugin interface, Relationship Engine, fs utils
│   ├── generator/    Markdown documentation generator
│   └── cli/          `docuforge` command-line tool
├── plugins/
│   └── laravel/      LaravelScanner — the first Scanner implementation (proof of concept)
├── tests/
│   └── fixtures/
│       └── laravel/  A small sample Laravel-shaped project used to validate the pipeline end-to-end
└── docs/
    └── DFIR-SPEC.md   The Universal Model specification
```

## How it fits together

```
Laravel ─┐
Express ─┤ (future)
FastAPI ─┤ (future)   ──►  Scanner.scan()  ──►  DFIR  ──►  RelationshipEngine  ──►  Markdown Generator  ──►  docs/
Django ──┘ (future)
```

Every framework plugin only has to implement three methods
(`metadata()`, `detect()`, `scan()` — see
[`packages/core/src/plugin/interface.ts`](./packages/core/src/plugin/interface.ts))
and hand back a [`DFIRDocument`](./packages/core/src/types/dfir.ts). Nothing
downstream — analysis, relationship resolution, or documentation generation —
knows anything about Laravel, Express, or any other framework. That's what
makes adding a new framework a matter of writing a new plugin, not touching
core.

## Commands

| Command | Description |
|---|---|
| `docuforge detect [path]` | Detect language/framework of a project |
| `docuforge scan [path]` | Scan the project into a DFIR document (`.docuforge/dfir.json`) |
| `docuforge generate [path]` | Scan + write Markdown docs into `./docs` |
| `docuforge validate [path]` | Compare docs against current source and report drift (exits non-zero on drift — wire into CI) |
| `docuforge serve [path]` | *(planned, milestone M7)* interactive documentation portal |

## Extending DocuForge — adding a new framework

1. Create `plugins/<name>/` with a `package.json` depending on `@docuforge/core`.
2. Implement the `Scanner` interface: `detect()` should do a cheap manifest
   check (e.g. `package.json` for an Express dependency); `scan()` should
   walk the relevant files and return a `DFIRDocument`.
3. Register it in `packages/cli/src/index.ts` (`buildRegistry()`).
4. Add a fixture project under `tests/fixtures/<name>/` mirroring what
   `tests/fixtures/laravel/` does, so the pipeline can be validated
   end-to-end without a real project.

No changes to `core`, `generator`, or the Relationship Engine should be
necessary — if they are, that's a signal the DFIR shape is missing something
and needs a version bump (see [`docs/DFIR-SPEC.md`](./docs/DFIR-SPEC.md)).

## Roadmap

This MVP covers milestones **M0–M3** from the blueprint (architecture, Laravel
scanner, relationship analysis, Markdown generator). Not yet implemented:

- **M5** — Express / FastAPI / Django scanners
- **M6** — AI layer (provider-agnostic explanations, auto-README)
- **M7** — Web UI viewer (`docuforge serve`), ERD, API explorer
- **M8** — VS Code extension
- **M9** — Deeper CI/CD integration beyond `docuforge validate`
- Incremental analysis based on file hashing (currently every `scan` is a full scan)
- Swapping the regex-based Laravel parser for a real PHP AST (e.g. tree-sitter-php)

## License

MIT — see [LICENSE](./LICENSE).
