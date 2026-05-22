import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const pkgDir = process.argv[2]
const files = process.argv.slice(3)

if (!pkgDir || files.length === 0) {
  process.exit(0)
}

const absolutePkgDir = path.resolve(process.cwd(), pkgDir)

// Convert file paths to be relative to the package directory
const relativeFiles = files.map((file) => {
  const absolutePath = path.resolve(process.cwd(), file)
  return path.relative(absolutePkgDir, absolutePath)
})

const result = spawnSync('npx', ['eslint', '--fix', ...relativeFiles], {
  cwd: absolutePkgDir,
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? 0)
