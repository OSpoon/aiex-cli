<script setup lang="ts">
import type { AIConfig, AIModelConfig, ModelCapabilities, PdfConverterKind } from "@/api-client"
import Button from "primevue/button"
import Checkbox from "primevue/checkbox"
import Dialog from "primevue/dialog"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import Select from "primevue/select"
import Textarea from "primevue/textarea"
import { computed, onMounted, onUnmounted, ref } from "vue"
import { toast } from "vue-sonner"
import {
  getAIConfig,
  registryLookup,
  saveAIConfig
} from "@/api-client"

const visible = defineModel<boolean>("visible", { default: false })

const loading = ref(false)
const saving = ref(false)

const baseURL = ref("https://dashscope.aliyuncs.com/compatible-mode/v1")
const apiKey = ref("")
const timeout = ref(300)
const models = ref<AIModelConfig[]>([])
const systemTemplate = ref("")
const userTemplate = ref("")

const pdfConverter = ref<PdfConverterKind>("unpdf")
const mineruCommand = ref("mineru")
const mineruArgs = ref("-p\n{input}\n-o\n{outputDir}")
const mineruTimeout = ref(600)
const mineruFallbackToUnpdf = ref(true)
const mineruKeepOutput = ref(true)
const markitdownCommand = ref("markitdown")
const markitdownArgs = ref("{input}\n-o\n{outputDir}/{basename}.md")
const markitdownOutputFile = ref("{outputDir}/{basename}.md")
const markitdownTimeout = ref(600)
const markitdownFallbackToUnpdf = ref(true)
const markitdownKeepOutput = ref(true)

const langfuseEnabled = ref(false)
const langfusePublicKey = ref("")
const langfuseSecretKey = ref("")
const langfuseHost = ref("")

// Add model state
const addingModel = ref(false)
const newModelName = ref("")
const newModelCaps = ref<ModelCapabilities>({ vision: false, structuredOutput: false })
const newModelSource = ref<"registry" | "manual">("manual")

function onModelNameInput() {
  newModelSource.value = "manual"
  newModelCaps.value = { vision: false, structuredOutput: false }

  if (!newModelName.value) return

  // Look up in registry (no network, instant)
  registryLookup(newModelName.value).then((caps) => {
    if (caps) {
      newModelCaps.value = { ...caps }
      newModelSource.value = "registry"
    }
  })
}

function confirmAddModel() {
  if (!newModelName.value) return
  models.value.push({
    name: newModelName.value,
    capabilities: { ...newModelCaps.value }
  })
  resetNewModel()
}

function cancelAddModel() {
  resetNewModel()
}

function resetNewModel() {
  newModelName.value = ""
  newModelCaps.value = { vision: false, structuredOutput: false }
  newModelSource.value = "manual"
  addingModel.value = false
}

function removeModel(index: number) {
  models.value.splice(index, 1)
}

const systemSchemaError = computed(() => {
  if (!systemTemplate.value.includes("{schema}")) {
    return "System prompt must contain the {schema} placeholder"
  }
  return ""
})

const userSchemaError = computed(() => {
  if (!userTemplate.value.includes("{text}")) {
    return "User prompt must contain the {text} placeholder"
  }
  return ""
})

const canSave = computed(() =>
  !systemSchemaError.value
  && !userSchemaError.value
  && !loading.value
  && models.value.length > 0
  && (pdfConverter.value !== "mineru" || !!mineruCommand.value.trim())
  && (pdfConverter.value !== "markitdown" || !!markitdownCommand.value.trim())
)

const pdfConverterOptions = [
  { label: "Built-in text extraction", value: "unpdf" },
  { label: "MinerU command", value: "mineru" },
  { label: "MarkItDown command", value: "markitdown" }
]

const defaultSystemTemplate = `You are a professional data extraction assistant. Your task is to extract structured data from text and return a JSON object based on the data structure definition provided below.

{schema}

Extraction requirements:
1. Extract data strictly according to the field names and types defined in the structure
2. If a field's information is missing from the text, set that field to null
3. Do not add fields that are not in the structure definition
4. Maintain data accuracy and completeness`

const defaultUserTemplate = `Please extract data from the following text:
{text}`

