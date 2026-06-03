<script setup lang="ts">
import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import { useDebounceFn } from "@vueuse/core"
import TabPanel from "primevue/tabpanel"
import { ref, watch } from "vue"
import Tabs from "@/lib/jsonschema-editor/components/ui/Tabs.vue"
import { useTranslation } from "@/lib/jsonschema-editor/hooks/use-translation"
import {
  createSchemaStore,
  provideSchemaStore
} from "@/lib/jsonschema-editor/hooks/useSchemaStore"
import { cn } from "@/lib/jsonschema-editor/lib/utils"
import FewShotExamplesEditor from "./FewShotExamplesEditor.vue"
import JsonSchemaVisualizer from "./JsonSchemaVisualizer.vue"
import SchemaVisualEditor from "./SchemaVisualEditor.vue"
import TableConfigEditor from "./TableConfigEditor.vue"

/** @public */
export interface JsonSchemaEditorProps {
  schema?: JSONSchema
  readOnly?: boolean
  /** Show the Monaco JSON editor panel alongside the visual editor (default: true) */
  showJsonEditor?: boolean
  /** Show the fullscreen toggle button (default: true) */
  showFullscreen?: boolean
  /** Loading state for save button */
  loading?: boolean
  /** Loading state for migrate button */
  migrating?: boolean
  class?: string
}

const props = withDefaults(defineProps<JsonSchemaEditorProps>(), {
  schema: () => ({ type: "object" }),
  readOnly: false,
  showJsonEditor: true,
  showFullscreen: true,
  loading: false,
  migrating: false
})

const emit = defineEmits<{
  "update:schema": [schema: JSONSchema]
  "save": []
  "saveAndMigrate": []
}>()

const t = useTranslation()

// ─── Schema Store ───────────────────────────────────────────────────────────
// The store is the single source of truth. It uses shallowRef internally,
// so the schema object is never deep-proxied by Vue.
//
// ANTI-LOOP DESIGN:
// onChange defers the emit to a macrotask. This guarantees that
// Vue's entire reactive flush (watchers + re-renders) completes BEFORE the
// parent component receives the update. This makes it physically impossible
// for a single schema change to circle back through the prop watcher.
let skipNextWatch = false
let lastEmittedJson = JSON.stringify(props.schema)

const emitSchemaUpdate = useDebounceFn((newSchema: JSONSchema) => {
  emit("update:schema", newSchema)
  // Reset the skip flag AFTER the next Vue flush processes the prop update
  setTimeout(() => {
    skipNextWatch = false
  }, 0)
}, 0)

const store = createSchemaStore(props.schema, (newSchema) => {
  const json = JSON.stringify(newSchema)
  if (json === lastEmittedJson) return // no-op if structurally identical
  lastEmittedJson = json

  // Defer the emit to a macrotask — BREAKS the synchronous reactive cycle.
  skipNextWatch = true
  emitSchemaUpdate(newSchema)
})

// Provide the store so all descendants can inject it.
provideSchemaStore(store)

// Watch the prop for EXTERNAL changes only (e.g., "Reset to Example" button).
// NO { deep: true } — only fires on reference change from parent.
watch(
  () => props.schema,
  (newSchema) => {
    if (skipNextWatch) return
    // Check structural equality to avoid redundant store updates
    const json = JSON.stringify(newSchema)
    if (json === lastEmittedJson) return
    lastEmittedJson = json
    store.replaceSchema(newSchema)
  }
)

// ─── UI state ───────────────────────────────────────────────────────────────
const isFullscreen = ref(false)
const leftPanelWidth = ref(50)
const containerRef = ref<HTMLDivElement | null>(null)
const isDragging = ref(false)
const activeTab = ref("visual")

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function fullscreenClass() {
  return isFullscreen.value ? "fixed inset-0 z-50 bg-background min-h-0" : ""
}

function handleMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.addEventListener("mousemove", handleMouseMove)
  document.addEventListener("mouseup", handleMouseUp)
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return
  const containerRect = containerRef.value.getBoundingClientRect()
  const newWidth
    = ((e.clientX - containerRect.left) / containerRect.width) * 100
  if (newWidth >= 20 && newWidth <= 80) {
    leftPanelWidth.value = newWidth
  }
}

function handleMouseUp() {
  isDragging.value = false
  document.removeEventListener("mousemove", handleMouseMove)
  document.removeEventListener("mouseup", handleMouseUp)
}

const leftTab = ref<"fields" | "examples">("fields")
</script>

