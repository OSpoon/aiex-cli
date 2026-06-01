export interface DoctorDiagnostics {
  cli: {
    name: string
    version: string
    executable: string
  }
  runtime: {
    node: string
    platform: string
    arch: string
    shell: string
    packageManager: string
  }
  system: {
    os: string
    cwd: string
  }
  imageOcr: {
    platformSupported: boolean
    dependencyLoaded: boolean
    ocrOk: boolean | null
    imagePath?: string
    recognizedText?: string
    confidence?: number
    error?: string
  }
  config: {
    path: string
    keys: string[]
  }
  project: {
    aiexDir: string
    dirExists: boolean
    schemaCount: number
    schemaFiles: string[]
    aiConfig: boolean
    aiApiKeySet: boolean
    aiModelCount: number
    aiModels: string[]
    aiVisionModelCount: number
    aiStructuredOutputModelCount: number
    aiProvider: string | null
    aiConnectionOk: boolean | null
    pdfConverter: string | null
    pdfConverterOk: boolean | null
    pdfConverterError?: string
    hasDatabase: boolean
    databaseTablesOk: boolean | null
    missingDatabaseTables: string[]
    migrationCount: number
    schemaValidCount: number
    invalidSchemas: Array<{ file: string, error: string }>
    errors: string[]
  }
}

export function buildDoctorDiagnostics(input: {
  pkg: { name: string, version: string }
  executable: string
  node: string
  platform: string
  arch: string
  shell: string
  packageManager: string
  osType: string
  osRelease: string
  cwd: string
  imageOcr: DoctorDiagnostics['imageOcr']
  configPath: string
  configStoreKeys: string[]
  project: DoctorDiagnostics['project']
}): DoctorDiagnostics {
  return {
    cli: {
      name: input.pkg.name,
      version: input.pkg.version,
      executable: input.executable,
    },
    runtime: {
      node: input.node,
      platform: input.platform,
      arch: input.arch,
      shell: input.shell,
      packageManager: input.packageManager,
    },
    system: {
      os: `${input.osType} ${input.osRelease}`,
      cwd: input.cwd,
    },
    imageOcr: { ...input.imageOcr },
    config: {
      path: input.configPath,
      keys: [...input.configStoreKeys].sort(),
    },
    project: { ...input.project },
  }
}

export function formatDoctorDiagnosticsJson(d: DoctorDiagnostics): string {
  return `${JSON.stringify(d, null, 2)}\n`
}

