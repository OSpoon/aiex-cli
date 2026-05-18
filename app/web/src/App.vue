<script setup lang="ts">
import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import tableSchemaMeta from "@aiex/table-schema"
import { useEventListener } from "@vueuse/core"
import Button from "primevue/button"
import Dialog from "primevue/dialog"
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import { toast, Toaster } from "vue-sonner"
import { deleteSchema, getPromptSnapshot, getSchema, listSchemas, migrateSchema, saveSchema } from "@/api-client"
import { useTheme } from "@/lib/jsonschema-editor/themes/useTheme"

const { darkMode, toggleDarkMode } = useTheme()
const AISettings = defineAsyncComponent(() => import("@/components/AISettings.vue"))
const DataBrowser = defineAsyncComponent(() => import("@/components/DataBrowser.vue"))
const JsonSchemaEditor = defineAsyncComponent(() => import("@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaEditor.vue"))

const currentView = ref<"editor" | "data">("editor")

// Data browser state
interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}
interface TableData {
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
interface TableInfo {
  name: string
  title: string
  hasData: boolean
}
const tables = ref<TableInfo[]>([])
const selectedTable = ref<string | null>(null)
const selectedTableData = ref<TableData | null>(null)
const tableDataLoading = ref(false)

async function loadTables() {
  try {
    const res = await fetch("/api/data/tables")
    if (!res.ok) throw new Error("Failed to load tables")
    tables.value = await res.json()
  } catch {
    toast.error("Failed to load tables")
  }
}

async function loadTableData(tableName: string, sortField?: string, sortOrder?: string) {
  selectedTable.value = tableName
  tableDataLoading.value = true
  try {
    const params = new URLSearchParams({ page: "1", pageSize: "200" })
    if (sortField) params.set("sortField", sortField)
    if (sortOrder) params.set("sortOrder", sortOrder)

    const res = await fetch(`/api/data/tables/${encodeURIComponent(tableName)}?${params}`)
    if (!res.ok) {
      const err = await res.json()
      toast.error(err.error || "Failed to load data")
      selectedTableData.value = null
      return
    }
    selectedTableData.value = await res.json()
  } catch {
    toast.error("Failed to load table data")
    selectedTableData.value = null
  }
  tableDataLoading.value = false
}

function onSortChange(field: string, order: "asc" | "desc" | null) {
  if (!selectedTable.value) return
  if (!order) {
    loadTableData(selectedTable.value)
  } else {
    loadTableData(selectedTable.value, field, order)
  }
}

// Complex e-commerce example schema
const ECOMMERCE_EXAMPLE: JSONSchema = {
  /** Must match Monaco-registered `table-schema.json` `$id` (not json-schema.org metaschema URLs). */
  $schema: (tableSchemaMeta as { $id: string }).$id,
  title: "Customer",
  type: "object",
  table: { name: "customers", timestamps: true, softDelete: true },
  properties: {
    id: { type: "integer", primary: true, autoIncrement: true },
    email: { type: "string", format: "email", unique: true },
    name: { type: "string" },
    creditBalance: { type: "number", default: 0 },
    isActive: { type: "boolean", default: true },
    lastLoginAt: { type: "string", format: "date-time" },
    metadata: { type: "object", drizzle: { mode: "json" } },
    orders: {
      type: "array",
      items: {
        type: "object",
        nested: { enabled: true, relation: "has-many" },
        properties: {
          orderNumber: { type: "string", unique: true },
          status: { type: "string", default: "pending" },
          totalAmount: { type: "number" },
          paidAt: { type: "string", format: "date-time" },
          notes: { type: "string" }
        }
      }
    },
    address: {
      type: "object",
      nested: { enabled: true, relation: "has-one" },
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        zipCode: { type: "string" },
        country: { type: "string" },
        isDefault: { type: "boolean", default: false }
      }
    }
  },
  required: ["email", "name"]
}

const schema = ref<JSONSchema>({
  type: "object",
  title: "",
  table: { name: "" },
  properties: {}
})
const originalSchema = ref<JSONSchema>({
  type: "object",
  title: "",
  table: { name: "" },
  properties: {}
})
const savedSchemas = ref<string[]>([])
const loading = ref(false)
const migrating = ref(false)
const showAISettings = ref(false)
const showPromptPreview = ref(false)
const promptPreviewName = ref("")
const promptPreviewContent = ref("")
const promptPreviewLoading = ref(false)

const hasUnsavedChanges = computed(() => {
  return JSON.stringify(schema.value) !== JSON.stringify(originalSchema.value)
})

