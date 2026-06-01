#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-package-smoke-'))

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
    },
  })
}

try {
  const packOutput = execFileSync('pnpm', ['pack', '--pack-destination', tempDir], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
    },
  })
  const tarball = packOutput.trim().split(/\r?\n/).at(-1)
  if (!tarball)
    throw new Error('pnpm pack did not report a tarball path')

  const tarballPath = path.isAbsolute(tarball) ? tarball : path.join(tempDir, tarball)
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"aiex-package-smoke","private":true,"type":"module"}\n')
  run('pnpm', ['add', tarballPath], { cwd: tempDir })
  run('node', ['node_modules/aiex-cli/dist/cli.mjs', '--help'], { cwd: tempDir })
}
finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