export function doctorDiagnosticsTableRows(
  d: DoctorDiagnostics,
): [string, string][] {
  const rows: [string, string][] = [
    ['node', d.runtime.node],
    ['platform', d.runtime.platform],
    ['arch', d.runtime.arch],
    ['shell', d.runtime.shell],
    ['packageManager', d.runtime.packageManager],
    ['os', d.system.os],
    ['cwd', d.system.cwd],
    ['config', d.config.path],
    ['configKeys', d.config.keys.join(', ')],
  ]

  const p = d.project
  rows.push(['aiexDir', p.aiexDir])
  rows.push(['dirExists', String(p.dirExists)])
  rows.push(['schemaFiles', `${p.schemaCount} (${p.schemaFiles.join(', ') || 'none'})`])
  rows.push(['aiConfig', String(p.aiConfig)])
  rows.push(['aiApiKeySet', String(p.aiApiKeySet)])
  rows.push(['aiModels', p.aiModelCount ? p.aiModels.join(', ') : 'none'])
  rows.push(['aiVisionModels', String(p.aiVisionModelCount)])
  rows.push(['aiStructuredOutputModels', String(p.aiStructuredOutputModelCount)])
  rows.push(['aiProvider', p.aiProvider ?? 'none'])
  rows.push(['aiConnectionOk', p.aiConnectionOk === null ? 'not tested' : String(p.aiConnectionOk)])
  rows.push(['pdfConverter', p.pdfConverter ?? 'none'])
  rows.push(['pdfConverterOk', p.pdfConverterOk === null ? 'not tested' : String(p.pdfConverterOk)])
  if (p.pdfConverterError)
    rows.push(['pdfConverterError', p.pdfConverterError])
  rows.push(['imageOcrPlatform', String(d.imageOcr.platformSupported)])
  rows.push(['imageOcrDependency', String(d.imageOcr.dependencyLoaded)])
  rows.push(['imageOcrOk', d.imageOcr.ocrOk === null ? 'not tested' : String(d.imageOcr.ocrOk)])
  if (d.imageOcr.imagePath)
    rows.push(['imageOcrImage', d.imageOcr.imagePath])
  if (d.imageOcr.recognizedText)
    rows.push(['imageOcrText', d.imageOcr.recognizedText])
  if (typeof d.imageOcr.confidence === 'number')
    rows.push(['imageOcrConfidence', `${(d.imageOcr.confidence * 100).toFixed(1)}%`])
  if (d.imageOcr.error)
    rows.push(['imageOcrError', d.imageOcr.error])
  rows.push(['hasDatabase', String(p.hasDatabase)])
  rows.push(['databaseTablesOk', p.databaseTablesOk === null ? 'not tested' : String(p.databaseTablesOk)])
  if (p.missingDatabaseTables.length)
    rows.push(['missingDatabaseTables', p.missingDatabaseTables.join(', ')])
  rows.push(['migrations', String(p.migrationCount)])
  rows.push(['schemaValid', `${p.schemaValidCount}/${p.schemaCount}`])
  for (const invalid of p.invalidSchemas) {
    rows.push(['invalidSchema', `${invalid.file}: ${invalid.error}`])
  }

  for (const err of p.errors) {
    rows.push(['error', err])
  }

  return rows
}

export function doctorDiagnosticsSeverityRows(
  d: DoctorDiagnostics,
): [string, string][] {
  const rows: [string, string][] = []
  const p = d.project

  rows.push([p.dirExists ? 'ok' : 'warn', p.dirExists ? 'Project directory exists' : 'Project directory is not initialized'])
  rows.push([p.aiConfig ? 'ok' : 'warn', p.aiConfig ? 'AI config exists' : 'AI config is missing'])

  if (p.aiConfig)
    rows.push([p.aiApiKeySet ? 'ok' : 'warn', p.aiApiKeySet ? 'AI API key is set' : 'AI API key is empty'])

  if (p.aiConnectionOk !== null)
    rows.push([p.aiConnectionOk ? 'ok' : 'warn', p.aiConnectionOk ? 'AI provider connection succeeded' : 'AI provider connection failed'])

  if (p.pdfConverterOk !== null) {
    rows.push([
      p.pdfConverterOk ? 'ok' : 'error',
      p.pdfConverterOk
        ? `PDF converter is available: ${p.pdfConverter ?? 'none'}`
        : `PDF converter is unavailable: ${p.pdfConverter ?? 'none'}${p.pdfConverterError ? ` (${p.pdfConverterError})` : ''}`,
    ])
  }
  else if (p.pdfConverterError) {
    rows.push(['warn', p.pdfConverterError])
  }

  if (d.imageOcr.ocrOk !== null) {
    rows.push([
      d.imageOcr.ocrOk ? 'ok' : 'warn',
      d.imageOcr.ocrOk
        ? 'Image OCR self-check passed'
        : `Image OCR self-check failed${d.imageOcr.error ? `: ${d.imageOcr.error}` : ''}`,
    ])
  }

  if (p.databaseTablesOk !== null) {
    rows.push([
      p.databaseTablesOk ? 'ok' : 'error',
      p.databaseTablesOk
        ? 'Database tables match schemas'
        : `Database tables are missing: ${p.missingDatabaseTables.join(', ') || 'unknown'}`,
    ])
  }

  for (const invalid of p.invalidSchemas)
    rows.push(['error', `Invalid schema ${invalid.file}: ${invalid.error}`])
  for (const err of p.errors)
    rows.push(['error', err])

  return rows
}
