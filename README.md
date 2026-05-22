<p align="center">
  <a href="https://www.npmjs.com/package/aiex-cli"><img src="https://img.shields.io/npm/v/aiex-cli?style=flat&colorA=18181B&colorB=green" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/aiex-cli"><img src="https://img.shields.io/npm/dm/aiex-cli?style=flat&colorA=18181B&colorB=green" alt="npm downloads"></a>
  <a href="https://github.com/OSpoon/aiex-cli/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-green?style=flat&colorA=18181B&colorB=green" alt="license"></a>
</p>

<h1 align="center">AIEX</h1>

<p align="center">
  <b>JSON Schema → SQLite — with AI-powered data extraction</b>
</p>

<p align="center">
  Define your data structure once. Generate a database. Extract documents into it.
</p>

<br>

```bash
npm install -g aiex-cli
```

```bash
aiex web                                # configure schemas, AI, integrations, and inspect data
aiex schema                             # generate SQLite from JSON Schema files
aiex extract -s invoice -f invoice.pdf  # extract data with AI and insert into database
aiex watch -s invoice -d ./watch_folder # watch folder daemon for automatic extraction
```

<br>

## ✨ Features

- **JSON Schema → SQLite** — Define tables as JSON Schema files, generate Drizzle ORM schema, and migrate to SQLite
- **Web Configuration & Viewer** — Browser-based UI for designing schemas, configuring integrations, previewing prompts, and browsing extracted data
- **AI Extraction** — Extract structured data from files (text, images, PDFs) using any OpenAI-compatible provider (OpenAI, Anthropic, Ollama, DeepSeek, local models, etc.)
- **Interactive Mode** — Run `aiex extract` without arguments for a guided extraction workflow
- **Batch Mode** — `aiex extract -d <dir>` processes entire directories with optional glob filtering
- **Incremental Extraction** — File hash deduplication skips already-processed files; use `--force` to override
- **Data Dump** — `aiex dump` exports SQLite tables to CSV or Excel (.xlsx)
- **Notion Sync** — Optionally sync CLI extraction results to configured Notion data sources
- **Extraction Audit Trail** — Every extraction is recorded with status, input source, output path, token usage, database inserts, Notion pages, and errors
- **Built-in Model Registry** — Knows capabilities of 2000+ models (vision, structured output) so you don't have to guess

<br>

## 🚀 Getting Started

### 1. Configure In Web UI

```bash
aiex web
```

Opens a browser UI where you can visually design and manage your schemas, configure AI and integrations, preview extraction prompts, browse inserted SQLite data, inspect extracted JSON files, and apply schema changes to the database. Extraction itself runs from the CLI.

### 2. Generate Database

```bash
aiex schema
```

Converts your JSON Schema files into a SQLite database with full migration support.

### 3. Extract Data

```bash
aiex extract                              # interactive mode (prompts for schema & input)
aiex extract -s <schema> -f <file>        # from file (txt, pdf, png, jpg, ...)
aiex extract -s <schema> -f <file> -m <model>      # specify AI model (overrides auto-selection)
aiex extract -s <schema> -f <file> --no-insert     # extract and save JSON without inserting into SQLite
aiex extract -s <schema> -f <file> --force         # force re-extraction even if already processed
aiex extract -s <schema> -d <directory>            # batch extract all supported files in a directory
aiex extract -s <schema> -d <dir> -g "*.pdf"       # batch with glob filter
aiex extract history                               # list extraction audit records
aiex extract show <audit-id>                       # show full audit record JSON
aiex extract retry <audit-id>                      # retry a previous extraction
aiex extract rm <audit-id>                         # delete an audit record and cached upload
```

The AI reads your document and outputs structured JSON matching your schema.

**Examples:**
```bash
aiex extract                                       # interactive mode
aiex extract -s paper -f research.pdf              # save result to .aiex/extracted/ and insert into database
aiex extract -s paper -f research.pdf --no-insert  # save result only, skip database insert
aiex extract -s paper -f research.pdf -m gpt-4o    # use a specific model
aiex extract -s paper -f research.pdf --force      # force re-extraction even if already processed
aiex extract -s paper -d ./papers -g "*.pdf"       # batch extract PDFs from a directory
aiex extract history                               # inspect recent extraction runs
```
Saves the extracted result to `.aiex/extracted/<schema-name>-<timestamp>.json` with fields like `title`, `firstAuthor`, `journal`, `year` — exactly as defined in your schema. Data is automatically inserted into the SQLite database.

By default, aiex automatically selects a model based on your input type (vision-capable for images, structured output for text). Use `--model` / `-m` to override and specify any model from your AI configuration.

Every extraction is also recorded under `.aiex/extracted/_audit/`. Audit records include the run status (`running`, `succeeded`, `failed`, or `stale`), schema name, input source, output file, token usage, inserted table rows, synced Notion pages, retry lineage, and error message. Deleting an audit record removes its cached upload, but keeps extracted JSON result files to avoid accidental data loss.

### 4. Watch Folder Daemon (Auto-Extraction)

```bash
aiex watch -s <schema> -d <folder>
```

