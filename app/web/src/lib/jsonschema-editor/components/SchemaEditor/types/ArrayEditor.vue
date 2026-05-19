<script setup lang="ts">
import type {
  JSONSchema,
  ObjectJSONSchema,
  SchemaType
} from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import InputNumber from "primevue/inputnumber"
import { computed, ref, useId } from "vue"
import Label from "@/lib/jsonschema-editor/components/ui/Label.vue"
import Switch from "@/lib/jsonschema-editor/components/ui/Switch.vue"
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
const minItems = ref<number | null>(
  withObjectSchema(props.schema, s => s.minItems ?? null, null)
)
const maxItems = ref<number | null>(
  withObjectSchema(props.schema, s => s.maxItems ?? null, null)
)
const uniqueItems = ref(
  withObjectSchema(props.schema, s => s.uniqueItems || false, false)
)

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

const minItemsId = useId()
const maxItemsId = useId()
const uniqueItemsId = useId()

const itemType = computed(() =>
  withObjectSchema(
    itemsSchema.value as JSONSchema,
    s => (s.type || "string") as SchemaType,
    "string" as SchemaType
  )
)

// Nested is only valid when items type is 'object'
const canHaveNested = computed(() => itemType.value === "object")

function buildValidationProps(overrides: {
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
} = {}) {
  const base = isBooleanSchema(props.schema)
    ? {}
    : cloneJson(props.schema)
  const validationProps: ObjectJSONSchema = {
    type: "array",
    ...base,
    minItems: overrides.minItems ?? minItems.value ?? undefined,
    maxItems: overrides.maxItems ?? maxItems.value ?? undefined,
    uniqueItems: (overrides.uniqueItems ?? uniqueItems.value) || undefined
  }

  if (validationProps.items === undefined && itemsSchema.value) {
    validationProps.items = itemsSchema.value as JSONSchema
  }

  const propsToKeep: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(validationProps)) {
    if (value !== undefined) propsToKeep[key] = value
  }
  return propsToKeep as ObjectJSONSchema
}

function handleValidationChange() {
  emit("change", buildValidationProps())
}

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

const minMaxError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "minmax"
    )?.message
)
const minItemsError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "minItems"
    )?.message
)
const maxItemsError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "maxItems"
    )?.message
)
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

    <div v-if="!readOnly || !!maxItems || !!minItems" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-if="!readOnly || !!minItems" class="flex flex-col gap-2">
        <label :for="minItemsId" class="text-sm font-medium" :class="[(!!minMaxError || !!minItemsError) && 'text-red-500']">
          {{ t.arrayMinimumLabel }}
        </label>
        <InputNumber
          :input-id="minItemsId"
          :model-value="minItems"
          @update:model-value="(v: number | null) => { minItems = v; }"
          @blur="handleValidationChange()"
          :placeholder="t.arrayMinimumPlaceholder"
          :min="0"
          :invalid="!!minMaxError || !!minItemsError"
          :disabled="readOnly"
          fluid
          size="small"
          show-buttons
        />
      </div>
      <div v-if="!readOnly || !!maxItems" class="flex flex-col gap-2">
        <label :for="maxItemsId" class="text-sm font-medium" :class="[(!!minMaxError || !!maxItemsError) && 'text-red-500']">
          {{ t.arrayMaximumLabel }}
        </label>
        <InputNumber
          :input-id="maxItemsId"
          :model-value="maxItems"
          @update:model-value="(v: number | null) => { maxItems = v; }"
          @blur="handleValidationChange()"
          :placeholder="t.arrayMaximumPlaceholder"
          :min="0"
          :invalid="!!minMaxError || !!maxItemsError"
          :disabled="readOnly"
          fluid
          size="small"
          show-buttons
        />
      </div>
      <div v-if="!!minMaxError || !!minItemsError || !!maxItemsError" class="text-xs text-red-500 italic md:col-span-2 whitespace-pre-line">
        {{ [minMaxError, minItemsError ?? maxItemsError].filter(Boolean).join("\n") }}
      </div>
    </div>

    <div v-if="!readOnly || !!uniqueItems" class="flex items-center space-x-2">
      <Switch
        :id="uniqueItemsId" :model-value="uniqueItems"
        @update:model-value="(value: boolean | undefined) => { const checked = value ?? false; uniqueItems = checked; emit('change', buildValidationProps({ uniqueItems: checked })); }"
      />
      <Label :for="uniqueItemsId" class="cursor-pointer">{{ t.arrayForceUniqueItemsLabel }}</Label>
    </div>

    <div class="space-y-2 pt-4" :style="(!readOnly || !!minItems || !!maxItems || !!uniqueItems) ? 'border-top: 1px solid var(--p-content-border-color)' : ''">
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
