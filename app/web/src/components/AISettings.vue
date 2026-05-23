<script setup lang="ts">
import type { AIConfig, AIModelConfig, ImageOcrFallbackMode, ModelCapabilities, NotionDatabaseProperty, NotionSchemaConfig, PdfConverterKind } from "@/api-client"
import Button from "primevue/button"
import Checkbox from "primevue/checkbox"
import Dialog from "primevue/dialog"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import Select from "primevue/select"
import Textarea from "primevue/textarea"
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { toast } from "vue-sonner"
import {
  getAIConfig,
  getSchema,
  inspectNotionDatabase,
  registryLookup,
  saveAIConfig
} from "@/api-client"

const props = defineProps<{
  schemas: string[]
}>()
const visible = defineModel<boolean>("visible", { default: false })

const { t } = useI18n()

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

const markerCommand = ref("marker_single")
const markerArgs = ref("{input}\n--output_dir\n{outputDir}")
const markerOutputFile = ref("{outputDir}/{basename}/{basename}.md")
const markerTimeout = ref(600)
const markerFallbackToUnpdf = ref(true)
const markerKeepOutput = ref(true)

const externalCommand = ref("")
const externalArgs = ref("")
const externalOutputFile = ref("")
const externalTimeout = ref(600)
const externalFallbackToUnpdf = ref(true)
const externalKeepOutput = ref(true)

const imageOcrFallback = ref<ImageOcrFallbackMode>("auto")
const imageOcrLanguages = ref("en-US, zh-Hans")
const imageOcrMinConfidence = ref(0)
const imageOcrAdvancedOpen = ref(false)

const langfuseEnabled = ref(false)
const langfusePublicKey = ref("")
const langfuseSecretKey = ref("")
const langfuseHost = ref("")

const webhookEnabled = ref(false)
const webhookUrl = ref("")
const webhookSecret = ref("")

const notionEnabled = ref(false)
const notionToken = ref("")
const notionSchemas = ref<Record<string, NotionSchemaConfig>>({})
const selectedNotionSchema = ref("")
const notionDatabaseId = ref("")
const notionTitleProperty = ref("")
const notionFieldMap = ref("")
const notionTesting = ref(false)
const notionProperties = ref<NotionDatabaseProperty[]>([])
const notionSchemaFields = ref<string[]>([])
const notionAdvancedOpen = ref(false)

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
    return t("app.systemPromptValidation")
  }
  return ""
})

const userSchemaError = computed(() => {
  if (!userTemplate.value.includes("{text}")) {
    return t("app.userPromptValidation")
  }
  return ""
})

const schemaOptions = computed(() => props.schemas.map(name => name.replace(".json", "")))

const notionFieldMapError = computed(() => {
  const text = notionFieldMap.value.trim()
  if (!text)
    return ""
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return t("app.fieldMapObject")
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string")
        return t("app.fieldMapString", { key })
    }
    return ""
  } catch {
    return t("app.fieldMapValidJson")
  }
})

const notionMappedFieldCount = computed(() => {
  try {
    return Object.keys(parseNotionFieldMap() ?? {}).length
  } catch {
    return 0
  }
})

const notionConnectionSummary = computed(() => {
  if (notionProperties.value.length === 0)
    return ""
  if (notionSchemaFields.value.length === 0)
    return t("app.notionPropertiesLoaded", { count: notionProperties.value.length })
  return t("app.notionFieldsMapped", { count: notionMappedFieldCount.value, total: notionSchemaFields.value.length })
})

const hasVisionModel = computed(() => models.value.some(model => model.capabilities.vision))

const imageInputModeLabel = computed(() => {
  if (imageOcrFallback.value === "off")
    return t("app.ocrDisabled")
  if (imageOcrFallback.value === "local")
    return t("app.requireLocalOcr")
  return t("app.ocrAuto")
})

