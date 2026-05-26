import fs from 'node:fs/promises'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

const TRANSCRIPTION_PROMPT = 'Transcribe all visible text from this image accurately. Preserve the layout and line breaks as much as possible.'

export async function transcribeImageWithVision(
  imagePath: string,
  baseURL: string,
  apiKey: string,
  modelName: string,
  timeoutMs?: number,
): Promise<{ text: string, modelName: string }> {
  const provider = createOpenAICompatible({
    baseURL,
    name: 'openai-compatible',
    apiKey,
  })

  const buffer = await fs.readFile(imagePath)
  const effectiveTimeout = timeoutMs ?? 300_000

  const result = await generateText({
    model: provider.chatModel(modelName),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIPTION_PROMPT },
          { type: 'image', image: buffer },
        ],
      },
    ],
    abortSignal: AbortSignal.timeout(effectiveTimeout),
  })

  return {
    text: result.text,
    modelName,
  }
}