useEventListener(window, "beforeunload", (event) => {
  if (hasUnsavedChanges.value) {
    event.preventDefault()
    event.returnValue = ""
  }
})

async function loadSchemaList() {
  loading.value = true
  try {
    savedSchemas.value = await listSchemas()
  } catch {
    toast.error("Failed to load schema list")
  }
  loading.value = false
}

async function loadSchema(name: string) {
  if (hasUnsavedChanges.value) {
    // eslint-disable-next-line no-alert
    if (!confirm("You have unsaved changes. Loading a new schema will discard them. Continue?"))
      return
  }
  loading.value = true
  try {
    const data = await getSchema(name)
    schema.value = data as JSONSchema
    originalSchema.value = JSON.parse(JSON.stringify(data))
  } catch {
    toast.error(`Failed to load ${name}`)
  }
  loading.value = false
}

async function handleSave() {
  const schemaValue = schema.value as any
  const tableName = schemaValue.table?.name?.trim()

  if (!tableName) {
    toast.error("Please enter a table name")
    return
  }

  const fileName = `${tableName}.json`
  loading.value = true
  try {
    await saveSchema(fileName, schema.value)
    originalSchema.value = JSON.parse(JSON.stringify(schema.value))
    await loadSchemaList()
  } catch {
    toast.error(`Failed to save ${fileName}`)
  }
  loading.value = false
}

async function handleSaveAndMigrate() {
  const schemaValue = schema.value as any
  const tableName = schemaValue.table?.name?.trim()

  if (!tableName) {
    toast.error("Please enter a table name")
    return
  }

  const fileName = `${tableName}.json`
  loading.value = true
  migrating.value = true

  try {
    await saveSchema(fileName, schema.value)
    originalSchema.value = JSON.parse(JSON.stringify(schema.value))
    await loadSchemaList()

    // Then migrate
    loading.value = false
    const result = await migrateSchema()

    // Show warnings
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        toast.warning(warning)
      }
    }

    if (result.changes > 0) {
      toast.success(`Migration applied (${result.changes} changes, ${result.tables} tables)`)
    } else {
      toast.info("No changes detected")
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    toast.error(message || "Migration failed")
  }

  loading.value = false
  migrating.value = false
}

async function handleDelete(name: string) {
  loading.value = true
  try {
    await deleteSchema(name)
    await loadSchemaList()
    const currentTableName = (schema.value as any).table?.name
    if (currentTableName === name.replace(".json", "")) {
      resetEditor()
    }
  } catch {
    toast.error(`Failed to delete ${name}`)
  }
  loading.value = false
}

function resetEditor() {
  schema.value = {
    type: "object",
    title: "",
    table: { name: "" },
    properties: {}
  }
  originalSchema.value = JSON.parse(JSON.stringify(schema.value))
}

function newSchema() {
  if (hasUnsavedChanges.value) {
    // eslint-disable-next-line no-alert
    if (!confirm("You have unsaved changes. Creating a new schema will discard them. Continue?"))
      return
  }
  resetEditor()
}

function loadExample() {
  if (hasUnsavedChanges.value) {
    // eslint-disable-next-line no-alert
    if (!confirm("You have unsaved changes. Loading example will discard them. Continue?"))
      return
  }
  schema.value = JSON.parse(JSON.stringify(ECOMMERCE_EXAMPLE))
  originalSchema.value = JSON.parse(JSON.stringify(ECOMMERCE_EXAMPLE))
}

async function handlePreviewPrompt(name: string) {
  const tableName = name.replace(".json", "")
  promptPreviewName.value = tableName
  promptPreviewContent.value = ""
  promptPreviewLoading.value = true
  showPromptPreview.value = true

  try {
    const result = await getPromptSnapshot(tableName)
    if (result.success && result.content) {
      promptPreviewContent.value = result.content
    } else {
      promptPreviewContent.value = ""
      toast.warning(result.error || "Prompt snapshot not found")
    }
  } catch {
    toast.error("Failed to load prompt snapshot")
  }
  promptPreviewLoading.value = false
}

onMounted(() => {
  loadSchemaList()
  loadTables()
})
</script>

