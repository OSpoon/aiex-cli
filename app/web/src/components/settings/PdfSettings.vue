<script setup lang="ts">
import type { ImageInputMode, PdfConverterKind } from "@/api-client"
import Checkbox from "primevue/checkbox"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import Select from "primevue/select"
import Textarea from "primevue/textarea"
import { computed, onMounted, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { registryLookup } from "@/api-client"

const pdfConverter = defineModel<PdfConverterKind>("pdfConverter", { required: true })
const mineruCommand = defineModel<string>("mineruCommand", { required: true })
const mineruArgs = defineModel<string>("mineruArgs", { required: true })
const mineruTimeout = defineModel<number>("mineruTimeout", { required: true })
const mineruFallbackToUnpdf = defineModel<boolean>("mineruFallbackToUnpdf", { required: true })

const mineruApiToken = defineModel<string>("mineruApiToken", { required: true })
const mineruApiBaseUrl = defineModel<string>("mineruApiBaseUrl", { required: true })
const mineruApiModel = defineModel<string>("mineruApiModel", { required: true })
const mineruApiIsOcr = defineModel<boolean>("mineruApiIsOcr", { required: true })
const mineruApiEnableFormula = defineModel<boolean>("mineruApiEnableFormula", { required: true })
const mineruApiEnableTable = defineModel<boolean>("mineruApiEnableTable", { required: true })

const externalCommand = defineModel<string>("externalCommand", { required: true })
const externalArgs = defineModel<string>("externalArgs", { required: true })
const externalTimeout = defineModel<number>("externalTimeout", { required: true })

const imageOcrFallback = defineModel<ImageInputMode>("imageOcrFallback", { required: true })
const imageModelName = defineModel<string>("imageModelName", { required: true })
const imageVisionBaseUrl = defineModel<string>("imageVisionBaseUrl", { required: true })
const imageVisionApiKey = defineModel<string>("imageVisionApiKey", { required: true })
const imageOcrLanguages = defineModel<string>("imageOcrLanguages", { required: true })
const imageOcrMinConfidence = defineModel<number>("imageOcrMinConfidence", { required: true })
const imageOcrAdvancedOpen = defineModel<boolean>("imageOcrAdvancedOpen", { required: true })

const visionModelSource = ref<"registry" | "manual">("manual")
const visionModelHasVision = ref(false)
let visionLookupId = 0

function refreshVisionIndicator(name: string) {
  if (!name) {
    visionModelSource.value = "manual"
    visionModelHasVision.value = false
    return
  }
  const id = ++visionLookupId
  registryLookup(name).then((caps) => {
    if (id !== visionLookupId) return
    visionModelSource.value = caps ? "registry" : "manual"
    visionModelHasVision.value = caps?.vision ?? false
  })
}

watch(imageModelName, val => refreshVisionIndicator(val))

onMounted(() => {
  if (imageModelName.value) refreshVisionIndicator(imageModelName.value)
})

const { t } = useI18n()

const pdfConverterOptions = computed(() => [
  { label: t("app.pdfConverterUnpdf"), value: "unpdf" },
  { label: t("app.pdfConverterMineru"), value: "mineru" },
  { label: t("app.pdfConverterMineruApi"), value: "mineru_api" },
  { label: t("app.pdfConverterExternal"), value: "external" }
])

const modeOptions = computed(() => [
  { label: t("app.ocrModeLocal"), value: "local" as const },
  { label: t("app.ocrModeVision"), value: "vision" as const }
])

const imageInputStatusText = computed(() => {
  if (imageOcrFallback.value === "vision" && imageModelName.value)
    return t("app.imageSummaryVisionModel", { model: imageModelName.value })
  if (imageOcrFallback.value === "vision")
    return t("app.imageSummaryNoVisionModel")
  return t("app.imageSummaryOcrLocal")
})
</script>

<template>
  <div class="space-y-6">
    <!-- Image Input -->
    <section>
      <h3 class="text-sm font-semibold mb-3 text-foreground">
        {{ $t("app.imageInput") }}
      </h3>
      <div class="space-y-3">
        <div class="rounded border p-3 text-sm border-blue-200 bg-blue-50 text-blue-800">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">
              {{ imageOcrFallback === 'vision' && imageModelName ? imageModelName : $t("app.requireLocalOcr") }}
            </span>
            <span class="text-xs">{{ $t("app.imageConversionEnabled") }}</span>
          </div>
          <p class="mt-1 text-xs leading-relaxed">
            {{ imageInputStatusText }}
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
            <label class="text-xs text-muted-foreground">{{ $t("app.imageInputMode") }}</label>
            <Select
              v-model="imageOcrFallback"
              :options="modeOptions"
              option-label="label"
              option-value="value"
              size="small"
            />
          </div>
          <div v-if="imageOcrFallback === 'vision'" class="space-y-3">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.visionBaseUrl") }}</label>
              <InputText v-model="imageVisionBaseUrl" size="small" :placeholder="$t('app.visionBaseUrlPlaceholder')" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.visionApiKey") }}</label>
              <Password v-model="imageVisionApiKey" :feedback="false" toggle-mask size="small" :placeholder="$t('app.visionApiKeyPlaceholder')" input-class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-muted-foreground">{{ $t("app.visionModel") }}</label>
              <div class="flex flex-col gap-1.5">
                <InputText
                  v-model="imageModelName"
                  size="small"
                  placeholder="gpt-4o"
                  class="font-mono"
                />
                <div class="flex items-center gap-3 text-xs">
                  <span v-if="visionModelSource === 'registry'" class="text-muted-foreground">
                    <i class="pi pi-database mr-0.5" />{{ $t("app.modelCapsRegistry") }}
                  </span>
                  <span :class="visionModelHasVision ? 'text-green-600 font-medium' : 'text-muted-foreground'">
                    {{ visionModelHasVision ? 'Vision' : ($t('app.noVisionCapability')) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.ocrLanguages") }}</label>
            <InputText v-model="imageOcrLanguages" size="small" placeholder="en-US, zh-Hans" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.ocrMinConfidence") }}</label>
            <InputText :value="String(imageOcrMinConfidence)" type="number" size="small" placeholder="0" :min="0" :max="1" :step="0.05" @input="imageOcrMinConfidence = Math.min(1, Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))" />
          </div>
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.imageConversionHint") }}
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

        <!-- Mineru PDF Converter config -->
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
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
            <code class="bg-secondary px-1 rounded">{outputDir}</code>,
            <code class="bg-secondary px-1 rounded">{basename}</code>
          </div>
        </div>

        <!-- MinerU API PDF Converter config -->
        <div v-if="pdfConverter === 'mineru_api'" class="space-y-3 pl-6 border-l-2 border-border">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.mineruApiTokenLabel") }}</label>
            <Password v-model="mineruApiToken" :feedback="false" toggle-mask size="small" :placeholder="$t('app.mineruApiTokenPlaceholder')" input-class="w-full" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.mineruApiBaseUrlLabel") }}</label>
            <InputText v-model="mineruApiBaseUrl" size="small" placeholder="https://mineru.net/api/v4" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground">{{ $t("app.mineruApiModelLabel") }}</label>
            <Select
              v-model="mineruApiModel"
              :options="[
                { label: 'vlm (Recommended)', value: 'vlm' },
                { label: 'pipeline (Layout + OCR)', value: 'pipeline' },
              ]"
              option-label="label"
              option-value="value"
              size="small"
            />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="mineruApiIsOcr" :binary="true" input-id="mineru-api-is-ocr" />
            <label for="mineru-api-is-ocr" class="text-sm cursor-pointer">{{ $t("app.mineruApiIsOcrLabel") }}</label>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="mineruApiEnableFormula" :binary="true" input-id="mineru-api-enable-formula" />
            <label for="mineru-api-enable-formula" class="text-sm cursor-pointer">{{ $t("app.mineruApiEnableFormulaLabel") }}</label>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="mineruApiEnableTable" :binary="true" input-id="mineru-api-enable-table" />
            <label for="mineru-api-enable-table" class="text-sm cursor-pointer">{{ $t("app.mineruApiEnableTableLabel") }}</label>
          </div>
        </div>

        <!-- External PDF Converter config -->
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
            <label class="text-xs text-muted-foreground">{{ $t("app.timeoutLabel") }}</label>
            <InputText :value="String(externalTimeout)" type="number" size="small" placeholder="600" :min="1" @input="externalTimeout = Number(($event.target as HTMLInputElement).value) || 600" />
          </div>
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
            <code class="bg-secondary px-1 rounded">{outputDir}</code>,
            <code class="bg-secondary px-1 rounded">{basename}</code>. {{ $t("app.externalHint") }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