async function loadConfig() {
  loading.value = true
  try {
    const config = await getAIConfig()
    baseURL.value = config.provider.baseURL
    apiKey.value = config.provider.apiKey
    timeout.value = config.provider.timeout ?? 300
    models.value = config.provider.models ?? []
    systemTemplate.value = config.prompt.systemTemplate
    userTemplate.value = config.prompt.userTemplate
    pdfConverter.value = config.pdf?.converter ?? "unpdf"
    mineruCommand.value = config.pdf?.mineru?.command ?? "mineru"
    mineruArgs.value = (config.pdf?.mineru?.args ?? ["-p", "{input}", "-o", "{outputDir}"]).join("\n")
    mineruTimeout.value = config.pdf?.mineru?.timeout ?? 600
    mineruFallbackToUnpdf.value = config.pdf?.mineru?.fallbackToUnpdf ?? true
    mineruKeepOutput.value = config.pdf?.mineru?.keepOutput ?? true
    markitdownCommand.value = config.pdf?.markitdown?.command ?? "markitdown"
    markitdownArgs.value = (config.pdf?.markitdown?.args ?? ["{input}", "-o", "{outputDir}/{basename}.md"]).join("\n")
    markitdownOutputFile.value = config.pdf?.markitdown?.outputFile ?? "{outputDir}/{basename}.md"
    markitdownTimeout.value = config.pdf?.markitdown?.timeout ?? 600
    markitdownFallbackToUnpdf.value = config.pdf?.markitdown?.fallbackToUnpdf ?? true
    markitdownKeepOutput.value = config.pdf?.markitdown?.keepOutput ?? true
    langfuseEnabled.value = !!config.langfuse
    langfusePublicKey.value = config.langfuse?.publicKey ?? ""
    langfuseSecretKey.value = config.langfuse?.secretKey ?? ""
    langfuseHost.value = config.langfuse?.host ?? ""
  } catch {
    apiKey.value = ""
    models.value = []
    systemTemplate.value = defaultSystemTemplate
    userTemplate.value = defaultUserTemplate
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const config: AIConfig = {
      provider: {
        baseURL: baseURL.value,
        apiKey: apiKey.value,
        timeout: timeout.value,
        models: models.value
      },
      prompt: {
        systemTemplate: systemTemplate.value,
        userTemplate: userTemplate.value
      },
      extraction: {
        outputDir: ".aiex/extracted"
      },
      pdf: {
        converter: pdfConverter.value,
        mineru: {
          command: mineruCommand.value,
          args: mineruArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
          timeout: mineruTimeout.value,
          fallbackToUnpdf: mineruFallbackToUnpdf.value,
          keepOutput: mineruKeepOutput.value || undefined
        },
        markitdown: {
          command: markitdownCommand.value,
          args: markitdownArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
          outputFile: markitdownOutputFile.value.trim() || undefined,
          timeout: markitdownTimeout.value,
          fallbackToUnpdf: markitdownFallbackToUnpdf.value,
          keepOutput: markitdownKeepOutput.value || undefined
        }
      },
      langfuse: langfuseEnabled.value
        ? {
            publicKey: langfusePublicKey.value,
            secretKey: langfuseSecretKey.value,
            host: langfuseHost.value || undefined
          }
        : undefined
    }
    await saveAIConfig(config)
    visible.value = false
  } catch (e: any) {
    toast.error(e.message || "Failed to save")
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadConfig()
})

