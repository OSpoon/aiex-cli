# PDF & OCR Subsystem

This document describes how `aiex` parses documents into Markdown text and uses OCR when handling images. The extraction engine itself only accepts text; it does not send images or PDF files directly to a model.

---

## 1. PDF-to-Markdown Converters

When a PDF file is passed to `aiex extract`, the parser orchestrates document conversion to plain Markdown text. The pipeline supports several converter backends configured under `pdf.converter` in the AI configuration:

| Converter Kind | Type | Description |
| :--- | :--- | :--- |
| **`unpdf`** | Local / JS | Built-in zero-dependency parser using PDF.js. Fast and doesn't require external runtimes, but does not parse tables or images. |
| **`mineru`** | Local / Command | Invokes local `mineru` CLI to convert PDFs layout-knowingly. Excellent for equations, tables, and layouts. |
| **`mineru_api`** | Cloud / API | Calls the Mineru cloud HTTP endpoint. Performs advanced server-side parsing. |
| **`external`** | Local / Command | Runs a user-defined shell command. Substitutes `{input}` and `{outputDir}` parameters dynamically. |

### Fallback Chain
For local CLI-based converters (`mineru`), if the command crashes or is missing from the system path, the orchestrator prints a warning and automatically falls back to the built-in `unpdf` library to extract plain text, ensuring the pipeline continues without halting.

---

## 2. Image-to-Text Conversion

If the input is an image (e.g. `png`, `jpg`), `aiex` must convert it to text before extraction. Two conversion methods are available:

| Method | Configuration | Description |
| :--- | :--- | :--- |
| **Local OCR** | `image.imageConversion: 'local'` (default) | Platform-native offline OCR using `@napi-rs/system-ocr`. No network required. |
| **Vision Model** | `image.imageConversion: 'vision'` + `image.imageModelName` | Sends the image to the configured LLM with a transcription prompt. Requires a vision-capable model. |

### Decision Flow

```
                    ┌──────────────────────────┐
                    │   imageConversion mode?  │
                    └────────────┬─────────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
              ┌──────▼──────┐         ┌──────▼──────┐
              │    local    │         │   vision    │
              └──────┬──────┘         └──────┬──────┘
                     │                       │
                     │             ┌─────────┴─────────┐
                     │             │                   │
                     │        ┌────▼────┐        ┌────▼────┐
                     │        │ Vision  │        │ Vision  │
                     │        │ model   │        │ model   │
                     │        │name set?│        │name     │
                     │        └────┬────┘        │empty    │
                     │             │              └────┬────┘
                     │        ┌────▼────┐              │
                     │        │ Try     │              │
                     │        │ transcribe│            │
                     │        └────┬────┘              │
                     │             │                   │
                     │        ┌────▼────┐              │
                     │        │ Success?│              │
                     │        └────┬────┘              │
                     │        ┌──┐ │ ┌──┐              │
                     │        │No│ │ │Yes│             │
                     │        └──┘ │ └──┘              │
                     │        │    ▼                   │
                     │        │  Done                  │
                     │        ▼                        ▼
                     │  ┌──────────────┐     ┌──────────────┐
                     │  │   Warn &     │     │   Fallback   │
                     │  │  fallback    │     │  to OCR      │
                     │  │  to OCR      │     │              │
                     │  └──────┬───────┘     └──────────────┘
                     ▼         ▼
          ┌─────────────────────────────────┐
          │         Local OCR Path          │
          └────────────────┬────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
      ┌─────▼─────┐                 ┌─────▼─────┐
      │   macOS   │                 │  Windows  │
      └─────┬─────┘                 └─────┬─────┘
            │                             │
      ┌─────▼─────┐                 ┌─────▼─────┐
      │ VisionKit │                 │ Media OCR │
      └───────────┘                 └───────────┘
```

### Vision Model Transcription

When `imageConversion` is `'vision'` and `imageModelName` is set, the pipeline calls `transcribeImageWithVision()` in `ai-extraction/transcriber.ts` with the model name and connection parameters (`visionBaseURL` / `visionApiKey`, falling back to `provider.baseURL` / `provider.apiKey`). The transcription prompt requests accurate visible text transcription with layout preservation.

If the vision transcription fails (model unreachable, invalid key, etc.), the pipeline logs a warning and falls back to local OCR instead of halting.

### Local Platform OCR

- **macOS OCR**: Utilizes Apple's native **VisionKit** API through `@napi-rs/system-ocr` to perform GPU-accelerated text recognition locally.
- **Windows OCR**: Utilizes the built-in **Windows.Media.Ocr** API to perform fast, offline OCR.
- **Linux/Unsupported Platforms**: Halts with an OCR availability error because local OCR is not available on that platform.

### Configuration

Configured via the `image` section of the AI config, completely independent from the provider model list:

```typescript
interface ImageOcrConfig {
  imageConversion: 'local' | 'vision'  // default: 'local'
  // Vision model connection (only used when imageConversion === 'vision')
  visionBaseURL?: string               // base URL for vision API (falls back to provider if empty)
  visionApiKey?: string                // API key for vision API (falls back to provider if empty)
  imageModelName?: string              // model name for vision transcription (e.g. 'gpt-4o')
  // Local OCR configuration
  ocrLanguages?: string                // e.g. 'en-US, zh-Hans'
  ocrMinConfidence?: number            // minimum confidence threshold (0-1)
}
```

The Provider configuration (`provider.models`) is used exclusively for structured extraction. Vision models for image transcription are specified independently via `imageModelName`, with optional separate `visionBaseURL` and `visionApiKey` for fully decoupled API connectivity.

In the Web UI, the image section shows a status card summarizing the active mode (model name or "Local OCR"), with an optional advanced panel containing independent API connection fields and a free-form model name input.
