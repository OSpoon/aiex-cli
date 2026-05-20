<script setup lang="ts">
import type { AIModelConfig, RunExtractionResult } from "@/api-client"
import Button from "primevue/button"
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { runExtraction } from "@/api-client"

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

const schemaOptions = computed(() => props.schemas.map(name => name.replace(".json", "")))

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
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Extraction failed")
  }
  running.value = false
}
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
  </div>
</template>
