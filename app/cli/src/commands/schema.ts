import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { intro, outro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import {
  createMigrationConfig,
  parseAllSchemas,
  resolveHelperPath,
  resolveTsxPath,
} from '@/core/schema-sqlite'
import tableSchemaFile from '~/schemas/table-schema.json'

const execFileAsync = promisify(execFile)

function fail(message?: string): void {
  if (message)
    consola.error(message)
  outro('Failed!')
  process.exitCode = 1
}

async function writeJsonIfAbsent(filePath: string, data: unknown): Promise<'created' | 'skipped'> {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' })
    return 'created'
  }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return 'skipped'
    throw error
  }
}

async function generateFromFiles(schemaFiles: string[], config: MigrationConfig): Promise<boolean> {
  const entries = await Promise.all(
    schemaFiles.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf-8')
      return { filePath, content }
    }),
  )

  const result = parseAllSchemas(entries)
  if (!result.success) {
    consola.error(result.error)
    return false
  }

  for (const warning of result.data.warnings) {
    consola.warn(warning)
  }

  await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
  await fs.writeFile(config.drizzleSchemaPath, result.data.drizzleCode)
  consola.success(`Generated ${pc.cyan('.aiex/drizzle/schema.ts')} from ${schemaFiles.length} schema file(s)`)
  return true
}

async function migrate(config: MigrationConfig, migrationName?: string): Promise<boolean> {
  const helperPath = resolveHelperPath()
  const tsxPath = resolveTsxPath()
  const helperArgs = [tsxPath, helperPath, config.drizzleSchemaPath, config.migrationsPath, config.databasePath]
  if (migrationName)
    helperArgs.push(migrationName)

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      helperArgs,
      { cwd: process.cwd() },
    )

    const result = JSON.parse(stdout.trim())

    if (!result.success) {
      consola.error('Failed to generate migration')
      consola.error(result.error)
      return false
    }

    if (result.changes === 0) {
      consola.info(pc.gray('No changes detected'))
      return true
    }

    consola.success(pc.green('Migration files generated'))
    consola.success(pc.green('Database migrated'))
    return true
  }
  catch (error: unknown) {
    consola.error('Failed to generate migration')
    const execError = error as { stderr?: string, message?: string }
    if (execError.stderr)
      consola.error(execError.stderr)
    else consola.error(execError.message || String(error))
    return false
  }
}

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description: 'Sync JSON Schema to SQLite database',
  },
  args: {
    init: {
      type: 'boolean',
      alias: 'i',
      description: 'Only initialize .aiex/ directory with example schema',
      default: false,
    },
    generate: {
      type: 'boolean',
      alias: 'g',
      description: 'Only generate Drizzle schema, skip migrate',
      default: false,
    },
    name: {
      type: 'string',
      description: 'Name for the migration',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex schema '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)

    if (args.init) {
      await fs.mkdir(config.schemaPath, { recursive: true })
      await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
      await fs.mkdir(config.migrationsPath, { recursive: true })

      // Example: Blog system with users, posts, and comments
      // Demonstrates: nested objects, has-one/has-many relations, various types, constraints

      const userSchema = {
        $schema: (tableSchemaFile as { $id: string }).$id,
        title: 'User',
        type: 'object',
        table: { name: 'users', timestamps: true, softDelete: true },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          email: { type: 'string', format: 'email', unique: true },
          username: { type: 'string', minLength: 3, maxLength: 50, unique: true },
          displayName: { type: 'string', maxLength: 100 },
          bio: { type: 'string', maxLength: 500 },
          avatarUrl: { type: 'string', format: 'uri' },
          role: { type: 'string', default: 'member' },
          isActive: { type: 'boolean', default: true },
          lastLoginAt: { type: 'string', format: 'date-time' },
          // Profile as embedded JSON (not a separate table)
          profile: {
            type: 'object',
            drizzle: { mode: 'json' },
            properties: {
              website: { type: 'string' },
              location: { type: 'string' },
              socialLinks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    platform: { type: 'string' },
                    url: { type: 'string' },
                  },
                },
              },
            },
          },
          // Preferences with nested relation (separate table, has-one)
          preferences: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              theme: { type: 'string', default: 'light' },
              language: { type: 'string', default: 'en' },
              emailNotifications: { type: 'boolean', default: true },
              pushNotifications: { type: 'boolean', default: false },
            },
          },
        },
        required: ['email', 'username'],
      }

      const postSchema = {
        $schema: (tableSchemaFile as { $id: string }).$id,
        title: 'Post',
        type: 'object',
        table: { name: 'posts', timestamps: true, softDelete: true },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          title: { type: 'string', minLength: 5, maxLength: 200 },
          slug: { type: 'string', maxLength: 250, unique: true },
          content: { type: 'string' },
          excerpt: { type: 'string', maxLength: 300 },
          authorId: { type: 'integer' },
          status: { type: 'string', default: 'draft' },
          viewCount: { type: 'integer', default: 0, minimum: 0 },
          likeCount: { type: 'integer', default: 0, minimum: 0 },
          publishedAt: { type: 'string', format: 'date-time' },
          // Tags as JSON array
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
          // Metadata as embedded JSON
          metadata: {
            type: 'object',
            drizzle: { mode: 'json' },
            properties: {
              featuredImage: { type: 'string' },
              readingTime: { type: 'integer' },
              seoTitle: { type: 'string' },
              seoDescription: { type: 'string' },
            },
          },
          // Comments with nested relation (separate table, has-many)
          comments: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                content: { type: 'string', minLength: 1, maxLength: 1000 },
                authorId: { type: 'integer' },
                status: { type: 'string', default: 'pending' },
                parentId: { type: 'integer' },
              },
            },
          },
        },
        required: ['title', 'slug', 'authorId'],
      }

      const userStatus = await writeJsonIfAbsent(path.join(config.schemaPath, 'user.json'), userSchema)
      const postStatus = await writeJsonIfAbsent(path.join(config.schemaPath, 'post.json'), postSchema)

      consola.success(`Initialized ${pc.cyan('.aiex/')} with example schemas`)
      if (userStatus === 'skipped')
        consola.warn(`${pc.cyan('.aiex/schema/user.json')} already exists, skipped`)
      if (postStatus === 'skipped')
        consola.warn(`${pc.cyan('.aiex/schema/post.json')} already exists, skipped`)
      consola.info('Example includes: User (with preferences has-one), Post (with comments has-many)')
      outro('Run: aiex schema')
      return
    }

    // Scan .aiex/schema/ for JSON Schema files
    let schemaFiles: string[]
    try {
      schemaFiles = await fs.readdir(config.schemaPath)
      schemaFiles = schemaFiles
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(config.schemaPath, f))
    }
    catch {
      schemaFiles = []
    }

    if (schemaFiles.length === 0) {
      consola.info('Use --init to initialize with an example schema')
      fail(`No schema files found in ${pc.cyan('.aiex/schema/')}`)
      return
    }

    // Generate
    const s1 = spinner()
    s1.start('Generating Drizzle schema...')

    const genOk = await generateFromFiles(schemaFiles, config)
    s1.stop(genOk ? 'Schema generated' : 'Generation failed')

    if (!genOk) {
      fail()
      return
    }

    if (args.generate) {
      outro('Done! Run without --generate to apply migrations')
      return
    }

    // Migrate
    const s2 = spinner()
    s2.start('Running migrations...')
    const migOk = await migrate(config, args.name)
    s2.stop(migOk ? 'Migrations applied' : 'Migration failed')

    if (!migOk) {
      fail()
      return
    }

    outro('Done!')
  },
})
