<script setup lang="ts">
import type { AIModelConfig, ExtractionAuditRecord, RunExtractionResult } from "@/api-client"
import Button from "primevue/button"
import { computed, onMounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { listExtractionRuns, retryExtractionRun, runExtraction } from "@/api-client"

const props = defineProps<{
  schemas: string[]
  models: AIModelConfig[]
}>()

const emit = defineEmits<{
  completed: [result: RunExtractionResult]
}>()

const selectedSchema = ref("")
const selectedModel = ref("")
const inputMode = ref<"text" | "file">("text")
const textInput = ref("")
const fileInput = ref<File | null>(null)
const running = ref(false)
const lastResult = ref<RunExtractionResult | null>(null)
const records = ref<ExtractionAuditRecord[]>([])
const recordsLoading = ref(false)
const retryingId = ref<string | null>(null)

const schemaOptions = computed(() => props.schemas.map(name => name.replace(".json", "")))
const recentRecords = computed(() => records.value.slice(0, 8))

watch(schemaOptions, (schemas) => {
  if (!selectedSchema.value && schemas.length > 0)
    selectedSchema.value = schemas[0]
}, { immediate: true })

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  fileInput.value = input.files?.[0] ?? null
}

function resetInput() {
  textInput.value = ""
  fileInput.value = null
  lastResult.value = null
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    records.value = await listExtractionRuns()
  } catch {
    toast.error("Failed to load extraction history")
  }
  recordsLoading.value = false
}

async function handleRun() {
  if (!selectedSchema.value) {
    toast.error("Select a schema")
    return
  }

  const text = textInput.value.trim()
  if (inputMode.value === "text" && !text) {
    toast.error("Enter text to extract")
    return
  }
  if (inputMode.value === "file" && !fileInput.value) {
    toast.error("Choose a file to extract")
    return
  }

  running.value = true
  lastResult.value = null
  try {
    const result = await runExtraction({
      schema: selectedSchema.value,
      text: inputMode.value === "text" ? text : undefined,
      file: inputMode.value === "file" ? fileInput.value : null,
      model: selectedModel.value || undefined
    })
    lastResult.value = result
    toast.success("Extraction complete")
    emit("completed", result)
    await loadRecords()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Extraction failed")
    await loadRecords()
  }
  running.value = false
}

async function handleRetry(record: ExtractionAuditRecord) {
  retryingId.value = record.id
  try {
    const result = await retryExtractionRun(record.id)
    lastResult.value = result
    toast.success("Retry complete")
    emit("completed", result)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Retry failed")
  }
  await loadRecords()
  retryingId.value = null
}

function statusClass(status: ExtractionAuditRecord["status"]): string {
  if (status === "succeeded") return "text-green-600"
  if (status === "failed") return "text-red-600"
  return "text-muted-foreground"
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

onMounted(loadRecords)
</script>

<template>
  <div class="h-full min-h-0 p-4 flex flex-col gap-4 overflow-auto">
    <div class="flex flex-wrap items-end gap-3 shrink-0">
      <label class="flex flex-col gap-1 text-sm text-foreground">
        <span class="text-xs text-muted-foreground">Schema</span>
        <select v-model="selectedSchema" class="h-9 min-w-48 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary">
          <option v-for="name in schemaOptions" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm text-foreground">
        <span class="text-xs text-muted-foreground">Model</span>
        <select v-model="selectedModel" class="h-9 min-w-56 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary">
          <option value="">
            Auto
          </option>
          <option v-for="model in props.models" :key="model.name" :value="model.name">
            {{ model.name }}
          </option>
        </select>
      </label>

      <div class="flex h-9 rounded-md border border-border bg-muted p-0.5">
        <button
          class="px-3 text-sm rounded transition-colors"
          :class="inputMode === 'text' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="inputMode = 'text'; resetInput()"
        >
          Text
        </button>
        <button
          class="px-3 text-sm rounded transition-colors"
          :class="inputMode === 'file' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="inputMode = 'file'; resetInput()"
        >
          File
        </button>
      </div>

      <Button
        icon="pi pi-sparkles"
        label="Extract"
        size="small"
        :loading="running"
        :disabled="schemaOptions.length === 0"
        @click="handleRun"
      />
    </div>

    <div v-if="schemaOptions.length === 0" class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <i class="pi pi-file-edit text-4xl mb-3 opacity-50" />
      <p class="text-sm">
        Create and save a schema before extracting data
      </p>
    </div>

    <template v-else>
      <div v-if="inputMode === 'text'" class="flex-1 min-h-64 flex flex-col">
        <textarea
          v-model="textInput"
          class="flex-1 min-h-64 resize-none rounded-md border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
          placeholder="Paste text to extract..."
        />
      </div>

      <div v-else class="flex-1 min-h-64 rounded-md border border-dashed border-border bg-background p-6 flex flex-col items-center justify-center gap-3 text-center">
        <i class="pi pi-upload text-3xl text-muted-foreground" />
        <input
          type="file"
          class="max-w-full text-sm text-muted-foreground"
          accept=".txt,.md,.csv,.json,.html,.xml,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
          @change="onFileChange"
        >
        <div v-if="fileInput" class="text-sm text-foreground">
          {{ fileInput.name }}
        </div>
      </div>

      <div v-if="lastResult" class="shrink-0 rounded-md border border-border bg-secondary p-3 text-sm text-foreground">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span v-if="lastResult.outputName">Saved: {{ lastResult.outputName }}</span>
          <span v-if="lastResult.tablesInserted">Inserted: {{ lastResult.tablesInserted.length }} table(s)</span>
          <span v-if="lastResult.tokensUsed">Tokens: {{ lastResult.tokensUsed.total }}</span>
        </div>
      </div>
    </template>

    <div class="shrink-0 h-72 rounded-md border border-border bg-background overflow-hidden flex flex-col">
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 class="m-0 text-sm font-semibold text-foreground">
          Extraction History
        </h3>
        <Button
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          text
          :loading="recordsLoading"
          @click="loadRecords"
        />
      </div>

      <div v-if="recordsLoading" class="px-3 py-4 text-sm text-muted-foreground">
        Loading...
      </div>
      <div v-else-if="recentRecords.length === 0" class="px-3 py-4 text-sm text-muted-foreground">
        No extraction runs yet
      </div>
      <div v-else class="min-h-0 flex-1 overflow-y-auto divide-y divide-border">
        <div
          v-for="record in recentRecords"
          :key="record.id"
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-medium text-foreground">{{ record.schemaName }}</span>
              <span class="text-xs font-medium" :class="statusClass(record.status)">{{ record.status }}</span>
              <span v-if="record.retryOf" class="text-xs text-muted-foreground">retry</span>
            </div>
            <div class="mt-1 truncate text-xs text-muted-foreground">
              {{ formatDate(record.createdAt) }} · {{ record.source.type === "file" ? record.source.fileName : "text" }}
              <template v-if="record.modelName">
                · {{ record.modelName }}
              </template>
              <template v-if="record.outputName">
                · {{ record.outputName }}
              </template>
            </div>
            <div v-if="record.error" class="mt-1 truncate text-xs text-red-600">
              {{ record.error }}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Button
              icon="pi pi-replay"
              severity="secondary"
              size="small"
              text
              :loading="retryingId === record.id"
              @click="handleRetry(record)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
