import process from 'node:process'
import { defineCommand } from 'citty'
import CliTable3 from 'cli-table3'
import { consola } from 'consola'
import { collectDoctorDiagnostics } from '@/application/doctor/collect-diagnostics'
import {
  doctorDiagnosticsSeverityRows,
  doctorDiagnosticsTableRows,
  formatDoctorDiagnosticsJson,
} from '@/domain/doctor/diagnostics'
import { t } from '@/locales'

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: t('command.doctor.description'),
  },
  args: {
    json: { type: 'boolean', description: t('command.doctor.args.json') },
  },
  async run({ args }) {
    try {
      const diagnostics = await collectDoctorDiagnostics()

      if (args.json) {
        process.stdout.write(formatDoctorDiagnosticsJson(diagnostics))
        return
      }

      consola.info(`${diagnostics.cli.name} ${diagnostics.cli.version}`)

      const table = new CliTable3({
        head: [t('command.doctor.headers.0'), t('command.doctor.headers.1')],
        colAligns: ['right', 'left'],
        style: { compact: true },
      })
      table.push(...doctorDiagnosticsTableRows(diagnostics))

      process.stdout.write(`${table.toString()}\n`)

      const severityRows = doctorDiagnosticsSeverityRows(diagnostics)
      if (severityRows.length) {
        const summary = new CliTable3({
          head: ['status', 'diagnostic'],
          colAligns: ['right', 'left'],
          style: { compact: true },
        })
        summary.push(...severityRows)
        process.stdout.write(`${summary.toString()}\n`)
      }
    }
    catch (err) {
      consola.error(t('command.doctor.diagnosticsFailed', { error: err }))
    }
  },
})
