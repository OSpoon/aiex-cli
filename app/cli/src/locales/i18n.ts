import { en } from './en'

type TOptions = Record<string, unknown>

export function detectLocale(): string {
  return 'en'
}

function resolveFallback(key: string, options?: TOptions): string {
  let value: unknown = en
  const parts = key.split('.')
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part]
    }
    else {
      return key
    }
  }
  if (typeof value !== 'string')
    return key
  if (options) {
    return Object.entries(options).reduce(
      (str, [k, v]) => str.replaceAll(`{{${k}}}`, String(v)),
      value as string,
    )
  }
  return value as string
}

export async function initI18n(_lng?: string): Promise<void> {
  // CLI output is intentionally English-only. Keep this hook for command compatibility.
}

export function t(key: string, options?: TOptions): string {
  return resolveFallback(key, options)
}

export async function changeLanguage(_lng: string): Promise<void> {
  await initI18n()
}