const imageInputSummary = computed(() => {
  if (hasVisionModel.value)
    return t("app.imageSummaryVisionModel")
  if (imageOcrFallback.value === "off")
    return t("app.imageSummaryOcrOff")
  if (imageOcrFallback.value === "local")
    return t("app.imageSummaryOcrLocal")
  return t("app.imageSummaryNoVision")
})

const imageInputStatusClass = computed(() => {
  if (hasVisionModel.value)
    return "border-green-200 bg-green-50 text-green-800"
  if (imageOcrFallback.value === "off")
    return "border-yellow-200 bg-yellow-50 text-yellow-800"
  return "border-blue-200 bg-blue-50 text-blue-800"
})

const canSave = computed(() =>
  !systemSchemaError.value
  && !userSchemaError.value
  && !notionFieldMapError.value
  && !loading.value
  && models.value.length > 0
  && (!notionEnabled.value || !!notionToken.value.trim())
  && (pdfConverter.value !== "mineru" || !!mineruCommand.value.trim())
  && (pdfConverter.value !== "markitdown" || !!markitdownCommand.value.trim())
  && (pdfConverter.value !== "marker" || !!markerCommand.value.trim())
  && (pdfConverter.value !== "external" || !!externalCommand.value.trim())
)

function parseNotionFieldMap(): Record<string, string> | undefined {
  if (!notionFieldMap.value.trim())
    return undefined

  const parsed = JSON.parse(notionFieldMap.value) as Record<string, string>
  const filtered = Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""])
      .filter(([key, value]) => !!key && !!value)
  )
  return Object.keys(filtered).length > 0 ? filtered : undefined
}

function extractNotionSchemaFields(schema: any): string[] {
  if (!schema?.properties || typeof schema.properties !== "object")
    return []

  const fields: string[] = []

  function visitProperties(properties: Record<string, any>, prefix = "") {
    for (const [name, property] of Object.entries(properties)) {
      const fieldName = prefix ? `${prefix}.${name}` : name
      if (property?.type === "object" && property?.properties && typeof property.properties === "object") {
        visitProperties(property.properties, fieldName)
        continue
      }
      if (property?.type === "array" && property?.items?.type === "object")
        continue

      fields.push(fieldName)
    }
  }

  visitProperties(schema.properties)
  return fields
}

function formatFieldMapForEditing(savedFieldMap?: Record<string, string>): string {
  const rows: Record<string, string> = {}
  for (const field of notionSchemaFields.value) {
    rows[field] = savedFieldMap?.[field] ?? ""
  }
  for (const [key, value] of Object.entries(savedFieldMap ?? {})) {
    if (!(key in rows))
      rows[key] = value
  }
  return Object.keys(rows).length > 0 ? JSON.stringify(rows, null, 2) : ""
}

function persistSelectedNotionSchema(schemaName = selectedNotionSchema.value) {
  if (!schemaName || notionFieldMapError.value)
    return

  const databaseId = notionDatabaseId.value.trim()
  const titleProperty = notionTitleProperty.value.trim()
  const fieldMap = parseNotionFieldMap()
  if (!databaseId) {
    const next = { ...notionSchemas.value }
    delete next[schemaName]
    notionSchemas.value = next
    return
  }

  notionSchemas.value = {
    ...notionSchemas.value,
    [schemaName]: {
      databaseId,
      titleProperty: titleProperty || undefined,
      fieldMap
    }
  }
}

function loadSelectedNotionSchema() {
  const config = selectedNotionSchema.value ? notionSchemas.value[selectedNotionSchema.value] : undefined
  notionDatabaseId.value = config?.databaseId ?? ""
  notionTitleProperty.value = config?.titleProperty ?? ""
  notionFieldMap.value = formatFieldMapForEditing(config?.fieldMap)
  notionProperties.value = []
}

watch(schemaOptions, (schemas) => {
  if (!selectedNotionSchema.value && schemas.length > 0)
    selectedNotionSchema.value = schemas[0]
}, { immediate: true })

watch(selectedNotionSchema, (_next, previous) => {
  if (previous)
    persistSelectedNotionSchema(previous)
  loadSelectedNotionSchemaFields()
})

