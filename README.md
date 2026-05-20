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
aiex web                                # configure schemas/AI/Notion and inspect data in the browser
aiex schema                             # generate SQLite from JSON Schema files
aiex extract -s invoice -f invoice.pdf  # extract data with AI and insert into database
```

<br>

## ✨ Features

- **JSON Schema → SQLite** — Define tables as JSON Schema files, generate Drizzle ORM schema, and migrate to SQLite
- **Web Configuration & Viewer** — Browser-based UI for designing schemas, configuring AI/Notion, previewing prompts, and browsing extracted data
- **AI Extraction** — Extract structured data from text, images, and PDFs using any OpenAI-compatible provider (OpenAI, Anthropic, Ollama, DeepSeek, local models, etc.)
- **Interactive Mode** — Run `aiex extract` without arguments for a guided extraction workflow
- **Batch Mode** — `aiex extract -d <dir>` processes entire directories with optional glob filtering
- **Notion Sync** — Map each JSON Schema to a Notion data source and automatically sync extracted results after CLI extraction
- **Extraction Audit Trail** — Every extraction is recorded with status, input source, output path, token usage, database inserts, Notion pages, and errors
- **Built-in Model Registry** — Knows capabilities of 2000+ models (vision, structured output) so you don't have to guess

<br>

## 🚀 Getting Started

### 1. Configure In Web UI

```bash
aiex web
```

Opens a browser UI where you can visually design and manage your schemas, configure AI and Notion settings, preview extraction prompts, browse inserted SQLite data, inspect extracted JSON files, and apply schema changes to the database. Extraction itself runs from the CLI.

### 2. Generate Database

```bash
aiex schema
```

Converts your JSON Schema files into a SQLite database with full migration support.

### 3. Extract Data

```bash
aiex extract                              # interactive mode (prompts for schema & input)
aiex extract -s <schema> -f <file>        # from file (txt, pdf, png, jpg, ...)
aiex extract -s <schema> -t <text>        # from text
aiex extract -s <schema> -f <file> -m <model>     # specify AI model (overrides auto-selection)
aiex extract -s <schema> -f <file> --no-insert    # extract and save JSON without inserting into SQLite
aiex extract -s <schema> -d <directory>           # batch extract all supported files in a directory
aiex extract -s <schema> -d <dir> -g "*.pdf"      # batch with glob filter
aiex extract history                              # list extraction audit records
aiex extract show <audit-id>                      # show full audit record JSON
aiex extract retry <audit-id>                     # retry a previous extraction
aiex extract rm <audit-id>                        # delete an audit record and cached upload
```

The AI reads your document and outputs structured JSON matching your schema.

**Examples:**
```bash
aiex extract                                      # interactive mode
aiex extract -s paper -f research.pdf              # save result to .aiex/extracted/ and insert into database
aiex extract -s paper -f research.pdf --no-insert   # save result only, skip database insert
aiex extract -s paper -f research.pdf -m gpt-4o    # use a specific model
aiex extract -s paper -d ./papers -g "*.pdf"        # batch extract PDFs from a directory
aiex extract history                                # inspect recent extraction runs
```
Saves the extracted result to `.aiex/extracted/<schema-name>-<timestamp>.json` with fields like `title`, `firstAuthor`, `journal`, `year` — exactly as defined in your schema. Data is automatically inserted into the SQLite database.

By default, aiex automatically selects a model based on your input type (vision-capable for images, structured output for text). Use `--model` / `-m` to override and specify any model from your AI configuration.

Every extraction is also recorded under `.aiex/extracted/_audit/`. Audit records include the run status (`running`, `succeeded`, `failed`, or `stale`), schema name, input source, output file, token usage, inserted table rows, synced Notion pages, retry lineage, and error message. Deleting an audit record removes its cached upload, but keeps extracted JSON result files to avoid accidental data loss.

<br>

## 📖 Commands

| Command | Description |
| --- | --- |
| `aiex schema` | Parse JSON Schema files and migrate to SQLite |
| `aiex schema --generate` | Generate Drizzle schema code only (skip migration) |
| `aiex web` | Launch visual schema/configuration UI and data viewer in browser |
| `aiex extract` | Interactive mode — prompts for schema and input source |
| `aiex extract -s <name> -f <file>` | Extract structured data from documents and insert into SQLite database |
| `aiex extract -s <name> -f <file> -m <model>` | Extract with a specific AI model |
| `aiex extract -s <name> -f <file> --no-insert` | Extract and save JSON without inserting into SQLite |
| `aiex extract -s <name> -d <dir>` | Batch extract all supported files in a directory |
| `aiex extract -s <name> -d <dir> -g "*.pdf"` | Batch extract with glob filter |
| `aiex extract history` | List extraction audit records |
| `aiex extract show <audit-id>` | Show a full extraction audit record |
| `aiex extract retry <audit-id>` | Retry a previous extraction run |
| `aiex extract retry <audit-id> --no-insert` | Retry without inserting into SQLite |
| `aiex extract rm <audit-id>` | Delete an audit record and its cached upload |
| `aiex doctor` | System and configuration diagnostics |
| `aiex completion bash\|zsh\|fish` | Generate shell completion scripts |

### Shell Completions

Enable tab completion for commands and options:

```bash
# bash
source <(aiex completion bash)

# zsh
source <(aiex completion zsh)

# fish
aiex completion fish | source
```

To make it permanent, add the `source` line to your shell config file (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`).

> Completions are dynamically generated from the command definitions — no manual updates needed when commands or options change.

<br>

## 🔧 AI Configuration

aiex works with any OpenAI-compatible API provider. Configure in the Web UI (AI Settings panel):

- **Provider** — Set your base URL and API key
- **Models** — Add models with vision and/or structured output capabilities
- **Prompts** — Customize system and user prompt templates with `{schema}` and `{text}` placeholders

The built-in model registry automatically suggests capabilities for 2000+ models from providers including OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Alibaba Cloud, and more.

### Notion Sync

aiex can sync extracted CLI results to Notion after extraction succeeds. When SQLite insertion is enabled, Notion sync runs after the database insert succeeds.

Configure it in Web UI → AI Settings → Notion Export:

- **Enabled** — Turn on Notion export and enter a Notion integration token
- **Schema Binding** — Select a JSON Schema and bind it to one Notion data source
- **Database/Data Source URL or ID** — Paste a Notion database or data source URL/ID; aiex resolves database links to their first data source
- **Test & Auto Map** — Optional but recommended for first-time setup; verifies access, resolves the data source ID, reads Notion properties, and fills matching field mappings
- **Field Map JSON** — Maps extracted top-level JSON fields to Notion property names, for example `{ "reportNumber": "reportNumber" }`

Once enabled and saved, `aiex extract` automatically syncs results for schemas that have a Notion binding. No extra CLI flag is required. Notion sync uses the current Notion data source API and writes pages with `parent.data_source_id`.

Nested schema fields are not flattened for Notion yet. The current mapping behavior is top-level fields only.

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
