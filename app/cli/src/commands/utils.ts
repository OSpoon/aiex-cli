import process from 'node:process'
import { outro } from '@clack/prompts'
import { consola } from 'consola'
import { t } from '@/locales'

export function failCommand(message?: string): void {
  if (message)
    consola.error(message)
  outro(t('common.failed'))
  process.exitCode = 1
}
