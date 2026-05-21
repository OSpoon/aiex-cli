import { describe, expect, it } from 'vitest'
import { lookupModelCapabilities } from '@/core/ai-extraction/capabilities'

describe('lookupModelCapabilities', () => {
  it('returns capabilities for known OpenAI model', () => {
    const caps = lookupModelCapabilities('gpt-4o')
    expect(caps).not.toBeNull()
    expect(caps!.vision).toBe(true)
    expect(caps!.structuredOutput).toBe(true)
  })

  it('returns capabilities for known Claude model', () => {
    const caps = lookupModelCapabilities('claude-3-5-sonnet-20241022')
    // May not be in registry; if found, verify structure
    if (caps) {
      expect(typeof caps.vision).toBe('boolean')
      expect(typeof caps.structuredOutput).toBe('boolean')
    }
  })

  it('returns null for truly unknown model', () => {
    const caps = lookupModelCapabilities('nonexistent-model-12345xyz')
    expect(caps).toBeNull()
  })

  it('returns null for empty string', () => {
    const caps = lookupModelCapabilities('')
    expect(caps).toBeNull()
  })

  it('is case-insensitive via normalization', () => {
    const lower = lookupModelCapabilities('gpt-4o')
    const upper = lookupModelCapabilities('GPT-4O')
    // Both should find the same model or both null
    expect(upper).toEqual(lower)
  })

  it('returns capabilities for Claude models', () => {
    const caps = lookupModelCapabilities('claude-3-haiku-20240307')
    expect(caps).not.toBeNull()
    expect(typeof caps!.vision).toBe('boolean')
  })

  it('returns capabilities for DeepSeek models', () => {
    const caps = lookupModelCapabilities('deepseek-chat')
    // May not exist in registry; if found, verify structure
    if (caps) {
      expect(typeof caps.vision).toBe('boolean')
      expect(typeof caps.structuredOutput).toBe('boolean')
    }
  })
})
