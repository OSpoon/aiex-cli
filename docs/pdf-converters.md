# PDF Converter Strategy

AIEX keeps PDF parsing behind the `PdfConverter` interface. The extraction pipeline should select one converter, produce text, record quality metadata, and then pass the result to AI extraction.

## Converter Tiers

| Converter | Tier | Dependency model | Best for | Notes |
|---|---|---|---|---|
| `unpdf` | Built-in baseline | Pure npm dependency already bundled | Normal text-based PDF extraction | Default. Lowest operational risk. |
| `liteparse` | Built-in enhanced | Optional native npm package | Text-based PDFs that benefit from page coordinates | Uses PDFium text parsing and text item coordinates. OCR is opt-in. |
| `mineru` | External advanced | User-installed command | Complex documents, OCR-heavy files, layout-heavy PDFs | Runs through the external command adapter. Can fall back to `unpdf`. |
| `mineru_api` | External advanced API | MinerU API token | Complex documents without local heavy dependencies | Requires network/API credentials. |
| `external` | Escape hatch | User-provided command | Organization-specific parsers | Must output Markdown or a selected `.md` file. |

## Defaults

The default converter remains `unpdf`. This keeps the CLI install small and predictable.

`liteparse` is optional. It is installed as an optional dependency and dynamically loaded only when selected. If the package or native binding is unavailable, the converter returns an actionable error instead of failing the entire CLI at startup.

## LiteParse OCR

LiteParse OCR is disabled by default:

```json
{
  "pdf": {
    "converter": "liteparse",
    "liteparse": {
      "ocrEnabled": false,
      "ocrLanguage": "eng"
    }
  }
}
```

When OCR is enabled, the user must provide either Tesseract language data or a compatible OCR server:

```json
{
  "pdf": {
    "converter": "liteparse",
    "liteparse": {
      "ocrEnabled": true,
      "ocrLanguage": "chi_sim",
      "tessdataPath": "/opt/tessdata"
    }
  }
}
```

If Tesseract language data is missing, AIEX reports that the selected `traineddata` file must be installed and that `pdf.liteparse.tessdataPath` should point to the directory containing it.

## Implementation Rules

- New PDF parsing options must implement `PdfConverter` in `app/cli/src/infrastructure/pdf`.
- The factory is the only place that maps `pdf.converter` values to implementations.
- Do not add new default PDF converter paths without tests, documentation, and `doctor` coverage.
- Optional native dependencies must stay external in the build config.
- The Web UI may expose existing converter config, but CLI extraction behavior remains the source of truth.
