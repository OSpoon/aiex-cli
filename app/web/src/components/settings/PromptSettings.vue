<script setup lang="ts">
import Textarea from "primevue/textarea"
import { computed } from "vue"
import { useI18n } from "vue-i18n"

const systemTemplate = defineModel<string>("systemTemplate", { required: true })
const userTemplate = defineModel<string>("userTemplate", { required: true })

const { t } = useI18n()

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

defineExpose({
  systemSchemaError,
  userSchemaError
})
</script>

<template>
  <div class="space-y-6">
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
</template>
