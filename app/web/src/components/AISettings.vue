<!-- eslint-disable vue/attribute-hyphenation -->
<script setup lang="ts">
import type { AIConfig, AIModelConfig, ImageOcrFallbackMode, NotionDatabaseProperty, NotionSchemaConfig, PdfConverterKind } from "@/api-client"
import Button from "primevue/button"
import Dialog from "primevue/dialog"
import { computed, onMounted, ref } from "vue"
import { useI18n } from "vue-i18n"
import { toast } from "vue-sonner"
import {
  getAIConfig,
  saveAIConfig
} from "@/api-client"
import IntegrationSettings from "./settings/IntegrationSettings.vue"
import PdfSettings from "./settings/PdfSettings.vue"
import PromptSettings from "./settings/PromptSettings.vue"
import ProviderSettings from "./settings/ProviderSettings.vue"

defineProps<{
  schemas: string[]
}>()
const visible = defineModel<boolean>("visible", { default: false })

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)

const baseURL = ref("")
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

const mineruApiToken = ref("")
const mineruApiBaseUrl = ref("https://mineru.net/api/v4")
const mineruApiModel = ref("vlm")
const mineruApiIsOcr = ref(true)
const mineruApiEnableFormula = ref(true)
const mineruApiEnableTable = ref(true)

const markitdownCommand = ref("markitdown")
const markitdownArgs = ref("{input}\n-o\n{outputDir}/{basename}.md")
const markitdownTimeout = ref(600)
const markitdownFallbackToUnpdf = ref(true)

const markerCommand = ref("marker_single")
const markerArgs = ref("{input}\n--output_dir\n{outputDir}")
const markerTimeout = ref(600)
const markerFallbackToUnpdf = ref(true)

const externalCommand = ref("")
const externalArgs = ref("")
const externalTimeout = ref(600)

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
const notionProperties = ref<NotionDatabaseProperty[]>([])
const notionSchemaFields = ref<string[]>([])
const notionAdvancedOpen = ref(false)

// Component refs for validation
const promptSettingsRef = ref<InstanceType<typeof PromptSettings> | null>(null)
const integrationSettingsRef = ref<InstanceType<typeof IntegrationSettings> | null>(null)

const hasVisionModel = computed(() => models.value.some(model => model.capabilities.vision))

const canSave = computed(() => {
  const systemSchemaError = promptSettingsRef.value?.systemSchemaError || ""
  const userSchemaError = promptSettingsRef.value?.userSchemaError || ""
  const notionFieldMapError = integrationSettingsRef.value?.notionFieldMapError || ""

  return !systemSchemaError
    && !userSchemaError
    && !notionFieldMapError
    && !loading.value
    && models.value.length > 0
    && (!notionEnabled.value || !!notionToken.value.trim())
    && (pdfConverter.value !== "mineru" || !!mineruCommand.value.trim())
    && (pdfConverter.value !== "mineru_api" || !!mineruApiToken.value.trim())
    && (pdfConverter.value !== "markitdown" || !!markitdownCommand.value.trim())
    && (pdfConverter.value !== "marker" || !!markerCommand.value.trim())
    && (pdfConverter.value !== "external" || !!externalCommand.value.trim())
})

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
    mineruApiToken.value = config.pdf?.mineruApi?.token ?? ""
    mineruApiBaseUrl.value = config.pdf?.mineruApi?.baseURL ?? "https://mineru.net/api/v4"
    mineruApiModel.value = config.pdf?.mineruApi?.modelVersion ?? "vlm"
    mineruApiIsOcr.value = config.pdf?.mineruApi?.isOcr ?? true
    mineruApiEnableFormula.value = config.pdf?.mineruApi?.enableFormula ?? true
    mineruApiEnableTable.value = config.pdf?.mineruApi?.enableTable ?? true
    mineruCommand.value = config.pdf?.mineru?.command ?? "mineru"
    mineruArgs.value = (config.pdf?.mineru?.args ?? ["-p", "{input}", "-o", "{outputDir}"]).join("\n")
    mineruTimeout.value = config.pdf?.mineru?.timeout ?? 600
    mineruFallbackToUnpdf.value = config.pdf?.mineru?.fallbackToUnpdf ?? true
    markitdownCommand.value = config.pdf?.markitdown?.command ?? "markitdown"
    markitdownArgs.value = (config.pdf?.markitdown?.args ?? ["{input}", "-o", "{outputDir}/{basename}.md"]).join("\n")
    markitdownTimeout.value = config.pdf?.markitdown?.timeout ?? 600
    markitdownFallbackToUnpdf.value = config.pdf?.markitdown?.fallbackToUnpdf ?? true
    markerCommand.value = config.pdf?.marker?.command ?? "marker_single"
    markerArgs.value = (config.pdf?.marker?.args ?? ["{input}", "--output_dir", "{outputDir}"]).join("\n")
    markerTimeout.value = config.pdf?.marker?.timeout ?? 600
    markerFallbackToUnpdf.value = config.pdf?.marker?.fallbackToUnpdf ?? true
    externalCommand.value = config.pdf?.external?.command ?? ""
    externalArgs.value = (config.pdf?.external?.args ?? []).join("\n")
    externalTimeout.value = config.pdf?.external?.timeout ?? 600
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
    await integrationSettingsRef.value?.loadSelectedNotionSchemaFields()
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
    integrationSettingsRef.value?.persistSelectedNotionSchema()
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
        mineru: mineruCommand.value.trim()
          ? {
              command: mineruCommand.value,
              args: mineruArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
              timeout: mineruTimeout.value,
              fallbackToUnpdf: mineruFallbackToUnpdf.value
            }
          : undefined,
        mineruApi: {
          token: mineruApiToken.value.trim(),
          baseURL: mineruApiBaseUrl.value.trim() || undefined,
          modelVersion: mineruApiModel.value.trim() || undefined,
          isOcr: mineruApiIsOcr.value,
          enableFormula: mineruApiEnableFormula.value,
          enableTable: mineruApiEnableTable.value
        },
        markitdown: markitdownCommand.value.trim()
          ? {
              command: markitdownCommand.value,
              args: markitdownArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
              timeout: markitdownTimeout.value,
              fallbackToUnpdf: markitdownFallbackToUnpdf.value
            }
          : undefined,
        marker: markerCommand.value.trim()
          ? {
              command: markerCommand.value,
              args: markerArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
              timeout: markerTimeout.value,
              fallbackToUnpdf: markerFallbackToUnpdf.value
            }
          : undefined,
        external: externalCommand.value.trim()
          ? {
              command: externalCommand.value,
              args: externalArgs.value.split("\n").map(arg => arg.trim()).filter(Boolean),
              timeout: externalTimeout.value
            }
          : undefined
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