<template>
  <div
    :class="
      cn(
        'json-editor-container w-full h-full min-h-0 flex flex-col',
        fullscreenClass(),
        props.class,
        'jscb',
      )
    "
  >
    <!-- Visual-only mode (no JSON editor) -->
    <template v-if="!showJsonEditor">
      <div
        :class="
          cn(
            'w-full min-h-0 flex flex-col',
            isFullscreen ? 'h-screen' : 'flex-1',
          )
        "
      >
        <TableConfigEditor v-if="!readOnly" :loading="loading" :migrating="migrating" :show-fullscreen="showFullscreen" @save="emit('save')" @save-and-migrate="emit('saveAndMigrate')" @toggle-fullscreen="toggleFullscreen" />
        <div class="editor-pane-header gap-2">
          <button
            type="button"
            @click="leftTab = 'fields'"
            class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
              leftTab === 'fields'
                ? 'bg-secondary text-foreground font-bold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            ]"
          >
            Fields Config
          </button>
          <button
            type="button"
            @click="leftTab = 'examples'"
            class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
              leftTab === 'examples'
                ? 'bg-secondary text-foreground font-bold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            ]"
          >
            Few-Shot Examples
          </button>
        </div>
        <div class="grow min-h-0 flex flex-col">
          <SchemaVisualEditor v-if="leftTab === 'fields'" :read-only="readOnly" />
          <FewShotExamplesEditor v-else :read-only="readOnly" />
        </div>
      </div>
    </template>

    <!-- Full mode with JSON editor -->
    <template v-else>
      <!-- For mobile screens - show as tabs -->
      <div class="flex flex-col w-full flex-1 min-h-0 lg:hidden">
        <Tabs
          v-model="activeTab"
          :tabs="[
            { value: 'visual', label: t.schemaEditorEditModeVisual },
            { value: 'json', label: t.schemaEditorEditModeJson },
          ]"
          class="flex min-h-0 w-full flex-1 flex-col"
        >
          <TabPanel
            value="visual"
            :class="
              cn(
                'focus:outline-hidden w-full min-h-0 flex flex-col',
                isFullscreen ? 'h-screen' : 'flex-1',
              )
            "
          >
            <TableConfigEditor v-if="!readOnly" :loading="loading" :migrating="migrating" :show-fullscreen="showFullscreen" @save="emit('save')" @save-and-migrate="emit('saveAndMigrate')" @toggle-fullscreen="toggleFullscreen" />
            <div class="editor-pane-header gap-2">
              <button
                type="button"
                @click="leftTab = 'fields'"
                class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
                  leftTab === 'fields'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                ]"
              >
                Fields Config
              </button>
              <button
                type="button"
                @click="leftTab = 'examples'"
                class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
                  leftTab === 'examples'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                ]"
              >
                Few-Shot Examples
              </button>
            </div>
            <div class="grow min-h-0 flex flex-col">
              <SchemaVisualEditor v-if="leftTab === 'fields'" :read-only="readOnly" />
              <FewShotExamplesEditor v-else :read-only="readOnly" />
            </div>
          </TabPanel>

          <TabPanel
            value="json"
            :class="
              cn(
                'focus:outline-hidden w-full min-h-0 flex flex-col',
                isFullscreen ? 'h-screen' : 'flex-1',
              )
            "
          >
            <JsonSchemaVisualizer />
          </TabPanel>
        </Tabs>
      </div>

      <!-- For large screens - show side by side -->
      <div
        ref="containerRef"
        :class="
          cn(
            'hidden lg:flex lg:flex-col w-full min-h-0',
            isFullscreen ? 'h-screen' : 'flex-1',
          )
        "
      >
        <TableConfigEditor v-if="!readOnly" :loading="loading" :migrating="migrating" :show-fullscreen="showFullscreen" @save="emit('save')" @save-and-migrate="emit('saveAndMigrate')" @toggle-fullscreen="toggleFullscreen" />
        <div class="flex flex-row w-full flex-1 min-h-0">
          <div
            class="flex flex-col min-h-0 min-w-0"
            :style="{ width: `${leftPanelWidth}%` }"
          >
            <div class="editor-pane-header gap-2">
              <button
                type="button"
                @click="leftTab = 'fields'"
                class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
                  leftTab === 'fields'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                ]"
              >
                Fields Config
              </button>
              <button
                type="button"
                @click="leftTab = 'examples'"
                class="h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer" :class="[
                  leftTab === 'examples'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                ]"
              >
                Few-Shot Examples
              </button>
            </div>
            <div class="grow min-h-0 flex flex-col">
              <SchemaVisualEditor v-if="leftTab === 'fields'" :read-only="readOnly" />
              <FewShotExamplesEditor v-else :read-only="readOnly" />
            </div>
          </div>
          <div
            class="w-0.5 bg-border hover:bg-primary cursor-col-resize shrink-0"
            @mousedown="handleMouseDown"
          />
          <div
            class="flex flex-col min-h-0 min-w-0"
            :style="{ width: `${100 - leftPanelWidth}%` }"
          >
            <JsonSchemaVisualizer />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
