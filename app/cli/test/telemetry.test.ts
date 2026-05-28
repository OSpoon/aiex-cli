import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initLangfuse } from '@/infrastructure/ai/langfuse-telemetry'

const providerInstances = vi.hoisted(() => {
  const instances: Array<{ register: ReturnType<typeof vi.fn> }> = []
  return instances
})

vi.mock('@opentelemetry/sdk-trace-node', () => {
  class MockNodeTracerProvider {
    register = vi.fn()
    constructor() {
      providerInstances.push(this)
    }
  }
  return { NodeTracerProvider: MockNodeTracerProvider }
})

vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: vi.fn(),
}))

describe('initLangfuse', () => {
  beforeEach(() => {
    providerInstances.length = 0
  })

  it('should not initialize when langfuse config is missing', () => {
    const config = {
      provider: { baseURL: 'https://test.com', apiKey: 'key', models: [] },
      prompt: { systemTemplate: '', userTemplate: '' },
      extraction: { outputDir: '.aiex/extracted' },
    }

    expect(() => initLangfuse(config as any)).not.toThrow()
    expect(providerInstances).toHaveLength(0)
  })

  it('should not initialize when langfuse keys are missing', () => {
    const config = {
      provider: { baseURL: 'https://test.com', apiKey: 'key', models: [] },
      langfuse: {},
      prompt: { systemTemplate: '', userTemplate: '' },
      extraction: { outputDir: '.aiex/extracted' },
    }

    expect(() => initLangfuse(config as any)).not.toThrow()
    expect(providerInstances).toHaveLength(0)
  })

  it('should initialize and not initialize twice', () => {
    const config = {
      provider: { baseURL: 'https://test.com', apiKey: 'key', models: [] },
      langfuse: { publicKey: 'pk-test', secretKey: 'sk-test' },
      prompt: { systemTemplate: '', userTemplate: '' },
      extraction: { outputDir: '.aiex/extracted' },
    }

    initLangfuse(config as any)
    expect(providerInstances).toHaveLength(1)
    expect(providerInstances[0].register).toHaveBeenCalled()

    providerInstances.length = 0
    initLangfuse(config as any)
    expect(providerInstances).toHaveLength(0)
  })
})
