<script setup lang="ts">
import type { ObjectJSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import { useId } from "vue"
import Label from "@/lib/jsonschema-editor/components/ui/Label.vue"
import Switch from "@/lib/jsonschema-editor/components/ui/Switch.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { withObjectSchema } from "@/lib/jsonschema-editor/types/jsonSchema"

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
const allowTrueId = useId()
const allowFalseId = useId()

function enumValues() {
  return withObjectSchema(props.schema, s => s.enum as boolean[] | undefined, null)
}

const hasRestrictions = () => Array.isArray(enumValues())
function allowsTrue() {
  return !hasRestrictions() || enumValues()?.includes(true) || false
}
function allowsFalse() {
  return !hasRestrictions() || enumValues()?.includes(false) || false
}

function handleAllowedChange(value: boolean, allowed: boolean) {
  let newEnum: boolean[] | undefined

  if (allowed) {
    if (!hasRestrictions()) return
    if (enumValues()?.includes(value)) return
    newEnum = enumValues() ? [...(enumValues() as boolean[]), value] : [value]
    if (newEnum.includes(true) && newEnum.includes(false)) {
      newEnum = undefined
    }
  } else {
    if (hasRestrictions() && !enumValues()?.includes(value)) return
    newEnum = [!value]
  }

  const updatedValidation: ObjectJSONSchema = { type: "boolean" }
  if (newEnum) {
    updatedValidation.enum = newEnum
  } else {
    emit("change", { type: "boolean" })
    return
  }
  emit("change", updatedValidation)
}

function hasEnum() {
  const ev = enumValues()
  return ev && ev.length > 0
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="readOnly && !hasEnum()" class="text-sm text-muted-foreground italic">
      {{ t.booleanNoConstraint }}
    </p>
    <div v-if="!readOnly || !allowsTrue() || !allowsFalse()" class="space-y-2 pt-2">
      <template v-if="!readOnly || hasEnum()">
        <Label>{{ t.booleanAllowedValuesLabel }}</Label>
        <div class="space-y-3">
          <div class="flex items-center space-x-2">
            <Switch
              :id="allowTrueId" :model-value="allowsTrue()" :disabled="readOnly"
              @update:model-value="(value: boolean | undefined) => handleAllowedChange(true, value ?? false)"
            />
            <Label :for="allowTrueId" class="cursor-pointer">{{ t.booleanAllowTrueLabel }}</Label>
          </div>
          <div class="flex items-center space-x-2">
            <Switch
              :id="allowFalseId" :model-value="allowsFalse()" :disabled="readOnly"
              @update:model-value="(value: boolean | undefined) => handleAllowedChange(false, value ?? false)"
            />
            <Label :for="allowFalseId" class="cursor-pointer">{{ t.booleanAllowFalseLabel }}</Label>
          </div>
        </div>
      </template>
      <p v-if="!allowsTrue() && !allowsFalse()" class="text-xs text-amber-600 mt-2">
        {{ t.booleanNeitherWarning }}
      </p>
    </div>
  </div>
</template>
