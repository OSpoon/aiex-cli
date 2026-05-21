<script setup lang="ts">
import Button from "primevue/button"
import { onMounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { getExtraction, retryNotionSync } from "@/api-client"

const props = defineProps<{
  extractionName: string | null
}>()

const extractContent = ref("")
const loading = ref(false)
const retryingNotion = ref(false)

async function loadContent() {
  if (!props.extractionName) return
  loading.value = true
  extractContent.value = ""
  try {
    const result = await getExtraction(props.extractionName)
    if (result.success && result.content) {
      extractContent.value = result.content
    } else {
      toast.error(result.error || "Failed to load extraction")
    }
  } catch {
    toast.error("Failed to load extraction")
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
    toast.success(`Synced to Notion (${result.notionPages?.length ?? 0} page)`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Notion sync failed")
  }
  retryingNotion.value = false
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
  <div class="flex h-full">
    <div v-if="!extractionName" class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <i class="pi pi-file text-4xl mb-3 opacity-50" />
      <p class="text-sm">
        Select an extraction record from the sidebar
      </p>
    </div>

    <div v-else-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground">
      Loading...
    </div>

    <div v-else class="flex-1 min-h-0 p-3 flex flex-col overflow-x-auto">
      <div class="flex items-center justify-between mb-3 shrink-0">
        <h2 class="m-0 text-lg font-semibold text-foreground">
          {{ extractionName }}
        </h2>
        <div class="flex items-center gap-2">
          <Button
            icon="pi pi-refresh"
            label="Retry Notion"
            severity="secondary"
            size="small"
            :loading="retryingNotion"
            @click="handleRetryNotion"
          />
          <Button
            icon="pi pi-download"
            label="Download"
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
