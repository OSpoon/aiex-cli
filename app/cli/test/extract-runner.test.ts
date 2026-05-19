import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { isImageFile, listSchemas, listSupportedFiles, loadSchema } from '@/core/extract-runner'

describe('listSupportedFiles', () => {
  it('should filter files by supported extensions', () => {
    const dir = `/tmp/test-extract-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/test.txt`, 'hello')
    fs.writeFileSync(`${dir}/test.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/test.png`, 'png')
    fs.writeFileSync(`${dir}/test.exe`, 'binary')
    fs.writeFileSync(`${dir}/test.json`, '{}')

    const files = listSupportedFiles(dir)
    expect(files).toHaveLength(4)
    expect(files.some(f => f.endsWith('.txt'))).toBe(true)
    expect(files.some(f => f.endsWith('.pdf'))).toBe(true)
    expect(files.some(f => f.endsWith('.png'))).toBe(true)
    expect(files.some(f => f.endsWith('.json'))).toBe(true)
    expect(files.some(f => f.endsWith('.exe'))).toBe(false)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob * pattern', () => {
    const dir = `/tmp/test-extract-glob-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/report.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/invoice.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/notes.txt`, 'text')

    const files = listSupportedFiles(dir, '*.pdf')
    expect(files).toHaveLength(2)
    expect(files.every(f => f.endsWith('.pdf'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob prefix pattern', () => {
    const dir = `/tmp/test-extract-prefix-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/report-2024.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/report-2025.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/summary-2024.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/notes.txt`, 'text')

    const files = listSupportedFiles(dir, 'report-*.pdf')
    expect(files).toHaveLength(2)
    expect(files.every(f => path.basename(f).startsWith('report-'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob {a,b} alternation pattern', () => {
    const dir = `/tmp/test-extract-alt-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/data.csv`, 'a,b')
    fs.writeFileSync(`${dir}/data.yaml`, 'a: b')
    fs.writeFileSync(`${dir}/data.json`, '{}')

    const files = listSupportedFiles(dir, '*.{csv,yaml}')
    expect(files).toHaveLength(2)
    expect(files.every(f => f.endsWith('.csv') || f.endsWith('.yaml'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })
})

describe('loadSchema', () => {
  it('should load and validate a valid schema file', async () => {
    const dir = `/tmp/test-schema-${Date.now()}`
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true })
    const schemaPath = path.join(dir, 'schema', 'test.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      title: 'Test',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'test' },
    }))

    const config = { schemaPath: path.join(dir, 'schema'), databasePath: '', drizzleSchemaPath: '', migrationsPath: '', drizzleConfigPath: '' }
    const result = await loadSchema(config, 'test')
    expect(result.schema).toBeDefined()
    expect(result.schema.title).toBe('Test')

    fs.rmSync(dir, { recursive: true })
  })

  it('should return error for missing schema file', async () => {
    const config = { schemaPath: '/nonexistent/schema', databasePath: '', drizzleSchemaPath: '', migrationsPath: '', drizzleConfigPath: '' }
    const result = await loadSchema(config, 'missing')
    expect(result.schema).toBeNull()
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Cannot read schema file')
  })
})

describe('listSchemas', () => {
  it('should list schema files without .json extension', async () => {
    const dir = `/tmp/test-schemas-${Date.now()}`
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'schema', 'users.json'), '{}')
    fs.writeFileSync(path.join(dir, 'schema', 'posts.json'), '{}')
    fs.writeFileSync(path.join(dir, 'schema', 'readme.txt'), 'hello')

    const schemas = await listSchemas(dir)
    expect(schemas).toEqual(['posts', 'users'])

    fs.rmSync(dir, { recursive: true })
  })

  it('should return empty array when schema directory does not exist', async () => {
    const schemas = await listSchemas('/nonexistent-path')
    expect(schemas).toEqual([])
  })
})

describe('isImageFile', () => {
  it('should identify image files by extension', () => {
    expect(isImageFile('photo.png')).toBe(true)
    expect(isImageFile('photo.jpg')).toBe(true)
    expect(isImageFile('photo.jpeg')).toBe(true)
    expect(isImageFile('photo.gif')).toBe(true)
    expect(isImageFile('photo.webp')).toBe(true)
    expect(isImageFile('photo.bmp')).toBe(true)
    expect(isImageFile('photo.svg')).toBe(true)
    expect(isImageFile('document.pdf')).toBe(false)
    expect(isImageFile('notes.txt')).toBe(false)
    expect(isImageFile('data.json')).toBe(false)
  })
})
