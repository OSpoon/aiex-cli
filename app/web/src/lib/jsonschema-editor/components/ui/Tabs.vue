<script setup lang="ts">
import Tab from "primevue/tab"
import TabList from "primevue/tablist"
import TabPanels from "primevue/tabpanels"
import Tabs from "primevue/tabs"
import { computed, watch } from "vue"

const props = defineProps<{
  tabs: { value: string, label: string }[]
  class?: string
}>()

const model = defineModel<string>()

// Initialize model with first tab value if undefined
watch(
  () => props.tabs,
  (tabs) => {
    if (model.value === undefined && tabs.length > 0) {
      model.value = tabs[0].value
    }
  },
  { immediate: true }
)

// Provide a non-undefined value for PrimeVue Tabs v-model
const tabValue = computed({
  get: () => model.value ?? "",
  set: (val: string) => {
    model.value = val
  }
})
</script>

<template>
  <Tabs v-model:value="tabValue" :class="$props.class">
    <TabList :pt="{ root: { class: 'shrink-0' } }">
      <Tab v-for="tab in tabs" :key="tab.value" :value="tab.value">
        {{ tab.label }}
      </Tab>
    </TabList>
    <TabPanels
      :pt="{
        root: {
          class: 'flex flex-1 min-h-0 w-full flex-col',
        },
      }"
    >
      <slot />
    </TabPanels>
  </Tabs>
</template>
