<script setup lang="ts">
import type { ObjectJSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import Chip from "primevue/chip"
import InputNumber from "primevue/inputnumber"
import { computed, ref, useId } from "vue"
import Button from "@/lib/jsonschema-editor/components/ui/Button.vue"
import InputField from "@/lib/jsonschema-editor/components/ui/InputField.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"
import {
  isBooleanSchema,
  withObjectSchema
} from "@/lib/jsonschema-editor/types/jsonSchema"

type Property = "enum" | "minLength" | "maxLength" | "pattern" | "format" | "unique" | "drizzle"

const props = withDefaults(
  defineProps<{
    schema: import("../../../types/jsonSchema.ts").JSONSchema
    path: string[]
    readOnly?: boolean
    validationNode?: ValidationTreeNode
    depth?: number
  }>(),
  { readOnly: false, depth: 0 }
)

const emit = defineEmits<{
  change: [schema: ObjectJSONSchema]
}>()

const t = useTranslation()
const enumValue = ref("")
const minLengthId = useId()
const maxLengthId = useId()
const patternId = useId()

const minLength = computed(() =>
  withObjectSchema(props.schema, s => s.minLength, undefined)
)
const maxLength = computed(() =>
  withObjectSchema(props.schema, s => s.maxLength, undefined)
)
const pattern = computed(() =>
  withObjectSchema(props.schema, s => s.pattern, undefined)
)
const format = computed(() =>
  withObjectSchema(props.schema, s => s.format, undefined)
)
const enumValues = computed(() =>
  withObjectSchema(props.schema, s => (s.enum as string[]) || [], [])
)

// aiex extensions
const isUnique = computed(() =>
  withObjectSchema(props.schema, s => s.unique === true, false)
)
const drizzleMode = computed(() =>
  withObjectSchema(props.schema, s => s.drizzle?.mode || "none", "none")
)

// When drizzle or format changes the column type away from text(), string constraints don't apply
const columnTypeChanged = computed(() =>
  drizzleMode.value === "timestamp"
  || drizzleMode.value === "timestamp_ms"
  || drizzleMode.value === "bigint"
  || drizzleMode.value === "json"
  || format.value === "date-time"
  || format.value === "json"
)

// Whether to show string-specific constraints (minLength, maxLength, pattern)
const showStringConstraints = computed(() => !columnTypeChanged.value)

function handleValidationChange(property: Property, value: unknown) {
  const baseSchema = isBooleanSchema(props.schema)
    ? { type: "string" as const }
    : cloneJson(props.schema)
  const { type: _, description: __, ...validationProps } = baseSchema

  // Handle drizzle mode — clear format and string constraints when mode changes column type
  if (property === "drizzle") {
    const mode = value as "none" | NonNullable<ObjectJSONSchema["drizzle"]>["mode"]
    const updatedValidation: ObjectJSONSchema = {
      ...validationProps,
      type: "string",
      drizzle: mode === "none" ? undefined : { mode }
    }
    if (mode !== "none") {
      delete updatedValidation.format
      delete updatedValidation.minLength
      delete updatedValidation.maxLength
      delete updatedValidation.pattern
    }
    emit("change", updatedValidation)
    return
  }

  // Handle format — clear drizzle and string constraints when format changes column type
  if (property === "format") {
    const format = value === "none" ? undefined : value as ObjectJSONSchema["format"]
    const updatedValidation: ObjectJSONSchema = {
      ...validationProps,
      type: "string",
      format
    }
    if (value === "date-time" || value === "json") {
      delete updatedValidation.drizzle
      delete updatedValidation.minLength
      delete updatedValidation.maxLength
      delete updatedValidation.pattern
    }
    emit("change", updatedValidation)
    return
  }

  const updatedValidation: ObjectJSONSchema = {
    ...validationProps,
    type: "string",
    [property]: value
  }
  emit("change", updatedValidation)
}

function handleAddEnumValue() {
  if (!enumValue.value.trim()) return
  if (!enumValues.value.includes(enumValue.value)) {
    handleValidationChange("enum", [...enumValues.value, enumValue.value])
  }
  enumValue.value = ""
}

function handleRemoveEnumValue(index: number) {
  const newEnumValues = [...enumValues.value]
  newEnumValues.splice(index, 1)
  if (newEnumValues.length === 0) {
    const baseSchema = isBooleanSchema(props.schema)
      ? { type: "string" as const }
      : cloneJson(props.schema)
    if (!isBooleanSchema(baseSchema) && "enum" in baseSchema) {
      const { enum: _, ...rest } = baseSchema
      emit("change", rest as ObjectJSONSchema)
    } else {
      emit("change", baseSchema as ObjectJSONSchema)
    }
  } else {
    handleValidationChange("enum", newEnumValues)
  }
}

const minMaxError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "length"
    )?.message
)
const minLengthError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "minLength"
    )?.message
)
const maxLengthError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "maxLength"
    )?.message
)
const patternError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "pattern"
    )?.message
)

const minLengthValue = computed(() => minLength.value ?? null)
const maxLengthValue = computed(() => maxLength.value ?? null)
const patternValue = computed(() => pattern.value ?? "")
const formatValue = computed(() => format.value || "none")

const formatOptions = computed(() => [
  { label: t.stringFormatNone, value: "none" },
  { label: t.stringFormatDateTime, value: "date-time" },
  { label: t.drizzleModeJson, value: "json" },
  { label: t.stringFormatEmail, value: "email" },
  { label: t.stringFormatUri, value: "uri" }
])

const drizzleModeOptions = computed(() => [
  { label: t.drizzleModeNone, value: "none" },
  { label: t.drizzleModeJson, value: "json" },
  { label: t.drizzleModeTimestamp, value: "timestamp" },
  { label: t.drizzleModeTimestampMs, value: "timestamp_ms" },
  { label: t.drizzleModeBigint, value: "bigint" }
])

