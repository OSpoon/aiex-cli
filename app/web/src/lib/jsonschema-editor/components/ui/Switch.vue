<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch"

defineProps<{
  id?: string
  disabled?: boolean
}>()

const model = defineModel<boolean>()
</script>

<template>
  <ToggleSwitch v-model="model" :input-id="id" :disabled="disabled" />
</template>
