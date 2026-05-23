<script setup lang="ts">
import type { NotionDatabaseProperty, NotionSchemaConfig } from "@/api-client"
import Button from "primevue/button"
import Checkbox from "primevue/checkbox"
import InputText from "primevue/inputtext"
import Password from "primevue/password"
import Select from "primevue/select"
import Textarea from "primevue/textarea"
import { computed, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { toast } from "vue-sonner"
import { getSchema, inspectNotionDatabase } from "@/api-client"

const props = defineProps<{
  schemas: string[]
}>()

const langfuseEnabled = defineModel<boolean>("langfuseEnabled", { required: true })
const langfusePublicKey = defineModel<string>("langfusePublicKey", { required: true })
const langfuseSecretKey = defineModel<string>("langfuseSecretKey", { required: true })
const langfuseHost = defineModel<string>("langfuseHost", { required: true })

const webhookEnabled = defineModel<boolean>("webhookEnabled", { required: true })
const webhookUrl = defineModel<string>("webhookUrl", { required: true })
const webhookSecret = defineModel<string>("webhookSecret", { required: true })

const notionEnabled = defineModel<boolean>("notionEnabled", { required: true })
const notionToken = defineModel<string>("notionToken", { required: true })
const notionSchemas = defineModel<Record<string, NotionSchemaConfig>>("notionSchemas", { required: true })
const selectedNotionSchema = defineModel<string>("selectedNotionSchema", { required: true })
const notionDatabaseId = defineModel<string>("notionDatabaseId", { required: true })
const notionTitleProperty = defineModel<string>("notionTitleProperty", { required: true })
const notionFieldMap = defineModel<string>("notionFieldMap", { required: true })
const notionProperties = defineModel<NotionDatabaseProperty[]>("notionProperties", { required: true })
const notionSchemaFields = defineModel<string[]>("notionSchemaFields", { required: true })
const notionAdvancedOpen = defineModel<boolean>("notionAdvancedOpen", { required: true })

const { t } = useI18n()
const notionTesting = ref(false)

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

// Handle save trigger to make sure the currently selected schema's config is persisted
defineExpose({
  persistSelectedNotionSchema,
  loadSelectedNotionSchemaFields,
  notionFieldMapError
})

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
</script>

<template>
  <div class="space-y-6">
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
  </div>
</template>
