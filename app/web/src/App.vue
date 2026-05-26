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

const { t } = useI18n()

const { darkMode, toggleDarkMode } = useTheme()
const AISettings = defineAsyncComponent(() => import("@/components/AISettings.vue"))
const DataBrowser = defineAsyncComponent(() => import("@/components/DataBrowser.vue"))
const Dashboard = defineAsyncComponent(() => import("@/components/Dashboard.vue"))
const JsonSchemaEditor = defineAsyncComponent(() => import("@/lib/jsonschema-editor/components/SchemaEditor/JsonSchemaEditor.vue"))
const ExtractionViewer = defineAsyncComponent(() => import("@/components/ExtractionViewer.vue"))

const currentView = ref<"overview" | "schemas" | "extract" | "data" | "settings">("overview")
const sidebarCollapsed = ref(false)

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
  currentView.value = "data"
  currentDataPage.value = 1
  currentSearch.value = ""
  loadTableData(name, 1, currentPageSize.value, "")
}

function selectExtraction(name: string) {
  selectedExtraction.value = name
  currentView.value = "extract"
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
  currentView.value = "schemas"
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

onMounted(() => {
  loadSchemaList()
  loadTables()
  loadExtractions()
})
</script>

<template>
  <div class="jscb h-screen bg-background p-4">
    <Toaster position="top-center" rich-colors />

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

    <div
      class="grid h-full min-h-0 min-w-0 gap-3 transition-[grid-template-columns] duration-200"
      :class="sidebarCollapsed ? 'grid-cols-[64px_minmax(0,1fr)]' : 'grid-cols-[220px_minmax(0,1fr)]'"
    >
      <aside class="flex min-h-0 flex-col rounded-lg border border-border bg-card p-3">
        <div
          class="mb-4 flex border-b border-border pb-4"
          :class="sidebarCollapsed ? 'min-h-[92px] flex-col items-center justify-start gap-3' : 'min-h-[76px] items-start justify-between gap-2'"
        >
          <div
            v-if="sidebarCollapsed"
            class="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
            aria-label="AIEX"
            v-tooltip="'AIEX'"
          >
            AI
          </div>
          <div v-if="!sidebarCollapsed" class="min-w-0">
            <h1 class="m-0 text-lg font-semibold text-foreground">
              AIEX
            </h1>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ $t("app.productSubtitle") }}
            </p>
          </div>
          <button
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            :aria-label="sidebarCollapsed ? $t('app.expandSidebar') : $t('app.collapseSidebar')"
            v-tooltip="sidebarCollapsed ? $t('app.expandSidebar') : $t('app.collapseSidebar')"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <i :class="sidebarCollapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'" />
          </button>
        </div>

        <nav class="grid grid-cols-1 gap-1">
          <button
            class="flex h-8 items-center rounded-md text-sm transition-colors"
            :class="[
              currentView === 'overview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-2',
            ]"
            @click="currentView = 'overview'"
            v-tooltip="sidebarCollapsed ? $t('app.overview') : undefined"
          >
            <i class="pi pi-th-large text-xs" />
            <span v-if="!sidebarCollapsed">{{ $t("app.overview") }}</span>
          </button>
          <button
            class="flex h-8 items-center rounded-md text-sm transition-colors"
            :class="[
              currentView === 'schemas' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-2',
            ]"
            @click="currentView = 'schemas'"
            v-tooltip="sidebarCollapsed ? $t('app.schemas') : undefined"
          >
            <i class="pi pi-pencil text-xs" />
            <span v-if="!sidebarCollapsed">{{ $t("app.schemas") }}</span>
          </button>
          <button
            class="flex h-8 items-center rounded-md text-sm transition-colors"
            :class="[
              currentView === 'extract' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-2',
            ]"
            @click="currentView = 'extract'"
            v-tooltip="sidebarCollapsed ? $t('app.extract') : undefined"
          >
            <i class="pi pi-file-import text-xs" />
            <span v-if="!sidebarCollapsed">{{ $t("app.extract") }}</span>
          </button>
          <button
            class="flex h-8 items-center rounded-md text-sm transition-colors"
            :class="[
              currentView === 'data' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-2',
            ]"
            @click="switchToData"
            v-tooltip="sidebarCollapsed ? $t('app.data') : undefined"
          >
            <i class="pi pi-database text-xs" />
            <span v-if="!sidebarCollapsed">{{ $t("app.data") }}</span>
          </button>
        </nav>

        <div class="mt-auto flex items-center justify-center gap-2 border-t border-border pt-3" :class="sidebarCollapsed ? 'flex-col' : ''">
          <button
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            @click="toggleDarkMode()"
            v-tooltip="$t('app.toggleDarkMode')"
          >
            <i :class="darkMode ? 'pi pi-sun' : 'pi pi-moon'" />
          </button>
          <button
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            :class="currentView === 'settings' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'"
            @click="currentView = 'settings'"
            v-tooltip="$t('app.settings')"
          >
            <i class="pi pi-cog" />
          </button>
        </div>
      </aside>

      <main
        class="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      >
        <Dashboard
          v-if="currentView === 'overview'"
          :schemas="savedSchemas"
          :tables="tables"
          :extractions="extractions"
          :loading-extractions="extractionsLoading"
          @open-settings="currentView = 'settings'"
          @new-schema="newSchema"
          @select-table="selectTable"
          @select-extraction="selectExtraction"
        />

        <div v-else-if="currentView === 'schemas'" class="grid h-full min-h-0 min-w-0 grid-cols-[280px_minmax(0,1fr)] bg-background">
          <section class="flex min-h-0 flex-col border-r border-border bg-card">
            <div class="border-b border-border p-4">
              <h2 class="m-0 text-lg font-semibold text-foreground">
                {{ $t("app.schemas") }}
              </h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ $t("app.schemasSubtitle") }}
              </p>
            </div>
            <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2">
              <li
                v-for="name in savedSchemas"
                :key="name"
                class="flex items-center justify-between rounded-md p-2 hover:bg-secondary"
              >
                <button class="min-w-0 flex-1 truncate text-left text-sm text-foreground" @click="loadSchema(name)">
                  {{ name.replace('.json', '') }}
                </button>
                <div class="flex items-center gap-1">
                  <Button icon="pi pi-eye" severity="secondary" size="small" text v-tooltip="$t('app.previewPrompt')" @click="handlePreviewPrompt(name)" />
                  <Button icon="pi pi-trash" severity="danger" size="small" text @click="handleDelete(name)" />
                </div>
              </li>
            </ul>
            <div class="grid gap-2 border-t border-border p-3">
              <Button class="w-full" :label="$t('app.newSchema')" icon="pi pi-plus" severity="secondary" size="small" @click="newSchema" />
              <Button class="w-full" :label="$t('app.loadExample')" icon="pi pi-box" severity="help" size="small" outlined @click="loadExample" />
            </div>
          </section>
          <JsonSchemaEditor
            v-model:schema="schema"
            :loading="loading"
            :migrating="migrating"
            @save="handleSave"
            @save-and-migrate="handleSaveAndMigrate"
          />
        </div>

        <div v-else-if="currentView === 'extract'" class="grid h-full min-h-0 min-w-0 grid-cols-[340px_minmax(0,1fr)] bg-background">
          <section class="flex min-h-0 flex-col border-r border-border bg-card">
            <div class="border-b border-border p-4">
              <h2 class="m-0 text-lg font-semibold text-foreground">
                {{ $t("app.extract") }}
              </h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ $t("app.extractSubtitle") }}
              </p>
            </div>
            <div v-if="extractionsLoading" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {{ $t("app.loading") }}
            </div>
            <div v-else-if="extractions.length === 0" class="flex flex-1 flex-col items-center justify-center p-4 text-center text-muted-foreground">
              <i class="pi pi-inbox mb-3 text-3xl opacity-50" />
              <p class="m-0 text-sm">
                {{ $t("app.noExtractionsYet") }}
              </p>
            </div>
            <div v-else class="min-h-0 flex-1 overflow-y-auto p-2">
              <button
                v-for="record in extractions"
                :key="record.name"
                class="mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors"
                :class="selectedExtraction === record.name ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'"
                @click="selectedExtraction = record.name"
              >
                <span class="block truncate font-medium">{{ record.schemaName }}</span>
                <span class="block truncate text-xs" :class="selectedExtraction === record.name ? 'text-primary-foreground/75' : 'text-muted-foreground'">
                  {{ record.name }}
                </span>
                <span
                  v-if="record.evidenceSummary"
                  class="mt-1 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium"
                  :class="record.evidenceSummary.issueCount > 0
                    ? selectedExtraction === record.name ? 'bg-yellow-100/20 text-yellow-100' : 'bg-yellow-500/10 text-yellow-700'
                    : selectedExtraction === record.name ? 'bg-white/15 text-primary-foreground' : 'bg-green-500/10 text-green-700'"
                >
                  {{ $t("app.evidenceCoverage") }} {{ record.evidenceSummary.evidenceCount }}/{{ record.evidenceSummary.fieldCount }}
                </span>
              </button>
            </div>
          </section>
          <ExtractionViewer
            :extraction-name="selectedExtraction"
            :record="selectedExtractionRecord"
            @notion-synced="refreshNotionState"
          />
        </div>

        <div v-else-if="currentView === 'data'" class="grid h-full min-h-0 min-w-0 grid-cols-[280px_minmax(0,1fr)] bg-background">
          <section class="flex min-h-0 flex-col border-r border-border bg-card">
            <div class="border-b border-border p-4">
              <h2 class="m-0 text-lg font-semibold text-foreground">
                {{ $t("app.data") }}
              </h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ $t("app.dataSubtitle") }}
              </p>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-2">
              <button
                v-for="table in tables"
                :key="table.name"
                class="mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors"
                :class="selectedTable === table.name ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'"
                @click="selectTable(table.name)"
              >
                <span class="block truncate font-medium">{{ table.title }}</span>
                <span class="block truncate text-xs" :class="selectedTable === table.name ? 'text-primary-foreground/75' : 'text-muted-foreground'">
                  {{ table.name }} · {{ table.hasData ? $t('app.hasData') : $t('app.empty') }}
                </span>
              </button>
            </div>
          </section>
          <DataBrowser
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
        </div>

        <AISettings
          v-else
          :schemas="savedSchemas"
          embedded
        />
      </main>
    </div>
  </div>
</template>
