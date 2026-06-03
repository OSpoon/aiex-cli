<script setup lang="ts">
import type { ObjectJSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import { computed, ref } from "vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"
import { getSchemaProperties } from "@/lib/jsonschema-editor/lib/schemaEditor"
import { isBooleanSchema, withObjectSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import AddFieldButton from "../AddFieldButton.vue"
import SchemaPropertyEditor from "../SchemaPropertyEditor.vue"

const props = withDefaults(
  defineProps<{
    schema: import("../../../types/jsonSchema.ts").JSONSchema
    path: string[]
    readOnly?: boolean
    validationNode?: ValidationTreeNode
    depth?: number
    insideNested?: boolean
  }>(),
  { readOnly: false, depth: 0, insideNested: false }
)

const emit = defineEmits<{
  change: [schema: ObjectJSONSchema]
}>()

const t = useTranslation()

const properties = computed(() => getSchemaProperties(props.schema))

// aiex nested config
const nestedEnabled = ref(
  withObjectSchema(props.schema, s => s.nested?.enabled === true, false)
)
const nestedRelation = ref<"has-one" | "has-many">(
  withObjectSchema(props.schema, s => s.nested?.relation || "has-one", "has-one")
)

function handleNestedToggle() {
  nestedEnabled.value = !nestedEnabled.value
  updateSchemaWithNested()
}

function handleNestedRelationChange() {
  updateSchemaWithNested()
}

function updateSchemaWithNested() {
  if (emit) {
    const base = isBooleanSchema(props.schema)
      ? {}
      : cloneJson(props.schema)
    const updated: ObjectJSONSchema = {
      type: "object",
      ...base,
      nested: nestedEnabled.value
        ? { enabled: true as const, relation: nestedRelation.value }
        : undefined
    }
    if (!nestedEnabled.value) {
      delete updated.nested
    }
    emit("change", updated)
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- aiex Nested Config -->
    <div class="flex flex-wrap gap-4 p-3 rounded-lg border border-border bg-secondary">
      <label class="flex items-center gap-2 text-sm text-foreground" :class="{ 'opacity-50 cursor-not-allowed': insideNested }">
        <input
          type="checkbox"
          :checked="nestedEnabled"
          :disabled="readOnly || insideNested"
          @change="handleNestedToggle"
          class="rounded border-border accent-primary"
          :title="insideNested ? 'Only one level of nesting is supported' : ''"
        >
        <span>{{ t.nestedEnabledLabel }}</span>
      </label>
      <div v-if="nestedEnabled" class="flex items-center gap-2">
        <label class="text-sm text-foreground">{{ t.nestedRelationLabel }}</label>
        <select
          :value="nestedRelation"
          :disabled="readOnly"
          @change="(e: Event) => { nestedRelation = ((e.target as HTMLSelectElement).value) as 'has-one' | 'has-many'; handleNestedRelationChange(); }"
          class="text-sm border border-border rounded px-2 py-1 bg-background text-foreground"
        >
          <option value="has-one">
            {{ t.hasOneRelation }}
          </option>
          <option value="has-many">
            {{ t.hasManyRelation }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="properties.length > 0" class="space-y-2">
      <SchemaPropertyEditor
        v-for="property in properties"
        :key="property.name"
        :read-only="readOnly"
        :path="path"
        :name="property.name"
        :schema="property.schema"
        :required="property.required"
        :validation-node="validationNode?.children[property.name]"
        :depth="depth"
        :inside-nested="insideNested || nestedEnabled"
      />
    </div>
    <div v-else class="text-sm text-muted-foreground italic p-2 text-center border rounded-md">
      {{ t.objectPropertiesNone }}
    </div>

    <div v-if="!readOnly" class="mt-4 flex flex-row gap-x-4">
      <AddFieldButton :path="path" variant="secondary" />
    </div>
  </div>
</template>
