#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = path.join(root, 'dist', 'cli.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-cli-smoke-'))

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function run(args, cwd) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      NO_UPDATE_NOTIFIER: '1',
    },
  })
}

function runExpectFailure(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      NO_UPDATE_NOTIFIER: '1',
    },
  })

  if (result.status === 0)
    throw new Error(`Expected command to fail: aiex ${args.join(' ')}`)

  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

function schemaPath(projectDir, name) {
  return path.join(projectDir, '.aiex', 'schema', name)
}

function createProject(name) {
  const dir = path.join(tempRoot, name)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })
  return dir
}

const baseSchema = {
  title: 'Smoke Customer',
  type: 'object',
  table: { name: 'smoke_customers', timestamps: true },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    email: { type: 'string', format: 'email', unique: true },
    name: { type: 'string', minLength: 2 },
    score: { type: 'number', minimum: 0, maximum: 100 },
    active: { type: 'boolean', default: true },
    metadata: { type: 'object', drizzle: { mode: 'json' } },
  },
  required: ['email', 'name'],
}

try {
  assert(fs.existsSync(cliPath), `Missing built CLI at ${cliPath}. Run pnpm --filter aiex-cli build first.`)

  const generateOnlyProject = createProject('generate-only')
  writeJson(schemaPath(generateOnlyProject, 'customer.json'), baseSchema)
  run(['schema', '--generate'], generateOnlyProject)
  assert(fs.existsSync(path.join(generateOnlyProject, '.aiex', 'drizzle', 'schema.ts')), 'schema --generate did not write Drizzle schema')
  assert(!fs.existsSync(path.join(generateOnlyProject, '.aiex', 'database.db')), 'schema --generate should not create database.db')

  const migrationProject = createProject('migration')
  writeJson(schemaPath(migrationProject, 'customer.json'), baseSchema)
  run(['schema', '--name', 'CLI Smoke'], migrationProject)
  assert(fs.existsSync(path.join(migrationProject, '.aiex', 'database.db')), 'schema did not create database.db')

  const db = new Database(path.join(migrationProject, '.aiex', 'database.db'), { readonly: true })
  try {
    const columns = db.prepare('pragma table_info(smoke_customers)').all()
    assert(columns.some(column => column.name === 'email' && column.notnull === 1), 'email column was not generated as NOT NULL')
    assert(columns.some(column => column.name === 'created_at' && column.notnull === 1), 'created_at timestamp column was not generated')

    const createSql = db.prepare(`
      select sql
      from sqlite_master
      where type = 'table' and name = 'smoke_customers'
    `).get()
    assert(createSql?.sql?.includes('CONSTRAINT "name_min_length"'), 'minLength CHECK constraint was not generated')
    assert(createSql?.sql?.includes('CONSTRAINT "score_min"'), 'minimum CHECK constraint was not generated')
  }
  finally {
    db.close()
  }

  writeJson(schemaPath(migrationProject, 'customer.json'), {
    ...baseSchema,
    properties: {
      id: baseSchema.properties.id,
      email: baseSchema.properties.email,
    },
    required: ['email'],
  })

  const blockedOutput = runExpectFailure(['schema'], migrationProject)
  assert(blockedOutput.includes('High-risk schema migration blocked') || blockedOutput.includes('--force'), 'schema did not block high-risk migration')

  run(['schema', '--force', '--name', 'CLI Smoke Force'], migrationProject)

  console.log('CLI smoke passed')
}
finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
