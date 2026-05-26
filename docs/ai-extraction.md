# AI Extraction Engine

The `aiex` core extraction engine coordinates LLM communication to pull clean, schema-conforming JSON objects out of unstructured text. This document details model registry lookup, pipeline slicing and merging, the ReAct agent flow, and self-reflection error correction.

---

## 1. Model Selection & Capabilities Registry

Before making an API call, `aiex` determines the best model from the user's provider list.

- **Registry Lookup**: Under `src/core/ai-extraction/capabilities.ts`, `aiex` contains a local lookup mapping for 2000+ models. It tracks:
  - `vision`: Does the model support image payloads?
  - `structuredOutput`: Does the model support strict JSON Schema response modes?
  - `maxTokens` / `maxOutputTokens`: Context window boundaries.
- **Auto-Selection logic**:
  - If the input is an image, it filters for vision-capable models.
  - If the input is text, it prioritizes structured output models.
  - It filters out models whose context windows are too small for the computed token count of the document.

---

## 2. Pipeline Mode (Sequential Chunking & Merging)

Used for files exceeding `40,000` characters to prevent context window clipping.

### A. Slicing with Heading Metadata Context
Slicing is handled by `splitMarkdown` in [text-splitter.ts](file:///Users/osp/Documents/GitHub/aiex-cli/app/cli/src/core/ai-extraction/text-splitter.ts):
1. **Title Slicing**: Splits the document logically at Markdown headings (`#`, `##`, etc.).
2. **Metadata Stack**: Tracks the active header hierarchy (e.g. `Chapter 1 > Section 1.2`) and prepends it to the top of subsequent sub-chunks:
   ```markdown
   > **[Context]** Belong to: Chapter 1 > Section 1.2
   ```
   This prevents the LLM from losing structural context during fragment processing.
3. **Paragraph Protection**: If a heading section is still larger than the maximum chunk size, the splitter recursively slices along paragraph boundaries (`\n\n`), ensuring that Markdown tables and lists remain unbroken.

### B. Recursive Schema Merging
After extracting JSON from all chunks, [json-merger.ts](file:///Users/osp/Documents/GitHub/aiex-cli/app/cli/src/core/ai-extraction/json-merger.ts) merges the array of JSON chunks recursively:
- **Arrays**: Concatenates items (e.g. merging database table rows).
- **Objects**: Recursively merges keys (merging nested fields).
- **Primitives**: Selects the first non-null, non-empty value (ideal for single metadata fields like title, author).

---

## 3. ReAct Agent Mode (Dynamic Document Navigation)

When ReAct mode is enabled (via config or `--agent`), `aiex` spawns an agent that uses tool calling to dynamically navigate document slices instead of reading them all.

### Tools Exposed to the Agent
- **`listChunks`**: Returns document chunks, sizes, heading stack headers, and heading paths. Supports optional `offset` and `limit` for large documents.
- **`summarizeChunks`**: Returns a compact map of chunk IDs, heading paths, sizes, and previews.
- **`readChunk(chunkId)`**: Fetches the full text of a specific chunk.
- **`readChunkRange(chunkId, start, length)`**: Fetches a bounded character range from a chunk when search has already identified the relevant area.
- **`searchChunks(query, limit)`**: Performs ranked keyword and phrase search on all chunks, using phrase hits, token coverage, token rarity, and heading matches. Returns IDs, offsets, scores, heading paths, and context snippets.
- **`submitExtraction(data, evidence)`**: Submits the final extracted JSON object and optional field-level evidence keyed by JSON path.

The agent reasons about the schema, searches or lists chunks, reads relevant sections, compiles the JSON object, and submits it.

Before the loop starts, `aiex` builds a schema-aware retrieval plan from field paths, field names, identifiers split from camelCase/snake_case, types, formats, and enums. The plan is included in the agent instructions and trace so the agent is guided to cover each field rather than browsing opportunistically.

ReAct mode also writes adjacent `.evidence.json` and `.agent-trace.json` files. Evidence records field paths, source chunks, snippets, confidence, and whether the value was found, missing, or inferred. If the agent does not provide evidence explicitly, `aiex` creates a heuristic evidence report by matching extracted primitive values back to document chunks. The trace file records selected model, chunk metadata, tool calls, step callbacks, correction attempts, and evidence summary.

Evidence coverage is validated after extraction. Non-null planned fields should have evidence, `found` evidence should include a chunk and snippet, and `null` values should be marked as `missing`. Coverage issues are written to `.evidence.json` and `.agent-trace.json` as warnings; they do not block JSON output.

For regression and model comparison guidance, see [Agent Evaluation](./agent-evaluation.md).

### Agent Extension Entry Points

`agentExtensions` is reserved in AI configuration as the standard entry point for future external tools:

- **`agentExtensions.mcp.servers`**: Reserved for configured MCP servers, transport metadata, and allowed tool filters.
- **`agentExtensions.skills`**: Reserved for local skill directories and skill enablement.

These fields are currently configuration-compatible placeholders. ReAct extraction only uses the built-in document navigation tools until MCP and Skills adapters are implemented.

---

## 4. Self-Reflection & Correction Loop

Even with structured output formats, LLMs can return malformed JSON or values that violate schema constraints. `aiex` runs an automated correction loop (up to 3 attempts):

1. **Validation**: The parsed JSON is validated against the JSON Schema using `validateExtractedData`.
2. **Reflection Prompting**: If validation fails (e.g. a validation error says `$.age: expected integer`), `aiex` prompts the model again, attaching:
   - The JSON Schema definition.
   - The previously generated invalid JSON.
   - The specific validation error trace.
3. **Correction**: The model is instructed to correct only the fields that failed validation and return the updated JSON.
