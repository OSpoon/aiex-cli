# AI Extraction Engine

The `aiex` core extraction engine coordinates LLM communication to pull clean, schema-conforming JSON objects out of unstructured text. This document details model registry lookup, pipeline slicing and merging, and self-reflection error correction.

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

## 3. Self-Reflection & Correction Loop

Even with structured output formats, LLMs can return malformed JSON or values that violate schema constraints. `aiex` runs an automated correction loop (up to 3 attempts):

1. **Validation**: The parsed JSON is validated against the JSON Schema using `validateExtractedData`.
2. **Reflection Prompting**: If validation fails (e.g. a validation error says `$.age: expected integer`), `aiex` prompts the model again, attaching:
   - The JSON Schema definition.
   - The previously generated invalid JSON.
   - The specific validation error trace.
3. **Correction**: The model is instructed to correct only the fields that failed validation and return the updated JSON.
