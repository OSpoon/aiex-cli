<script setup lang="ts">
import type {
  JSONSchema,
  ObjectJSONSchema,
  SchemaType
} from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import { computed, ref } from "vue"
import Label from "@/lib/jsonschema-editor/components/ui/Label.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"
import { getArrayItemsSchema } from "@/lib/jsonschema-editor/lib/schemaEditor"
import {
  isBooleanSchema,
  withObjectSchema
} from "@/lib/jsonschema-editor/types/jsonSchema"
import TypeDropdown from "../TypeDropdown.vue"
import TypeEditor from "../TypeEditor.vue"

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

// aiex nested config — lives on items, not the array itself
const itemsSchema = computed(
  () => getArrayItemsSchema(props.schema) || { type: "string" }
)

const nestedEnabled = ref(
  withObjectSchema(itemsSchema.value as JSONSchema, s => s.nested?.enabled === true, false)
)
const nestedRelation = ref<"has-one" | "has-many">(
  withObjectSchema(itemsSchema.value as JSONSchema, s => s.nested?.relation || "has-many", "has-many")
)

const itemType = computed(() =>
  withObjectSchema(
    itemsSchema.value as JSONSchema,
    s => (s.type || "string") as SchemaType,
    "string" as SchemaType
  )
)

// Nested is only valid when items type is 'object'
const canHaveNested = computed(() => itemType.value === "object")

function handleItemSchemaChange(updatedItemSchema: ObjectJSONSchema) {
  const base = isBooleanSchema(props.schema)
    ? {}
    : cloneJson(props.schema)
  emit("change", {
    type: "array",
    ...base,
    items: updatedItemSchema
  })
}

function handleItemTypeChange(newType: SchemaType) {
  const currentItems = itemsSchema.value as JSONSchema
  const plain = isBooleanSchema(currentItems)
    ? { type: newType }
    : cloneJson(currentItems)
  plain.type = newType
  // Clear nested when type changes away from object
  if (newType !== "object") {
    delete plain.nested
    nestedEnabled.value = false
  }
  handleItemSchemaChange(plain)
}

function handleNestedToggle() {
  nestedEnabled.value = !nestedEnabled.value
  updateItemsNested()
}

function handleNestedRelationChange() {
  updateItemsNested()
}

function updateItemsNested() {
  const currentItems = itemsSchema.value as JSONSchema
  const plain = isBooleanSchema(currentItems)
    ? {}
    : cloneJson(currentItems)
  if (nestedEnabled.value) {
    plain.nested = { enabled: true as const, relation: nestedRelation.value }
  } else {
    delete plain.nested
  }
  handleItemSchemaChange(plain)
}
</script>

<template>
  <div class="space-y-6">
    <!-- aiex Nested Config (on items) - only show when items type is object -->
    <div v-if="canHaveNested" class="flex flex-wrap gap-4 p-3 rounded-lg border border-border bg-secondary">
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

    <div class="space-y-2 pt-4">
      <div class="flex items-center justify-between mb-4">
        <Label>{{ t.arrayItemTypeLabel }}</Label>
        <TypeDropdown
          :read-only="readOnly"
          :model-value="itemType"
          @update:model-value="handleItemTypeChange"
        />
      </div>
      <TypeEditor
        :read-only="readOnly"
        :schema="itemsSchema as JSONSchema"
        :path="path"
        :validation-node="validationNode"
        :depth="depth + 1"
        @change="handleItemSchemaChange"
      />
    </div>
  </div>
</template>
