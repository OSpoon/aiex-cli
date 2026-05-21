import { describe, expect, it } from 'vitest'
import { selectModel } from '@/core/ai-extraction/model-selector'

const visionModel = {
  name: 'gpt-4o',
  capabilities: { vision: true, structuredOutput: true },
}

const textModel = {
  name: 'gpt-4o-mini',
  capabilities: { vision: false, structuredOutput: true },
}

const plainModel = {
  name: 'llama3.2',
  capabilities: { vision: false, structuredOutput: false },
}

describe('model-selector', () => {
  describe('selectModel', () => {
    it('throws when no models configured', () => {
      expect(() => selectModel({
        models: [],
        isImage: false,
      })).toThrow('No AI models configured')
    })

    it('selects vision-capable model for image input', () => {
      const result = selectModel({
        models: [plainModel, visionModel],
        isImage: true,
      })
      expect(result.name).toBe('gpt-4o')
      expect(result.capabilities.vision).toBe(true)
    })

    it('throws when image input but no vision model', () => {
      expect(() => selectModel({
        models: [textModel],
        isImage: true,
        fileName: 'photo.jpg',
      })).toThrow('vision capability')
    })

    it('selects structured output model for text when available', () => {
      const result = selectModel({
        models: [plainModel, textModel],
        isImage: false,
      })
      expect(result.name).toBe('gpt-4o-mini')
      expect(result.capabilities.structuredOutput).toBe(true)
    })

    it('falls back to first model when no structured output model', () => {
      const result = selectModel({
        models: [plainModel],
        isImage: false,
      })
      expect(result.name).toBe('llama3.2')
    })

    it('prefers vision over structured output for images', () => {
      const visionOnly = {
        name: 'llava',
        capabilities: { vision: true, structuredOutput: false },
      }
      const result = selectModel({
        models: [textModel, visionOnly],
        isImage: true,
      })
      expect(result.name).toBe('llava')
    })

    it('filters models by input tokens when maxTokens is set', () => {
      const smallModel = {
        name: 'small',
        capabilities: { vision: false, structuredOutput: true, maxTokens: 4000 },
      }
      const largeModel = {
        name: 'large',
        capabilities: { vision: false, structuredOutput: true, maxTokens: 32000 },
      }

      const result = selectModel({
        models: [smallModel, largeModel],
        isImage: false,
        inputTokens: 5000,
      })
      expect(result.name).toBe('large')
    })

    it('filters models by output tokens when maxOutputTokens is set', () => {
      const smallModel = {
        name: 'small',
        capabilities: { vision: false, structuredOutput: true, maxOutputTokens: 1000 },
      }
      const largeModel = {
        name: 'large',
        capabilities: { vision: false, structuredOutput: true, maxOutputTokens: 16000 },
      }

      const result = selectModel({
        models: [smallModel, largeModel],
        isImage: false,
        outputTokens: 2000,
      })
      expect(result.name).toBe('large')
    })

    it('falls back to all models when no model matches token constraints', () => {
      const smallModel = {
        name: 'small',
        capabilities: { vision: true, structuredOutput: true, maxTokens: 4000 },
      }

      const result = selectModel({
        models: [smallModel],
        isImage: true,
        inputTokens: 999999,
      })
      // Falls back to all models, picks first with vision
      expect(result.name).toBe('small')
    })

    it('returns model capabilities in result', () => {
      const result = selectModel({
        models: [visionModel],
        isImage: true,
      })
      expect(result.capabilities).toEqual({
        vision: true,
        structuredOutput: true,
      })
    })
  })
})
