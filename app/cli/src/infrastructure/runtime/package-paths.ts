import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(__filename)

export function resolvePackageRoot(): string {
  const pkgPath = require.resolve('aiex-cli/package.json')
  return path.dirname(pkgPath)
}

export function resolveTsxPath(): string {
  try {
    return require.resolve('tsx/cli', { paths: [process.cwd()] })
  }
  catch {
    return require.resolve('tsx/cli')
  }
}

export function resolveHelperPath(): string {
  try {
    return path.join(resolvePackageRoot(), 'src/infrastructure/schema/migrate-helper.ts')
  }
  catch {
    return path.join(__dirname, '../schema/migrate-helper.ts')
  }
}
