// Styles
import "@/lib/jsonschema-editor/index.css"

// Vue components

export { default as JsonValidator } from "@/lib/jsonschema-editor/components/features/JsonValidator.vue"
export { default as SchemaInferencer } from "@/lib/jsonschema-editor/components/features/SchemaInferencer.vue"
export { default as JsonSchemaEditor } from "@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaEditor.vue"
export { default as JsonSchemaVisualizer } from "@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaVisualizer.vue"
export { default as SchemaVisualEditor } from "@/lib/jsonschema-editor/components/SchemaEditor/SchemaVisualEditor.vue"
export { useMonacoTheme } from "@/lib/jsonschema-editor/hooks/use-monaco-theme.ts"
// i18n
export { de } from "@/lib/jsonschema-editor/i18n/locales/de.ts"
export { en } from "@/lib/jsonschema-editor/i18n/locales/en.ts"
export { es } from "@/lib/jsonschema-editor/i18n/locales/es.ts"
export { fr } from "@/lib/jsonschema-editor/i18n/locales/fr.ts"
export { it } from "@/lib/jsonschema-editor/i18n/locales/it.ts"
export { pl } from "@/lib/jsonschema-editor/i18n/locales/pl.ts"
export { ru } from "@/lib/jsonschema-editor/i18n/locales/ru.ts"
export { uk } from "@/lib/jsonschema-editor/i18n/locales/uk.ts"
export { zh } from "@/lib/jsonschema-editor/i18n/locales/zh.ts"
// Composables
export {
  provideTranslation,
  TranslationKey,
  useTranslation
} from "@/lib/jsonschema-editor/i18n/translation-context.ts"
export type { Translation } from "@/lib/jsonschema-editor/i18n/translation-keys.ts"
// Utilities
export { createSchemaFromJson, inferSchema } from "@/lib/jsonschema-editor/lib/schema-inference.ts"
// Themes
export {
  auraPreset,
  laraPreset,
  materialPreset,
  noraPreset,
  type PresetName,
  presets,
  useTheme
} from "@/lib/jsonschema-editor/themes/index.ts"
// Types
export type {
  DrizzleExtension,
  DrizzleMode,
  JSONSchema,
  NestedConfig,
  NewField,
  ObjectJSONSchema,
  SchemaType,
  TableConfig
} from "@/lib/jsonschema-editor/types/jsonSchema.ts"
export { validateJson } from "@/lib/jsonschema-editor/utils/jsonValidator.ts"
