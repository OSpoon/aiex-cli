<script setup lang="ts">
import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import { computed } from "vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { getSchemaProperties } from "@/lib/jsonschema-editor/lib/schemaEditor"
import { buildValidationTree } from "@/lib/jsonschema-editor/types/validation"
import SchemaPropertyEditor from "./SchemaPropertyEditor.vue"

const props = withDefaults(
  defineProps<{
    path: string[]
    readOnly?: boolean
  }>(),
  { readOnly: false }
)

const store = useSchemaStore()
const t = useTranslation()

const parentSchema = computed((): JSONSchema => {
  if (props.path.length === 0) return store.schema.value
  return store.getAtPath(props.path) ?? { type: "object", properties: {} }
})

const properties = computed(() => getSchemaProperties(parentSchema.value))

const validationTree = computed(() =>
  buildValidationTree(parentSchema.value, t)
)
</script>

<template>
  <div class="space-y-2">
    <SchemaPropertyEditor
      v-for="property in properties"
      :key="property.name"
      :path="path"
      :name="property.name"
      :schema="property.schema"
      :required="property.required"
      :validation-node="validationTree.children[property.name] ?? undefined"
      :read-only="readOnly"
    />
  </div>
</template>
