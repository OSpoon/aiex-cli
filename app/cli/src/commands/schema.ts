import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import {
  generateSchemaFromFiles,
  listSchemaFiles,
  runSchemaMigration,
} from '@/application/schema/schema-sync'
import { failCommand } from '@/commands/utils'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'
import { initI18n, t } from '@/locales'

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description: t('command.schema.description'),
  },
  args: {
    generate: {
      type: 'boolean',
      alias: 'g',
      description: t('command.schema.args.generate'),
      default: false,
    },
    name: {
      type: 'string',
      description: t('command.schema.args.name'),
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex schema '))
    await initI18n()

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)

    const schemaFiles = await listSchemaFiles(config.schemaPath)

    if (schemaFiles.length === 0) {
      consola.info(t('command.schema.runWebHint', { cmd: pc.cyan('aiex web') }))
      failCommand(t('command.schema.noSchemas', { path: pc.cyan('.aiex/schema/') }))
      return
    }

    // Generate
    const s1 = spinner()
    s1.start(t('command.schema.generating'))

    const generated = await generateSchemaFromFiles(schemaFiles, config)
    for (const warning of generated.warnings) {
      consola.warn(warning)
    }
    if (generated.success) {
      consola.success(t('command.schema.generated', { path: pc.cyan('.aiex/drizzle/schema.ts'), count: generated.schemaCount }))
    }
    else if (generated.error) {
      consola.error(generated.error)
    }
    s1.stop(generated.success ? t('command.schema.generatedOk') : t('command.schema.generatedFail'))

    if (!generated.success) {
      failCommand(t('common.failed'))
      return
    }

    if (args.generate) {
      outro(t('command.schema.runWithoutGenerate'))
      return
    }

    // Migrate
    const s2 = spinner()
    s2.start(t('command.schema.runningMigrations'))
    const migration = await runSchemaMigration(config, args.name)
    if (!migration.success) {
      consola.error(t('command.schema.migrationFailed'))
      consola.error(migration.error || t('command.schema.migrationFail'))
    }
    else if (migration.changes === 0) {
      consola.info(pc.gray(t('command.schema.noChanges')))
    }
    else {
      consola.success(pc.green(t('command.schema.migrationFilesGenerated')))
      consola.success(pc.green(t('command.schema.databaseMigrated')))
    }
    s2.stop(migration.success ? t('command.schema.migrationsApplied') : t('command.schema.migrationFail'))

    if (!migration.success) {
      failCommand(t('common.failed'))
      return
    }

    outro(t('common.done'))
  },
})
