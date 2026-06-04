import type { PromptConfig } from './types'
import defaultPrompts from '~/assets/default-prompts.json'

export const PLACEHOLDER_SCHEMA = '{schema}'
export const PLACEHOLDER_TEXT = '{text}'

export const DEFAULT_EXTRACTION_SYSTEM_TEMPLATE = defaultPrompts.systemTemplate
export const DEFAULT_EXTRACTION_USER_TEMPLATE = defaultPrompts.userTemplate

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  systemTemplate: DEFAULT_EXTRACTION_SYSTEM_TEMPLATE,
  userTemplate: DEFAULT_EXTRACTION_USER_TEMPLATE,
}

export const EVIDENCE_INSTRUCTIONS = `Evidence requirements:
- Also return a top-level "_evidence" object.
- For each top-level scalar field you extracted from the text, include "_evidence.<field>.quote".
- The quote must be an exact contiguous substring copied from the input text.
- Prefer the shortest quote that still uniquely identifies the field in the document.
- Include the field label and nearby context when a value is repeated, for example "考试年份：2017年" instead of "2017", or "语文 106 150 71%" instead of "150".
- Do not use a quote that supports a different field with the same repeated value.
- Do not invent offsets. Only provide quotes.
- If no exact quote supports a field, omit that field from "_evidence".`

export const CORRECTION_SYSTEM_PROMPT = `You are a precise data correction assistant. Your task is to correct validation errors in a previously generated JSON object to make it comply with the provided JSON Schema.
        
CRITICAL RULES:
1. Only correct the fields that failed validation.
2. Preserve all other correctly extracted fields and their values exactly.
3. Return ONLY the corrected JSON object. No explanations, no markdown blocks other than JSON.`

export function buildCorrectionUserPrompt(input: {
  text: string
  schema: Record<string, unknown>
  invalidJson: string
  error: string
  includeEvidenceInstructions: boolean
}): string {
  return `The JSON data you generated previously failed validation. Please correct it.

[Original Text]
${input.text || 'Data is contained in the attached file.'}

[JSON Schema Definition]
${JSON.stringify(input.schema, null, 2)}

[Previously Generated Invalid JSON]
${input.invalidJson}

[Validation Error Details]
${input.error}

${input.includeEvidenceInstructions ? EVIDENCE_INSTRUCTIONS : ''}

Please output the corrected JSON object now:`
}
