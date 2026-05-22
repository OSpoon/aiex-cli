import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { dumpCommand } from '@/commands/dump'

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

const cmd = dumpCommand as any
const originalCwd = process.cwd()
const cleanupDirs = new Set<string>()

function cleanupDir(dir: string): void {
  if (path.resolve(process.cwd()).toLowerCase() === path.resolve(dir).toLowerCase())
    process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  cleanupDirs.delete(dir)
}

function createProjectFixture(): { dir: string, dbPath: string } {
  const dir = path.join(os.tmpdir(), `test-export-project-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })

  const dbPath = path.join(dir, '.aiex', 'database.db')
  const db = new Database(dbPath)
  db.exec(`
    create table members (
      id integer primary key,
      name text not null,
      is_active integer,
      score real
    )
  `)
  const insert = db.prepare('insert into members (id, name, is_active, score) values (?, ?, ?, ?)')
  insert.run(1, 'John Doe', 1, 95.5)
  insert.run(2, 'Jane Smith', 0, 88.0)
  db.close()

  fs.writeFileSync(path.join(dir, '.aiex', 'schema', 'member.json'), JSON.stringify({
    title: 'Member Schema',
    type: 'object',
    table: { name: 'members' },
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      is_active: { type: 'boolean' },
      score: { type: 'number' },
    },
  }))

  return { dir, dbPath }
}

describe('dumpCommand definition', () => {
  it('should have correct name and description', () => {
    expect(cmd.meta.name).toBe('dump')
    expect(cmd.meta.description).toContain('Dump SQLite database table')
  })

  it('should define table, schema, format, and output args', () => {
    expect(cmd.args.table).toBeDefined()
    expect(cmd.args.schema).toBeDefined()
    expect(cmd.args.format).toBeDefined()
    expect(cmd.args.output).toBeDefined()
  })
})

describe('dumpCommand.run', () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    for (const dir of [...cleanupDirs]) {
      cleanupDir(dir)
    }
  })

  it('fails if neither table nor schema is provided', async () => {
    await cmd.run({ args: {} })
    expect(process.exitCode).toBe(1)
  })

  it('exports table to CSV successfully using table name', async () => {
    const { dir } = createProjectFixture()
    process.chdir(dir)

    const outputPath = path.join(dir, 'exported_members.csv')
    await cmd.run({
      args: {
        table: 'members',
        format: 'csv',
        output: outputPath,
      },
    })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)

    const csvContent = fs.readFileSync(outputPath, 'utf8')
    // Check BOM prefix
    expect(csvContent.startsWith('\uFEFF')).toBe(true)
    // Check content (SheetJS sheet_to_csv formats it)
    expect(csvContent).toContain('id,name,is_active,score')
    // Schema mapping should change 1/0 to true/false
    expect(csvContent).toContain('1,John Doe,true,95.5')
    expect(csvContent).toContain('2,Jane Smith,false,88')
  })

  it('exports table to XLSX successfully using schema name', async () => {
    const { dir } = createProjectFixture()
    process.chdir(dir)

    const outputPath = path.join(dir, 'exported_members.xlsx')
    await cmd.run({
      args: {
        schema: 'member',
        format: 'xlsx',
        output: outputPath,
      },
    })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)

    // Load and read the written Excel file using SheetJS
    const wb = XLSX.readFile(outputPath)
    expect(wb.SheetNames).toContain('members')
    const ws = wb.Sheets.members
    const data = XLSX.utils.sheet_to_json(ws) as any[]

    expect(data).toHaveLength(2)
    // SheetJS converts cell types back to JS types
    expect(data[0]).toEqual({
      id: 1,
      name: 'John Doe',
      is_active: true, // boolean conversion
      score: 95.5, // numeric type
    })
    expect(data[1]).toEqual({
      id: 2,
      name: 'Jane Smith',
      is_active: false, // boolean conversion
      score: 88, // numeric type
    })
  })

  it('infers format from output file extension', async () => {
    const { dir } = createProjectFixture()
    process.chdir(dir)

    const outputPath = path.join(dir, 'auto_members.xlsx')
    await cmd.run({
      args: {
        table: 'members',
        output: outputPath,
      },
    })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)

    const wb = XLSX.readFile(outputPath)
    expect(wb.SheetNames).toContain('members')
  })

  it('fails if specified table does not match schema table', async () => {
    const { dir } = createProjectFixture()
    process.chdir(dir)

    await cmd.run({
      args: {
        table: 'wrong_table',
        schema: 'member',
      },
    })
    expect(process.exitCode).toBe(1)
  })

  it('fails if table does not exist in database', async () => {
    const { dir } = createProjectFixture()
    process.chdir(dir)

    await cmd.run({
      args: {
        table: 'nonexistent_table',
      },
    })
    expect(process.exitCode).toBe(1)
  })

  it('exports complex types and fallback DB numeric types to XLSX', async () => {
    const { dir } = createRichProjectFixture()
    process.chdir(dir)

    const outputPath = path.join(dir, 'exported_rich.xlsx')
    await cmd.run({
      args: {
        table: 'rich_table',
        schema: 'rich',
        format: 'xlsx',
        output: outputPath,
      },
    })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)

    const wb = XLSX.readFile(outputPath)
    const ws = wb.Sheets.rich_table
    const data = XLSX.utils.sheet_to_json(ws) as any[]

    expect(data).toHaveLength(1)
    expect(data[0].score_fallback).toBe(99.5)
    expect(data[0].data_object).toBe('{"key": "value"}')
    expect(data[0].null_val ?? '').toBe('')
  })

  it('exports empty table successfully', async () => {
    const { dir } = createEmptyProjectFixture()
    process.chdir(dir)

    const outputPath = path.join(dir, 'exported_empty.csv')
    await cmd.run({
      args: {
        table: 'empty_table',
        format: 'csv',
        output: outputPath,
      },
    })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)
    const csvContent = fs.readFileSync(outputPath, 'utf8')
    expect(csvContent).toContain('id,name')
  })
})

function createRichProjectFixture(): { dir: string, dbPath: string } {
  const dir = path.join(os.tmpdir(), `test-export-rich-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })

  const dbPath = path.join(dir, '.aiex', 'database.db')
  const db = new Database(dbPath)
  db.exec(`
    create table rich_table (
      id integer primary key,
      data_object text,
      score_fallback real,
      null_val text
    )
  `)
  const insert = db.prepare('insert into rich_table (id, data_object, score_fallback, null_val) values (?, ?, ?, ?)')
  insert.run(1, '{"key": "value"}', '99.5', null)
  db.close()

  fs.writeFileSync(path.join(dir, '.aiex', 'schema', 'rich.json'), JSON.stringify({
    title: 'Rich Schema',
    type: 'object',
    table: { name: 'rich_table' },
    properties: {
      id: { type: 'integer' },
      data_object: { type: 'object' },
      null_val: { type: 'string' },
    },
  }))

  return { dir, dbPath }
}

function createEmptyProjectFixture(): { dir: string, dbPath: string } {
  const dir = path.join(os.tmpdir(), `test-export-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })

  const dbPath = path.join(dir, '.aiex', 'database.db')
  const db = new Database(dbPath)
  db.exec(`
    create table empty_table (
      id integer primary key,
      name text
    )
  `)
  db.close()

  fs.writeFileSync(path.join(dir, '.aiex', 'schema', 'empty.json'), JSON.stringify({
    title: 'Empty Schema',
    type: 'object',
    table: { name: 'empty_table' },
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
    },
  }))

  return { dir, dbPath }
}
