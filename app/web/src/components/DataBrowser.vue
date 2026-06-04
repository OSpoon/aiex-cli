<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core"
import Button from "primevue/button"
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { toast } from "vue-sonner"
import { VxeColumn, VxeTable } from "vxe-table"
import { getTableData, retryNotionSync } from "@/api-client"
import "vxe-table/lib/style.css"

interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

interface TableData {
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  rowActions?: Record<string, {
    extractionName: string
    notionStatus: "synced" | "failed" | "not_synced"
    notionPages?: Array<{ databaseId: string, pageId: string }>
    notionError?: string
  }>
  total: number
  page: number
  pageSize: number
  totalPages: number
  schema?: any
}

const props = withDefaults(defineProps<{
  tableName?: string | null
  tableData?: TableData | null
  loading?: boolean
  searchQuery?: string
}>(), {
  tableName: null,
  tableData: null,
  loading: false,
  searchQuery: ""
})

const emit = defineEmits<{
  sortChange: [field: string, order: "asc" | "desc" | null]
  pageChange: [page: number]
  pageSizeChange: [size: number]
  searchChange: [query: string]
  selectExtraction: [name: string]
  notionSynced: []
}>()

const { t } = useI18n()

// ── search ──

const searchInput = ref(props.searchQuery)
const emitSearchChange = useDebounceFn(() => {
  emit("searchChange", searchInput.value)
}, 300)

function onSearchInput() {
  emitSearchChange()
}

function clearSearch() {
  searchInput.value = ""
  emit("searchChange", "")
}

// ── sort ──

function sortChange(params: any) {
  const field = params.field
  const order = params.order
  emit("sortChange", field, order === "desc" ? "desc" : order === "asc" ? "asc" : null)
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return ""
  if (typeof val === "object") return JSON.stringify(val)
  return String(val)
}

type RowAction = NonNullable<TableData["rowActions"]>[string]

function rowAction(rowIndex: number): RowAction | undefined {
  return props.tableData?.rowActions?.[String(rowIndex)]
}

function notionStatusLabel(status: RowAction["notionStatus"]): string {
  if (status === "synced") return t("app.notionSynced")
  if (status === "failed") return t("app.notionFailed")
  return t("app.notionPending")
}

function notionActionLabel(status: RowAction["notionStatus"]): string {
  if (status === "failed") return t("app.notionRetry")
  return t("app.notionSync")
}

function notionActionTooltip(status: RowAction["notionStatus"]): string | null {
  if (status === "synced") return null
  return notionActionLabel(status)
}

const syncingExtraction = ref<string | null>(null)

async function syncExtractionToNotion(action: RowAction) {
  if (action.notionStatus === "synced") return
  syncingExtraction.value = action.extractionName
  try {
    const result = await retryNotionSync(action.extractionName)
    toast.success(t("app.notionSyncedToNotionDetail", { count: result.notionPages?.length ?? 0 }))
    emit("notionSynced")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("app.notionSyncFailed"))
    emit("notionSynced")
  }
  syncingExtraction.value = null
}

// ── pagination ──

const pageNumbers = computed(() => {
  if (!props.tableData) return []
  const { page, totalPages } = props.tableData
  const maxVisible = 7
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const half = Math.floor(maxVisible / 2)
  let start = Math.max(1, page - half)
  const end = Math.min(totalPages, start + maxVisible - 1)
  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1)
  }
  const pages: (number | "...")[] = []
  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push("...")
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("...")
    pages.push(totalPages)
  }
  return pages
})

function goToPage(p: number) {
  if (!props.tableData) return
  if (p < 1 || p > props.tableData.totalPages) return
  emit("pageChange", p)
}

const pageSizeOptions = [10, 20, 50, 100, 200]

// ── export ──

const exporting = ref(false)
let xlsxModulePromise: Promise<typeof import("xlsx")> | null = null

function loadXlsx() {
  xlsxModulePromise ||= import("xlsx")
  return xlsxModulePromise
}

async function fetchAllRows() {
  if (!props.tableName) return null
  exporting.value = true
  try {
    const data = await getTableData(props.tableName, { all: true })
    return data
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("app.failedToLoadFullTableData"))
    return null
  } finally {
    exporting.value = false
  }
}

