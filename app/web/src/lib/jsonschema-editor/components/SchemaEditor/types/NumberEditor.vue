<script setup lang="ts">
import type { ObjectJSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import Chip from "primevue/chip"
import InputNumber from "primevue/inputnumber"
import { computed, ref, useId } from "vue"
import Button from "@/lib/jsonschema-editor/components/ui/Button.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import {
  isBooleanSchema,
  withObjectSchema
} from "@/lib/jsonschema-editor/types/jsonSchema"

type Property
  = | "minimum"
    | "maximum"
    | "exclusiveMinimum"
    | "exclusiveMaximum"
    | "multipleOf"
    | "enum"
    | "primary"
    | "autoIncrement"
    | "unique"
    | "drizzle"

const props = withDefaults(
  defineProps<{
    schema: import("../../../types/jsonSchema.ts").JSONSchema
    path: string[]
    readOnly?: boolean
    validationNode?: ValidationTreeNode
    depth?: number
    integer?: boolean
  }>(),
  { readOnly: false, depth: 0, integer: false }
)

const emit = defineEmits<{
  change: [schema: ObjectJSONSchema]
}>()

const enumValue = ref("")
const t = useTranslation()

const maximumId = useId()
const minimumId = useId()
const exclusiveMinimumId = useId()
const exclusiveMaximumId = useId()
const multipleOfId = useId()

const minimum = computed(() =>
  withObjectSchema(props.schema, s => s.minimum, undefined)
)
const maximum = computed(() =>
  withObjectSchema(props.schema, s => s.maximum, undefined)
)
const exclusiveMinimum = computed(() =>
  withObjectSchema(props.schema, s => s.exclusiveMinimum, undefined)
)
const exclusiveMaximum = computed(() =>
  withObjectSchema(props.schema, s => s.exclusiveMaximum, undefined)
)
const multipleOf = computed(() =>
  withObjectSchema(props.schema, s => s.multipleOf, undefined)
)
const enumValues = computed(() =>
  withObjectSchema(props.schema, s => (s.enum as number[]) || [], [])
)

// aiex extensions
const isPrimary = computed(() =>
  withObjectSchema(props.schema, s => s.primary === true, false)
)
const isAutoIncrement = computed(() =>
  withObjectSchema(props.schema, s => s.autoIncrement === true, false)
)
const isUnique = computed(() =>
  withObjectSchema(props.schema, s => s.unique === true, false)
)
const drizzleMode = computed(() =>
  withObjectSchema(props.schema, s => s.drizzle?.mode || "none", "none")
)

// Whether drizzle mode changes the column type away from the default
const drizzleChangesType = computed(() =>
  drizzleMode.value === "boolean" || drizzleMode.value === "timestamp"
)

// Whether numeric constraints (min/max/multipleOf) are relevant
const showNumericConstraints = computed(() => {
  if (props.integer && drizzleChangesType.value) return false
  return true
})

const drizzleModeOptions = computed(() => {
  if (!props.integer) return []
  return [
    { label: t.drizzleModeNone, value: "none" },
    { label: t.drizzleModeBoolean, value: "boolean" },
    { label: t.drizzleModeTimestamp, value: "timestamp" }
  ]
})

