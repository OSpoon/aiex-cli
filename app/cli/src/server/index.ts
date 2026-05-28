import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs/promises'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { aiRoutes } from '@/server/routes/ai'
import { dataRoutes } from '@/server/routes/data'
import { extractRoutes } from '@/server/routes/extract'
import { schemaRoutes } from '@/server/routes/schema'

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/

export function createApp(config: MigrationConfig, staticDir: string): Hono {
  const app = new Hono()

  app.use('*', cors({
    origin: origin => LOCAL_ORIGIN_RE.test(origin) ? origin : null,
  }))

  app.route('/api', schemaRoutes(config))
  app.route('/api', aiRoutes(config))
  app.route('/api', extractRoutes(config))
  app.route('/api', dataRoutes(config))

  app.use('/*', serveStatic({
    root: staticDir,
    rewriteRequestPath: path => path,
  }))

  app.get('*', async (c) => {
    let html: string
    try {
      html = await fs.readFile(`${staticDir}/index.html`, 'utf-8')
    }
    catch {
      html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AIEX Schema Editor</title>
  </head>
  <body>
    <div id="app"></div>
    <p style="font-family:sans-serif;padding:2em;color:#888;">Web UI not built. Run <code>pnpm --filter aiex-web build</code> and restart.</p>
  </body>
</html>`
    }
    return c.html(html)
  })

  return app
}
