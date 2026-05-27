import { describe, expect, it } from 'vitest'
import {
  buildDoctorDiagnostics,
  doctorDiagnosticsTableRows,
  formatDoctorDiagnosticsJson,
} from '@/index'

const defaultProject = {
  aiexDir: '/tmp/fixture/.aiex',
  dirExists: false,
  schemaCount: 0,
  schemaFiles: [] as string[],
  aiConfig: false,
  aiApiKeySet: false,
  aiModelCount: 0,
  aiModels: [] as string[],
  aiVisionModelCount: 0,
  aiStructuredOutputModelCount: 0,
  aiProvider: null,
  aiConnectionOk: null,
  pdfConverter: null,
  pdfConverterOk: null,
  pdfConverterError: undefined as string | undefined,
  hasDatabase: false,
  databaseTablesOk: null,
  missingDatabaseTables: [] as string[],
  migrationCount: 0,
  schemaValidCount: 0,
  invalidSchemas: [] as Array<{ file: string, error: string }>,
  errors: [] as string[],
}

const defaultImageOcr = {
  platformSupported: true,
  dependencyLoaded: true,
  ocrOk: true,
  imagePath: '/project/app/web/public/logo.png',
  recognizedText: 'aiex',
  confidence: 0.96,
}

describe('core logic', () => {
  it('should build and format doctor diagnostics', () => {
    const diagnostics = buildDoctorDiagnostics({
      pkg: { name: 'fixture-cli', version: '1.0.0' },
      executable: '/bin/fixture',
      node: 'v24.0.0',
      platform: 'darwin',
      arch: 'arm64',
      shell: '/bin/zsh',
      packageManager: 'pnpm/10.33.0',
      osType: 'Darwin',
      osRelease: '25.0.0',
      cwd: '/tmp/fixture',
      imageOcr: defaultImageOcr,
      configPath: '/tmp/config.json',
      configStoreKeys: ['version', 'name'],
      project: defaultProject,
    })

    expect(diagnostics.config.keys).toEqual(['name', 'version'])
    expect(formatDoctorDiagnosticsJson(diagnostics)).toContain('"fixture-cli"')
    expect(doctorDiagnosticsTableRows(diagnostics)).toContainEqual(['configKeys', 'name, version'])
  })

  it('includes project diagnostics in table rows', () => {
    const diagnostics = buildDoctorDiagnostics({
      pkg: { name: 'test-cli', version: '2.0.0' },
      executable: '/bin/test',
      node: 'v24.0.0',
      platform: 'darwin',
      arch: 'arm64',
      shell: '/bin/zsh',
      packageManager: 'pnpm/10.33.0',
      osType: 'Darwin',
      osRelease: '25.0.0',
      cwd: '/project',
      imageOcr: {
        platformSupported: true,
        dependencyLoaded: true,
        ocrOk: false,
        imagePath: '/project/app/web/public/logo.png',
        error: 'OCR failed',
      },
      configPath: '/tmp/config.json',
      configStoreKeys: ['name'],
      project: {
        aiexDir: '/project/.aiex',
        dirExists: true,
        schemaCount: 2,
        schemaFiles: ['users.json', 'posts.json'],
        aiConfig: true,
        aiApiKeySet: true,
        aiModelCount: 2,
        aiModels: ['gpt-4o', 'gpt-4o-vision'],
        aiVisionModelCount: 1,
        aiStructuredOutputModelCount: 2,
        aiProvider: 'https://api.openai.com/v1',
        aiConnectionOk: true,
        pdfConverter: 'unpdf',
        pdfConverterOk: true,
        hasDatabase: true,
        databaseTablesOk: false,
        missingDatabaseTables: ['posts'],
        migrationCount: 3,
        schemaValidCount: 1,
        invalidSchemas: [{ file: 'posts.json', error: 'Invalid schema' }],
        errors: ['Could not read schema directory'],
      },
    })

    const rows = doctorDiagnosticsTableRows(diagnostics)
    expect(rows).toContainEqual(['aiexDir', '/project/.aiex'])
    expect(rows).toContainEqual(['dirExists', 'true'])
    expect(rows).toContainEqual(['schemaFiles', '2 (users.json, posts.json)'])
    expect(rows).toContainEqual(['aiConfig', 'true'])
    expect(rows).toContainEqual(['aiApiKeySet', 'true'])
    expect(rows).toContainEqual(['aiModels', 'gpt-4o, gpt-4o-vision'])
    expect(rows).toContainEqual(['aiVisionModels', '1'])
    expect(rows).toContainEqual(['aiStructuredOutputModels', '2'])
    expect(rows).toContainEqual(['aiProvider', 'https://api.openai.com/v1'])
    expect(rows).toContainEqual(['aiConnectionOk', 'true'])
    expect(rows).toContainEqual(['pdfConverter', 'unpdf'])
    expect(rows).toContainEqual(['pdfConverterOk', 'true'])
    expect(rows).toContainEqual(['imageOcrPlatform', 'true'])
    expect(rows).toContainEqual(['imageOcrDependency', 'true'])
    expect(rows).toContainEqual(['imageOcrOk', 'false'])
    expect(rows).toContainEqual(['imageOcrImage', '/project/app/web/public/logo.png'])
    expect(rows).toContainEqual(['imageOcrError', 'OCR failed'])
    expect(rows).toContainEqual(['hasDatabase', 'true'])
    expect(rows).toContainEqual(['databaseTablesOk', 'false'])
    expect(rows).toContainEqual(['missingDatabaseTables', 'posts'])
    expect(rows).toContainEqual(['migrations', '3'])
    expect(rows).toContainEqual(['schemaValid', '1/2'])
    expect(rows).toContainEqual(['invalidSchema', 'posts.json: Invalid schema'])
    expect(rows).toContainEqual(['error', 'Could not read schema directory'])
  })
})
