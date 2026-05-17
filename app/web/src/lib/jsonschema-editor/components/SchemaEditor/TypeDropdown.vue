<script setup lang="ts">
import type { SchemaType } from "@/lib/jsonschema-editor/types/jsonSchema"
import PSelect from "primevue/select"
import { computed } from "vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { getTypeColor, getTypeLabel } from "@/lib/jsonschema-editor/lib/utils"

const props = withDefaults(
  defineProps<{
    modelValue: SchemaType
    class?: string
    readOnly?: boolean
  }>(),
  { readOnly: false }
)

const emit = defineEmits<{
  "update:modelValue": [value: SchemaType]
}>()

const t = useTranslation()

const typeOptions: SchemaType[] = [
  "integer",
  "number",
  "string",
  "boolean",
  "object",
  "array"
]

const options = computed(() =>
  typeOptions.map(type => ({
    value: type,
    label: getTypeLabel(t, type),
    color: getTypeColor(type)
  }))
)

const selectedOption = computed(() =>
  options.value.find(o => o.value === props.modelValue)
)

function handleChange(event: { value: string }) {
  emit("update:modelValue", event.value as SchemaType)
}
</script>

<template>
  <PSelect
    :model-value="modelValue"
    @change="handleChange"
    :options="options"
    option-label="label"
    option-value="value"
    :disabled="readOnly"
    append-to="body"
    class="text-xs" :class="[$props.class]"
    :pt="{
      root: { style: 'min-width: 92px; padding: 0.25rem 0.5rem; font-size: 0.75rem;' },
      label: { style: 'padding: 0.25rem 0; font-size: 0.75rem; font-weight: 500;', class: selectedOption?.color },
      option: { style: 'font-size: 0.75rem; padding: 0.375rem 0.75rem;' },
      overlay: { class: 'jscb' },
    }"
  >
    <template #option="{ option }">
      <span class="px-2 py-0.5 rounded text-xs font-medium" :class="[option.color]">
        {{ option.label }}
      </span>
    </template>
    <template #value="{ value: val }">
      <span v-if="val" class="text-xs font-medium" :class="[getTypeColor(val as SchemaType)]">
        {{ getTypeLabel(t, val as SchemaType) }}
      </span>
    </template>
  </PSelect>
</template>
