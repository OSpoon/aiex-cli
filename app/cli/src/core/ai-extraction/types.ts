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
  { name: 'qwen-plus', capabilities: { vision: false, structuredOutput: true } },
  { name: 'qwen-vl-plus', capabilities: { vision: true, structuredOutput: true } },
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
4. Maintain data accuracy and completeness`,
  userTemplate: `Please extract data from the following text:
{text}`,
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  outputDir: '.aiex/extracted',
  mode: 'pipeline',
}

export const DEFAULT_IMAGE_OCR_CONFIG: ImageOcrConfig = {
  ocrFallback: 'auto',
  ocrLanguages: 'en-US, zh-Hans',
  ocrMinConfidence: 0,
}

export const DEFAULT_MINERU_CONFIG: ExternalPdfConverterConfig = {
  command: 'mineru',
  args: ['-p', '{input}', '-o', '{outputDir}'],
  timeout: 600,
  fallbackToUnpdf: true,
}

export const DEFAULT_MARKITDOWN_CONFIG: ExternalPdfConverterConfig = {
  command: 'markitdown',
  args: ['{input}', '-o', '{outputDir}/{basename}.md'],
  timeout: 600,
  fallbackToUnpdf: true,
}

export const DEFAULT_MARKER_CONFIG: ExternalPdfConverterConfig = {
  command: 'marker_single',
  args: ['{input}', '--output_dir', '{outputDir}'],
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
  markitdown: DEFAULT_MARKITDOWN_CONFIG,
  marker: DEFAULT_MARKER_CONFIG,
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
