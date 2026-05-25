<script setup lang="ts">
import { AlertCircle, Check, Plus, Sparkles, Trash2 } from "lucide-vue-next"
import Button from "primevue/button"
import Textarea from "primevue/textarea"
import { onMounted, ref, watch } from "vue"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"

defineProps<{
  readOnly?: boolean
}>()

interface LocalExampleItem {
  id: string
  text: string
  outputJsonStr: string
  isValidJson: boolean
}

const store = useSchemaStore()
const localExamples = ref<LocalExampleItem[]>([])

function initFromStore() {
  const rawSchema = store.schema.value
  const rawExamples = rawSchema && typeof rawSchema === "object"
    ? (rawSchema.examples || [])
    : []

  localExamples.value = rawExamples.map((item: any, idx: number) => ({
    id: `${Date.now()}-${idx}-${Math.random()}`,
    text: item.text || "",
    outputJsonStr: JSON.stringify(item.output || {}, null, 2),
    isValidJson: true
  }))
}

onMounted(() => {
  initFromStore()
})

let lastStoreExamplesJson = JSON.stringify(
  store.schema.value && typeof store.schema.value === "object"
    ? store.schema.value.examples
    : []
)

// Watch for external schema changes (e.g. from Monaco/Reset)
watch(() => store.schema.value, (newSchema) => {
  const currentRaw = newSchema && typeof newSchema === "object" ? (newSchema.examples || []) : []
  const rawJson = JSON.stringify(currentRaw)
  if (rawJson !== lastStoreExamplesJson) {
    lastStoreExamplesJson = rawJson
    initFromStore()
  }
}, { deep: true })

function saveToStore() {
  // Only write back to store if JSON outputs are valid to prevent breaking the schema
  if (localExamples.value.some(item => !item.isValidJson)) {
    return
  }
  const schemaCopy = cloneJson(store.schema.value)
  if (typeof schemaCopy === "object" && schemaCopy !== null) {
    schemaCopy.examples = localExamples.value.map(item => ({
      text: item.text,
      output: JSON.parse(item.outputJsonStr)
    }))
    lastStoreExamplesJson = JSON.stringify(schemaCopy.examples)
    store.replaceSchema(schemaCopy)
  }
}

function addExample() {
  localExamples.value.push({
    id: `${Date.now()}-${Math.random()}`,
    text: "",
    outputJsonStr: "{\n}",
    isValidJson: true
  })
  saveToStore()
}

function deleteExample(idx: number) {
  localExamples.value.splice(idx, 1)
  saveToStore()
}

function handleTextChange(idx: number, val: string) {
  localExamples.value[idx].text = val
  saveToStore()
}

function handleJsonChange(idx: number, val: string) {
  const item = localExamples.value[idx]
  item.outputJsonStr = val
  try {
    JSON.parse(val)
    item.isValidJson = true
    saveToStore()
  } catch {
    item.isValidJson = false
  }
}

function generateDefaultJsonFromSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return null

  if (schema.type === "object") {
    const obj: Record<string, any> = {}
    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        obj[key] = generateDefaultJsonFromSchema(value)
      }
    }
    return obj
  }

  if (schema.type === "array") {
    if (schema.items) {
      return [generateDefaultJsonFromSchema(schema.items)]
    }
    return []
  }

  if (schema.type === "string") return ""
  if (schema.type === "integer" || schema.type === "number") return 0
  if (schema.type === "boolean") return false

  return null
}

function generateTemplate(idx: number) {
  const defaultJson = generateDefaultJsonFromSchema(store.schema.value)
  localExamples.value[idx].outputJsonStr = JSON.stringify(defaultJson || {}, null, 2)
  localExamples.value[idx].isValidJson = true
  saveToStore()
}
</script>