async function loadSelectedNotionSchemaFields() {
  const schemaName = selectedNotionSchema.value
  notionSchemaFields.value = []
  if (!schemaName) {
    loadSelectedNotionSchema()
    return
  }
  try {
    notionSchemaFields.value = extractNotionSchemaFields(await getSchema(`${schemaName}.json`))
  } catch {
    notionSchemaFields.value = []
  }
  loadSelectedNotionSchema()
}

const pdfConverterOptions = computed(() => [
  { label: t("app.pdfConverterUnpdf"), value: "unpdf" },
  { label: t("app.pdfConverterMineru"), value: "mineru" },
  { label: t("app.pdfConverterMarkitdown"), value: "markitdown" },
  { label: t("app.pdfConverterMarker"), value: "marker" },
  { label: t("app.pdfConverterExternal"), value: "external" }
])

const imageOcrFallbackOptions = computed(() => [
  { label: t("app.ocrFallbackAuto"), value: "auto" },
  { label: t("app.ocrFallbackOff"), value: "off" },
  { label: t("app.ocrFallbackLocal"), value: "local" }
])

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
    markerCommand.value = config.pdf?.marker?.command ?? "marker_single"
    markerArgs.value = (config.pdf?.marker?.args ?? ["{input}", "--output_dir", "{outputDir}"]).join("\n")
    markerOutputFile.value = config.pdf?.marker?.outputFile ?? "{outputDir}/{basename}/{basename}.md"
    markerTimeout.value = config.pdf?.marker?.timeout ?? 600
    markerFallbackToUnpdf.value = config.pdf?.marker?.fallbackToUnpdf ?? true
    markerKeepOutput.value = config.pdf?.marker?.keepOutput ?? true
    externalCommand.value = config.pdf?.external?.command ?? ""
    externalArgs.value = (config.pdf?.external?.args ?? []).join("\n")
    externalOutputFile.value = config.pdf?.external?.outputFile ?? ""
    externalTimeout.value = config.pdf?.external?.timeout ?? 600
    externalFallbackToUnpdf.value = config.pdf?.external?.fallbackToUnpdf ?? true
    externalKeepOutput.value = config.pdf?.external?.keepOutput ?? true
    imageOcrFallback.value = config.image?.ocrFallback ?? "auto"
    imageOcrLanguages.value = config.image?.ocrLanguages ?? "en-US, zh-Hans"
    imageOcrMinConfidence.value = config.image?.ocrMinConfidence ?? 0
    langfuseEnabled.value = !!config.langfuse
    langfusePublicKey.value = config.langfuse?.publicKey ?? ""
    langfuseSecretKey.value = config.langfuse?.secretKey ?? ""
    langfuseHost.value = config.langfuse?.host ?? ""
    webhookEnabled.value = !!config.webhook?.enabled
    webhookUrl.value = config.webhook?.url ?? ""
    webhookSecret.value = config.webhook?.secret ?? ""
    notionEnabled.value = !!config.notion?.enabled
    notionToken.value = config.notion?.token ?? ""
    notionSchemas.value = config.notion?.schemas ?? {}
    await loadSelectedNotionSchemaFields()
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
    persistSelectedNotionSchema()
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
      image: {
        ocrFallback: imageOcrFallback.value,
        ocrLanguages: imageOcrLanguages.value.trim() || undefined,
        ocrMinConfidence: imageOcrMinConfidence.value
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
        },
        marker: {
          command: markerCommand.value,
          args: markerArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
          outputFile: markerOutputFile.value.trim() || undefined,
          timeout: markerTimeout.value,
          fallbackToUnpdf: markerFallbackToUnpdf.value,
          keepOutput: markerKeepOutput.value || undefined
        },
        external: {
          command: externalCommand.value,
          args: externalArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
          outputFile: externalOutputFile.value.trim() || undefined,
          timeout: externalTimeout.value,
          fallbackToUnpdf: externalFallbackToUnpdf.value,
          keepOutput: externalKeepOutput.value || undefined
        }
      },
      langfuse: langfuseEnabled.value
        ? {
            publicKey: langfusePublicKey.value,
            secretKey: langfuseSecretKey.value,
            host: langfuseHost.value || undefined
          }
        : undefined,
      notion: {
        enabled: notionEnabled.value,
        token: notionToken.value,
        schemas: notionSchemas.value
      },
      webhook: {
        enabled: webhookEnabled.value,
        url: webhookUrl.value.trim(),
        secret: webhookSecret.value.trim() || undefined
      }
    }
    await saveAIConfig(config)
    visible.value = false
  } catch (e: any) {
    toast.error(e.message || t("app.toastSaveFailed"))
  } finally {
    saving.value = false
  }
}

