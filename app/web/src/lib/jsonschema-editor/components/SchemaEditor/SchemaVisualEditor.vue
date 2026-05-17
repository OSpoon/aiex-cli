<script setup lang="ts">
import { computed } from "vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { isBooleanSchema, isObjectSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import AddFieldButton from "./AddFieldButton.vue"
import SchemaFieldList from "./SchemaFieldList.vue"

withDefaults(
  defineProps<{
    readOnly?: boolean
  }>(),
  { readOnly: false }
)

const t = useTranslation()
const store = useSchemaStore()
const schema = computed(() => store.schema.value)

function hasFields() {
  return !isBooleanSchema(schema.value)
    && isObjectSchema(schema.value)
    && schema.value.properties
    && Object.keys(schema.value.properties).length > 0
}
</script>

<template>
  <div class="p-4 flex-1 min-h-0 flex flex-col overflow-auto jscb">
    <div v-if="!readOnly" class="mb-6 shrink-0">
      <AddFieldButton :path="[]" />
    </div>

    <div class="grow overflow-auto">
      <div v-if="!hasFields()" class="text-center py-10 text-muted-foreground">
        <p class="mb-3">
          {{ t.visualEditorNoFieldsHint1 }}
        </p>
        <p class="text-sm">
          {{ t.visualEditorNoFieldsHint2 }}
        </p>
      </div>
      <SchemaFieldList
        v-else
        :path="[]"
        :read-only="readOnly"
      />
    </div>
  </div>
</template>
