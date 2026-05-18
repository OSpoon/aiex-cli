<script setup lang="ts">
import Button from "primevue/button"
import { computed, onUnmounted, ref } from "vue"
import { VxeColumn, VxeTable } from "vxe-table"
import "vxe-pc-ui/lib/style.css"
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
  total: number
  page: number
  pageSize: number
  totalPages: number
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
}>()

// ── search ──

const searchInput = ref(props.searchQuery)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    emit("searchChange", searchInput.value)
  }, 300)
}

function clearSearch() {
  searchInput.value = ""
  emit("searchChange", "")
}

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

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

function downloadBlob(content: string, filename: string, mimeType: string) {
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

function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return ""
  const str = typeof val === "object" ? JSON.stringify(val) : String(val)
  if (str.includes(",") || str.includes("\"") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, "\"\"")}"`
  }
  return str
}

function exportCSV() {
  if (!props.tableData) return
  const { columns, rows } = props.tableData
  const header = columns.map(c => escapeCsvValue(c.name)).join(",")
  const body = rows.map(row =>
    columns.map(c => escapeCsvValue(row[c.name])).join(",")
  ).join("\n")
  const bom = "\uFEFF"
  downloadBlob(`${bom + header}\n${body}`, `${props.tableName}.csv`, "text/csv;charset=utf-8")
}

function exportJSON() {
  if (!props.tableData) return
  const { columns, rows } = props.tableData
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
  <div class="flex h-full">
    <div class="flex-1 min-h-0 p-3 flex flex-col overflow-x-auto">
      <template v-if="!props.tableName">
        <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <i class="pi pi-database text-4xl mb-3 opacity-50" />
          <p class="text-sm">
            Select a table from the sidebar
          </p>
        </div>
      </template>

      <template v-else-if="props.loading">
        <div class="flex-1 flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </template>

      <template v-else-if="props.tableData">
        <div class="flex items-center justify-between mb-3 shrink-0 gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="m-0 text-lg font-semibold text-foreground shrink-0">
              {{ props.tableName }}
            </h2>
            <span class="text-xs text-muted-foreground shrink-0">
              {{ props.tableData.total }} row(s)
            </span>
          </div>

          <div class="flex items-center gap-2">
            <div class="relative">
              <i class="pi pi-search absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none" />
              <input
                v-model="searchInput"
                type="text"
                placeholder="Search..."
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
              icon="pi pi-file-export"
              label="CSV"
              severity="secondary"
              size="small"
              outlined
              @click="exportCSV"
            />
            <Button
              icon="pi pi-code"
              label="JSON"
              severity="secondary"
              size="small"
              outlined
              @click="exportJSON"
            />
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-x-auto">
          <VxeTable
            :data="props.tableData.rows"
            height="auto"
            border="none"
            stripe
            :row-config="{ isHover: true }"
            show-header-overflow="title"
            :sort-config="{ remote: true }"
            @sort-change="sortChange"
          >
            <VxeColumn type="seq" title="#" width="60" />
            <VxeColumn
              v-for="col in props.tableData.columns"
              :key="col.name"
              :field="col.name"
              :title="col.name"
              sortable
              min-width="120"
            >
              <template #default="{ row }: any">
                {{ formatCellValue(row[col.name]) }}
              </template>
            </VxeColumn>
          </VxeTable>
        </div>

        <div class="flex items-center justify-between mt-3 shrink-0 gap-2">
          <div class="flex items-center gap-1">
            <span class="text-xs text-muted-foreground shrink-0">Rows per page:</span>
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
              {{ (props.tableData.page - 1) * props.tableData.pageSize + 1 }}–{{ Math.min(props.tableData.page * props.tableData.pageSize, props.tableData.total) }} of {{ props.tableData.total }}
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
