import type { AIConfig } from '@/types'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

let langfuseInitialized = false

export function initLangfuse(config: AIConfig): void {
  if (!config.langfuse?.publicKey || !config.langfuse.secretKey)
    return
  if (langfuseInitialized)
    return
  langfuseInitialized = true

  try {
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey,
          baseUrl: config.langfuse.host || 'https://us.cloud.langfuse.com',
          exportMode: 'immediate',
        }),
      ],
    })

    provider.register()
  }
  catch (e) {
    console.warn('[Langfuse] Failed to initialize tracing:', e instanceof Error ? e.message : e)
  }
}
