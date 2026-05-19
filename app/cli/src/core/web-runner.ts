import type { MigrationConfig } from '@/core/schema-sqlite'
import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { serve } from '@hono/node-server'
import { resolvePackageRoot } from '@/core/schema-sqlite'
import { createApp } from '@/server'

const execFileAsync = promisify(execFile)

export interface WebServerStartedInfo {
  url: string
  schemaPath: string
}

export function resolveWebStaticDir(): string {
  return path.join(resolvePackageRoot(), 'dist/web')
}

export async function openBrowser(url: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [url])
    return
  }

  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', url])
    return
  }

  await execFileAsync('xdg-open', [url])
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
