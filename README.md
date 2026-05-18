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
aiex schema --init                      # set up .aiex/schema/ directory
aiex schema                             # generate SQLite from JSON Schema files
aiex extract -s invoice -f invoice.pdf  # extract data with AI
aiex extract -s invoice -f invoice.pdf --db  # extract and insert into database
```

<br>

## ✨ Features

- **JSON Schema → SQLite** — Define tables as JSON Schema files, generate Drizzle ORM schema, and migrate to SQLite
- **Visual Editor** — Browser-based UI for designing schemas without writing JSON by hand
- **AI Extraction** — Extract structured data from text, images, and PDFs using any OpenAI-compatible provider (OpenAI, Anthropic, Ollama, DeepSeek, local models, etc.)
- **Built-in Model Registry** — Knows capabilities of 2000+ models (vision, structured output) so you don't have to guess

<br>

## 🚀 Getting Started

### 1. Initialize

```bash
aiex schema --init
```

Creates a `.aiex/` directory with example schemas to get you started.

Add your own JSON Schema files to `.aiex/schema/` (one file per table), then run `aiex schema` to migrate them into the database.

### 2. Visual Editor

```bash
aiex web
```

Opens a browser UI where you can visually design and manage your schemas, configure AI settings, preview extraction prompts, and apply changes to the database.

### 3. Generate Database

```bash
aiex schema
```

Converts your JSON Schema files into a SQLite database with full migration support.

### 4. Extract Data

```bash
aiex extract -s <schema> -f <file>     # from file (txt, pdf, png, jpg, ...)
aiex extract -s <schema> -t <text>     # from text
aiex extract -s <schema> -f <file> -m <model>  # specify AI model (overrides auto-selection)
```

The AI reads your document and outputs structured JSON matching your schema.

**Examples:**
```bash
aiex extract -s paper -f research.pdf              # save result to .aiex/extracted/
aiex extract -s paper -f research.pdf --db         # also insert into SQLite database
aiex extract -s paper -f research.pdf -m gpt-4o    # use a specific model
```
Saves the extracted result to `.aiex/extracted/<schema-name>-<timestamp>.json` with fields like `title`, `firstAuthor`, `journal`, `year` — exactly as defined in your schema. Add `--db` to also insert the data directly into the SQLite database.

By default, aiex automatically selects a model based on your input type (vision-capable for images, structured output for text). Use `--model` / `-m` to override and specify any model from your AI configuration.

<br>

## 📖 Commands

| Command | Description |
| --- | --- |
| `aiex schema --init` | Scaffold `.aiex/` directory with example schemas |
| `aiex schema` | Parse JSON Schema files and migrate to SQLite |
| `aiex schema --generate` | Generate Drizzle schema code only (skip migration) |
| `aiex web` | Launch visual schema editor in browser |
| `aiex extract -s <name> -f <file>` | Extract structured data from documents via AI |
| `aiex extract -s <name> -f <file> --db` | Extract and insert into SQLite database |
| `aiex extract -s <name> -f <file> -m <model>` | Extract with a specific AI model |
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

<br>

## 🙏 Acknowledgments

This project includes source code adapted from [jsonschema-builder-vue](https://github.com/gcasotti/jsonschema-builder-vue) by Gabriel Casotti, used and modified under the MIT License.

The AI model capabilities registry is derived from [LiteLLM](https://github.com/BerriAI/litellm)'s `model_prices_and_context_window.json`, used under the MIT License.

<br>

## 📄 License

[MIT](./LICENSE.md) © [OSpoon](https://github.com/OSpoon)
