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
    aiProvider: string | null
    aiConnectionOk: boolean | null
    hasDatabase: boolean
    migrationCount: number
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
  rows.push(['aiProvider', p.aiProvider ?? 'none'])
  rows.push(['aiConnectionOk', p.aiConnectionOk === null ? 'not tested' : String(p.aiConnectionOk)])
  rows.push(['hasDatabase', String(p.hasDatabase)])
  rows.push(['migrations', String(p.migrationCount)])

  for (const err of p.errors) {
    rows.push(['error', err])
  }

  return rows
}