async function handleInspectNotion() {
  if (!selectedNotionSchema.value) {
    toast.error(t("app.toastSelectSchema"))
    return
  }
  if (!notionToken.value.trim()) {
    toast.error(t("app.toastEnterToken"))
    return
  }
  if (!notionDatabaseId.value.trim()) {
    toast.error(t("app.toastEnterDatabaseId"))
    return
  }
  if (notionFieldMapError.value) {
    toast.error(notionFieldMapError.value)
    return
  }

  notionTesting.value = true
  try {
    const result = await inspectNotionDatabase({
      token: notionToken.value,
      databaseId: notionDatabaseId.value,
      schemaName: selectedNotionSchema.value
    })

    if (result.dataSourceId || result.databaseId)
      notionDatabaseId.value = result.dataSourceId ?? result.databaseId ?? ""
    if (!notionTitleProperty.value && result.titleProperty)
      notionTitleProperty.value = result.titleProperty

    const existingFieldMap = parseNotionFieldMap() ?? {}
    const suggestedFieldMap = result.suggestedFieldMap ?? {}
    const mergedFieldMap = { ...suggestedFieldMap, ...existingFieldMap }
    notionFieldMap.value = Object.keys(mergedFieldMap).length > 0
      ? JSON.stringify(mergedFieldMap, null, 2)
      : ""
    notionProperties.value = result.properties ?? []
    persistSelectedNotionSchema()
    toast.success(t("app.notionConnected", { count: notionProperties.value.length }))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("app.notionConnectionFailed"))
  } finally {
    notionTesting.value = false
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
    :header="$t('app.aiSettings')"
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
          {{ $t("app.provider") }}
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.baseUrl") }}</label>
            <InputText v-model="baseURL" size="small" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.apiKey") }}</label>
            <Password v-model="apiKey" :feedback="false" toggle-mask size="small" placeholder="sk-xxx" input-class="w-full" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
            <InputText :value="String(timeout)" type="number" size="small" placeholder="300" :min="1" @input="timeout = Number(($event.target as HTMLInputElement).value) || 300" />
          </div>
        </div>
      </section>

      <!-- Models -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.models") }}
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
              {{ m.capabilities.structuredOutput ? $t('app.structuredOutput') : $t('app.textOnlyOutput') }}
            </span>
            <span
              class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
              :class="m.capabilities.vision ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'"
            >
              <i :class="m.capabilities.vision ? 'pi pi-check-circle' : 'pi pi-times-circle'" class="text-[10px]" />
              {{ m.capabilities.vision ? $t('app.visionSupported') : $t('app.visionUnsupported') }}
            </span>
            <Button icon="pi pi-times" severity="danger" text size="small" @click="removeModel(i)" />
          </div>

          <!-- Add Model -->
          <div v-if="addingModel" class="flex flex-col gap-2 px-3 py-2 rounded border border-border bg-card">
            <div class="flex items-center gap-2">
              <InputText
                v-model="newModelName"
                size="small"
                :placeholder="$t('app.modelName')"
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
                  {{ $t("app.structuredOutput") }}
                </span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  v-model="newModelCaps.vision"
                  :binary="true"
                  input-id="add-vision"
                />
                <span :class="newModelCaps.vision ? 'text-green-600' : 'text-muted-foreground'">
                  {{ $t("app.visionSupported") }}
                </span>
              </label>
              <span v-if="newModelSource === 'registry'" class="text-muted-foreground ml-auto">
                <i class="pi pi-database mr-0.5" />{{ $t("app.modelCapsRegistry") }}
              </span>
            </div>
          </div>

          <Button
            v-else
            :label="$t('app.addModel')"
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            @click="addingModel = true"
          />
        </div>
      </section>

      <!-- Image Input -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.imageInput") }}
        </h3>
        <div class="space-y-3">
          <div class="rounded border p-3 text-sm" :class="imageInputStatusClass">
            <div class="flex items-center justify-between gap-3">
              <span class="font-medium">{{ imageInputModeLabel }}</span>
              <span v-if="hasVisionModel" class="text-xs">{{ $t("app.visionModelConfigured") }}</span>
              <span v-else class="text-xs">{{ $t("app.noVisionModel") }}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed">
              {{ imageInputSummary }}
            </p>
          </div>

          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="imageOcrAdvancedOpen = !imageOcrAdvancedOpen"
          >
            {{ imageOcrAdvancedOpen ? $t('app.hideAdvancedImageSettings') : $t('app.advancedImageSettings') }}
          </button>

          <div v-if="imageOcrAdvancedOpen" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.ocrFallback") }}</label>
              <Select
                v-model="imageOcrFallback"
                :options="imageOcrFallbackOptions"
                option-label="label"
                option-value="value"
                size="small"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.ocrLanguages") }}</label>
              <InputText v-model="imageOcrLanguages" size="small" placeholder="en-US, zh-Hans" :disabled="imageOcrFallback === 'off'" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.ocrMinConfidence") }}</label>
              <InputText :value="String(imageOcrMinConfidence)" type="number" size="small" placeholder="0" :min="0" :max="1" :step="0.05" :disabled="imageOcrFallback === 'off'" @input="imageOcrMinConfidence = Math.min(1, Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))" />
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              {{ $t("app.ocrHint") }}
            </div>
          </div>
        </div>
      </section>

      <!-- PDF Conversion -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.pdfConversion") }}
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.converter") }}</label>
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
              <label class="text-xs text-muted-foreground">{{ $t("app.command") }}</label>
              <InputText v-model="mineruCommand" size="small" placeholder="mineru" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.arguments") }}</label>
              <Textarea v-model="mineruArgs" rows="4" auto-resize class="text-xs font-mono" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
              <InputText :value="String(mineruTimeout)" type="number" size="small" placeholder="600" :min="1" @input="mineruTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="mineruFallbackToUnpdf" :binary="true" input-id="mineru-fallback" />
              <label for="mineru-fallback" class="text-sm cursor-pointer">{{ $t("app.fallbackToBuiltin") }}</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="mineruKeepOutput" :binary="true" input-id="mineru-keep-output" />
              <label for="mineru-keep-output" class="text-sm cursor-pointer">{{ $t("app.keepConvertedFiles") }}</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>
            </div>
          </div>

          <div v-if="pdfConverter === 'markitdown'" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.command") }}</label>
              <InputText v-model="markitdownCommand" size="small" placeholder="markitdown" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.arguments") }}</label>
              <Textarea v-model="markitdownArgs" rows="4" auto-resize class="text-xs font-mono" />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
              <InputText :value="String(markitdownTimeout)" type="number" size="small" placeholder="600" :min="1" @input="markitdownTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markitdownFallbackToUnpdf" :binary="true" input-id="markitdown-fallback" />
              <label for="markitdown-fallback" class="text-sm cursor-pointer">{{ $t("app.fallbackToBuiltin") }}</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markitdownKeepOutput" :binary="true" input-id="markitdown-keep-output" />
              <label for="markitdown-keep-output" class="text-sm cursor-pointer">{{ $t("app.keepConvertedFiles") }}</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>
            </div>
          </div>

          <div v-if="pdfConverter === 'marker'" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.command") }}</label>
              <InputText v-model="markerCommand" size="small" placeholder="marker_single" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.arguments") }}</label>
              <Textarea v-model="markerArgs" rows="4" auto-resize class="text-xs font-mono" />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
              <InputText :value="String(markerTimeout)" type="number" size="small" placeholder="600" :min="1" @input="markerTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markerFallbackToUnpdf" :binary="true" input-id="marker-fallback" />
              <label for="marker-fallback" class="text-sm cursor-pointer">{{ $t("app.fallbackToBuiltin") }}</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="markerKeepOutput" :binary="true" input-id="marker-keep-output" />
              <label for="marker-keep-output" class="text-sm cursor-pointer">{{ $t("app.keepConvertedFiles") }}</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>
            </div>
          </div>

          <div v-if="pdfConverter === 'external'" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.command") }}</label>
              <InputText v-model="externalCommand" size="small" placeholder="pdf2markdown" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.arguments") }}</label>
              <Textarea v-model="externalArgs" rows="4" auto-resize class="text-xs font-mono" placeholder="-i&#10;{input}&#10;-o&#10;{outputDir}/{basename}.md" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.outputFile") }}</label>
              <InputText v-model="externalOutputFile" size="small" class="text-xs font-mono" placeholder="{outputDir}/{basename}.md" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
              <InputText :value="String(externalTimeout)" type="number" size="small" placeholder="600" :min="1" @input="externalTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="externalFallbackToUnpdf" :binary="true" input-id="external-fallback" />
              <label for="external-fallback" class="text-sm cursor-pointer">{{ $t("app.fallbackToBuiltin") }}</label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="externalKeepOutput" :binary="true" input-id="external-keep-output" />
              <label for="external-keep-output" class="text-sm cursor-pointer">{{ $t("app.keepConvertedFiles") }}</label>
            </div>
            <div class="text-xs text-muted-foreground p-2 rounded border border-border">
              {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
              <code class="bg-secondary px-1 rounded">{outputDir}</code>,
              <code class="bg-secondary px-1 rounded">{basename}</code>. {{ $t("app.externalHint") }}
            </div>
          </div>
        </div>
      </section>

      <!-- Langfuse Tracing -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.langfuseTracing") }}
        </h3>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Checkbox v-model="langfuseEnabled" :binary="true" input-id="lf-enabled" />
            <label for="lf-enabled" class="text-sm cursor-pointer">{{ $t("app.enabled") }}</label>
          </div>
          <div v-if="langfuseEnabled" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.secretKey") }}</label>
              <Password v-model="langfuseSecretKey" :feedback="false" toggle-mask size="small" placeholder="sk-lf-..." input-class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.publicKey") }}</label>
              <InputText v-model="langfusePublicKey" size="small" placeholder="pk-lf-..." />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.host") }}</label>
              <InputText v-model="langfuseHost" size="small" placeholder="https://us.cloud.langfuse.com" />
            </div>
          </div>
        </div>
      </section>

      <!-- Webhook Notifications -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.webhookNotification") }}
        </h3>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Checkbox v-model="webhookEnabled" :binary="true" input-id="webhook-enabled" />
            <label for="webhook-enabled" class="text-sm cursor-pointer">{{ $t("app.enabled") }}</label>
          </div>
          <div v-if="webhookEnabled" class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.webhookUrl") }}</label>
              <InputText v-model="webhookUrl" size="small" placeholder="http://localhost:8080/webhook" class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.webhookSecret") }}</label>
              <Password v-model="webhookSecret" :feedback="false" toggle-mask size="small" placeholder="webhook-secret-key" input-class="w-full" />
            </div>
            <div class="text-xs text-muted-foreground">
              {{ $t("app.webhookHelp") }}
            </div>
          </div>
        </div>
      </section>

      <!-- Notion Export -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.notionExport") }}
        </h3>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Checkbox v-model="notionEnabled" :binary="true" input-id="notion-enabled" />
            <label for="notion-enabled" class="text-sm cursor-pointer">{{ $t("app.enabled") }}</label>
          </div>
          <div class="space-y-3 pl-6 border-l-2 border-border">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.integrationToken") }}</label>
              <Password v-model="notionToken" :feedback="false" toggle-mask size="small" placeholder="secret_..." input-class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.schemaBinding") }}</label>
              <Select
                v-model="selectedNotionSchema"
                :options="schemaOptions"
                size="small"
                :placeholder="$t('app.selectSchema')"
                :disabled="schemaOptions.length === 0"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.databaseUrl") }}</label>
              <InputText v-model="notionDatabaseId" size="small" placeholder="https://www.notion.so/... or xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            </div>
            <div class="flex items-center gap-2">
              <Button
                :label="$t('app.connectAndMap')"
                icon="pi pi-bolt"
                severity="secondary"
                size="small"
                :loading="notionTesting"
                :disabled="!selectedNotionSchema || !notionToken.trim() || !notionDatabaseId.trim() || !!notionFieldMapError"
                @click="handleInspectNotion"
              />
              <span v-if="notionConnectionSummary" class="text-xs text-green-600">
                {{ notionConnectionSummary }}
              </span>
            </div>
            <div class="rounded border border-border">
              <button
                type="button"
                class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary"
                @click="notionAdvancedOpen = !notionAdvancedOpen"
              >
                <span>{{ $t("app.advancedMapping") }}</span>
                <i :class="notionAdvancedOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="text-[10px]" />
              </button>
              <div v-if="notionAdvancedOpen" class="space-y-3 border-t border-border p-3">
                <div class="flex flex-col gap-1">
                  <label class="text-xs text-muted-foreground">{{ $t("app.titleProperty") }}</label>
                  <InputText v-model="notionTitleProperty" size="small" :placeholder="$t('app.titleProperty')" />
                </div>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between gap-2">
                    <label class="text-xs text-muted-foreground">{{ $t("app.fieldMapJson") }}</label>
                    <span v-if="notionSchemaFields.length > 0" class="text-xs text-muted-foreground">
                      {{ $t('app.fieldsMapped', { count: notionMappedFieldCount, total: notionSchemaFields.length }) }}
                    </span>
                  </div>
                  <Textarea v-model="notionFieldMap" rows="5" auto-resize class="text-xs font-mono" placeholder="{&#10;  &quot;invoiceNo&quot;: &quot;Invoice No&quot;,&#10;  &quot;issuedAt&quot;: &quot;Issued At&quot;&#10;}" />
                  <p v-if="notionFieldMapError" class="text-xs text-red-500 mt-1">
                    {{ notionFieldMapError }}
                  </p>
                </div>
                <div class="text-xs text-muted-foreground p-2 rounded border border-border">
                  {{ $t("app.notionMappingHint") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Prompt Config -->
      <section>
        <h3 class="text-sm font-semibold mb-3 text-foreground">
          {{ $t("app.promptTemplates") }}
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.systemPrompt") }}</label>
            <Textarea v-model="systemTemplate" rows="6" auto-resize class="text-xs font-mono" />
            <p v-if="systemSchemaError" class="text-xs text-red-500 mt-1">
              {{ systemSchemaError }}
            </p>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.userPromptTemplate") }}</label>
            <Textarea v-model="userTemplate" rows="6" auto-resize class="text-xs font-mono" />
            <p v-if="userSchemaError" class="text-xs text-red-500 mt-1">
              {{ userSchemaError }}
            </p>
          </div>
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.promptPlaceholderHint") }}
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button :label="$t('app.cancel')" severity="secondary" text @click="visible = false" />
        <Button :label="$t('app.save')" icon="pi pi-check" :loading="saving" :disabled="!canSave" @click="handleSave" />
      </div>
    </template>
  </Dialog>
</template>
