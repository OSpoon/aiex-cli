import type { CommandDef } from 'citty'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { readFileSync as readJsonFileSync } from 'jsonfile'

const LEADING_DASHES = /^-+/

function getArgNames(cmd: CommandDef): string[] {
  if (!cmd.args)
    return []
  return Object.entries(cmd.args).flatMap(([key, arg]) => {
    const names = [`--${key}`]
    if ((arg as any).alias)
      names.push(`-${(arg as any).alias}`)
    return names
  })
}

function getCommandNames(cmds: Record<string, unknown>): string[] {
  return Object.keys(cmds).filter(c => !c.startsWith('_'))
}

function getFileCompletions(pattern: string): string[] {
  try {
    const files = fs.readdirSync(path.dirname(pattern))
    const ext = path.extname(pattern)
    const prefix = path.basename(pattern).replace(ext, '')
    return files
      .filter(f => f.endsWith(ext) && f.startsWith(prefix))
      .map(f => f.replace(ext, ''))
  }
  catch {
    return []
  }
}

function getJsonModelNames(configPath: string): string[] {
  try {
    const config = readJsonFileSync(configPath)
    if (config.provider?.models)
      return config.provider.models.map((m: any) => m.name)
  }
  catch {}
  return []
}

function getValueCompletions(prevArg: string): string[] {
  switch (prevArg) {
    case '--schema':
    case '-s': {
      const cwd = process.cwd()
      return getFileCompletions(path.join(cwd, '.aiex/schema/*.json'))
    }
    case '--model':
    case '-m': {
      const cwd = process.cwd()
      return getJsonModelNames(path.join(cwd, '.aiex/ai-config.json'))
    }
    case '--file':
    case '-f':
    case '--text':
    case '-t':
    case '--name':
    case '--port':
    case '-p':
      return []
    default:
      return []
  }
}

export function getCompletions(
  subCommands: Record<string, unknown>,
  args: string[],
): string[] {
  const cmds = getCommandNames(subCommands)

  if (args.length <= 1) {
    const word = args[0] ?? ''
    if (!word)
      return cmds
    return cmds.filter(c => c.startsWith(word))
  }

  const cmdName = args[0]
  const cmd = subCommands[cmdName] as CommandDef | undefined
  const rest = args.slice(1)

  if (!cmd) {
    const matched = cmds.filter(c => c.startsWith(cmdName))
    if (matched.length > 0)
      return matched
    return cmds
  }

  const current = rest[rest.length - 1] ?? ''
  const prev = rest.length > 1 ? rest[rest.length - 2] : undefined

  if (current.startsWith('-')) {
    const names = getArgNames(cmd)
    if (!current)
      return names
    const key = current.replace(LEADING_DASHES, '')
    if (!key)
      return names
    return names.filter(n => n.replace(LEADING_DASHES, '').startsWith(key))
  }

  if (!current && prev) {
    const values = getValueCompletions(prev)
    if (values.length > 0)
      return values
  }

  return getArgNames(cmd)
}
