# Extraction Flow Charts

This document splits the extraction pipeline into smaller diagrams so each stage can be read independently.

## 0. Schema To SQLite Pipeline

```mermaid
flowchart TD
  S0[".aiex/schema/*.json"] --> S1["Parse as AIEX Drizzle-backed schema dialect"]
  S1 --> S2{"Dialect warnings?"}
  S2 -->|"yes"| S3["Report unsupported or non-portable JSON Schema keywords"]
  S2 -->|"no"| S4
  S3 --> S4["Map fields to Drizzle SQLite tables and columns"]
  S4 --> S5["Generate .aiex/drizzle/schema.ts"]
  S4 --> S6["Write .aiex/drizzle/schema-map.json"]
  S6 --> R1["Compare previous and current schema-map"]
  R1 --> R2{"High-risk migration?"}
  R2 -->|"yes and no --force"| R3["Block migration and keep baselineEntries"]
  R2 -->|"no or --force"| S7["Drizzle migration helper"]
  S7 --> S8["Apply SQLite migration"]
  S8 --> S9["SQLite database ready for extraction inserts"]
```

## 1. Entry And File Routing

```mermaid
flowchart TD
  A["User runs aiex extract"] --> B{"Input source"}

  B -->|"--file"| F1["readExtractFileInput(file)"]
  B -->|"--dir"| D1["listSupportedFiles scans supported paths"]
  D1 --> F1

  F1 --> D2{"Detect content type\nfile-type + UTF-8 text detection"}

  D2 -->|"text content"| T1["Read as UTF-8 text"]
  D2 -->|"application/pdf"| P1["PDF pipeline"]
  D2 -->|"image/png, image/jpeg, image/webp"| I1["Image pipeline"]
  D2 -->|"unsupported"| E1["Return unsupported file type error"]

  T1 --> O1["Text input for extraction"]
  P1 --> O1
  I1 --> O2{"Image handler"}
  O2 -->|"vision"| O3["File input for vision model"]
  O2 -->|"local OCR"| O1

  O1 --> M1["Record inputProcessing and input quality"]
  O3 --> M1
  M1 --> X1["extractSingle / extractStructuredData"]
```

## 2. PDF Conversion Pipeline

```mermaid
flowchart TD
  P0["Detected application/pdf"] --> P1["Read PDF buffer"]
  P1 --> P2["createPdfConverter(aiConfig.pdf)"]
  P2 --> P3{"Configured converter"}

  P3 -->|"unpdf"| U1["Built-in unpdf text extraction"]
  P3 -->|"liteparse"| L1["Built-in liteparse layout parsing\nPDFium text + coordinates"]
  L1 --> L2{"LiteParse OCR enabled?"}
  L2 -->|"yes"| L3["Use configured Tesseract tessdata\nor OCR server URL"]
  L2 -->|"no"| Q1
  L3 --> Q1
  P3 -->|"mineru"| M1["External mineru command to Markdown"]
  P3 -->|"mineru_api"| A1["MinerU API to Markdown"]
  P3 -->|"external"| X1["User configured external command"]

  M1 --> F1{"Failed and fallbackToUnpdf?"}
  X1 --> F1
  F1 -->|"yes"| U1
  F1 -->|"no"| E1["Return file_conversion failure"]

  U1 --> Q1["Collect PDF quality\npageCount, textLength, emptyText, fallbackUsed, converter"]
  M1 --> Q1
  A1 --> Q1
  X1 --> Q1

  Q1 --> S1["Save sidecar Markdown when possible"]
  S1 --> O1["Return converted text"]
```

## 3. Image Pipeline

```mermaid
flowchart TD
  I0["Detected supported bitmap image\nPNG / JPEG / WebP"] --> I1{"Vision model available?"}

  I1 -->|"yes"| V1["Keep filePath as image attachment"]
  V1 --> Q1["Record handler=image_vision\nNo text offset evidence"]
  Q1 --> O1["Return file input"]

  I1 -->|"no"| L1{"Local OCR platform supported?"}
  L1 -->|"macOS / Windows"| L2["Run system OCR\nmacOS VisionKit / Windows Media OCR"]
  L1 -->|"other"| E1["Return OCR platform unsupported"]

  L2 --> L3{"OCR text available?"}
  L3 -->|"yes"| Q2["Record OCR quality\nconfidence, textLength, platform"]
  L3 -->|"no"| E2["Return OCR unavailable or no text"]
  Q2 --> O2["Return OCR text input"]
```

## 4. AI Extraction And Validation

```mermaid
flowchart TD
  X0["extractStructuredData"] --> M1{"Input kind"}

  M1 -->|"image attachment"| M2["selectModel requires vision=true"]
  M1 -->|"text"| M3["Prefer structuredOutput=true\notherwise first compatible model"]

  M2 --> P1["OpenAI-compatible provider"]
  M3 --> P1

  P1 --> S1{"Selected model supports structured output?"}
  S1 -->|"yes"| S2["AI SDK Output.object(JSON Schema)"]
  S1 -->|"no"| S3["generateText + safeParseJSON"]

  S2 --> V1["validateExtractedData"]
  S3 --> V1

  V1 -->|"valid"| Q1["Record AI quality\nvalidationPassed, attempts, selfCorrectionCount, apiRetryCount, missingFieldRate"]
  V1 -->|"invalid"| R1{"Attempts remaining?"}
  R1 -->|"yes"| R2["Self-correction prompt\noriginal text + schema + invalid JSON + validation error"]
  R2 --> P1
  R1 -->|"no"| E1["Return ai_extraction failure"]

  Q1 --> O1["Write business JSON to .aiex/extracted/*.json"]
```

## 5. Evidence Location Rules

```mermaid
flowchart TD
  E0["Validated business JSON"] --> E1{"Text chain is locatable?"}

  E1 -->|"text / PDF text / OCR text"| E2["Ask model for _evidence.<field>.quote only"]
  E1 -->|"vision image attachment"| N1["Do not record location evidence"]

  E2 --> E3["Strip _evidence from business JSON"]
  E3 --> E4{"For each scalar field"}
  E4 --> E5{"Quote appears exactly once in source text?"}
  E5 -->|"no"| N2["Do not record location"]
  E5 -->|"yes"| E6{"Field value is contained in quote?"}
  E6 -->|"no"| N2
  E6 -->|"yes"| E7["System records quote, start, end\nverified=true, matchMethod=exact_unique"]

  E7 --> A1["Store verified evidence in audit only"]
  N1 --> A1
  N2 --> A1
```

## 6. Persistence, Integrations, And Audit

```mermaid
flowchart TD
  O0["Extraction output ready"] --> D1{"insert !== false?"}

  D1 -->|"no"| A1["Update extraction audit"]
  D1 -->|"yes"| D2["ensureDatabaseReady"]
  D2 --> D3{"Database ready?"}
  D3 -->|"no"| E1["Return db_insert failure"]
  D3 -->|"yes"| D4["insertExtractedData into SQLite"]

  D4 --> N1{"Notion sync enabled?"}
  N1 -->|"no"| A1
  N1 -->|"yes"| N2["writeNotionPage"]
  N2 -->|"success"| A1
  N2 -->|"failure"| E2["Return integration failure"]

  A1 --> A2["Audit stores\nsource, inputProcessing, quality, failureStage, evidence, tokens, output, DB rows, integration result"]
  A2 --> DONE["Done"]
```
