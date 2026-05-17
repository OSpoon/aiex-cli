import process from 'node:process'
import { defineCommand } from 'citty'
import CliTable3 from 'cli-table3'
import { consola } from 'consola'
import {
  doctorDiagnosticsTableRows,
  formatDoctorDiagnosticsJson,
} from '@/core/doctor'
import { collectDoctorDiagnostics } from '@/doctor'

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Print environment and configuration diagnostics',
  },
  args: {
    json: { type: 'boolean', description: 'Print diagnostics as JSON' },
  },
  async run({ args }) {
    try {
      const diagnostics = await collectDoctorDiagnostics()

      if (args.json) {
        process.stdout.write(formatDoctorDiagnosticsJson(diagnostics))
        return
      }

      consola.info(`${diagnostics.cli.name} ${diagnostics.cli.version}`)

      const t = new CliTable3({
        head: ['key', 'value'],
        colAligns: ['right', 'left'],
        style: { compact: true },
      })
      t.push(...doctorDiagnosticsTableRows(diagnostics))

      process.stdout.write(`${t.toString()}\n`)
    }
    catch (err) {
      consola.error(`Doctor diagnostics failed: ${err}`)
    }
  },
})
