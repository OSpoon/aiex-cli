<script setup lang="ts">
import Button from "primevue/button"
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
}>(), {
  tableName: null,
  tableData: null,
  loading: false
})

const emit = defineEmits<{
  sortChange: [field: string, order: "asc" | "desc" | null]
}>()

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
        <div class="flex items-center justify-between mb-3 shrink-0">
          <div class="flex items-center gap-2">
            <h2 class="m-0 text-lg font-semibold text-foreground">
              {{ props.tableName }}
            </h2>
            <span class="text-xs text-muted-foreground shrink-0">
              {{ props.tableData.total }} row(s)
            </span>
          </div>
          <div class="flex items-center gap-1">
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
      </template>
    </div>
  </div>
</template>