function formatExportRows(rows: Record<string, unknown>[], columns: ColumnInfo[], schema: any, format: "csv" | "xlsx") {
  return rows.map((row) => {
    const newRow: Record<string, any> = {}
    columns.forEach((col) => {
      const colName = col.name
      const val = row[colName]
      const prop = schema?.properties?.[colName]
      const type = prop?.type || ""

      if (val === null || val === undefined) {
        newRow[colName] = ""
      } else if (type === "boolean") {
        if (format === "xlsx") {
          newRow[colName] = val === 1 || val === "1" || val === true
        } else {
          newRow[colName] = (val === 1 || val === "1" || val === true) ? "true" : "false"
        }
      } else if (type === "number" || type === "integer") {
        if (val === "") {
          newRow[colName] = ""
        } else {
          const num = Number(val)
          newRow[colName] = Number.isNaN(num) ? val : num
        }
      } else if (typeof val === "object") {
        newRow[colName] = JSON.stringify(val)
      } else {
        const dbType = (col.type || "").toLowerCase()
        const isNumericDb = dbType.includes("int") || dbType.includes("real") || dbType.includes("num") || dbType.includes("double") || dbType.includes("float")
        if (isNumericDb && typeof val === "string" && val !== "") {
          const num = Number(val)
          newRow[colName] = Number.isNaN(num) ? val : num
        } else {
          newRow[colName] = val
        }
      }
    })
    return newRow
  })
}

