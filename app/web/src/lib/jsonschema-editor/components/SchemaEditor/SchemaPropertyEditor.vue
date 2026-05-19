<script setup lang="ts">
import type {
  JSONSchema,
  ObjectJSONSchema,
  SchemaType
} from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import { ChevronDown, ChevronRight, X } from "lucide-vue-next"
import { computed, ref } from "vue"
import Badge from "@/lib/jsonschema-editor/components/ui/Badge.vue"
import ButtonToggle from "@/lib/jsonschema-editor/components/ui/ButtonToggle.vue"
import InputField from "@/lib/jsonschema-editor/components/ui/InputField.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"
import { cn } from "@/lib/jsonschema-editor/lib/utils"
import {
  getSchemaDescription,
  isObjectSchema,
  withObjectSchema
} from "@/lib/jsonschema-editor/types/jsonSchema"
import TypeDropdown from "./TypeDropdown.vue"
import TypeEditor from "./TypeEditor.vue"

const props = withDefaults(
  defineProps<{
    path: string[]
    name: string
    schema: JSONSchema
    required?: boolean
    readOnly?: boolean
    validationNode?: ValidationTreeNode
    depth?: number
    insideNested?: boolean
  }>(),
  { required: false, readOnly: false, depth: 0, insideNested: false }
)

const store = useSchemaStore()
const t = useTranslation()
const expanded = ref(false)
const isEditingName = ref(false)
const isEditingDesc = ref(false)
const isEditingDefault = ref(false)

// Display values — computed directly from props, no side effects.
const displayName = computed(() => props.name)
const displayDesc = computed(() => getSchemaDescription(props.schema))
const displayDefault = computed(() =>
  withObjectSchema(props.schema, s => s.default, undefined)
)

// Edit-local refs — only populated when user starts editing.
const tempName = ref("")
const tempDesc = ref("")
const tempDefault = ref("")

function editableObjectSchema(schema: JSONSchema | undefined): ObjectJSONSchema {
  return cloneJson(schema && isObjectSchema(schema) ? schema : { type: "object" })
}

function type() {
  return withObjectSchema(
    props.schema,
    s => (s.type || "object") as SchemaType,
    "object" as SchemaType
  )
}

function startEditingName() {
  tempName.value = props.name
  isEditingName.value = true
}

function startEditingDesc() {
  tempDesc.value = getSchemaDescription(props.schema)
  isEditingDesc.value = true
}

function handleNameSubmit() {
  const trimmedName = tempName.value.trim()
  if (trimmedName && trimmedName !== props.name) {
    store.renameProperty(props.path, props.name, trimmedName)
  } else {
    tempName.value = props.name
  }
  isEditingName.value = false
}

function handleDescSubmit() {
  const trimmedDesc = tempDesc.value.trim()
  if (trimmedDesc !== getSchemaDescription(props.schema)) {
    // Update the property schema with the new description
    const currentSchema = store.getAtPath([...props.path, props.name])
    const plain = editableObjectSchema(currentSchema)
    plain.description = trimmedDesc || undefined
    store.updateProperty(props.path, props.name, plain)
  } else {
    tempDesc.value = getSchemaDescription(props.schema)
  }
  isEditingDesc.value = false
}

function startEditingDefault() {
  tempDefault.value = displayDefault.value !== undefined ? String(displayDefault.value) : ""
  isEditingDefault.value = true
}

function handleDefaultSubmit() {
  const currentSchema = store.getAtPath([...props.path, props.name])
  const plain = editableObjectSchema(currentSchema)
  // Try to parse as JSON for objects/arrays, otherwise use as string
  let parsedDefault: unknown
  try {
    parsedDefault = JSON.parse(tempDefault.value)
  } catch {
    parsedDefault = tempDefault.value || undefined
  }
  plain.default = parsedDefault
  store.updateProperty(props.path, props.name, plain)
  isEditingDefault.value = false
}

function handleSchemaUpdate(updatedSchema: ObjectJSONSchema) {
  // Preserve the description and default from the current property
  const description = getSchemaDescription(props.schema)
  const defaultVal = withObjectSchema(props.schema, s => s.default, undefined)
  const plain = cloneJson(updatedSchema)
  plain.description = description || undefined
  if (defaultVal !== undefined) {
    plain.default = defaultVal
  }
  store.updateProperty(props.path, props.name, plain)
}

function handleTypeChange(newType: SchemaType) {
  const currentSchema = store.getAtPath([...props.path, props.name])
  const plain = editableObjectSchema(currentSchema)
  plain.type = newType
  store.updateProperty(props.path, props.name, plain)
}

function handleRequiredToggle() {
  if (props.readOnly) return
  store.setPropertyRequired(props.path, props.name, !props.required)
}

function handleDelete() {
  store.deleteProperty(props.path, props.name)
}
</script>