onMounted(() => {
  loadConfig()
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
      <ProviderSettings
        v-model:base-u-r-l="baseURL"
        v-model:api-key="apiKey"
        v-model:timeout="timeout"
        v-model:models="models"
      />

      <PdfSettings
        :has-vision-model="hasVisionModel"
        v-model:pdf-converter="pdfConverter"
        v-model:mineru-command="mineruCommand"
        v-model:mineru-args="mineruArgs"
        v-model:mineru-timeout="mineruTimeout"
        v-model:mineru-fallback-to-unpdf="mineruFallbackToUnpdf"
        v-model:mineru-api-token="mineruApiToken"
        v-model:mineru-api-base-url="mineruApiBaseUrl"
        v-model:mineru-api-model="mineruApiModel"
        v-model:mineru-api-is-ocr="mineruApiIsOcr"
        v-model:mineru-api-enable-formula="mineruApiEnableFormula"
        v-model:mineru-api-enable-table="mineruApiEnableTable"
        v-model:markitdown-command="markitdownCommand"
        v-model:markitdown-args="markitdownArgs"
        v-model:markitdown-timeout="markitdownTimeout"
        v-model:markitdown-fallback-to-unpdf="markitdownFallbackToUnpdf"
        v-model:marker-command="markerCommand"
        v-model:marker-args="markerArgs"
        v-model:marker-timeout="markerTimeout"
        v-model:marker-fallback-to-unpdf="markerFallbackToUnpdf"
        v-model:external-command="externalCommand"
        v-model:external-args="externalArgs"
        v-model:external-timeout="externalTimeout"
        v-model:image-ocr-fallback="imageOcrFallback"
        v-model:image-ocr-languages="imageOcrLanguages"
        v-model:image-ocr-min-confidence="imageOcrMinConfidence"
        v-model:image-ocr-advanced-open="imageOcrAdvancedOpen"
      />

      <IntegrationSettings
        ref="integrationSettingsRef"
        :schemas="schemas"
        v-model:langfuse-enabled="langfuseEnabled"
        v-model:langfuse-public-key="langfusePublicKey"
        v-model:langfuse-secret-key="langfuseSecretKey"
        v-model:langfuse-host="langfuseHost"
        v-model:webhook-enabled="webhookEnabled"
        v-model:webhook-url="webhookUrl"
        v-model:webhook-secret="webhookSecret"
        v-model:notion-enabled="notionEnabled"
        v-model:notion-token="notionToken"
        v-model:notion-schemas="notionSchemas"
        v-model:selected-notion-schema="selectedNotionSchema"
        v-model:notion-database-id="notionDatabaseId"
        v-model:notion-title-property="notionTitleProperty"
        v-model:notion-field-map="notionFieldMap"
        v-model:notion-properties="notionProperties"
        v-model:notion-schema-fields="notionSchemaFields"
        v-model:notion-advanced-open="notionAdvancedOpen"
      />

      <PromptSettings
        ref="promptSettingsRef"
        v-model:system-template="systemTemplate"
        v-model:user-template="userTemplate"
      />
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button :label="$t('app.cancel')" severity="secondary" text @click="visible = false" />
        <Button :label="$t('app.save')" icon="pi pi-check" :loading="saving" :disabled="!canSave" @click="handleSave" />
      </div>
    </template>
  </Dialog>
</template>
