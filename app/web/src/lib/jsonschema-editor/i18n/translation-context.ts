import type { InjectionKey, Ref } from 'vue'
import type { Translation } from './translation-keys.ts'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Injection key kept for backwards compatibility.
 * @internal
 */
export const TranslationKey: InjectionKey<Ref<Translation>>
  = Symbol('TranslationContext')

/**
 * No-op — translations are now managed by vue-i18n.
 *
 * Accepts the same signature as before for backwards compatibility
 * with external consumers of the library.
 */
export function provideTranslation(
  _translation: Ref<Translation> | Translation,
): void {
  // Translations are handled by vue-i18n at the app level
}

/**
 * Read the current translation context backed by vue-i18n.
 *
 * Returns a `Translation` proxy that delegates every property access
 * to `t()` from vue-i18n.  All ~170 library components that use
 * `t.someKey` in templates or `computed` continue to work unchanged
 * because `t()` internally reads reactive locale refs that Vue tracks
 * during template/computed evaluation.
 *
 * Must be called from within a Vue component's `setup()` (or `<script setup>`)
 * because it uses `useI18n()` internally.
 */
export function useTranslation(): Translation {
  const injected = inject(TranslationKey, undefined)

  // If something still provides via the old injection, honour it
  if (injected) {
    return new Proxy({} as Translation, {
      get(_target, key: string | symbol) {
        if (typeof key !== 'string') return ''
        if (key.startsWith('__v_') || key === 'constructor' || key === 'toJSON') {
          return undefined
        }
        return (injected.value as any)[key] ?? key
      },
    })
  }

  // Bridge to vue-i18n
  const { t } = useI18n()
  return new Proxy({} as Translation, {
    get(_target, key: string | symbol) {
      if (typeof key !== 'string') return ''
      if (key.startsWith('__v_') || key === 'constructor' || key === 'toJSON') {
        return undefined
      }
      const result = t(key)
      return typeof result === 'string' ? result : key
    },
  })
}

