import type { MigrationConfig } from '@/domain/schema/types'
import path from 'node:path'
import { serve } from '@hono/node-server'
import open from 'open'
import { resolvePackageRoot } from '@/infrastructure/runtime/package-paths'
import { createApp } from '@/server'

export interface WebServerStartedInfo {
  url: string
  schemaPath: string
}

export function resolveWebStaticDir(): string {
  return path.join(resolvePackageRoot(), 'dist/web')
}

export async function openBrowser(url: string): Promise<void> {
  await open(url)
}

export async function startWebServer(input: {
  config: MigrationConfig
  port: number
  staticDir?: string
  open?: boolean
  onStarted?: (info: WebServerStartedInfo) => void
  onOpenFailed?: (url: string) => void
}): Promise<void> {
  const { config, port } = input
  const staticDir = input.staticDir ?? resolveWebStaticDir()
  const url = `http://localhost:${port}`
  const app = createApp(config, staticDir)

  serve({
    fetch: app.fetch,
    port,
  }, () => {
    input.onStarted?.({ url, schemaPath: config.schemaPath })

    if (input.open === false)
      return

    openBrowser(url).catch(() => {
      input.onOpenFailed?.(url)
    })
  })

  await new Promise(() => {})
}
