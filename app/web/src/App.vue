<script setup lang="ts">
import type { AIModelConfig, ExtractionRecord, RunExtractionResult, TableData, TableInfo } from "@/api-client"
import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import tableSchemaMeta from "@aiex/table-schema"
import { useEventListener } from "@vueuse/core"
import Button from "primevue/button"
import Dialog from "primevue/dialog"
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import { toast, Toaster } from "vue-sonner"
import { deleteSchema, getAIConfig, getPromptSnapshot, getSchema, getTableData, listDataTables, listExtractions, listSchemas, migrateSchema, saveSchema } from "@/api-client"
import { cloneJson, isDeepEqual } from "@/lib/jsonschema-editor/lib/object-utils"
import { useTheme } from "@/lib/jsonschema-editor/themes/useTheme"

const { darkMode, toggleDarkMode } = useTheme()
const AISettings = defineAsyncComponent(() => import("@/components/AISettings.vue"))
const DataBrowser = defineAsyncComponent(() => import("@/components/DataBrowser.vue"))
const ExtractRunner = defineAsyncComponent(() => import("@/components/ExtractRunner.vue"))
const JsonSchemaEditor = defineAsyncComponent(() => import("@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaEditor.vue"))
const ExtractionViewer = defineAsyncComponent(() => import("@/components/ExtractionViewer.vue"))

const currentView = ref<"editor" | "extract" | "data">("editor")
const aiModels = ref<AIModelConfig[]>([])
const notionEnabled = ref(false)
const notionSchemaNames = ref<string[]>([])

// Data browser state
const tables = ref<TableInfo[]>([])
const selectedTable = ref<string | null>(null)
const selectedTableData = ref<TableData | null>(null)
const tableDataLoading = ref(false)

// Pagination & search state
const currentDataPage = ref(1)
const currentPageSize = ref(50)
const currentSearch = ref("")

// Data view sub-navigation
const dataSubView = ref<"table" | "extraction">("table")

// Extraction state
const extractions = ref<ExtractionRecord[]>([])
const selectedExtraction = ref<string | null>(null)
const extractionsLoading = ref(false)

async function loadTables() {
  try {
    tables.value = await listDataTables()
  } catch {
    toast.error("Failed to load tables")
  }
}

async function loadExtractions() {
  extractionsLoading.value = true
  try {
    extractions.value = await listExtractions()
  } catch {
    toast.error("Failed to load extractions")
  }
  extractionsLoading.value = false
}

