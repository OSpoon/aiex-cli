<script setup lang="ts">
import PSelect from "primevue/select"

defineProps<{
  options: { label: string, value: string }[]
  placeholder?: string
  id?: string
  class?: string
}>()

const model = defineModel<string>()
</script>

<template>
  <PSelect
    v-model="model"
    :options="options"
    option-label="label"
    option-value="value"
    :placeholder="placeholder"
    :id="id"
    :class="$props.class"
    append-to="body"
    :pt="{ overlay: { class: 'jscb' } }"
    fluid
  />
</template>
