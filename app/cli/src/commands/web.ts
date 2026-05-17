import { exec } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { intro, spinner } from '@clack/prompts'
import { serve } from '@hono/node-server'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { createMigrationConfig, resolvePackageRoot } from '@/core/schema-sqlite'
import { createApp } from '@/server'

const execAsync = promisify(exec)

export const webCommand = defineCommand({
  meta: {
    name: 'web',
    description: 'Start visual JSON Schema editor',
  },
  args: {
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on',
      default: '13000',
    },
    open: {
      type: 'boolean',
      alias: 'o',
      description: 'Open browser after starting',
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex web '))

    const cwd = process.cwd()
    const port = Number(args.port) || 13000
    const config = createMigrationConfig(cwd)

    // Resolve static files from package root
    const packageRoot = resolvePackageRoot()
    const staticDir = path.join(packageRoot, 'dist/web')

    const s = spinner()
    s.start('Starting web server...')

    const app = createApp(config, staticDir)

    serve({
      fetch: app.fetch,
      port,
    }, () => {
      s.stop(`Server running at ${pc.cyan(`http://localhost:${port}`)}`)
      consola.info(`Schema directory: ${pc.dim(config.schemaPath)}`)
      consola.info('Press Ctrl+C to stop')

      if (args.open) {
        const url = `http://localhost:${port}`
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        execAsync(`${cmd} ${url}`).catch(() => {
          consola.warn(`Could not open browser. Visit ${url} manually.`)
        })
      }
    })

    await new Promise(() => {})
  },
})
