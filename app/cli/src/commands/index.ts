import { completionCommand } from '@/commands/completion'
import { doctorCommand } from '@/commands/doctor'
import { dumpCommand } from '@/commands/dump'
import { extractCommand } from '@/commands/extract'
import { schemaCommand } from '@/commands/schema'
import { watchCommand } from '@/commands/watch'
import { webCommand } from '@/commands/web'

export const subCommands = {
  web: webCommand,
  schema: schemaCommand,
  extract: extractCommand,
  watch: watchCommand,
  dump: dumpCommand,
  completion: completionCommand,
  doctor: doctorCommand,
}
