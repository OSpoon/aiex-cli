<script setup lang="ts">
import type { ExtractionRecord, TableData, TableInfo } from "@/api-client"
import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import tableSchemaMeta from "@aiex/table-schema"
import { useEventListener } from "@vueuse/core"
import Button from "primevue/button"
import Dialog from "primevue/dialog"
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import { useI18n } from "vue-i18n"
import { toast, Toaster } from "vue-sonner"
import { deleteSchema, getPromptSnapshot, getSchema, getTableData, listDataTables, listExtractions, listSchemas, migrateSchema, saveSchema } from "@/api-client"
import { cloneJson, isDeepEqual } from "@/lib/jsonschema-editor/lib/object-utils"
import { useTheme } from "@/lib/jsonschema-editor/themes/useTheme"
import { setLocale } from "@/locales"

const { t, locale } = useI18n()

const { darkMode, toggleDarkMode } = useTheme()
const AISettings = defineAsyncComponent(() => import("@/components/AISettings.vue"))
const DataBrowser = defineAsyncComponent(() => import("@/components/DataBrowser.vue"))
const JsonSchemaEditor = defineAsyncComponent(() => import("@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaEditor.vue"))
const ExtractionViewer = defineAsyncComponent(() => import("@/components/ExtractionViewer.vue"))

const currentView = ref<"editor" | "data">("editor")

// Data browser state
const tables = ref<TableInfo[]>([])
const selectedTable = ref<string | null>(null)
const selectedTableData = ref<TableData | null>(null)
const tableDataLoading = ref(false)

// Pagination & search state
const currentDataPage = ref(1)
const currentPageSize = ref(50)
const currentSearch = ref("")

// Extraction state
const extractions = ref<ExtractionRecord[]>([])
const selectedExtraction = ref<string | null>(null)
const showExtractionDialog = ref(false)
const extractionsLoading = ref(false)
const selectedExtractionRecord = computed(() => extractions.value.find(ext => ext.name === selectedExtraction.value) ?? null)

async function loadTables() {
  try {
    tables.value = await listDataTables()
  } catch {
    toast.error(t("app.failedToLoadTables"))
  }
}

async function loadExtractions() {
  extractionsLoading.value = true
  try {
    extractions.value = await listExtractions()
  } catch {
    toast.error(t("app.failedToLoadExtractions"))
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
    toast.error(error instanceof Error ? error.message : t("app.failedToLoadTableData"))
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

function refreshNotionState() {
  loadExtractions()
  if (selectedTable.value) {
    loadTableData(selectedTable.value)
  }
}

function switchToData() {
  currentView.value = "data"
  loadTables()
  loadExtractions()
}

function selectTable(name: string) {
  currentDataPage.value = 1
  currentSearch.value = ""
  loadTableData(name, 1, currentPageSize.value, "")
}

function selectExtraction(name: string) {
  selectedExtraction.value = name
  showExtractionDialog.value = true
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
    toast.error(t("app.failedToLoadSchemaList"))
  }
  loading.value = false
}

async function loadSchema(name: string) {
  if (hasUnsavedChanges.value) {
    // eslint-disable-next-line no-alert
    if (!confirm(t("app.unsavedChangesConfirm", { action: t("app.confirmActionLoad") })))
      return
  }
  loading.value = true
  try {
    const data = await getSchema(name)
    schema.value = data as JSONSchema
    originalSchema.value = cloneJson(data as JSONSchema)
  } catch {
    toast.error(t("app.failedToLoadSchema", { name }))
  }
  loading.value = false
}

async function handleSave() {
  const schemaValue = schema.value as any
  const tableName = schemaValue.table?.name?.trim()

  if (!tableName) {
    toast.error(t("app.pleaseEnterTableName"))
    return
  }

  const fileName = `${tableName}.json`
  loading.value = true
  try {
    await saveSchema(fileName, schema.value)
    originalSchema.value = cloneJson(schema.value)
    await loadSchemaList()
  } catch {
    toast.error(t("app.failedToSaveSchema", { name: fileName }))
  }
  loading.value = false
}

async function handleSaveAndMigrate() {
  const schemaValue = schema.value as any
  const tableName = schemaValue.table?.name?.trim()

  if (!tableName) {
    toast.error(t("app.pleaseEnterTableName"))
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
      toast.success(t("app.migrationApplied", { changes: result.changes, tables: result.tables }))
    } else {
      toast.info(t("app.noChangesDetected"))
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    toast.error(message || t("app.migrationFailed"))
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
    toast.error(t("app.failedToDeleteSchema", { name }))
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
    if (!confirm(t("app.unsavedChangesConfirm", { action: t("app.confirmActionCreate") })))
      return
  }
  resetEditor()
}

function loadExample() {
  if (hasUnsavedChanges.value) {
    // eslint-disable-next-line no-alert
    if (!confirm(t("app.unsavedChangesConfirm", { action: t("app.confirmActionLoadExample") })))
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
      toast.warning(result.error || t("app.promptSnapshotNotFound"))
    }
  } catch {
    toast.error(t("app.failedToLoadPromptSnapshot"))
  }
  promptPreviewLoading.value = false
}

