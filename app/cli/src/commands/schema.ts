import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { failCommand } from '@/commands/utils'
import {
  generateSchemaFromFiles,
  listSchemaFiles,
  runSchemaMigration,
} from '@/core/schema-runner'
import { createMigrationConfig } from '@/core/schema-sqlite'

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description: 'Sync JSON Schema to SQLite database',
  },
  args: {
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

    const schemaFiles = await listSchemaFiles(config.schemaPath)

    if (schemaFiles.length === 0) {
      consola.info(`Run ${pc.cyan('aiex web')} to create and configure schemas in the Web UI`)
      failCommand(`No schema files found in ${pc.cyan('.aiex/schema/')}`)
      return
    }

    // Generate
    const s1 = spinner()
    s1.start('Generating Drizzle schema...')

    const generated = await generateSchemaFromFiles(schemaFiles, config)
    for (const warning of generated.warnings) {
      consola.warn(warning)
    }
    if (generated.success) {
      consola.success(`Generated ${pc.cyan('.aiex/drizzle/schema.ts')} from ${generated.schemaCount} schema file(s)`)
    }
    else if (generated.error) {
      consola.error(generated.error)
    }
    s1.stop(generated.success ? 'Schema generated' : 'Generation failed')

    if (!generated.success) {
      failCommand()
      return
    }

    if (args.generate) {
      outro('Done! Run without --generate to apply migrations')
      return
    }

    // Migrate
    const s2 = spinner()
    s2.start('Running migrations...')
    const migration = await runSchemaMigration(config, args.name)
    if (!migration.success) {
      consola.error('Failed to generate migration')
      consola.error(migration.error || 'Migration failed')
    }
    else if (migration.changes === 0) {
      consola.info(pc.gray('No changes detected'))
    }
    else {
      consola.success(pc.green('Migration files generated'))
      consola.success(pc.green('Database migrated'))
    }
    s2.stop(migration.success ? 'Migrations applied' : 'Migration failed')

    if (!migration.success) {
      failCommand()
      return
    }

    outro('Done!')
  },
})