function downloadBlob(content: string | ArrayBuffer | Blob, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function exportCSV() {
  const fullData = await fetchAllRows()
  if (!fullData) return
  const XLSX = await loadXlsx()
  const { columns, rows, schema } = fullData
  const formattedRows = formatExportRows(rows, columns, schema, "csv")
  const ws = XLSX.utils.json_to_sheet(formattedRows, { header: columns.map(col => col.name) })
  const csv = XLSX.utils.sheet_to_csv(ws)
  const bom = "\uFEFF"
  downloadBlob(bom + csv, `${props.tableName}.csv`, "text/csv;charset=utf-8")
}

async function exportExcel() {
  const fullData = await fetchAllRows()
  if (!fullData) return
  const XLSX = await loadXlsx()
  const { columns, rows, schema } = fullData
  const formattedRows = formatExportRows(rows, columns, schema, "xlsx")
  const ws = XLSX.utils.json_to_sheet(formattedRows, { header: columns.map(col => col.name) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (props.tableName || "Sheet1").slice(0, 31))
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  downloadBlob(wbout, `${props.tableName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
}

async function exportJSON() {
  const fullData = await fetchAllRows()
  if (!fullData) return
  const { columns, rows } = fullData
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((c) => {
      obj[c.name] = row[c.name]
    })
    return obj
  })
  downloadBlob(JSON.stringify(data, null, 2), `${props.tableName}.json`, "application/json")
}
</script>

<template>
  <div class="flex h-full min-w-0 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4">
      <template v-if="!props.tableName">
        <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <i class="pi pi-database text-4xl mb-3 opacity-50" />
          <p class="text-sm">
            {{ $t("app.selectTable") }}
          </p>
        </div>
      </template>

      <template v-else-if="props.loading">
        <div class="flex-1 flex items-center justify-center text-muted-foreground">
          {{ $t("app.loading") }}
        </div>
      </template>

      <template v-else-if="props.tableData">
        <div class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <h2 class="m-0 text-lg font-semibold text-foreground shrink-0">
              {{ props.tableName }}
            </h2>
            <span class="text-xs text-muted-foreground shrink-0">
              {{ props.tableData.total }} {{ $t("app.rowCount") }}
            </span>
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <div class="relative">
              <i class="pi pi-search absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none" />
              <input
                v-model="searchInput"
                type="text"
                :placeholder="$t('app.search')"
                class="h-7 w-44 rounded-md border border-border bg-background pl-6 pr-7 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                @input="onSearchInput"
              >
              <button
                v-if="searchInput"
                class="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                @click="clearSearch"
              >
                &times;
              </button>
            </div>
            <Button
              icon="pi pi-file-excel"
              :label="$t('app.exportExcel')"
              severity="secondary"
              size="small"
              outlined
              :loading="exporting"
              @click="exportExcel"
            />
            <Button
              icon="pi pi-file-export"
              :label="$t('app.exportCSV')"
              severity="secondary"
              size="small"
              outlined
              :loading="exporting"
              @click="exportCSV"
            />
            <Button
              icon="pi pi-code"
              :label="$t('app.exportJSON')"
              severity="secondary"
              size="small"
              outlined
              :loading="exporting"
              @click="exportJSON"
            />
          </div>
        </div>

        <div class="min-h-0 min-w-0 flex-1 overflow-hidden">
          <VxeTable
            :data="props.tableData.rows"
            class="w-full"
            height="auto"
            border
            round
            stripe
            :row-config="{ isHover: true }"
            show-header-overflow="title"
            :sort-config="{ remote: true }"
            @sort-change="sortChange"
          >
            <VxeColumn type="seq" title="#" width="60" fixed="left" />
            <VxeColumn :title="$t('app.actions')" width="180" align="center" fixed="right">
              <template #default="{ rowIndex }: any">
                <div v-if="rowAction(rowIndex)" class="flex items-center justify-center">
                  <span
                    class="mr-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                    :class="[
                      rowAction(rowIndex)!.notionStatus === 'synced'
                        ? 'bg-green-500/10 text-green-700'
                        : rowAction(rowIndex)!.notionStatus === 'failed'
                          ? 'bg-red-500/10 text-red-700'
                          : 'bg-secondary text-muted-foreground',
                    ]"
                  >
                    {{ notionStatusLabel(rowAction(rowIndex)!.notionStatus) }}
                  </span>
                  <Button
                    icon="pi pi-eye"
                    severity="secondary"
                    size="small"
                    text
                    v-tooltip.top="$t('app.viewJson')"
                    :aria-label="$t('app.viewExtractionJson')"
                    @click="emit('selectExtraction', rowAction(rowIndex)!.extractionName)"
                  />
                  <Button
                    icon="pi pi-refresh"
                    severity="secondary"
                    size="small"
                    text
                    :loading="syncingExtraction === rowAction(rowIndex)!.extractionName"
                    :disabled="rowAction(rowIndex)!.notionStatus === 'synced'"
                    v-tooltip.top="notionActionTooltip(rowAction(rowIndex)!.notionStatus)"
                    :aria-label="notionActionLabel(rowAction(rowIndex)!.notionStatus)"
                    @click="syncExtractionToNotion(rowAction(rowIndex)!)"
                  />
                </div>
                <span v-else class="block text-right text-xs text-muted-foreground">-</span>
              </template>
            </VxeColumn>
            <VxeColumn
              v-for="col in props.tableData.columns"
              :key="col.name"
              :field="col.name"
              :title="col.name"
              sortable
              min-width="180"
            >
              <template #default="{ row }: any">
                {{ formatCellValue(row[col.name]) }}
              </template>
            </VxeColumn>
          </VxeTable>
        </div>

        <div class="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center justify-end gap-1">
            <span class="text-xs text-muted-foreground shrink-0">{{ $t("app.rowsPerPage") }}</span>
            <select
              class="h-7 rounded border border-border bg-background px-1 text-xs text-foreground outline-none"
              :value="props.tableData.pageSize"
              @change="emit('pageSizeChange', Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="s in pageSizeOptions" :key="s" :value="s">
                {{ s }}
              </option>
            </select>
          </div>

          <div class="flex items-center gap-1">
            <span class="text-xs text-muted-foreground shrink-0 mr-1">
              {{ (props.tableData.page - 1) * props.tableData.pageSize + 1 }}–{{ Math.min(props.tableData.page * props.tableData.pageSize, props.tableData.total) }} {{ $t("app.of") }} {{ props.tableData.total }}
            </span>
            <button
              class="flex items-center justify-center h-7 w-7 rounded text-xs text-foreground disabled:opacity-30 hover:bg-secondary disabled:hover:bg-transparent transition-colors"
              :disabled="props.tableData.page <= 1"
              @click="goToPage(props.tableData.page - 1)"
            >
              <i class="pi pi-chevron-left" />
            </button>
            <template v-for="p in pageNumbers" :key="typeof p === 'string' ? p : p">
              <span v-if="typeof p === 'string'" class="text-xs text-muted-foreground px-0.5 select-none">{{ p }}</span>
              <button
                v-else
                class="flex items-center justify-center h-7 min-w-7 rounded text-xs font-medium transition-colors"
                :class="p === props.tableData.page ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'"
                @click="goToPage(p)"
              >
                {{ p }}
              </button>
            </template>
            <button
              class="flex items-center justify-center h-7 w-7 rounded text-xs text-foreground disabled:opacity-30 hover:bg-secondary disabled:hover:bg-transparent transition-colors"
              :disabled="props.tableData.page >= props.tableData.totalPages"
              @click="goToPage(props.tableData.page + 1)"
            >
              <i class="pi pi-chevron-right" />
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
