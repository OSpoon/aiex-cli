import { z } from 'zod'

export const ModelCapabilitiesSchema = z.object({
  vision: z.boolean(),
  structuredOutput: z.boolean(),
  supportsTools: z.boolean().optional(),
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
  mode: z.enum(['pipeline', 'react']).default('pipeline').optional(),
  concurrency: z.number().int().min(1).optional(),
  overlapSize: z.number().int().nonnegative().optional(),
  preFiltering: z.boolean().optional(),
  preFilteringLimit: z.number().int().min(1).optional(),
})

export const ImageOcrConfigSchema = z.object({
  ocrFallback: z.enum(['auto', 'off', 'local']).default('auto').optional(),
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
  token: z.string(), // We don't min(1) here so that empty strings pass Zod, we validate at runtime
  baseURL: z.string().url().optional(),
  modelVersion: z.string().optional(),
  isOcr: z.boolean().optional(),
  enableFormula: z.boolean().optional(),
  enableTable: z.boolean().optional(),
})

export const PdfConfigSchema = z.object({
  converter: z.enum(['unpdf', 'mineru', 'mineru_api', 'markitdown', 'marker', 'external']),
  mineru: ExternalPdfConverterConfigSchema.optional(),
  mineruApi: MineruApiPdfConverterConfigSchema.optional(),
  markitdown: ExternalPdfConverterConfigSchema.optional(),
  marker: ExternalPdfConverterConfigSchema.optional(),
  external: ExternalPdfConverterConfigSchema.optional(),
})

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

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  url: z.string().min(1).optional(),
  allowedTools: z.array(z.string()).optional(),
})

export const AgentExtensionsConfigSchema = z.object({
  mcp: z.object({
    servers: z.array(McpServerConfigSchema).default([]),
  }).optional(),
  skills: z.object({
    enabled: z.boolean().optional(),
    directories: z.array(z.string()).optional(),
  }).optional(),
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
  agentExtensions: AgentExtensionsConfigSchema.optional(),
})
