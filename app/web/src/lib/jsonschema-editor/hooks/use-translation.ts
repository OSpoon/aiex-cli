export { useTranslation } from '@/lib/jsonschema-editor/i18n/translation-context.ts'

export function formatTranslation(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key]
    return value !== undefined ? String(value) : `{${key}}`
  })
}
