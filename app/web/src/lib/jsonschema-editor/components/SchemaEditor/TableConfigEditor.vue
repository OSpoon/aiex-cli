<script setup lang="ts">
import type { TableConfig } from "@/lib/jsonschema-editor/types/jsonSchema"
import { Maximize2 } from "lucide-vue-next"
import Button from "primevue/button"
import InputText from "primevue/inputtext"
import ToggleSwitch from "primevue/toggleswitch"
import { computed, useId } from "vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { isObjectSchema } from "@/lib/jsonschema-editor/types/jsonSchema"

withDefaults(defineProps<{
  loading?: boolean
  migrating?: boolean
  showFullscreen?: boolean
}>(), {
  loading: false,
  migrating: false,
  showFullscreen: false
})
const emit = defineEmits<{
  save: []
  saveAndMigrate: []
  toggleFullscreen: []
}>()
const store = useSchemaStore()
const t = useTranslation()

const tableNameId = useId()
const timestampsId = useId()
const softDeleteId = useId()

// Table name validation regex: must start with lowercase letter, followed by lowercase letters, digits, or underscores
const TABLE_NAME_REGEX = /^[a-z][a-z0-9_]*$/
const STARTS_WITH_LOWERCASE_REGEX = /^[a-z]/

// Unified name - same value for both title and table.name
const tableName = computed({
  get: () => {
    const schema = store.schema.value
    if (!isObjectSchema(schema)) return ""
    return schema.table?.name ?? schema.title ?? ""
  },
  set: (value: string) => {
    const schema = store.schema.value
    if (!isObjectSchema(schema)) return
    store.replaceSchema({
      ...schema,
      title: value,
      table: {
        ...schema.table,
        name: value
      } as TableConfig
    })
  }
})

// Validation state
const isValid = computed(() => {
  if (!tableName.value) return false
  return TABLE_NAME_REGEX.test(tableName.value)
})

const validationError = computed(() => {
  if (!tableName.value) return ""
  if (!STARTS_WITH_LOWERCASE_REGEX.test(tableName.value)) {
    return "Must start with lowercase letter"
  }
  if (!TABLE_NAME_REGEX.test(tableName.value)) {
    return "Only lowercase letters, digits, and underscores allowed"
  }
  return ""
})

const tableConfig = computed<TableConfig | undefined>({
  get: () => {
    const schema = store.schema.value
    return isObjectSchema(schema) ? schema.table : undefined
  },
  set: (value) => {
    if (!value) return
    const schema = store.schema.value
    if (!isObjectSchema(schema)) return
    store.replaceSchema({
      ...schema,
      table: value
    })
  }
})

const timestamps = computed({
  get: () => tableConfig.value?.timestamps ?? false,
  set: (value: boolean) => {
    tableConfig.value = {
      ...tableConfig.value,
      timestamps: value
    } as TableConfig
  }
})

const softDelete = computed({
  get: () => tableConfig.value?.softDelete ?? false,
  set: (value: boolean) => {
    tableConfig.value = {
      ...tableConfig.value,
      softDelete: value
    } as TableConfig
  }
})
</script>

<template>
  <div class="table-config p-4 border-b" style="border-color: var(--p-content-border-color);">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 flex-1 flex-wrap items-start gap-x-6 gap-y-3">
        <div class="flex min-w-[200px] max-w-[280px] flex-1 flex-col gap-1">
          <InputText
            :id="tableNameId"
            v-model="tableName"
            :placeholder="t.tableNamePlaceholder"
            size="small"
            class="w-full font-mono"
            :invalid="!!tableName && !isValid"
          />
          <p v-if="validationError" class="text-xs text-red-500">
            {{ validationError }}
          </p>
        </div>
        <div class="flex min-h-8 items-center gap-2">
          <ToggleSwitch :input-id="timestampsId" v-model="timestamps" />
          <label :for="timestampsId" class="cursor-pointer whitespace-nowrap text-sm">{{ t.timestampsLabel }}</label>
        </div>
        <div class="flex min-h-8 items-center gap-2">
          <ToggleSwitch :input-id="softDeleteId" v-model="softDelete" />
          <label :for="softDeleteId" class="cursor-pointer whitespace-nowrap text-sm">{{ t.softDeleteLabel }}</label>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button :label="t.saveLabel" icon="pi pi-save" severity="success" size="small" :loading="loading" :disabled="!isValid || migrating" @click="emit('save')" />
        <Button class="max-w-full" :label="t.saveAndMigrateLabel" icon="pi pi-database" severity="info" size="small" :loading="migrating" :disabled="!isValid || loading" @click="emit('saveAndMigrate')" />
        <button
          v-if="showFullscreen"
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="t.schemaEditorToggleFullscreen"
          @click="emit('toggleFullscreen')"
        >
          <Maximize2 :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