const needsDetail = computed(
  () =>
    !props.readOnly
    || minLengthValue.value !== null
    || maxLengthValue.value !== null
    || patternValue.value !== ""
    || formatValue.value !== "none"
    || enumValues.value.length > 0
    || isUnique.value
    || drizzleMode.value !== "none"
)
</script>

<template>
  <div class="space-y-4">
    <!-- aiex Database Extensions -->
    <div class="flex flex-wrap gap-4 p-3 rounded-lg border border-border bg-secondary">
      <label class="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          :checked="isUnique"
          :disabled="readOnly"
          @change="handleValidationChange('unique', !isUnique)"
          class="rounded border-border accent-primary"
        >
        <span>{{ t.uniqueLabel }}</span>
      </label>
      <!-- Drizzle Mode - shown when format is not date-time/json -->
      <div v-if="format !== 'date-time' && format !== 'json'" class="flex items-center gap-2">
        <label class="text-sm text-foreground">{{ t.drizzleModeLabel }}</label>
        <select
          :value="drizzleMode"
          :disabled="readOnly"
          @change="handleValidationChange('drizzle', ($event.target as HTMLSelectElement).value)"
          class="text-sm border border-border rounded px-2 py-1 bg-background text-foreground"
        >
          <option v-for="opt in drizzleModeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
      <!-- Format - shown when drizzle mode is none -->
      <div v-if="drizzleMode === 'none'" class="flex items-center gap-2">
        <label class="text-sm text-foreground">{{ t.stringFormatLabel }}</label>
        <select
          :value="formatValue"
          :disabled="readOnly"
          @change="handleValidationChange('format', ($event.target as HTMLSelectElement).value)"
          class="text-sm border border-border rounded px-2 py-1 bg-background text-foreground"
        >
          <option v-for="opt in formatOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- String-specific constraints — hidden when column type changed from text() -->
    <template v-if="showStringConstraints">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <p v-if="readOnly && !needsDetail" class="text-sm text-muted-foreground italic">
          {{ t.stringNoConstraint }}
        </p>

        <div v-if="!readOnly || minLengthValue !== null" class="flex flex-col gap-2">
          <label :for="minLengthId" class="text-sm font-medium" :class="[(!!minMaxError || !!minLengthError) && 'text-red-500']">
            {{ t.stringMinimumLengthLabel }}
          </label>
          <InputNumber
            :input-id="minLengthId"
            :model-value="minLengthValue"
            @update:model-value="(v: number | null) => handleValidationChange('minLength', v ?? undefined)"
            :placeholder="t.stringMinimumLengthPlaceholder"
            :min="0"
            :disabled="readOnly"
            :invalid="!!minMaxError || !!minLengthError"
            fluid
            size="small"
            show-buttons
          />
        </div>

        <div v-if="!readOnly || maxLengthValue !== null" class="flex flex-col gap-2">
          <label :for="maxLengthId" class="text-sm font-medium" :class="[(!!minMaxError || !!maxLengthError) && 'text-red-500']">
            {{ t.stringMaximumLengthLabel }}
          </label>
          <InputNumber
            :input-id="maxLengthId"
            :model-value="maxLengthValue"
            @update:model-value="(v: number | null) => handleValidationChange('maxLength', v ?? undefined)"
            :placeholder="t.stringMaximumLengthPlaceholder"
            :min="0"
            :disabled="readOnly"
            :invalid="!!minMaxError || !!maxLengthError"
            fluid
            size="small"
            show-buttons
          />
        </div>

        <div v-if="!!minMaxError || !!minLengthError || !!maxLengthError" class="text-xs text-red-500 italic md:col-span-2 whitespace-pre-line">
          {{ [minMaxError, minLengthError ?? maxLengthError].filter(Boolean).join("\n") }}
        </div>
      </div>

      <div v-if="!readOnly || patternValue !== ''" class="flex flex-col gap-2">
        <label :for="patternId" class="text-sm font-medium" :class="[!!patternError && 'text-red-500']">
          {{ t.stringPatternLabel }}
        </label>
        <InputField
          :id="patternId"
          type="text"
          :model-value="String(patternValue)"
          @update:model-value="(v: string | undefined) => handleValidationChange('pattern', v || undefined)"
          :placeholder="t.stringPatternPlaceholder"
          size="sm"
        />
      </div>
    </template>

    <div v-if="!readOnly || enumValues.length > 0" class="space-y-2 pt-2 border-t" style="border-color: var(--p-content-border-color);">
      <label class="text-sm font-medium">{{ t.stringAllowedValuesEnumLabel }}</label>

      <div class="flex flex-wrap gap-2 mb-4">
        <template v-if="enumValues.length > 0">
          <Chip
            v-for="value in enumValues"
            :key="`enum-string-${value}`"
            :label="String(value)"
            removable
            @remove="handleRemoveEnumValue(enumValues.indexOf(value))"
          />
        </template>
        <p v-else class="text-xs italic" style="color: var(--p-text-muted-color);">
          {{ t.stringAllowedValuesEnumNone }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <InputField
          type="text"
          v-model="enumValue"
          :placeholder="t.stringAllowedValuesEnumAddPlaceholder"
          class="flex-1"
          size="small"
          @keydown="$event.key === 'Enter' && handleAddEnumValue()"
        />
        <Button
          type="button"
          @click="handleAddEnumValue()"
          size="sm"
          severity="secondary"
        >
          {{ t.stringAllowedValuesEnumAddLabel }}
        </Button>
      </div>
    </div>
  </div>
</template>
