<script setup lang="ts">
import { Download, FileJson } from "lucide-vue-next"
import { computed, ref, watch } from "vue"
import MonacoEditor from "@/lib/jsonschema-editor/components/ui/MonacoEditor.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import { useSchemaStore } from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { cn } from "@/lib/jsonschema-editor/lib/utils"

const props = defineProps<{
  class?: string
}>()

const store = useSchemaStore()
const schema = computed(() => store.schema.value)
const t = useTranslation()

// ── One-way text buffer ──
// `editorText` is a local string ref that owns Monaco's content.
// Store-to-editor: computed → rAF inside MonacoEditor (via prop)
// Editor-to-store: debounced emit → this handler
let lastStoreJson = JSON.stringify(schema.value)
const editorText = ref(JSON.stringify(schema.value, null, 2))

// When the store changes (e.g. from visual editor), update the text buffer
watch(schema, (newSchema) => {
  const newJson = JSON.stringify(newSchema)
  if (newJson === lastStoreJson) return // nothing changed structurally
  lastStoreJson = newJson
  editorText.value = JSON.stringify(newSchema, null, 2)
})

// When the editor emits a change, parse and push to store
function handleEditorUpdate(newText: string) {
  try {
    const parsed = JSON.parse(newText)
    const newJson = JSON.stringify(parsed)
    if (newJson === lastStoreJson) return
    lastStoreJson = newJson
    store.replaceSchema(parsed)
  } catch {
    // Invalid JSON — Monaco will show the error inline
  }
}

function handleDownload() {
  const content = JSON.stringify(schema.value, null, 2)
  const blob = new Blob([content], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = t.visualizerDownloadFileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div
    :class="cn('relative overflow-hidden flex-1 min-h-0 flex flex-col', props.class, 'jscb')"
  >
    <div class="editor-pane-header justify-between bg-secondary/80 backdrop-blur-xs">
      <div class="flex items-center gap-2">
        <FileJson :size="18" />
        <span class="font-medium text-sm">{{ t.visualizerSource }}</span>
      </div>
      <button
        type="button"
        @click="handleDownload"
        class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary transition-colors"
        :title="t.visualizerDownloadTitle"
      >
        <Download :size="16" />
      </button>
    </div>
    <div class="grow flex min-h-0 relative">
      <MonacoEditor
        :model-value="editorText"
        @update:model-value="handleEditorUpdate"
        language="json"
      />
    </div>
  </div>
</template>
