<script setup lang="ts">
import type { Translation } from "@/lib/jsonschema-editor/i18n/translation-keys"
import type { SchemaType } from "@/lib/jsonschema-editor/types/jsonSchema"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { cn } from "@/lib/jsonschema-editor/lib/utils"

interface TypeOption {
  id: SchemaType
  label: keyof Translation
  description: keyof Translation
}

defineProps<{
  id?: string
  modelValue: SchemaType
}>()

const emit = defineEmits<{
  "update:modelValue": [value: SchemaType]
}>()

const typeOptions: TypeOption[] = [
  {
    id: "integer",
    label: "fieldTypeIntegerLabel",
    description: "fieldTypeIntegerDescription"
  },
  {
    id: "number",
    label: "fieldTypeNumberLabel",
    description: "fieldTypeNumberDescription"
  },
  {
    id: "string",
    label: "fieldTypeTextLabel",
    description: "fieldTypeTextDescription"
  },
  {
    id: "boolean",
    label: "fieldTypeBooleanLabel",
    description: "fieldTypeBooleanDescription"
  },
  {
    id: "object",
    label: "fieldTypeObjectLabel",
    description: "fieldTypeObjectDescription"
  },
  {
    id: "array",
    label: "fieldTypeArrayLabel",
    description: "fieldTypeArrayDescription"
  }
]

const t = useTranslation()
</script>

<template>
  <div :id="id" class="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 gap-2">
    <button
      v-for="type in typeOptions"
      :key="type.id"
      type="button"
      :title="t[type.description]"
      :class="
        cn(
          'p-2.5 rounded-lg border-2 text-left transition-all duration-200',
          modelValue === type.id
            ? 'border-primary bg-primary/5 shadow-xs'
            : 'border-border hover:border-primary/30 hover:bg-secondary',
        )
      "
      @click="emit('update:modelValue', type.id)"
    >
      <div class="font-medium text-sm">
        {{ t[type.label] }}
      </div>
      <div class="text-xs text-muted-foreground line-clamp-1">
        {{ t[type.description] }}
      </div>
    </button>
  </div>
</template>
