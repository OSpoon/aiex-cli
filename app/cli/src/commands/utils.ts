import process from 'node:process'
import { outro } from '@clack/prompts'
import { consola } from 'consola'

export function failCommand(message?: string): void {
  if (message)
    consola.error(message)
  outro('Failed!')
  process.exitCode = 1
}