function handleValidationChange(property: Property, value: unknown) {
  const baseProperties: Partial<ObjectJSONSchema> = {
    type: props.integer ? "integer" : "number"
  }

  if (!isBooleanSchema(props.schema)) {
    if (props.schema.minimum !== undefined)
      baseProperties.minimum = props.schema.minimum
    if (props.schema.maximum !== undefined)
      baseProperties.maximum = props.schema.maximum
    if (props.schema.exclusiveMinimum !== undefined)
      baseProperties.exclusiveMinimum = props.schema.exclusiveMinimum
    if (props.schema.exclusiveMaximum !== undefined)
      baseProperties.exclusiveMaximum = props.schema.exclusiveMaximum
    if (props.schema.multipleOf !== undefined)
      baseProperties.multipleOf = props.schema.multipleOf
    if (props.schema.enum !== undefined)
      baseProperties.enum = [...(props.schema.enum as unknown[])]
    if (props.schema.primary !== undefined)
      baseProperties.primary = props.schema.primary
    if (props.schema.autoIncrement !== undefined)
      baseProperties.autoIncrement = props.schema.autoIncrement
    if (props.schema.unique !== undefined)
      baseProperties.unique = props.schema.unique
    if (props.schema.drizzle !== undefined)
      baseProperties.drizzle = props.schema.drizzle
  }

  // Handle drizzle mode — clear numeric constraints when mode changes column type
  if (property === "drizzle") {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.drizzle = value === "none" ? undefined : { mode: value as "json" | "timestamp" | "timestamp_ms" | "boolean" | "bigint" }
    // When drizzle changes column type, clear numeric constraints
    if (value !== "none") {
      delete updatedProperties.minimum
      delete updatedProperties.maximum
      delete updatedProperties.exclusiveMinimum
      delete updatedProperties.exclusiveMaximum
      delete updatedProperties.multipleOf
    }
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Handle primary key — clear drizzle and unique (they are meaningless for PK)
  if (property === "primary" && value === true) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.primary = true
    delete updatedProperties.drizzle
    delete updatedProperties.unique
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Handle exclusiveMinimum — clear minimum when setting exclusiveMinimum
  if (property === "exclusiveMinimum" && value !== undefined) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.exclusiveMinimum = value as number
    delete updatedProperties.minimum
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Handle minimum — clear exclusiveMinimum when setting minimum
  if (property === "minimum" && value !== undefined) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.minimum = value as number
    delete updatedProperties.exclusiveMinimum
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Handle exclusiveMaximum — clear maximum when setting exclusiveMaximum
  if (property === "exclusiveMaximum" && value !== undefined) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.exclusiveMaximum = value as number
    delete updatedProperties.maximum
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Handle maximum — clear exclusiveMaximum when setting maximum
  if (property === "maximum" && value !== undefined) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    updatedProperties.maximum = value as number
    delete updatedProperties.exclusiveMaximum
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  if (value !== undefined) {
    const updatedProperties: Partial<ObjectJSONSchema> = { ...baseProperties }
    if (property === "multipleOf")
      updatedProperties.multipleOf = value as number
    else if (property === "enum") updatedProperties.enum = value as unknown[]
    else if (property === "primary") updatedProperties.primary = value as boolean
    else if (property === "autoIncrement") updatedProperties.autoIncrement = value as boolean
    else if (property === "unique") updatedProperties.unique = value as boolean
    emit("change", updatedProperties as ObjectJSONSchema)
    return
  }

  // Remove property
  const result = { ...baseProperties }
  delete (result as Record<string, unknown>)[property]
  emit("change", result as ObjectJSONSchema)
}

function handleAddEnumValue() {
  if (!enumValue.value.trim()) return
  const numValue = Number(enumValue.value)
  if (Number.isNaN(numValue)) return
  const validValue = props.integer ? Math.floor(numValue) : numValue
  if (!enumValues.value.includes(validValue)) {
    handleValidationChange("enum", [...enumValues.value, validValue])
  }
  enumValue.value = ""
}

function handleRemoveEnumValue(index: number) {
  const newEnumValues = [...enumValues.value]
  newEnumValues.splice(index, 1)
  handleValidationChange(
    "enum",
    newEnumValues.length === 0 ? undefined : newEnumValues
  )
}

const minMaxError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "minMax"
    )?.message
)
const redundantMinError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "redundantMinimum"
    )?.message
)
const redundantMaxError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "redundantMaximum"
    )?.message
)
const enumError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "enum"
    )?.message
)
const multipleOfError = computed(
  () =>
    props.validationNode?.validation.errors?.find(
      err => err.path[0] === "multipleOf"
    )?.message
)

const hasConstraint = computed(
  () =>
    !!minimum.value
    || !!maximum.value
    || !!exclusiveMinimum.value
    || !!exclusiveMaximum.value
    || !!multipleOf.value
    || enumValues.value.length > 0
    || isPrimary.value
    || isAutoIncrement.value
    || isUnique.value
    || drizzleMode.value !== "none"
)

