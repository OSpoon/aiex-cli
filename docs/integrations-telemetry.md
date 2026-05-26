# Integrations & Telemetry

This document details how `aiex` synchronizes extraction results to external services (Notion, webhooks) and routes instrumentation traces to Langfuse.

---

## 1. Notion Sync Integration

`aiex` allows you to connect schemas directly to Notion databases. When enabled, successful extractions generate new database pages in Notion.

### Configuration & Property Mapping
Under `notion.schemas[schemaName]` in the AI configuration:
- `databaseId`: The ID of the target Notion database.
- `titleProperty`: The property name in Notion designated as the Title field (usually `Name` or `Title`).
- `fieldMap`: A JSON mapping that links JSON Schema fields to Notion database property names.

### Column Mapping Matrix

The dispatcher (`app/cli/src/core/integration/dispatcher.ts`) translates extracted JSON types into Notion page properties:

| Extracted JSON Type | Notion Property Type | Notion payload representation |
| :--- | :--- | :--- |
| `string` | `rich_text` / `title` | Text content wrapped in `text.content`. |
| `number` / `integer` | `number` | Direct numerical assignment. |
| `boolean` | `checkbox` | Boolean checkbox state (`true` / `false`). |
| `array` (of strings) | `multi_select` | Array of objects `{ name: "value" }`. |
| `string` (date format) | `date` | JSON object `{ start: "YYYY-MM-DD" }`. |

---

## 2. Webhook Event Dispatches

You can register a webhook URL to receive notifications upon extraction completion. Webhooks are dispatched asynchronously.

### Webhook Event Payloads

1. **`extraction.success`**: Fired when extraction, validation, database insertion, and Notion sync succeed.
   ```json
   {
     "event": "extraction.success",
     "auditId": "a1b2c3d4-...",
     "schemaName": "invoice",
     "source": { "type": "file", "filePath": "path/to/invoice.pdf" },
     "data": { "vendor": "ACME Corp", "total": 120.50 },
     "tokensUsed": { "prompt": 450, "completion": 80, "total": 530 }
   }
   ```
2. **`extraction.failed`**: Fired if any step in the pipeline (PDF parsing, LLM call, validation, db write, notion sync) fails.
   ```json
   {
     "event": "extraction.failed",
     "auditId": "a1b2c3d4-...",
     "schemaName": "invoice",
     "source": { "type": "file", "filePath": "path/to/invoice.pdf" },
     "error": "Notion database not found",
     "tokensUsed": { "prompt": 450, "completion": 0, "total": 450 }
   }
   ```

Webhooks are signed using a HMAC signature (SHA-256) computed using `webhook.secret` and attached in the header as `x-aiex-signature`.

---

## 3. Langfuse Telemetry Tracing

If `langfuse.publicKey` and `langfuse.secretKey` are configured:

1. **Traces**: Every call inside `extractStructuredData` initializes a telemetry trace span.
2. **Instrumentation**: OpenTelemetry automatically captures request payloads, temperature parameters, model names, latency, and token metrics.
3. **Trace Visualizer**: You can monitor step execution times, input chunks, and prompt snapshots directly from your Langfuse Dashboard.
