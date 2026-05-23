import type { TOptions } from 'i18next'
import process from 'node:process'
import { en } from './en'

let tFn: ((key: string, options?: TOptions) => string) | null = null
let i18nInstance: Awaited<ReturnType<typeof import('i18next')['createInstance']>> | null = null
let initPromise: Promise<void> | null = null

export function detectLocale(): string {
  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ''
  if (envLang.startsWith('zh'))
    return 'zh-CN'
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
    return Object.entries(options).reduce((str, [k, v]) => str.replace(`{{${k}}}`, String(v)), value as string)
  }
  return value as string
}

export async function initI18n(lng?: string): Promise<void> {
  if (i18nInstance)
    return
  if (initPromise)
    return initPromise

  initPromise = (async () => {
    const { createInstance } = await import('i18next')
    const instance = createInstance()
    i18nInstance = instance

    const locale = lng ?? detectLocale()

    await instance.init({
      lng: locale,
      fallbackLng: 'en',
      resources: {
        'en': { translation: en },
        'zh-CN': { translation: await import('./zh-CN').then(m => m.zhCN) },
      },
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    })

    tFn = instance.t.bind(instance)
  })()

  return initPromise
}

export function t(key: string, options?: TOptions): string {
  if (tFn)
    return tFn(key, options)
  return resolveFallback(key, options)
}

export async function changeLanguage(lng: string): Promise<void> {
  await initI18n()
  await i18nInstance!.changeLanguage(lng)
}
