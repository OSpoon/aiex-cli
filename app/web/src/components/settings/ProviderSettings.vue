<script setup lang="ts">
import type { AIModelConfig } from "@/api-client"
import Button from "primevue/button"
import Checkbox from "primevue/checkbox"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import { ref } from "vue"
import { registryLookup } from "@/api-client"

const baseURL = defineModel<string>("baseURL", { required: true })
const apiKey = defineModel<string>("apiKey", { required: true })
const timeout = defineModel<number>("timeout", { required: true })
const models = defineModel<AIModelConfig[]>("models", { required: true })

// Model adding state
const addingModel = ref(false)
const newModelName = ref("")
const newModelStructuredOutput = ref(false)
const newModelSource = ref<"registry" | "manual">("manual")
let providerLookupId = 0

function onModelNameInput() {
  const id = ++providerLookupId
  newModelSource.value = "manual"
  newModelStructuredOutput.value = false

  if (!newModelName.value) return

  registryLookup(newModelName.value).then((caps) => {
    if (id !== providerLookupId) return
    if (caps) {
      newModelStructuredOutput.value = caps.structuredOutput
      newModelSource.value = "registry"
    }
  })
}

function confirmAddModel() {
  if (!newModelName.value) return
  models.value.push({
    name: newModelName.value,
    capabilities: { structuredOutput: newModelStructuredOutput.value }
  })
  resetNewModel()
}

function cancelAddModel() {
  resetNewModel()
}

function resetNewModel() {
  newModelName.value = ""
  newModelStructuredOutput.value = false
  newModelSource.value = "manual"
  addingModel.value = false
}

function removeModel(index: number) {
  models.value.splice(index, 1)
}
</script>

<template>
  <div class="space-y-6">
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
          <span v-if="m.capabilities.structuredOutput" class="text-xs text-green-600 font-medium">SO</span>
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
                v-model="newModelStructuredOutput"
                :binary="true"
                input-id="add-so"
              />
              <span :class="newModelStructuredOutput ? 'text-green-600' : 'text-muted-foreground'">
                Structured Output
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
  </div>
</template>
