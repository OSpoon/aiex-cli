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

export const ExternalPdfConverterConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  outputFile: z.string().min(1).optional(),
  timeout: z.number().int().positive().default(600).optional(),
  fallbackToUnpdf: z.boolean().optional(),
  keepOutput: z.boolean().optional(),
})

export const PdfConfigSchema = z.object({
  converter: z.enum(['unpdf', 'mineru', 'external']),
  mineru: ExternalPdfConverterConfigSchema.optional(),
  external: ExternalPdfConverterConfigSchema.optional(),
})

export const LangfuseConfigSchema = z.object({
  publicKey: z.string(),
  secretKey: z.string(),
  host: z.string().optional(),
})

export const AIConfigSchema = z.object({
  provider: AIProviderConfigSchema,
  prompt: PromptConfigSchema,
  extraction: ExtractionConfigSchema,
  pdf: PdfConfigSchema.optional(),
  langfuse: LangfuseConfigSchema.optional(),
})