onUnmounted(() => {
})
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="AI Settings"
    :style="{ width: '680px' }"
    :draggable="false"
  >
    <div v-if="loading" class="flex items-center justify-center py-8">
      <i class="pi pi-spin pi-spinner text-xl" />
    </div>

    <div v-else class="space-y-6">
      <!-- Provider Config -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          Provider
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">Base URL</label>
            <InputText v-model="baseURL" size="small" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">API Key</label>
            <Password v-model="apiKey" :feedback="false" toggle-mask size="small" placeholder="sk-xxx" input-class="w-full" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">Timeout (seconds)</label>
            <InputText :value="String(timeout)" type="number" size="small" placeholder="300" :min="1" @input="timeout = Number(($event.target as HTMLInputElement).value) || 300" />
          </div>
        </div>
      </section>

      <!-- Models -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          Models
        </h3>
        <div class="space-y-2">
          <div
            v-for="(m, i) in models"
            :key="i"
            class="flex items-center gap-2 px-3 py-2 rounded border border-border bg-card"
          >
            <code class="text-sm font-mono flex-1">{{ m.name }}</code>
            <span
              class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
              :class="m.capabilities.structuredOutput ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'"
            >
              <i :class="m.capabilities.structuredOutput ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" class="text-[10px]" />
              {{ m.capabilities.structuredOutput ? 'Structured Output' : 'Text-only Output' }}
            </span>
            <span
              class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
              :class="m.capabilities.vision ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'"
            >
              <i :class="m.capabilities.vision ? 'pi pi-check-circle' : 'pi pi-times-circle'" class="text-[10px]" />
              {{ m.capabilities.vision ? 'Vision Supported' : 'Vision Unsupported' }}
            </span>
            <Button icon="pi pi-times" severity="danger" text size="small" @click="removeModel(i)" />
          </div>

          <!-- Add Model -->
          <div v-if="addingModel" class="flex flex-col gap-2 px-3 py-2 rounded border border-border bg-card">
            <div class="flex items-center gap-2">
              <InputText
                v-model="newModelName"
                size="small"
                placeholder="Model name (e.g. gpt-4o)"
                class="flex-1 font-mono"
                @input="onModelNameInput"
                @keyup.enter="confirmAddModel"
              />
              <Button icon="pi pi-check" severity="success" text size="small" :disabled="!newModelName" @click="confirmAddModel" />
              <Button icon="pi pi-times" severity="secondary" text size="small" @click="cancelAddModel" />
            </div>
            <div class="flex items-center gap-4 text-xs">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  v-model="newModelCaps.structuredOutput"
                  :binary="true"
                  input-id="add-so"
                />
                <span :class="newModelCaps.structuredOutput ? 'text-green-600' : 'text-muted-foreground'">
                  Structured Output
                </span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  v-model="newModelCaps.vision"
                  :binary="true"
                  input-id="add-vision"
                />
                <span :class="newModelCaps.vision ? 'text-green-600' : 'text-muted-foreground'">
                  Vision
                </span>
              </label>
              <span v-if="newModelSource === 'registry'" class="text-muted-foreground ml-auto">
                <i class="pi pi-database mr-0.5" />Registry
              </span>
            </div>
          </div>

          <Button
            v-else
            label="Add Model"
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            @click="addingModel = true"
          />
        </div>
      </section>

      <!-- PDF Conversion -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          PDF Conversion
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">Converter</label>
            <Select
              v-model="pdfConverter"
              :options="pdfConverterOptions"
              option-label="label"
              option-value="value"
              size="small"
            />
          </div>

          <div v-if="pdfConverter === 'mineru'" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Command</label>
              <InputText v-model="mineruCommand" size="small" placeholder="mineru" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Arguments</label>
              <Textarea v-model="mineruArgs" rows="4" auto-resize class="text-xs font-mono" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Timeout (seconds)</label>
              <InputText :value="String(mineruTimeout)" type="number" size="small" placeholder="600" :min="1" @input="mineruTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="mineruFallbackToUnpdf" :binary="true" input-id="mineru-fallback" />
              <label for="mineru-fallback" class="text-sm cursor-pointer">Fallback to built-in converter</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="mineruKeepOutput" :binary="true" input-id="mineru-keep-output" />
              <label for="mineru-keep-output" class="text-sm cursor-pointer">Keep converted files on disk</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              Placeholders: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>
            </div>
          </div>

          <div v-if="pdfConverter === 'markitdown'" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Command</label>
              <InputText v-model="markitdownCommand" size="small" placeholder="markitdown" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Arguments</label>
              <Textarea v-model="markitdownArgs" rows="4" auto-resize class="text-xs font-mono" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Output File</label>
              <InputText v-model="markitdownOutputFile" size="small" class="text-xs font-mono" placeholder="{outputDir}/{basename}.md" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Timeout (seconds)</label>
              <InputText :value="String(markitdownTimeout)" type="number" size="small" placeholder="600" :min="1" @input="markitdownTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markitdownFallbackToUnpdf" :binary="true" input-id="markitdown-fallback" />
              <label for="markitdown-fallback" class="text-sm cursor-pointer">Fallback to built-in converter</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markitdownKeepOutput" :binary="true" input-id="markitdown-keep-output" />
              <label for="markitdown-keep-output" class="text-sm cursor-pointer">Keep converted files on disk</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              Placeholders: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>
            </div>
          </div>
        </div>
      </section>

      <!-- Langfuse Tracing -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          Langfuse Tracing
        </h3>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Checkbox v-model="langfuseEnabled" :binary="true" input-id="lf-enabled" />
            <label for="lf-enabled" class="text-sm cursor-pointer">Enabled</label>
          </div>
          <div v-if="langfuseEnabled" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Secret Key</label>
              <Password v-model="langfuseSecretKey" :feedback="false" toggle-mask size="small" placeholder="sk-lf-..." input-class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Public Key</label>
              <InputText v-model="langfusePublicKey" size="small" placeholder="pk-lf-..." />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">Host (optional)</label>
              <InputText v-model="langfuseHost" size="small" placeholder="https://us.cloud.langfuse.com" />
            </div>
          </div>
        </div>
      </section>

      <!-- Prompt Config -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          Prompt Templates
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">System Prompt</label>
            <Textarea v-model="systemTemplate" rows="6" auto-resize class="text-xs font-mono" />
            <p v-if="systemSchemaError" class="text-xs text-red-500 mt-1">
              {{ systemSchemaError }}
            </p>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">User Prompt</label>
            <Textarea v-model="userTemplate" rows="6" auto-resize class="text-xs font-mono" />
            <p v-if="userSchemaError" class="text-xs text-red-500 mt-1">
              {{ userSchemaError }}
            </p>
          </div>
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            Placeholders: <code class="bg-secondary px-1 rounded">{schema}</code> JSON Schema structure description,
            <code class="bg-secondary px-1 rounded">{text}</code> text to extract from
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" text @click="visible = false" />
        <Button label="Save" icon="pi pi-check" :loading="saving" :disabled="!canSave" @click="handleSave" />
      </div>
    </template>
  </Dialog>
</template>