async function handleAISettingsVisible(value: boolean) {
  showAISettings.value = value
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
        {{ $t("app.title") }}
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ $t("app.subtitle") }}
      </p>
    </header>

    <Toaster position="top-center" rich-colors />
    <AISettings :visible="showAISettings" :schemas="savedSchemas" @update:visible="handleAISettingsVisible" />

    <Dialog v-model:visible="showPromptPreview" modal :draggable="false" :style="{ width: '720px' }" :header="$t('app.promptPreview', { name: promptPreviewName })">
      <div v-if="promptPreviewLoading" class="flex items-center justify-center py-8 text-muted-foreground">
        {{ $t("app.loading") }}
      </div>
      <div v-else-if="promptPreviewContent" class="max-h-[60vh] overflow-y-auto space-y-4">
        <div>
          <h4 class="text-sm font-semibold text-foreground mb-2">
            {{ $t("app.systemPrompt") }}
          </h4>
          <pre class="bg-secondary border border-border rounded-lg p-3 text-sm font-mono whitespace-pre-wrap text-foreground">{{ promptPreviewContent.match(/## System Prompt\s*\n([\s\S]*?)(?=## User Prompt|$)/)?.[1]?.trim() || '' }}</pre>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-foreground mb-2">
            {{ $t("app.userPromptTemplate") }}
          </h4>
          <pre class="bg-secondary border border-border rounded-lg p-3 text-sm font-mono whitespace-pre-wrap text-foreground">{{ promptPreviewContent.match(/## User Prompt Template\s*\n([\s\S]*)$/)?.[1]?.trim() || '' }}</pre>
        </div>
      </div>
      <div v-else class="py-8 text-center text-muted-foreground">
        {{ $t("app.noPromptSnapshot") }}
      </div>
      <template #footer>
        <Button :label="$t('app.close')" size="small" @click="showPromptPreview = false" />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showExtractionDialog"
      modal
      :draggable="false"
      :style="{ width: 'min(920px, calc(100vw - 2rem))' }"
      :content-style="{ height: 'min(72vh, 720px)', padding: '0' }"
      :header="selectedExtraction || $t('app.extractionJson')"
    >
      <ExtractionViewer
        :extraction-name="selectedExtraction"
        :record="selectedExtractionRecord"
        @notion-synced="refreshNotionState"
      />
    </Dialog>

    <div class="row-start-2 flex flex-col min-h-0 bg-card border border-border rounded-xl p-3">
      <div class="flex mb-3 shrink-0 bg-muted rounded-lg p-0.5">
        <button
          class="flex-1 px-2 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'editor' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="currentView = 'editor'"
        >
          {{ $t("app.editor") }}
        </button>
        <button
          class="flex-1 px-2 py-1.5 text-sm rounded-md transition-colors"
          :class="currentView === 'data' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchToData"
        >
          {{ $t("app.data") }}
        </button>
      </div>

      <template v-if="currentView === 'editor'">
        <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
          {{ $t("app.savedSchemas") }}
        </h3>
        <ul class="list-none p-0 m-0 flex-1 min-h-0 overflow-y-auto">
          <li
            v-for="name in savedSchemas"
            :key="name"
            class="flex items-center justify-between p-2 rounded cursor-pointer hover:bg-secondary"
          >
            <span class="flex-1 truncate" @click="loadSchema(name)">{{ name.replace('.json', '') }}</span>
            <div class="flex items-center gap-1">
              <Button icon="pi pi-eye" severity="secondary" size="small" text v-tooltip="$t('app.previewPrompt')" @click="handlePreviewPrompt(name)" />
              <Button icon="pi pi-trash" severity="danger" size="small" text @click="handleDelete(name)" />
            </div>
          </li>
        </ul>
        <div class="flex flex-col gap-2 mt-3 shrink-0">
          <Button class="w-full" :label="$t('app.newSchema')" icon="pi pi-plus" severity="secondary" size="small" @click="newSchema" />
          <Button class="w-full" :label="$t('app.loadExample')" icon="pi pi-box" severity="help" size="small" outlined @click="loadExample" />
        </div>
      </template>

      <template v-if="currentView === 'data'">
        <div class="flex-1 min-h-0 overflow-y-auto space-y-3">
          <div>
            <h3 class="m-0 mb-2 text-sm text-muted-foreground shrink-0">
              {{ $t("app.tables") }}
            </h3>
            <div class="space-y-1">
              <button
                v-for="table in tables"
                :key="table.name"
                class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                :class="selectedTable === table.name ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-foreground'"
                @click="selectTable(table.name)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-medium truncate">
                      {{ table.title }}
                    </div>
                    <div class="text-xs truncate" :class="selectedTable === table.name ? 'text-primary-foreground/70' : 'text-muted-foreground'">
                      {{ table.name }} · {{ table.hasData ? $t('app.hasData') : $t('app.empty') }}
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </template>

      <div class="flex items-center justify-center gap-1 mt-3 pt-3 shrink-0 border-t border-border">
        <Button severity="secondary" text size="small" @click="setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')">
          {{ locale === 'zh-CN' ? 'EN' : '中文' }}
        </Button>
        <Button :icon="darkMode ? 'pi pi-sun' : 'pi pi-moon'" severity="secondary" text size="small" @click="toggleDarkMode()" v-tooltip="$t('app.toggleDarkMode')" />
        <Button icon="pi pi-cog" severity="secondary" text size="small" @click="showAISettings = true" v-tooltip="$t('app.aiSettings')" />
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
        v-else-if="currentView === 'data'"
        :table-name="selectedTable"
        :table-data="selectedTableData"
        :loading="tableDataLoading"
        :search-query="currentSearch"
        @sort-change="onSortChange"
        @page-change="onPageChange"
        @page-size-change="onPageSizeChange"
        @search-change="onSearchChange"
        @select-extraction="selectExtraction"
        @notion-synced="refreshNotionState"
      />
    </main>
  </div>
</template>
