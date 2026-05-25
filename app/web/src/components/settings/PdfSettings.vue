<script setup lang="ts">
import type { ImageOcrFallbackMode, PdfConverterKind } from "@/api-client"
import Checkbox from "primevue/checkbox"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import Select from "primevue/select"
import Textarea from "primevue/textarea"
import { computed } from "vue"
import { useI18n } from "vue-i18n"

const props = defineProps<{
  hasVisionModel: boolean
}>()

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

const markitdownCommand = defineModel<string>("markitdownCommand", { required: true })
const markitdownArgs = defineModel<string>("markitdownArgs", { required: true })
const markitdownTimeout = defineModel<number>("markitdownTimeout", { required: true })
const markitdownFallbackToUnpdf = defineModel<boolean>("markitdownFallbackToUnpdf", { required: true })

const markerCommand = defineModel<string>("markerCommand", { required: true })
const markerArgs = defineModel<string>("markerArgs", { required: true })
const markerTimeout = defineModel<number>("markerTimeout", { required: true })
const markerFallbackToUnpdf = defineModel<boolean>("markerFallbackToUnpdf", { required: true })

const externalCommand = defineModel<string>("externalCommand", { required: true })
const externalArgs = defineModel<string>("externalArgs", { required: true })
const externalTimeout = defineModel<number>("externalTimeout", { required: true })

const imageOcrFallback = defineModel<ImageOcrFallbackMode>("imageOcrFallback", { required: true })
const imageOcrLanguages = defineModel<string>("imageOcrLanguages", { required: true })
const imageOcrMinConfidence = defineModel<number>("imageOcrMinConfidence", { required: true })
const imageOcrAdvancedOpen = defineModel<boolean>("imageOcrAdvancedOpen", { required: true })

const { t } = useI18n()

const pdfConverterOptions = computed(() => [
  { label: t("app.pdfConverterUnpdf"), value: "unpdf" },
  { label: t("app.pdfConverterMineru"), value: "mineru" },
  { label: t("app.pdfConverterMineruApi"), value: "mineru_api" },
  { label: t("app.pdfConverterMarkitdown"), value: "markitdown" },
  { label: t("app.pdfConverterMarker"), value: "marker" },
  { label: t("app.pdfConverterExternal"), value: "external" }
])

const imageOcrFallbackOptions = computed(() => [
  { label: t("app.ocrFallbackAuto"), value: "auto" },
  { label: t("app.ocrFallbackOff"), value: "off" },
  { label: t("app.ocrFallbackLocal"), value: "local" }
])

const imageInputModeLabel = computed(() => {
  if (imageOcrFallback.value === "off")
    return t("app.ocrDisabled")
  if (imageOcrFallback.value === "local")
    return t("app.requireLocalOcr")
  return t("app.ocrAuto")
})

const imageInputSummary = computed(() => {
  if (props.hasVisionModel)
    return t("app.imageSummaryVisionModel")
  if (imageOcrFallback.value === "off")
    return t("app.imageSummaryOcrOff")
  if (imageOcrFallback.value === "local")
    return t("app.imageSummaryOcrLocal")
  return t("app.imageSummaryNoVision")
})

const imageInputStatusClass = computed(() => {
  if (props.hasVisionModel)
    return "border-green-200 bg-green-50 text-green-800"
  if (imageOcrFallback.value === "off")
    return "border-yellow-200 bg-yellow-50 text-yellow-800"
  return "border-blue-200 bg-blue-50 text-blue-800"
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

        <!-- MarkItDown PDF Converter config -->
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
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
            <code class="bg-secondary px-1 rounded">{outputDir}</code>,
            <code class="bg-secondary px-1 rounded">{basename}</code>
          </div>
        </div>

        <!-- Marker PDF Converter config -->
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
          <div class="text-xs text-muted-foreground p-2 rounded border border-border">
            {{ $t("app.placeholders") }}: <code class="bg-secondary px-1 rounded">{input}</code>,
            <code class="bg-secondary px-1 rounded">{outputDir}</code>,
            <code class="bg-secondary px-1 rounded">{basename}</code>
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
