# PDF & OCR Subsystem

This document describes how `aiex` parses documents into Markdown text and falls back to system OCR when handling images or scanned pages.

---

## 1. PDF-to-Markdown Converters

When a PDF file is passed to `aiex extract`, the parser orchestrates document conversion to plain Markdown text. The pipeline supports several converter backends configured under `pdf.converter` in the AI configuration:

| Converter Kind | Type | Description |
| :--- | :--- | :--- |
| **`unpdf`** | Local / JS | Built-in zero-dependency parser using PDF.js. Fast and doesn't require external runtimes, but does not parse tables or images. |
| **`mineru`** | Local / Command | Invokes local `mineru` CLI to convert PDFs layout-knowingly. Excellent for equations, tables, and layouts. |
| **`mineru_api`** | Cloud / API | Calls the Mineru cloud HTTP endpoint. Performs advanced server-side parsing. |
| **`markitdown`** | Local / Command | Invokes Microsoft's `markitdown` Python command to convert text/office documents to Markdown. |
| **`marker`** | Local / Command | Invokes `marker` CLI for layout-aware PDF conversion. |
| **`external`** | Local / Command | Runs a user-defined shell command. Substitutes `{input}` and `{outputDir}` parameters dynamically. |

### Fallback Chain
For local CLI-based converters (`mineru`, `markitdown`, `marker`), if the command crashes or is missing from the system path, the orchestrator prints a warning and automatically falls back to the built-in `unpdf` library to extract plain text, ensuring the pipeline continues without halting.

---

## 2. Platform-Native Image OCR

If the input is an image (e.g. `png`, `jpg`) and the selected AI model does not support vision capabilities, or if `image.ocrFallback` is configured, `aiex` triggers local platform-native OCR:

```
                  ┌──────────────────────────────┐
                  │      ocrFallback Mode?       │
                  └──────────────┬───────────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
              ┌──────▼──────┐         ┌──────▼──────┐
              │    local    │         │    auto     │
              └──────┬──────┘         └──────┬──────┘
                     │                       │
                     │             ┌─────────┴─────────┐
                     │             │                   │
                     │       ┌─────▼─────┐       ┌─────▼─────┐
                     │       │ Vision    │       │ No Vision │
                     │       │ Model?    │       │ Model?    │
                     │       └─────┬─────┘       └─────┬─────┘
                     │             │                   │
                     │          ┌──▼──┐             ┌──▼──┐
                     │          │ Skip│             │ OCR │
                     │          │ OCR │             └─────┘
                     │          └─────┘
                     ▼
          ┌────────────────────┐
          │     OS Platform    │
          └──────────┬─────────┘
                     │
            ┌────────┴────────┐
            │                 │
      ┌─────▼─────┐     ┌─────▼─────┐
      │   macOS   │     │  Windows  │
      └─────┬─────┘     └─────┬─────┘
            │                 │
      ┌─────▼─────┐     ┌─────▼─────┐
      │ VisionKit │     │ Media OCR │
      └───────────┘     └───────────┘
```

- **macOS OCR**: Utilizes Apple's native **VisionKit** API through `@napi-rs/system-ocr` to perform GPU-accelerated text recognition locally.
- **Windows OCR**: Utilizes the built-in **Windows.Media.Ocr** API to perform fast, offline OCR.
- **Linux/Unsupported Platforms**: Halts with an error if no vision model is configured, advising the user to use a vision-capable model (like `gpt-4o` or `gemini-pro`).