<template>
  <div
    :class="
      cn(
        'mb-2 rounded-lg transition-colors duration-200',
        depth > 0 && 'ml-0 sm:ml-4',
      )
    "
    :style="{
      border: '1px solid var(--p-content-border-color)',
      borderLeftColor: depth > 0 ? 'var(--p-content-border-color)' : undefined,
    }"
  >
    <div class="relative json-field-row justify-between group">
      <div class="flex items-center gap-2 grow min-w-0">
        <!-- Expand/collapse button -->
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground transition-colors"
          @click="expanded = !expanded"
          :aria-label="expanded ? t.collapse : t.expand"
        >
          <ChevronDown v-if="expanded" :size="18" />
          <ChevronRight v-else :size="18" />
        </button>

        <!-- Property name -->
        <div class="flex items-center gap-2 grow min-w-0 overflow-visible">
          <div class="flex items-center gap-2 min-w-0 grow overflow-visible">
            <InputField
              v-if="!readOnly && isEditingName"
              v-model="tempName"
              @blur="handleNameSubmit()"
              @keydown="$event.key === 'Enter' && handleNameSubmit()"
              class="h-8 text-sm font-medium min-w-[120px] max-w-full z-10"
              :autofocus="true"
              @focus="($event.target as HTMLInputElement)?.select()"
            />
            <button
              v-else
              type="button"
              @click="startEditingName()"
              @keydown="$event.key === 'Enter' && startEditingName()"
              class="json-field-label font-medium cursor-text px-2 py-0.5 -mx-0.5 rounded-sm hover:bg-secondary/30 hover:shadow-xs hover:ring-1 hover:ring-ring/20 transition-all text-left truncate min-w-[80px] max-w-[50%]"
            >
              {{ displayName }}
            </button>

            <!-- Description -->
            <InputField
              v-if="!readOnly && isEditingDesc"
              v-model="tempDesc"
              @blur="handleDescSubmit()"
              @keydown="$event.key === 'Enter' && handleDescSubmit()"
              :placeholder="t.propertyDescriptionPlaceholder"
              class="h-8 text-xs text-muted-foreground italic flex-1 min-w-[150px] z-10"
              :autofocus="true"
              @focus="($event.target as HTMLInputElement)?.select()"
            />
            <button
              v-else-if="displayDesc"
              type="button"
              @click="startEditingDesc()"
              @keydown="$event.key === 'Enter' && startEditingDesc()"
              class="text-xs text-muted-foreground italic cursor-text px-2 py-0.5 -mx-0.5 rounded-sm hover:bg-secondary/30 hover:shadow-xs hover:ring-1 hover:ring-ring/20 transition-all text-left truncate flex-1 max-w-[40%] mr-2"
            >
              {{ displayDesc }}
            </button>
            <button
              v-else
              type="button"
              @click="startEditingDesc()"
              @keydown="$event.key === 'Enter' && startEditingDesc()"
              class="text-xs text-muted-foreground/50 italic cursor-text px-2 py-0.5 -mx-0.5 rounded-sm hover:bg-secondary/30 hover:shadow-xs hover:ring-1 hover:ring-ring/20 transition-all opacity-0 group-hover:opacity-100 text-left truncate flex-1 max-w-[40%] mr-2"
            >
              {{ t.propertyDescriptionButton }}
            </button>
          </div>

          <!-- Type display -->
          <div class="flex items-center gap-2 justify-end shrink-0">
            <TypeDropdown
              :model-value="type()"
              :read-only="readOnly"
              @update:model-value="handleTypeChange"
            />

            <!-- Required toggle -->
            <ButtonToggle
              @click="handleRequiredToggle"
              :class="required ? 'bg-red-500/10 text-red-500' : 'bg-secondary text-muted-foreground'"
            >
              {{ required ? t.propertyRequired : t.propertyOptional }}
            </ButtonToggle>
          </div>
        </div>
      </div>

      <!-- Error badge -->
      <Badge
        v-if="(validationNode?.cumulativeChildrenErrors ?? 0) > 0"
        class="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums justify-center"
        variant="destructive"
      >
        {{ validationNode?.cumulativeChildrenErrors ?? 0 }}
      </Badge>

      <!-- Delete button -->
      <div v-if="!readOnly" class="flex items-center gap-1 text-muted-foreground">
        <button
          type="button"
          @click="handleDelete"
          class="p-1 rounded-md hover:bg-secondary hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
          :aria-label="t.propertyDelete"
        >
          <X :size="16" />
        </button>
      </div>
    </div>

    <!-- Type-specific editor -->
    <div v-if="expanded" class="pt-1 pb-2 px-2 sm:px-3">
      <p v-if="readOnly && displayDesc" class="pb-2">
        {{ displayDesc }}
      </p>

      <!-- Default value editor -->
      <div v-if="!readOnly || displayDefault !== undefined" class="flex items-center gap-2 mb-3 p-2 rounded border border-border bg-secondary">
        <label class="text-sm font-medium shrink-0 text-foreground">{{ t.defaultValueLabel }}</label>
        <InputField
          v-if="!readOnly && isEditingDefault"
          v-model="tempDefault"
          @blur="handleDefaultSubmit()"
          @keydown="$event.key === 'Enter' && handleDefaultSubmit()"
          :placeholder="t.defaultValuePlaceholder"
          class="flex-1"
          size="small"
          :autofocus="true"
          @focus="($event.target as HTMLInputElement)?.select()"
        />
        <button
          v-else-if="!readOnly"
          type="button"
          @click="startEditingDefault()"
          class="text-xs text-muted-foreground italic cursor-text px-2 py-0.5 rounded hover:bg-secondary/30 transition-all flex-1 text-left"
        >
          {{ displayDefault !== undefined ? JSON.stringify(displayDefault) : t.defaultValuePlaceholder }}
        </button>
        <span v-else class="text-sm font-mono">{{ JSON.stringify(displayDefault) }}</span>
      </div>

      <TypeEditor
        :schema="schema"
        :path="[...path, name]"
        :read-only="readOnly"
        :validation-node="validationNode"
        :depth="depth + 1"
        :inside-nested="insideNested || withObjectSchema(schema, (s) => s.nested?.enabled === true, false)"
        @change="handleSchemaUpdate"
      />
    </div>
  </div>
</template>
