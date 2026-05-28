import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { doctorCommand } from '@/commands/doctor'

vi.mock('@/application/doctor/collect-diagnostics', () => ({
  collectDoctorDiagnostics: vi.fn(),
}))

const diagnosticsMock = vi.hoisted(() => ({
  cli: { name: 'aiex', version: '0.0.0', executable: '/usr/local/bin/aiex' },
  runtime: { node: 'v22.0.0', platform: 'darwin', arch: 'arm64', shell: '/bin/zsh', packageManager: 'pnpm' },
  system: { os: 'darwin', cwd: '/mock' },
  imageOcr: { platformSupported: true, dependencyLoaded: true, ocrOk: false },
  config: { path: '/mock/.aiex', keys: ['api-key'] },
  project: {
    aiexDir: '/mock/.aiex',
    dirExists: true,
    schemaCount: 2,
    schemaFiles: ['schema1.json', 'schema2.json'],
    aiConfig: true,
    aiApiKeySet: true,
    aiModelCount: 1,
    aiModels: ['gpt-4'],
    aiVisionModelCount: 1,
    aiStructuredOutputModelCount: 1,
    aiProvider: 'openai',
    aiConnectionOk: null,
    pdfConverter: 'unpdf',
    pdfConverterOk: true,
    hasDatabase: true,
    databaseTablesOk: true,
    missingDatabaseTables: [],
    migrationCount: 1,
    schemaValidCount: 2,
    invalidSchemas: [],
    errors: [],
  },
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
    const { collectDoctorDiagnostics } = await import('@/application/doctor/collect-diagnostics')
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