<template>
  <div class="jscb grid grid-rows-[auto_1fr] grid-cols-[200px_1fr] h-screen gap-2 p-4 bg-background">
    <header class="col-span-2 text-center">
      <h1 class="m-0 text-xl text-foreground">
        AIEX Schema Editor
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Visual JSON Schema editor for SQLite database generation
      </p>
    </header>

    <Toaster position="top-center" rich-colors />
    <AISettings v-model:visible="showAISettings" />

    <Dialog v-model:visible="showPromptPreview" modal :draggable="false" :style="{ width: '720px' }" :header="`Prompt Preview - ${promptPreviewName}`">
      <div v-if="promptPreviewLoading" class="flex items-center justify-center py-8 text-muted-foreground">
        Loading...
      </div>
      <div v-else-if="promptPreviewContent" class="max-h-[60vh] overflow-y-auto space-y-4">
        <div>
          <h4 class="text-sm font-semibold text-foreground mb-2">
            System Prompt
          </h4>
          <pre class="bg-secondary border border-border rounded-lg p-3 text-sm font-mono whitespace-pre-wrap text-foreground">{{ promptPreviewContent.match(/## System Prompt\s*\n([\s\S]*?)(?=## User Prompt|$)/)?.[1]?.trim() || '' }}</pre>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-foreground mb-2">
            User Prompt Template
          </h4>
          <pre class="bg-secondary border border-border rounded-lg p-3 text-sm font-mono whitespace-pre-wrap text-foreground">{{ promptPreviewContent.match(/## User Prompt Template\s*\n([\s\S]*)$/)?.[1]?.trim() || '' }}</pre>
        </div>
      </div>
      <div v-else class="py-8 text-center text-muted-foreground">
        No prompt snapshot available. Save the schema first.
      </div>
      <template #footer>
        <Button label="Close" size="small" @click="showPromptPreview = false" />
      </template>
    </Dialog>

    <div class="row-start-2 flex flex-col min-h-0 bg-card border border-border rounded-xl p-3">
      <div class="flex mb-3 shrink-0 bg-muted rounded-lg p-0.5">
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'editor' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="currentView = 'editor'"
        >
          Editor
        </button>
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'data' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="currentView = 'data'"
        >
          Data
        </button>
      </div>

      <template v-if="currentView === 'editor'">
        <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
          Saved Schemas
        </h3>
        <ul class="list-none p-0 m-0 flex-1 min-h-0 overflow-y-auto">
          <li
            v-for="name in savedSchemas"
            :key="name"
            class="flex items-center justify-between p-2 rounded cursor-pointer hover:bg-secondary"
          >
            <span class="flex-1 truncate" @click="loadSchema(name)">{{ name.replace('.json', '') }}</span>
            <div class="flex items-center gap-1">
              <Button icon="pi pi-eye" severity="secondary" size="small" text v-tooltip="'Preview Prompt'" @click="handlePreviewPrompt(name)" />
              <Button icon="pi pi-trash" severity="danger" size="small" text @click="handleDelete(name)" />
            </div>
          </li>
        </ul>
        <div class="flex flex-col gap-2 mt-3 shrink-0">
          <Button class="w-full" label="New" icon="pi pi-plus" severity="secondary" size="small" @click="newSchema" />
          <Button class="w-full" label="Load Example" icon="pi pi-box" severity="help" size="small" outlined @click="loadExample" />
        </div>
      </template>

      <template v-if="currentView === 'data'">
        <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
          Tables
        </h3>
        <div class="flex-1 min-h-0 overflow-y-auto space-y-1">
          <button
            v-for="t in tables"
            :key="t.name"
            class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
            :class="selectedTable === t.name ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-foreground'"
            @click="loadTableData(t.name)"
          >
            <div class="font-medium truncate">
              {{ t.title }}
            </div>
            <div class="text-xs truncate" :class="selectedTable === t.name ? 'text-primary-foreground/70' : 'text-muted-foreground'">
              {{ t.name }} · {{ t.hasData ? 'has data' : 'empty' }}
            </div>
          </button>
        </div>
      </template>

      <div class="flex items-center justify-center gap-1 mt-3 pt-3 shrink-0 border-t border-border">
        <Button :icon="darkMode ? 'pi pi-sun' : 'pi pi-moon'" severity="secondary" text size="small" @click="toggleDarkMode()" v-tooltip="'Toggle dark mode'" />
        <Button icon="pi pi-cog" severity="secondary" text size="small" @click="showAISettings = true" v-tooltip="'AI Settings'" />
      </div>
    </div>

    <main
      class="row-start-2 min-h-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col"
    >
      <JsonSchemaEditor
        v-if="currentView === 'editor'"
        v-model:schema="schema"
        :loading="loading"
        :migrating="migrating"
        @save="handleSave"
        @save-and-migrate="handleSaveAndMigrate"
      />
      <DataBrowser
        v-else
        :table-name="selectedTable"
        :table-data="selectedTableData"
        :loading="tableDataLoading"
        @sort-change="onSortChange"
      />
    </main>
  </div>
</template>