async function loadTableData(
  tableName: string,
  page?: number,
  pageSize?: number,
  search?: string,
  sortField?: string,
  sortOrder?: string
) {
  dataSubView.value = "table"
  selectedTable.value = tableName
  tableDataLoading.value = true

  try {
    selectedTableData.value = await getTableData(tableName, {
      page: page ?? currentDataPage.value,
      pageSize: pageSize ?? currentPageSize.value,
      search: search !== undefined ? search : currentSearch.value,
      sortField,
      sortOrder
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to load table data")
    selectedTableData.value = null
  }
  tableDataLoading.value = false
}

function onSortChange(field: string, order: "asc" | "desc" | null) {
  if (!selectedTable.value) return
  if (!order) {
    loadTableData(selectedTable.value)
  } else {
    loadTableData(selectedTable.value, undefined, undefined, undefined, field, order)
  }
}

function onPageChange(page: number) {
  currentDataPage.value = page
  if (!selectedTable.value) return
  loadTableData(selectedTable.value, page)
}

function onPageSizeChange(size: number) {
  currentPageSize.value = size
  currentDataPage.value = 1
  if (!selectedTable.value) return
  loadTableData(selectedTable.value, 1, size)
}

function onSearchChange(query: string) {
  currentSearch.value = query
  currentDataPage.value = 1
  if (!selectedTable.value) return
  loadTableData(selectedTable.value, 1, undefined, query)
}

function switchToData() {
  currentView.value = "data"
  loadTables()
  loadExtractions()
}

async function switchToExtract() {
  currentView.value = "extract"
  await loadAIModels()
}

function selectTable(name: string) {
  currentDataPage.value = 1
  currentSearch.value = ""
  loadTableData(name, 1, currentPageSize.value, "")
}

function selectExtraction(name: string) {
  dataSubView.value = "extraction"
  selectedExtraction.value = name
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Schema editor state ──

const ECOMMERCE_EXAMPLE: JSONSchema = {
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
  return !isDeepEqual(schema.value, originalSchema.value)
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
    originalSchema.value = cloneJson(data as JSONSchema)
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
    originalSchema.value = cloneJson(schema.value)
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
    originalSchema.value = cloneJson(schema.value)
    await loadSchemaList()

    loading.value = false
    const result = await migrateSchema()

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
  originalSchema.value = cloneJson(schema.value)
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
  schema.value = cloneJson(ECOMMERCE_EXAMPLE)
  originalSchema.value = cloneJson(ECOMMERCE_EXAMPLE)
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

async function loadAIModels() {
  try {
    const config = await getAIConfig()
    aiModels.value = config.provider.models ?? []
    notionEnabled.value = !!config.notion?.enabled
    notionSchemaNames.value = Object.keys(config.notion?.schemas ?? {})
  } catch {
    aiModels.value = []
    notionEnabled.value = false
    notionSchemaNames.value = []
  }
}

async function handleAISettingsVisible(value: boolean) {
  showAISettings.value = value
  if (!value)
    await loadAIModels()
}

async function handleExtractionCompleted(result: RunExtractionResult) {
  await loadTables()
  await loadExtractions()
  if (result.outputName) {
    selectedExtraction.value = result.outputName
  }
}

onMounted(() => {
  loadSchemaList()
  loadTables()
  loadAIModels()
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
    <AISettings :visible="showAISettings" :schemas="savedSchemas" @update:visible="handleAISettingsVisible" />

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
          class="flex-1 px-2 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'editor' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="currentView = 'editor'"
        >
          Editor
        </button>
        <button
          class="flex-1 px-2 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'extract' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchToExtract"
        >
          Extract
        </button>
        <button
          class="flex-1 px-2 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'data' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchToData"
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

      <template v-if="currentView === 'extract'">
        <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
          Schemas
        </h3>
        <ul class="list-none p-0 m-0 flex-1 min-h-0 overflow-y-auto">
          <li
            v-for="name in savedSchemas"
            :key="name"
            class="p-2 rounded text-sm text-foreground truncate"
            :title="name"
          >
            {{ name.replace('.json', '') }}
          </li>
        </ul>
      </template>

      <template v-if="currentView === 'data'">
        <div class="flex-1 min-h-0 overflow-y-auto space-y-3">
          <div>
            <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
              Tables
            </h3>
            <div class="space-y-1">
              <button
                v-for="t in tables"
                :key="t.name"
                class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                :class="dataSubView === 'table' && selectedTable === t.name ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-foreground'"
                @click="selectTable(t.name)"
              >
                <div class="font-medium truncate">
                  {{ t.title }}
                </div>
                <div class="text-xs truncate" :class="dataSubView === 'table' && selectedTable === t.name ? 'text-primary-foreground/70' : 'text-muted-foreground'">
                  {{ t.name }} · {{ t.hasData ? 'has data' : 'empty' }}
                </div>
              </button>
            </div>
          </div>

          <div>
            <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
              Extractions
            </h3>
            <div v-if="extractionsLoading" class="text-xs text-muted-foreground py-2 text-center">
              Loading...
            </div>
            <div v-else-if="extractions.length === 0" class="text-xs text-muted-foreground py-2 text-center">
              No extractions yet
            </div>
            <div v-else class="space-y-1">
              <button
                v-for="ext in extractions"
                :key="ext.name"
                class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                :class="dataSubView === 'extraction' && selectedExtraction === ext.name ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-foreground'"
                @click="selectExtraction(ext.name)"
              >
                <div class="font-medium truncate">
                  {{ ext.schemaName }}
                </div>
                <div class="text-xs truncate" :class="dataSubView === 'extraction' && selectedExtraction === ext.name ? 'text-primary-foreground/70' : 'text-muted-foreground'">
                  {{ ext.timestamp }} · {{ formatFileSize(ext.fileSize) }}
                </div>
              </button>
            </div>
          </div>
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
      <ExtractRunner
        v-else-if="currentView === 'extract'"
        :schemas="savedSchemas"
        :models="aiModels"
        :notion-enabled="notionEnabled"
        :notion-schema-names="notionSchemaNames"
        @completed="handleExtractionCompleted"
      />
      <DataBrowser
        v-else-if="currentView === 'data' && dataSubView === 'table'"
        :table-name="selectedTable"
        :table-data="selectedTableData"
        :loading="tableDataLoading"
        :search-query="currentSearch"
        @sort-change="onSortChange"
        @page-change="onPageChange"
        @page-size-change="onPageSizeChange"
        @search-change="onSearchChange"
      />
      <ExtractionViewer
        v-else-if="currentView === 'data' && dataSubView === 'extraction'"
        :extraction-name="selectedExtraction"
      />
    </main>
  </div>
</template>
