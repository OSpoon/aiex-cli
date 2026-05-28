import { z } from 'zod'

export const ModelCapabilitiesSchema = z.object({
  vision: z.boolean(),
  structuredOutput: z.boolean(),
  maxTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
})

export const AIModelConfigSchema = z.object({
  name: z.string().min(1),
  capabilities: ModelCapabilitiesSchema,
})

export const AIProviderConfigSchema = z.object({
  baseURL: z.string().min(1),
  apiKey: z.string(),
  models: z.array(AIModelConfigSchema).min(1),
  timeout: z.number().int().positive().default(300).optional(),
})

export const PromptConfigSchema = z.object({
  systemTemplate: z.string().min(1),
  userTemplate: z.string().min(1),
})

export const ExtractionConfigSchema = z.object({
  outputDir: z.string().min(1),
})

const ImageOcrFallbackSchema = z.preprocess(
  value => ['auto', 'off', 'local'].includes(String(value)) ? 'localAuto' : value,
  z.literal('localAuto').default('localAuto').optional(),
)

export const ImageOcrConfigSchema = z.object({
  ocrFallback: ImageOcrFallbackSchema,
  ocrLanguages: z.string().min(1).optional(),
  ocrMinConfidence: z.number().min(0).max(1).optional(),
})

export const ExternalPdfConverterConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).min(1).refine(
    args => args.some(arg => arg.includes('{input}')),
    { message: 'args must contain {input} template variable' },
  ),
  outputFile: z.string().min(1).optional(),
  timeout: z.number().int().positive().default(600).optional(),
  fallbackToUnpdf: z.boolean().optional(),
})

export const MineruApiPdfConverterConfigSchema = z.object({
  token: z.string(),
  baseURL: z.string().url().optional(),
  modelVersion: z.string().optional(),
  isOcr: z.boolean().optional(),
  enableFormula: z.boolean().optional(),
  enableTable: z.boolean().optional(),
})

export const PdfConfigSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object')
    return value

  const config = { ...(value as Record<string, unknown>) }
  if (config.converter === 'markitdown' && config.markitdown) {
    config.converter = 'external'
    config.external = config.markitdown
  }
  else if (config.converter === 'marker' && config.marker) {
    config.converter = 'external'
    config.external = config.marker
  }
  else if (config.converter === 'markitdown' || config.converter === 'marker') {
    config.converter = 'unpdf'
  }
  delete config.markitdown
  delete config.marker
  return config
}, z.object({
  converter: z.enum(['unpdf', 'mineru', 'mineru_api', 'external']),
  mineru: ExternalPdfConverterConfigSchema.optional(),
  mineruApi: MineruApiPdfConverterConfigSchema.optional(),
  external: ExternalPdfConverterConfigSchema.optional(),
}))

export const LangfuseConfigSchema = z.object({
  publicKey: z.string(),
  secretKey: z.string(),
  host: z.string().optional(),
})

export const NotionSchemaConfigSchema = z.object({
  databaseId: z.string(),
  titleProperty: z.string().optional(),
  fieldMap: z.record(z.string()).optional(),
})

export const NotionConfigSchema = z.object({
  enabled: z.boolean(),
  token: z.string(),
  schemas: z.record(NotionSchemaConfigSchema).default({}),
})

export const WebhookConfigSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  secret: z.string().optional(),
})

export const AIConfigSchema = z.object({
  provider: AIProviderConfigSchema,
  prompt: PromptConfigSchema,
  extraction: ExtractionConfigSchema,
  image: ImageOcrConfigSchema.optional(),
  pdf: PdfConfigSchema.optional(),
  langfuse: LangfuseConfigSchema.optional(),
  notion: NotionConfigSchema.optional(),
  webhook: WebhookConfigSchema.optional(),
})
