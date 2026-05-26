import type { AppConfig } from '@/types'
import process from 'node:process'
import Conf from 'conf'
import pkg from '~/package.json'

export function createConfig(): Conf<AppConfig> {
  return new Conf<AppConfig>({
    cwd: process.env.CLI_CONFIG_DIR,
    projectName: process.env.CLI_CONFIG_PROJECT_NAME || pkg.name,
  })
}

export function seedConfig(config = createConfig()): void {
  if (!config.has('name'))
    config.set('name', pkg.name)
  if (!config.has('version'))
    config.set('version', pkg.version)
}
