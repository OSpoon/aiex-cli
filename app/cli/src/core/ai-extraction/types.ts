import type {
  AIConfig,
  AIModelConfig,
  AIProviderConfig,
  ExternalPdfConverterConfig,
  ExtractionConfig,
  ImageOcrConfig,
  MineruApiPdfConverterConfig,
  PdfConfig,
  PromptConfig,
} from '@/types'

export const PLACEHOLDER_SCHEMA = '{schema}'
export const PLACEHOLDER_TEXT = '{text}'

export const DEFAULT_MODELS: AIModelConfig[] = [
  { name: 'qwen-plus', capabilities: { structuredOutput: true } },
]

export const DEFAULT_PROVIDER_CONFIG: AIProviderConfig = {
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  models: [...DEFAULT_MODELS],
  timeout: 300,
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  systemTemplate: `You are a professional data extraction assistant. Your task is to extract structured data from text and return a JSON object based on the data structure definition provided below.

{schema}

Extraction requirements:
1. Extract strictly according to the field names and types defined in the structure
2. If the text lacks information for a field, set that field to null
3. Do not add fields that do not exist in the structure definition
4. Use only facts present in the source text; do not infer, guess, or complete missing values from outside knowledge
5. Normalize values to the target type: numbers as JSON numbers, booleans as true/false, dates and formatted strings exactly as requested by the field format
6. For repeated or conflicting mentions, prefer the most specific final value in the source text and ignore placeholder values such as N/A, unknown, TBD, or empty strings
7. Maintain data accuracy and completeness`,
  userTemplate: `Please extract data from the following text:
{text}`,
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  outputDir: '.aiex/extracted',
  mode: 'pipeline',
}

export const DEFAULT_IMAGE_OCR_CONFIG: ImageOcrConfig = {
  imageConversion: 'local',
  ocrLanguages: 'en-US, zh-Hans',
  ocrMinConfidence: 0,
}

export const DEFAULT_MINERU_CONFIG: ExternalPdfConverterConfig = {
  command: 'mineru',
  args: ['-p', '{input}', '-o', '{outputDir}'],
  timeout: 600,
  fallbackToUnpdf: true,
}

export const DEFAULT_MINERU_API_CONFIG: MineruApiPdfConverterConfig = {
  token: '',
  baseURL: 'https://mineru.net/api/v4',
  modelVersion: 'vlm',
  isOcr: true,
  enableFormula: true,
  enableTable: true,
}

export const DEFAULT_PDF_CONFIG: PdfConfig = {
  converter: 'unpdf',
  mineru: DEFAULT_MINERU_CONFIG,
  mineruApi: DEFAULT_MINERU_API_CONFIG,
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: DEFAULT_PROVIDER_CONFIG,
  prompt: DEFAULT_PROMPT_CONFIG,
  extraction: DEFAULT_EXTRACTION_CONFIG,
  image: DEFAULT_IMAGE_OCR_CONFIG,
  pdf: DEFAULT_PDF_CONFIG,
  webhook: {
    enabled: false,
    url: '',
    secret: '',
  },
}
