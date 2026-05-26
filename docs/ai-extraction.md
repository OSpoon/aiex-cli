# AI Extraction Engine

The `aiex` core extraction engine coordinates LLM communication to pull clean, schema-conforming JSON objects out of unstructured text. This document details model registry lookup, the unified text pipeline, candidate/evidence merging, and self-reflection error correction.

---

## 1. Model Selection & Capabilities Registry

Before making an API call, `aiex` determines the best model from the user's provider list.

- **Registry Lookup**: Under `src/core/ai-extraction/capabilities.ts`, `aiex` contains a local lookup mapping for 2000+ models. It tracks:
  - `vision`: Informational flag indicating model supports image input. Image transcription uses a separately configured model name (`imageModelName`) and independent API connection — the registry flag is only used for UI display and is not involved in the transcription routing decision.
  - `structuredOutput`: Does the model support strict JSON Schema response modes?
  - `maxTokens` / `maxOutputTokens`: Context window boundaries.
- **Auto-Selection logic**:
  - Prioritizes structured output models for schema-conforming JSON.
  - It filters out models whose context windows are too small for the computed token count of the document.
  - If no model matches token constraints, it falls back to the configured model list as a best-effort path.

---

## 2. Unified Text Pipeline

All extraction inputs are normalized to text before model calls. Short inputs enter the same pipeline as a single chunk; long inputs are split into multiple chunks to prevent context window clipping.

### A. Slicing with Heading Metadata Context
Long-document slicing is handled by [text-splitter.ts](/Users/osp/Documents/GitHub/aiex-cli/app/cli/src/core/ai-extraction/text-splitter.ts):
1. **AST-Based Block Extraction**: Uses `marked.lexer()` to parse markdown structural elements, ensuring proper recognition of headings, tables, code blocks, and list items.
2. **Token-Aware Budgeting**: Employs `js-tiktoken` (`cl100k_base` encoding) for precise token-weight calculations instead of character counts. A dynamic safety buffer of up to 10% is reserved to prevent context window clipping.
3. **Metadata Stack**: Tracks the active header hierarchy (e.g. `Chapter 1 > Section 1.2`) and prepends it to the top of subsequent sub-chunks:
   ```markdown
   > **[Context]** Belong to: Chapter 1 > Section 1.2
   ```
   This prevents the LLM from losing structural context during fragment processing.
4. **Block-Aware Protection**: Preserves code block syntax. Oversized tables can be split by rows while retaining table headers so each chunk remains readable.
5. **List Item Expansion**: Automatically breaks down giant lists into individual list items to process them separately if the list as a whole exceeds the token budget.
6. **Heading Overlap Reset**: Resets the sliding window overlap when crossing heading boundaries, avoiding carrying over trailing paragraphs of a previous section into the next section.

### B. Candidate & Evidence Merging
After extracting JSON from all chunks, [json-merger.ts](/Users/osp/Documents/GitHub/aiex-cli/app/cli/src/core/ai-extraction/json-merger.ts) merges chunk results into schema-shaped candidates:
- **Arrays**: Concatenates items (e.g. merging database table rows).
- **Objects**: Recursively merges keys (merging nested fields).
- **Primitives**: Selects the strongest candidate using evidence coverage and conflict metadata rather than simply taking the first non-empty value.
- **Evidence Summary**: Writes evidence coverage and issue summaries alongside the extracted JSON so CLI/Web consumers can quickly judge extraction reliability.

Prompt snapshots are kept for preview/debug visibility in the Web UI. They are not loaded back into the production extraction path; live extraction uses the configured prompt templates directly.

---

## 3. Self-Reflection & Correction Loop

Even with structured output formats, LLMs can return malformed JSON or values that violate schema constraints. `aiex` runs an automated correction loop (up to 3 attempts):

1. **Validation**: The parsed JSON is validated against the JSON Schema using `validateExtractedData`.
2. **Reflection Prompting**: If validation fails (e.g. a validation error says `$.age: expected integer`), `aiex` prompts the model again, attaching:
   - The JSON Schema definition.
   - The previously generated invalid JSON.
   - The specific validation error trace.
3. **Correction**: The model is instructed to correct only the fields that failed validation and return the updated JSON.
