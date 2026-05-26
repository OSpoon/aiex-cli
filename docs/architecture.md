# System Architecture

This document describes the high-level architecture, monorepo structure, and data flows of the `aiex` workspace.

---

## 1. Monorepo Project Structure

`aiex` is structured as a pnpm monorepo containing the CLI application and the Web Console:

```
aiex-cli (Root)
├── app
│   ├── cli/            # TypeScript Node.js CLI & backend server (aiex-cli)
│   └── web/            # Vue 3 visual schema editor & data browser (aiex-web)
├── docs/               # Architecture & system documentation
├── playground/         # Local workspace for debugging migrations and AI extractions
├── package.json        # Workspace configuration and scripts
└── pnpm-workspace.yaml # Package workspace catalog configuration
```

### Module Relations
- **`app/cli`**: Serves as the database engine, AI extraction runner, and hosts a local Hono API server.
- **`app/web`**: Interacts with the Hono API server hosted by the CLI to modify schemas, save settings, and view tables. When compiled, the static assets of `app/web` are embedded and served directly by the CLI's server.

---

## 2. High-Level Architecture Layers

The CLI is structured into three main layers:

```
┌────────────────────────────────────────────────────────┐
│                        CLI Layer                       │
│      (citty commands: extract, schema, watch, web)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                       Server Layer                     │
│        (Hono API Server: schema, AI config, data)      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                        Core Layer                      │
│   (schema-sqlite, ai-extraction, pdf-converter, notion)│
└────────────────────────────────────────────────────────┘
```

### 1. CLI Layer (`src/commands/`)
Powered by `citty`, it defines command entry points, registers flags, and configures interactive prompts using `@clack/prompts`.
* Key commands: `extract`, `schema`, `watch`, `web`, `dump`, `doctor`.

### 2. Server Layer (`src/server/`)
Hosts a local Hono HTTP server. It serves two purposes:
1. Exposes JSON APIs for schema CRUD, database table browsing, and config updates.
2. Serves the precompiled Vue SPA from `app/web/dist` when the user runs `aiex web`.

### 3. Core Layer (`src/core/`)
Implements the business logic divided into separate domain modules:
* `schema-sqlite`: Handles JSON Schema validation, conversion to Drizzle models, and migration execution.
* `ai-extraction`: Coordinates LLM calls, context stacking, sequential splitting, and ReAct agent tool executions.
* `pdf-converter`: Converts files to Markdown (via unpdf, mineru, markitdown, etc.) and native OCR.
* `integration`: Dispatches extracted payloads to Notion databases and HTTP webhooks.

---

## 3. High-Level Operational Flows

### Flow A: Schema Design & Database Sync
1. Developer runs `aiex web` to open the Web Console.
2. Web Console saves JSON Schema definitions to `.aiex/schema/`.
3. User runs `aiex schema` on the command line.
4. The migration engine parses files in `.aiex/schema/`, compiles them into Drizzle typescript code, writes them to `.aiex/drizzle/`, and executes a SQLite schema migration against `.aiex/database.db`.

### Flow B: Audited Document Extraction
1. User runs `aiex extract -s <schema> -f <file>`.
2. Core checks if the file hash has already been processed successfully in the audit trail.
3. If not processed (or `--force` is set), the PDF converter parses the document into Markdown text.
4. The extraction pipeline splits the text (if too long) or runs the ReAct agent.
5. The extracted structured JSON is validated against the JSON Schema.
6. The valid JSON is written to `.aiex/extracted/`.
7. The extracted fields are inserted into the SQLite database.
8. If configured, the payload is synchronized to Notion and webhooks are fired.
9. The run is logged in the local audit database.