Runs a background watcher daemon to monitor a folder for new incoming files (such as scanned documents or downloads), automatically performing offline data extraction, database insertion, and system notifications.

### 5. Dump Data

```bash
aiex dump -s <schema>                          # dump to CSV (default)
aiex dump -s <schema> -f xlsx -o output.xlsx   # dump to Excel
aiex dump -t <table> -f csv -o output.csv      # dump a specific table by name
```

Dumps all extracted data for a given schema (or table) from the SQLite database to CSV or Excel format.

<br>

## 📖 Commands

| Command | Description |
| --- | --- |
| `aiex schema` | Parse JSON Schema files and migrate to SQLite |
| `aiex schema --generate` | Generate Drizzle schema code only (skip migration) |
| `aiex web` | Launch visual schema/configuration UI and data viewer in browser |
| `aiex extract` | Interactive mode — prompts for schema and file/directory input |
| `aiex extract -s <name> -f <file>` | Extract structured data from a file and insert into SQLite database |
| `aiex extract -s <name> -f <file> -m <model>` | Extract with a specific AI model |
| `aiex extract -s <name> -f <file> --no-insert` | Extract and save JSON without inserting into SQLite |
| `aiex extract -s <name> -f <file> --force` | Force re-extraction even if the file has already been processed |
| `aiex extract -s <name> -d <dir>` | Batch extract all supported files in a directory |
| `aiex extract -s <name> -d <dir> -g "*.pdf"` | Batch extract with glob filter |
| `aiex extract history` | List extraction audit records |
| `aiex extract show <audit-id>` | Show a full extraction audit record |
| `aiex extract retry <audit-id>` | Retry a previous extraction run |
| `aiex extract retry <audit-id> --no-insert` | Retry without inserting into SQLite |
| `aiex extract rm <audit-id>` | Delete an audit record and its cached upload |
| `aiex watch -s <name> -d <dir>` | Watch a directory for new files and automatically extract data |
| `aiex watch -s <name> -d <dir> --no-insert` | Watch and save JSON without inserting into SQLite |
| `aiex dump -s <name>` | Dump extracted data for a schema to CSV |
| `aiex dump -s <name> -f xlsx -o <file>` | Dump to Excel (.xlsx) |
| `aiex doctor` | System and configuration diagnostics |
| `aiex completion bash\|zsh\|fish` | Generate shell completion scripts |

### Shell Completions

Each release ships pre-generated completion files in `dist/completions/`. You can use either the dynamic method or install them permanently.

**Dynamic (session only):**

```bash
# bash
source <(aiex completion bash)

# zsh
source <(aiex completion zsh)

# fish
aiex completion fish | source
```

**Permanent install (recommended):**

```bash
# bash — write to system completions directory
aiex completion bash > /etc/bash_completion.d/aiex
# or for user-level (no sudo):
mkdir -p ~/.local/share/bash-completion/completions
aiex completion bash > ~/.local/share/bash-completion/completions/aiex

# zsh — write to a directory in $fpath
aiex completion zsh > "${fpath[1]}/_aiex"
# or use the pre-built file from the package:
# $(npm root -g)/aiex-cli/dist/completions/aiex.zsh

# fish — write to fish completions directory
aiex completion fish > ~/.config/fish/completions/aiex.fish
```

> Pre-built completion files are also available in the installed package at `node_modules/aiex-cli/dist/completions/`, so Homebrew formulae, oh-my-zsh plugins, and other package managers can reference them directly without running `aiex completion`.

<br>

## 🔧 AI Configuration

aiex works with any OpenAI-compatible API provider. Configure in the Web UI (AI Settings panel):

- **Provider** — Set your base URL and API key
- **Models** — Add models with vision and/or structured output capabilities
- **Prompts** — Customize system and user prompt templates with `{schema}` and `{text}` placeholders
- **Integrations** — Optionally connect Notion from AI Settings; use Connect & Map to bind a schema to an existing Notion data source

The built-in model registry automatically suggests capabilities for 2000+ models from providers including OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Alibaba Cloud, and more.

### Langfuse Tracing

aiex can send AI model interaction traces to [Langfuse](https://langfuse.com) for monitoring and debugging.

- **Enable** — In Web UI → AI Settings → Langfuse Tracing, toggle on and enter your Langfuse Secret Key / Public Key
- **Self-hosted** — Optionally set a custom Host URL; defaults to `https://us.cloud.langfuse.com`
- **No impact when disabled** — No tracing is sent if keys are left empty
- **Non-blocking** — Misconfigured keys will not affect extraction

Once enabled, every `aiex extract` call is automatically traced with full request/response payloads, token usage, and latency.

<br>

## 🙏 Acknowledgments

This project includes source code adapted from [jsonschema-builder-vue](https://github.com/gcasotti/jsonschema-builder-vue) by Gabriel Casotti, used and modified under the MIT License.

The AI model capabilities registry is derived from [LiteLLM](https://github.com/BerriAI/litellm)'s `model_prices_and_context_window.json`, used under the MIT License.

<br>

## 📄 License

[MIT](./LICENSE.md) © [OSpoon](https://github.com/OSpoon)
