<script setup lang="ts">
import Button from "primevue/button"
import { onMounted, ref } from "vue"
import { toast } from "vue-sonner"
import { VxeColumn, VxeTable } from "vxe-table"
import "vxe-pc-ui/lib/style.css"
import "vxe-table/lib/style.css"

interface TableInfo {
  name: string
  title: string
  hasData: boolean
}

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

const loading = ref(false)
const tables = ref<TableInfo[]>([])
const selectedTable = ref<string | null>(null)
const tableData = ref<TableData | null>(null)
const dataLoading = ref(false)

async function loadTables() {
  loading.value = true
  try {
    const res = await fetch("/api/data/tables")
    if (!res.ok) throw new Error("Failed to load tables")
    tables.value = await res.json()
  } catch {
    toast.error("Failed to load tables")
  }
  loading.value = false
}

async function loadTableData(tableName: string, sortField?: string, sortOrder?: string) {
  selectedTable.value = tableName
  dataLoading.value = true
  try {
    const params = new URLSearchParams({ page: "1", pageSize: "200" })
    if (sortField) params.set("sortField", sortField)
    if (sortOrder) params.set("sortOrder", sortOrder)

    const res = await fetch(`/api/data/tables/${encodeURIComponent(tableName)}?${params}`)
    if (!res.ok) {
      const err = await res.json()
      toast.error(err.error || "Failed to load data")
      tableData.value = null
      return
    }
    tableData.value = await res.json()
  } catch {
    toast.error("Failed to load table data")
    tableData.value = null
  }
  dataLoading.value = false
}

function sortChange(params: any) {
  if (!selectedTable.value) return
  const field = params.field
  const order = params.order
  if (order === "normal") {
    loadTableData(selectedTable.value)
  } else {
    loadTableData(selectedTable.value, field, order === "desc" ? "desc" : "asc")
  }
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return ""
  if (typeof val === "object") return JSON.stringify(val)
  return String(val)
}

onMounted(() => {
  loadTables()
})
</script>

<template>
  <div class="flex h-full">
    <!-- Table list sidebar -->
    <div class="w-56 shrink-0 border-r border-border p-3 flex flex-col min-h-0">
      <h3 class="m-0 mb-3 text-sm font-semibold text-foreground shrink-0">
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
      <div v-if="tables.length === 0 && !loading" class="text-center py-8 text-muted-foreground text-xs">
        No schemas found. Create one in Editor first.
      </div>
      <Button class="w-full mt-3 shrink-0" icon="pi pi-refresh" severity="secondary" size="small" text @click="loadTables" />
    </div>

    <!-- Data view -->
    <div class="flex-1 min-h-0 p-3 flex flex-col">
      <template v-if="!selectedTable">
        <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <i class="pi pi-database text-4xl mb-3 opacity-50" />
          <p class="text-sm">
            Select a table to view its data
          </p>
        </div>
      </template>

      <template v-else-if="dataLoading">
        <div class="flex-1 flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </template>

      <template v-else-if="tableData">
        <div class="flex items-center justify-between mb-3 shrink-0">
          <div class="flex items-center gap-2">
            <h2 class="m-0 text-lg font-semibold text-foreground">
              {{ selectedTable }}
            </h2>
            <span class="text-xs text-muted-foreground">
              {{ tableData.total }} row(s)
            </span>
          </div>
        </div>

        <div class="flex-1 min-h-0">
          <VxeTable
            :data="tableData.rows"
            height="auto"
            border="none"
            stripe
            highlight-hover-row
            :sort-config="{ remote: true }"
            @sort-change="sortChange"
          >
            <VxeColumn type="seq" title="#" width="60" />
            <VxeColumn
              v-for="col in tableData.columns"
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
      </template>
    </div>
  </div>
</template>
