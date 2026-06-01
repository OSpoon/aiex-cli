import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import pkg from '~/package.json'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE_ROOT = path.join(ROOT, 'src')
const TEST_ROOT = path.join(ROOT, 'test')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory())
      return walk(fullPath)
    return fullPath
  })
}

function readTextFiles(dir: string): Array<{ file: string, content: string }> {
  return walk(dir)
    .filter(file => /\.(?:ts|vue)$/.test(file))
    .filter(file => !file.includes(`${path.sep}src${path.sep}core${path.sep}`))
    .map(file => ({ file, content: fs.readFileSync(file, 'utf8') }))
}

describe('package boundary', () => {
  const coreAlias = `@${'/core/'}`

  it('keeps public exports intentionally small', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './cli',
      './package.json',
    ])
  })

  it('does not allow app code or tests to import through core compatibility wrappers', () => {
    const offenders = [
      ...readTextFiles(SOURCE_ROOT),
      ...readTextFiles(TEST_ROOT),
    ].filter(({ content }) => content.includes(coreAlias))

    expect(offenders.map(({ file }) => path.relative(ROOT, file))).toEqual([])
  })

  it('does not keep a core source directory', () => {
    expect(fs.existsSync(path.join(SOURCE_ROOT, 'core'))).toBe(false)
  })
})
