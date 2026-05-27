<script setup lang="ts">
import type { ExtractionRecord, InputProcessingInfo } from "@/api-client"
import Button from "primevue/button"
import { computed, onMounted, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { toast } from "vue-sonner"
import { getExtraction, retryNotionSync } from "@/api-client"

const props = defineProps<{
  extractionName: string | null
  record?: ExtractionRecord | null
}>()
const emit = defineEmits<{
  notionSynced: []
}>()

const { t } = useI18n()

const extractContent = ref("")
const loading = ref(false)
const retryingNotion = ref(false)
const notionActionLabel = computed(() => {
  if (props.record?.notionStatus === "synced") return t("app.notionSynced")
  if (props.record?.notionStatus === "failed") return t("app.retryNotion")
  return t("app.syncNotion")
})
const inputProcessingLabel = computed(() => formatInputProcessing(props.record?.inputProcessing))

async function loadContent() {
  if (!props.extractionName) return
  loading.value = true
  extractContent.value = ""
  try {
    const result = await getExtraction(props.extractionName)
    if (result.success && result.content) {
      extractContent.value = result.content
    } else {
      toast.error(result.error || t("app.failedToLoadExtraction"))
    }
  } catch {
    toast.error(t("app.failedToLoadExtraction"))
  }
  loading.value = false
}

function handleDownload() {
  if (!props.extractionName || !extractContent.value) return
  const blob = new Blob([extractContent.value], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = props.extractionName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function handleRetryNotion() {
  if (!props.extractionName) return
  retryingNotion.value = true
  try {
    const result = await retryNotionSync(props.extractionName)
    toast.success(t("app.notionSyncedToNotionDetail", { count: result.notionPages?.length ?? 0 }))
    emit("notionSynced")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("app.notionSyncFailed"))
  }
  retryingNotion.value = false
}

function notionStatusLabel(status: ExtractionRecord["notionStatus"] | undefined): string {
  if (status === "synced") return t("app.notionStatusSynced")
  if (status === "failed") return t("app.notionStatusFailed")
  return t("app.notionStatusNotSynced")
}

function handlerLabel(input: InputProcessingInfo): string {
  if (input.handler === "image_vision") return "Vision"
  if (input.handler === "image_local_ocr") return "Local OCR"
  if (input.handler === "pdf_converter") return input.converter ? `PDF ${input.converter}` : "PDF converter"
  return "Text"
}

function formatInputProcessing(input?: InputProcessingInfo): string {
  if (!input) return ""
  return `${input.mime ?? input.kind} -> ${handlerLabel(input)}`
}

function tryParseAndFormat(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

watch(() => props.extractionName, loadContent)
onMounted(loadContent)
</script>

<template>
  <div class="flex h-full min-w-0 overflow-hidden">
    <div v-if="!extractionName" class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <i class="pi pi-file text-4xl mb-3 opacity-50" />
      <p class="text-sm">
        {{ $t("app.selectExtraction") }}
      </p>
    </div>

    <div v-else-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground">
      {{ $t("app.loading") }}
    </div>

    <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4">
      <div class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 class="m-0 text-lg font-semibold text-foreground">
          {{ extractionName }}
        </h2>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span
            v-if="inputProcessingLabel"
            class="rounded bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground"
          >
            {{ inputProcessingLabel }}
          </span>
          <span
            v-if="record"
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
          <Button
            icon="pi pi-refresh"
            :label="notionActionLabel"
            severity="secondary"
            size="small"
            :loading="retryingNotion"
            :disabled="record?.notionStatus === 'synced'"
            @click="handleRetryNotion"
          />
          <Button
            icon="pi pi-download"
            :label="$t('app.download')"
            severity="secondary"
            size="small"
            @click="handleDownload"
          />
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <pre class="text-sm font-mono whitespace-pre-wrap text-foreground bg-secondary border border-border rounded-lg p-4">{{ tryParseAndFormat(extractContent) }}</pre>
      </div>
    </div>
  </div>
</template>
