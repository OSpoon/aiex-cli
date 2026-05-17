import { doctorCommand } from '@/commands/doctor'
import { extractCommand } from '@/commands/extract'
import { schemaCommand } from '@/commands/schema'
import { webCommand } from '@/commands/web'

export const subCommands = {
  web: webCommand,
  schema: schemaCommand,
  extract: extractCommand,
  doctor: doctorCommand,
}