const minimumValue = computed(() => minimum.value ?? null)
const maximumValue = computed(() => maximum.value ?? null)
const exclusiveMinimumValue = computed(() => exclusiveMinimum.value ?? null)
const exclusiveMaximumValue = computed(() => exclusiveMaximum.value ?? null)
const multipleOfValue = computed(() => multipleOf.value ?? null)
</script>

<template>
  <div class="space-y-4">
    <p v-if="readOnly && !hasConstraint" class="text-sm italic" style="color: var(--p-text-muted-color);">
      {{ t.numberNoConstraint }}
    </p>

    <!-- aiex Database Extensions (Integer only) -->
    <div v-if="integer" class="flex flex-wrap gap-4 p-3 rounded-lg border border-border bg-secondary">
      <label class="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          :checked="isPrimary"
          :disabled="readOnly"
          @change="handleValidationChange('primary', !isPrimary)"
          class="rounded border-border accent-primary"
        >
        <span class="font-medium">{{ t.primaryKeyLabel }}</span>
      </label>
      <label v-if="isPrimary" class="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          :checked="isAutoIncrement"
          :disabled="readOnly"
          @change="handleValidationChange('autoIncrement', !isAutoIncrement)"
          class="rounded border-border accent-primary"
        >
        <span>{{ t.autoIncrementLabel }}</span>
      </label>
      <!-- Drizzle Mode hidden when Primary Key — generator ignores it -->
      <div v-if="!isPrimary" class="flex items-center gap-2">
        <label class="text-sm whitespace-nowrap text-foreground">{{ t.drizzleModeLabel }}</label>
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
    </div>

    <!-- Unique (non-integer) -->
    <div v-if="!integer && (!readOnly || isUnique)" class="flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary">
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
    </div>

    <!-- Numeric constraints — hidden when drizzle changes column type -->
    <template v-if="showNumericConstraints">
      <div v-if="!readOnly || hasConstraint" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-0 md:col-span-2">
          <div v-if="!!minMaxError" class="text-xs text-red-500 italic">
            {{ minMaxError }}
          </div>
          <div v-if="!!redundantMinError" class="text-xs text-red-500 italic">
            {{ redundantMinError }}
          </div>
          <div v-if="!!redundantMaxError" class="text-xs text-red-500 italic">
            {{ redundantMaxError }}
          </div>
          <div v-if="!!enumError" class="text-xs text-red-500 italic">
            {{ enumError }}
          </div>
        </div>

        <!-- Minimum (hidden when exclusiveMinimum is set) -->
        <div v-if="(!readOnly || !!minimum) && !exclusiveMinimum" class="flex flex-col gap-2">
          <label :for="minimumId" class="text-sm font-medium" :class="[minimum !== undefined && (!!minMaxError || !!redundantMinError) && 'text-red-500']">
            {{ t.numberMinimumLabel }}
          </label>
          <InputNumber
            :input-id="minimumId"
            :model-value="minimumValue"
            @update:model-value="(v: number | null) => handleValidationChange('minimum', v ?? undefined)"
            :placeholder="t.numberMinimumPlaceholder"
            :step="integer ? 1 : undefined"
            :invalid="minimum !== undefined && (!!minMaxError || !!redundantMinError)"
            :disabled="readOnly"
            fluid
            size="small"
            show-buttons
          />
        </div>

        <!-- Maximum (hidden when exclusiveMaximum is set) -->
        <div v-if="(!readOnly || !!maximum) && !exclusiveMaximum" class="flex flex-col gap-2">
          <label :for="maximumId" class="text-sm font-medium" :class="[maximum !== undefined && (!!minMaxError || !!redundantMaxError) && 'text-red-500']">
            {{ t.numberMaximumLabel }}
          </label>
          <InputNumber
            :input-id="maximumId"
            :model-value="maximumValue"
            @update:model-value="(v: number | null) => handleValidationChange('maximum', v ?? undefined)"
            :placeholder="t.numberMaximumPlaceholder"
            :step="integer ? 1 : undefined"
            :invalid="maximum !== undefined && (!!minMaxError || !!redundantMaxError)"
            :disabled="readOnly"
            fluid
            size="small"
            show-buttons
          />
        </div>
      </div>

      <div v-if="!readOnly || !!exclusiveMaximum || !!exclusiveMinimum" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Exclusive Minimum (hidden when minimum is set) -->
        <div v-if="(!readOnly || !!exclusiveMinimum) && !minimum" class="flex flex-col gap-2">
          <label :for="exclusiveMinimumId" class="text-sm font-medium">{{ t.numberExclusiveMinimumLabel }}</label>
          <InputNumber
            :input-id="exclusiveMinimumId"
            :model-value="exclusiveMinimumValue"
            @update:model-value="(v: number | null) => handleValidationChange('exclusiveMinimum', v ?? undefined)"
            :placeholder="t.numberExclusiveMinimumPlaceholder"
            :step="integer ? 1 : undefined"
            :disabled="readOnly"
            fluid
            size="small"
            show-buttons
          />
        </div>
        <!-- Exclusive Maximum (hidden when maximum is set) -->
        <div v-if="(!readOnly || !!exclusiveMaximum) && !maximum" class="flex flex-col gap-2">
          <label :for="exclusiveMaximumId" class="text-sm font-medium">{{ t.numberExclusiveMaximumLabel }}</label>
          <InputNumber
            :input-id="exclusiveMaximumId"
            :model-value="exclusiveMaximumValue"
            @update:model-value="(v: number | null) => handleValidationChange('exclusiveMaximum', v ?? undefined)"
            :placeholder="t.numberExclusiveMaximumPlaceholder"
            :step="integer ? 1 : undefined"
            :disabled="readOnly"
            fluid
            size="small"
            show-buttons
          />
        </div>
      </div>

      <div v-if="!readOnly || !!multipleOf" class="flex flex-col gap-2">
        <label :for="multipleOfId" class="text-sm font-medium" :class="[!!multipleOfError && 'text-red-500']">{{ t.numberMultipleOfLabel }}</label>
        <InputNumber
          :input-id="multipleOfId"
          :model-value="multipleOfValue"
          @update:model-value="(v: number | null) => handleValidationChange('multipleOf', v ?? undefined)"
          :placeholder="t.numberMultipleOfPlaceholder"
          :min="0"
          :step="integer ? 1 : undefined"
          :invalid="!!multipleOfError"
          :disabled="readOnly"
          fluid
          size="small"
          show-buttons
        />
        <div v-if="!!multipleOfError" class="text-xs text-red-500 italic whitespace-pre-line">
          {{ multipleOfError }}
        </div>
      </div>
    </template>

    <div v-if="!readOnly || enumValues.length > 0" class="space-y-2 pt-2 border-t" style="border-color: var(--p-content-border-color);">
      <label class="text-sm font-medium" :class="[!!enumError && 'text-red-500']">{{ t.numberAllowedValuesEnumLabel }}</label>
      <div class="flex flex-wrap gap-2 mb-4">
        <template v-if="enumValues.length > 0">
          <Chip
            v-for="(value, index) in enumValues"
            :key="`enum-number-${value}`"
            :label="String(value)"
            removable
            @remove="handleRemoveEnumValue(index)"
          />
        </template>
        <p v-else class="text-xs italic" style="color: var(--p-text-muted-color);">
          {{ t.numberAllowedValuesEnumNone }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <InputNumber
          :model-value="enumValue ? Number(enumValue) : null"
          @update:model-value="(v: number | null) => { enumValue = v !== null ? String(v) : ''; }"
          :placeholder="t.numberAllowedValuesEnumAddPlaceholder"
          :step="integer ? 1 : undefined"
          fluid
          size="small"
          show-buttons
          @keydown="($event as KeyboardEvent).key === 'Enter' && handleAddEnumValue()"
        />
        <Button type="button" @click="handleAddEnumValue()" size="sm" severity="secondary">
          {{ t.numberAllowedValuesEnumAddLabel }}
        </Button>
      </div>
    </div>
  </div>
</template>