<template>
  <div class="p-4 flex-1 min-h-0 flex flex-col overflow-auto jscb">
    <div class="shrink-0 mb-4 flex items-center justify-between">
      <div>
        <h4 class="font-medium text-sm text-foreground">
          Few-Shot Examples
        </h4>
        <p class="text-xs text-muted-foreground mt-0.5">
          Provide examples of source text and expected JSON output to guide lightweight local models (e.g. Ollama Qwen) for much higher extraction accuracy.
        </p>
      </div>
      <Button
        v-if="!readOnly"
        type="button"
        size="small"
        severity="secondary"
        class="flex items-center gap-1.5 whitespace-nowrap shrink-0"
        @click="addExample"
      >
        <Plus :size="14" />
        Add Example
      </Button>
    </div>

    <!-- Empty state -->
    <div
      v-if="localExamples.length === 0"
      class="flex-1 border border-dashed border-border rounded-lg flex flex-col items-center justify-center py-12 px-4 text-center"
    >
      <div class="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-3">
        <Sparkles :size="20" />
      </div>
      <h5 class="text-sm font-medium text-foreground">
        No few-shot examples defined
      </h5>
      <p class="text-xs text-muted-foreground mt-1 max-w-sm">
        Few-shot prompting shows the model exact input/output pairs. Highly recommended for local models running on CPU/GPU.
      </p>
      <Button
        v-if="!readOnly"
        type="button"
        size="small"
        class="mt-4"
        @click="addExample"
      >
        <Plus :size="14" class="mr-1.5" />
        Add First Example
      </Button>
    </div>

    <!-- Examples List -->
    <div v-else class="flex-1 flex flex-col gap-4">
      <div
        v-for="(item, idx) in localExamples"
        :key="item.id"
        class="border border-border/80 bg-card/40 hover:bg-card/60 transition-colors p-4 rounded-lg flex flex-col gap-3 relative"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-border/60 pb-2">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Example #{{ idx + 1 }}</span>
          <Button
            v-if="!readOnly"
            type="button"
            severity="danger"
            text
            size="small"
            class="p-1 hover:bg-red-500/10 rounded-md!"
            @click="deleteExample(idx)"
            aria-label="Delete Example"
          >
            <Trash2 :size="14" />
          </Button>
        </div>

        <!-- Content: Stacked layout (Input → Output) -->
        <div class="flex flex-col gap-4">
          <!-- Input Text -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-foreground/80">Input Text Example</label>
            <Textarea
              :model-value="item.text"
              @update:model-value="handleTextChange(idx, $event)"
              placeholder="Paste raw unstructured text example here..."
              rows="5"
              class="w-full text-xs font-sans p-3 bg-secondary/30 border border-border/60 rounded-md focus:border-primary/60 focus:ring-1 focus:ring-primary/60! resize-y jscb"
              :disabled="readOnly"
            />
          </div>

          <!-- Output JSON -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-3">
              <label class="text-xs font-medium text-foreground/80 shrink-0">Expected JSON Output</label>

              <div class="flex items-center gap-2">
                <!-- Validation Badge -->
                <span
                  v-if="item.outputJsonStr.trim()"
                  class="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 font-medium shrink-0" :class="[
                    item.isValidJson
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20',
                  ]"
                >
                  <component :is="item.isValidJson ? Check : AlertCircle" :size="10" />
                  {{ item.isValidJson ? 'Valid JSON' : 'Invalid JSON' }}
                </span>

                <Button
                  v-if="!readOnly"
                  type="button"
                  severity="secondary"
                  text
                  size="small"
                  class="text-[10px] p-0 px-2 h-6 border border-border/80 hover:bg-secondary/80 rounded-md! shrink-0"
                  @click="generateTemplate(idx)"
                  title="Generate JSON layout based on schema"
                >
                  <Sparkles :size="10" class="mr-1 text-primary" />
                  Gen Template
                </Button>
              </div>
            </div>

            <Textarea
              :model-value="item.outputJsonStr"
              @update:model-value="handleJsonChange(idx, $event)"
              placeholder="{ ... }"
              rows="5"
              class="w-full text-xs font-mono p-3 bg-secondary/30 border border-border/60 rounded-md focus:border-primary/60 focus:ring-1 focus:ring-primary/60! resize-y jscb"
              :disabled="readOnly"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
