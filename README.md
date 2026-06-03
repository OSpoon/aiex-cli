<p align="center">
  <a href="https://www.npmjs.com/package/aiex-cli"><img src="https://img.shields.io/npm/v/aiex-cli?style=flat&colorA=18181B&colorB=green" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/aiex-cli"><img src="https://img.shields.io/npm/dm/aiex-cli?style=flat&colorA=18181B&colorB=green" alt="npm downloads"></a>
  <a href="https://github.com/OSpoon/aiex-cli/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-green?style=flat&colorA=18181B&colorB=green" alt="license"></a>
  <a href="https://codecov.io/gh/OSpoon/aiex-cli"><img src="https://img.shields.io/codecov/c/github/OSpoon/aiex-cli?style=flat&colorA=18181B&colorB=green" alt="coverage"></a>
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

- **AIEX JSON Schema → SQLite** — Define tables with a Drizzle-backed JSON Schema dialect, generate Drizzle ORM schema, and migrate to SQLite
- **Web Configuration & Viewer** — Browser-based UI for designing schemas, configuring integrations, previewing prompts, and browsing extracted data
- **AI Extraction** — Extract structured data from files (text, images, PDFs) using any OpenAI-compatible provider (OpenAI, Anthropic, Ollama, DeepSeek, local models, etc.)
- **Interactive Mode** — Run `aiex extract` without arguments for a guided extraction workflow
- **Batch Mode** — `aiex extract -d <dir>` processes entire directories with optional glob filtering
- **Incremental Extraction** — File hash deduplication skips already-processed files; use `--force` to override
- **Web Data Export** — Export SQLite table data to CSV, Excel (.xlsx), or JSON from the Web UI
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

Converts AIEX JSON Schema files into a SQLite database with full migration support. AIEX uses a Drizzle-backed schema dialect rather than the full JSON Schema specification; see [Docs/schema-dialect.md](Docs/schema-dialect.md) for the supported mapping surface.

### 3. Extract Data

```bash
aiex extract                              # interactive mode (prompts for schema & input)
aiex extract -s <schema> -f <file>        # from file (txt, pdf, png, jpg, ...)
aiex extract -s <schema> -f <file> -m <model>      # specify AI model (overrides auto-selection)
aiex extract -s <schema> -f <file> --no-insert     # extract and save JSON without inserting into SQLite
aiex extract -s <schema> -f <file> --force         # force re-extraction even if already processed
aiex extract -s <schema> -d <directory>            # batch extract all supported files in a directory
aiex extract -s <schema> -d <dir> -g "*.pdf"       # batch with glob filter
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
```
Saves the extracted result to `.aiex/extracted/<schema-name>-<timestamp>.json` with fields like `title`, `firstAuthor`, `journal`, `year` — exactly as defined in your schema. Data is automatically inserted into the SQLite database.

By default, aiex automatically selects a model based on your input type (vision-capable for images, structured output for text). Use `--model` / `-m` to override and specify any model from your AI configuration.

Every extraction is also recorded under `.aiex/extracted/_audit/`. Audit records include the run status (`running`, `succeeded`, `failed`, or `stale`), schema name, input source, output file, token usage, inserted table rows, synced Notion pages, retry lineage, and error message. Use the Web UI to inspect, retry, or delete extraction records.

### 4. Watch Folder Daemon (Auto-Extraction)

```bash
aiex watch
aiex watch -s <schema> -d <folder>
```

Runs a background watcher daemon to monitor a folder for new incoming files (such as scanned documents or downloads), automatically performing offline data extraction, database insertion, and system notifications. Run without arguments to choose a schema, watch directory, model, and insert mode interactively.

## 📖 Commands

| Command | Description |
| --- | --- |
| `aiex schema` | Parse JSON Schema files and migrate to SQLite |
| `aiex schema --generate` | Generate Drizzle schema code only (skip migration) |
| `aiex schema --force` | Allow a high-risk schema migration after reviewing the migration risk report |
| `aiex web` | Launch visual schema/configuration UI and data viewer in browser |
| `aiex extract` | Interactive mode — prompts for schema and file/directory input |
| `aiex extract -s <name> -f <file>` | Extract structured data from a file and insert into SQLite database |
| `aiex extract -s <name> -f <file> -m <model>` | Extract with a specific AI model |
| `aiex extract -s <name> -f <file> --no-insert` | Extract and save JSON without inserting into SQLite |
| `aiex extract -s <name> -f <file> --force` | Force re-extraction even if the file has already been processed |
| `aiex extract -s <name> -d <dir>` | Batch extract all supported files in a directory |
| `aiex extract -s <name> -d <dir> -g "*.pdf"` | Batch extract with glob filter |
| `aiex watch` | Guided setup for watching a directory and automatically extracting new files |
| `aiex watch -s <name> -d <dir>` | Watch a directory for new files and automatically extract data |
| `aiex watch -s <name> -d <dir> --no-insert` | Watch and save JSON without inserting into SQLite |
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

* **Zsh (Oh My Zsh - Recommended):**
  If you use Oh My Zsh, you can save the completion script directly to the custom completions folder without modifying `~/.zshrc`:
  ```bash
  mkdir -p ~/.oh-my-zsh/custom/completions
  aiex completion zsh > ~/.oh-my-zsh/custom/completions/_aiex
  source ~/.zshrc
  ```

* **Zsh (Standard):**
  Write to a directory in your `$fpath` (e.g., `~/.zsh/completions`):
  ```bash
  mkdir -p ~/.zsh/completions
  aiex completion zsh > ~/.zsh/completions/_aiex
  ```
  Then add the following lines to your `~/.zshrc` (before `compinit`):
  ```bash
  fpath=(~/.zsh/completions $fpath)
  autoload -Uz compinit && compinit
  ```

* **Bash:**
  Write to the system completions directory:
  ```bash
  aiex completion bash > /etc/bash_completion.d/aiex
  ```
  Or for user-level (no sudo):
  ```bash
  mkdir -p ~/.local/share/bash-completion/completions
  aiex completion bash > ~/.local/share/bash-completion/completions/aiex
  ```

* **Fish:**
  Write to the fish completions directory:
  ```bash
  aiex completion fish > ~/.config/fish/completions/aiex.fish
  ```

> Pre-built completion files are also available in the installed package at `node_modules/aiex-cli/dist/completions/`, so Homebrew formulae, oh-my-zsh plugins, and other package managers can reference them directly without running `aiex completion`.

<br>

## 🔧 AI Configuration

aiex works with any OpenAI-compatible API provider. Configure in the Web UI (AI Settings panel):

- **Provider** — Set your base URL and API key
- **Models** — Add models with vision and/or structured output capabilities
- **Documents** — Choose a PDF converter (`unpdf`, `mineru`, `mineru_api`, or `external`); image input automatically uses a vision model when available, otherwise system OCR on supported platforms
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
