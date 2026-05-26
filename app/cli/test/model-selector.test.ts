import { describe, expect, it } from 'vitest'
import { selectModel } from '@/core/ai-extraction/model-selector'

const visionModel = {
  name: 'gpt-4o',
  capabilities: { structuredOutput: true },
}

const textModel = {
  name: 'gpt-4o-mini',
  capabilities: { structuredOutput: true },
}

const plainModel = {
  name: 'llama3.2',
  capabilities: { structuredOutput: false },
}

describe('model-selector', () => {
  describe('selectModel', () => {
    it('throws when no models configured', () => {
      expect(() => selectModel({
        models: [],
      })).toThrow('No AI models configured')
    })

    it('selects structured output model for text when available', () => {
      const result = selectModel({
        models: [plainModel, textModel],
      })
      expect(result.name).toBe('gpt-4o-mini')
      expect(result.capabilities.structuredOutput).toBe(true)
    })

    it('falls back to first model when no structured output model', () => {
      const result = selectModel({
        models: [plainModel],
      })
      expect(result.name).toBe('llama3.2')
    })

    it('filters models by input tokens when maxTokens is set', () => {
      const smallModel = {
        name: 'small',
        capabilities: { structuredOutput: true, maxTokens: 4000 },
      }
      const largeModel = {
        name: 'large',
        capabilities: { structuredOutput: true, maxTokens: 32000 },
      }

      const result = selectModel({
        models: [smallModel, largeModel],
        inputTokens: 5000,
      })
      expect(result.name).toBe('large')
    })

    it('filters models by output tokens when maxOutputTokens is set', () => {
      const smallModel = {
        name: 'small',
        capabilities: { structuredOutput: true, maxOutputTokens: 1000 },
      }
      const largeModel = {
        name: 'large',
        capabilities: { structuredOutput: true, maxOutputTokens: 16000 },
      }

      const result = selectModel({
        models: [smallModel, largeModel],
        outputTokens: 2000,
      })
      expect(result.name).toBe('large')
    })

    it('falls back to all models when no model matches token constraints', () => {
      const smallModel = {
        name: 'small',
        capabilities: { structuredOutput: true, maxTokens: 4000 },
      }

      const result = selectModel({
        models: [smallModel],
        inputTokens: 999999,
      })
      // Falls back to all models, picks the first structured-output candidate.
      expect(result.name).toBe('small')
    })

    it('returns model capabilities in result', () => {
      const result = selectModel({
        models: [visionModel],
      })
      expect(result.capabilities).toEqual({
        structuredOutput: true,
      })
    })
  })
})
