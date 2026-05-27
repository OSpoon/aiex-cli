import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { doctorCommand } from '@/commands/doctor'

vi.mock('@/core/doctor-collector', () => ({
  collectDoctorDiagnostics: vi.fn(),
}))

const diagnosticsMock = vi.hoisted(() => ({
  cli: { name: 'aiex', version: '0.0.0' },
  system: { platform: 'darwin', nodeVersion: 'v22.0.0' },
  config: { exists: true, path: '/mock/.aiex' },
  aiProvider: { configured: true, modelCount: 1 },
  database: { exists: true, path: '/mock/.aiex/database.db', tableCount: 2 },
}))

const cmd = doctorCommand as any

describe('doctorCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('doctor')
    expect(cmd.meta.description).toBe('Print environment and configuration diagnostics')
  })

  it('should define json arg as boolean', () => {
    expect(cmd.args.json).toBeDefined()
    expect(cmd.args.json.type).toBe('boolean')
  })
})

describe('doctorCommand.run', () => {
  it('should output JSON when --json flag is set', async () => {
    const { collectDoctorDiagnostics } = await import('@/core/doctor-collector')
    vi.mocked(collectDoctorDiagnostics).mockResolvedValueOnce(diagnosticsMock)
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await cmd.run({ args: { json: true } })

    expect(writeSpy).toHaveBeenCalled()
    const written = writeSpy.mock.calls[0][0]
    expect(typeof written).toBe('string')
    const parsed = JSON.parse(written as string)
    expect(parsed.cli.name).toBe('aiex')

    writeSpy.mockRestore()
  })
})
