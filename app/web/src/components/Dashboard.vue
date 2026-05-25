<script setup lang="ts">
import type { ExtractionRecord, TableInfo } from "@/api-client"
import Button from "primevue/button"
import { computed } from "vue"
import { useI18n } from "vue-i18n"

const props = defineProps<{
  schemas: string[]
  tables: TableInfo[]
  extractions: ExtractionRecord[]
  loadingExtractions?: boolean
}>()

const emit = defineEmits<{
  openSettings: []
  newSchema: []
  selectTable: [name: string]
  selectExtraction: [name: string]
}>()

const { t, locale } = useI18n()

const populatedTables = computed(() => props.tables.filter(table => table.hasData))
const syncedExtractions = computed(() => props.extractions.filter(record => record.notionStatus === "synced"))
const failedNotionExtractions = computed(() => props.extractions.filter(record => record.notionStatus === "failed"))
const recentExtractions = computed(() => props.extractions.slice(0, 6))
const topTables = computed(() => props.tables.slice(0, 6))

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale.value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function notionStatusLabel(status: ExtractionRecord["notionStatus"]): string {
  if (status === "synced") return t("app.notionSynced")
  if (status === "failed") return t("app.notionFailed")
  return t("app.notionPending")
}
</script>

<template>
  <div class="h-full min-h-0 overflow-auto bg-background">
    <div class="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <section class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 class="m-0 text-2xl font-semibold text-foreground">
            {{ $t("app.dashboard") }}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ $t("app.dashboardSubtitle") }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button icon="pi pi-plus" :label="$t('app.newSchema')" severity="secondary" size="small" @click="emit('newSchema')" />
          <Button icon="pi pi-cog" :label="$t('app.aiSettings')" size="small" @click="emit('openSettings')" />
        </div>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ $t("app.schemas") }}</span>
            <i class="pi pi-sitemap text-muted-foreground" />
          </div>
          <div class="mt-3 text-3xl font-semibold text-foreground">
            {{ schemas.length }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ $t("app.dataTables") }}</span>
            <i class="pi pi-database text-muted-foreground" />
          </div>
          <div class="mt-3 text-3xl font-semibold text-foreground">
            {{ populatedTables.length }}<span class="text-base font-normal text-muted-foreground"> / {{ tables.length }}</span>
          </div>
        </div>
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ $t("app.extractions") }}</span>
            <i class="pi pi-file-import text-muted-foreground" />
          </div>
          <div class="mt-3 text-3xl font-semibold text-foreground">
            {{ extractions.length }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ $t("app.notionSyncMetric") }}</span>
            <i class="pi pi-send text-muted-foreground" />
          </div>
          <div class="mt-3 text-3xl font-semibold text-foreground">
            {{ syncedExtractions.length }}<span class="text-base font-normal text-muted-foreground"> / {{ failedNotionExtractions.length }}</span>
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ $t("app.syncedFailed") }}
          </div>
        </div>
      </section>

      <section class="grid min-h-0 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-lg border border-border bg-card">
          <div class="flex items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h3 class="m-0 text-base font-semibold text-foreground">
                {{ $t("app.recentExtractions") }}
              </h3>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ $t("app.recentExtractionsHint") }}
              </p>
            </div>
          </div>

          <div v-if="loadingExtractions" class="flex h-48 items-center justify-center text-sm text-muted-foreground">
            {{ $t("app.loading") }}
          </div>
          <div v-else-if="recentExtractions.length === 0" class="flex h-48 flex-col items-center justify-center text-muted-foreground">
            <i class="pi pi-inbox mb-3 text-3xl opacity-50" />
            <p class="m-0 text-sm">
              {{ $t("app.noExtractionsYet") }}
            </p>
          </div>
          <div v-else class="divide-y divide-border">
            <button
              v-for="record in recentExtractions"
              :key="record.name"
              class="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary"
              @click="emit('selectExtraction', record.name)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-foreground">{{ record.name }}</span>
                <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{{ record.schemaName }}</span>
                  <span>{{ formatDate(record.timestamp) }}</span>
                  <span>{{ formatBytes(record.fileSize) }}</span>
                </span>
              </span>
              <span
                class="rounded px-2 py-1 text-xs font-medium"
                :class="[
                  record.notionStatus === 'synced'
                    ? 'bg-green-500/10 text-green-700'
                    : record.notionStatus === 'failed'
                      ? 'bg-red-500/10 text-red-700'
                      : 'bg-secondary text-muted-foreground',
                ]"
              >
                {{ notionStatusLabel(record.notionStatus) }}
              </span>
            </button>
          </div>
        </div>

        <div class="rounded-lg border border-border bg-card">
          <div class="border-b border-border p-4">
            <h3 class="m-0 text-base font-semibold text-foreground">
              {{ $t("app.tableOverview") }}
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ $t("app.tableOverviewHint") }}
            </p>
          </div>

          <div v-if="topTables.length === 0" class="flex h-48 flex-col items-center justify-center text-muted-foreground">
            <i class="pi pi-database mb-3 text-3xl opacity-50" />
            <p class="m-0 text-sm">
              {{ $t("app.noTablesYet") }}
            </p>
          </div>
          <div v-else class="divide-y divide-border">
            <button
              v-for="table in topTables"
              :key="table.name"
              class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary"
              @click="emit('selectTable', table.name)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-foreground">{{ table.title }}</span>
                <span class="mt-1 block truncate text-xs text-muted-foreground">{{ table.name }}</span>
              </span>
              <span
                class="shrink-0 rounded px-2 py-1 text-xs font-medium"
                :class="table.hasData ? 'bg-green-500/10 text-green-700' : 'bg-secondary text-muted-foreground'"
              >
                {{ table.hasData ? $t("app.hasData") : $t("app.empty") }}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
