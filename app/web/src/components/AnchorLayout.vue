<script setup lang="ts">
import { ref } from "vue"

export interface AnchorItem {
  key: string
  label: string
  icon?: string
}

const props = withDefaults(defineProps<{
  anchors: AnchorItem[]
  bottomSpacer?: number
}>(), {
  bottomSpacer: 192
})

const activeKey = defineModel<string>("activeKey", { default: "" })
const contentRef = ref<HTMLElement | null>(null)

function findSection(key: string): HTMLElement | null {
  const container = contentRef.value
  if (!container) return null
  const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-anchor-section]"))
  return sections.find(section => section.dataset.anchorSection === key) ?? null
}

function scrollToAnchor(key: string) {
  activeKey.value = key
  const container = contentRef.value
  const target = findSection(key)
  if (!container || !target) return

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  container.scrollTo({
    top: Math.max(0, targetRect.top - containerRect.top + container.scrollTop - 16),
    behavior: "smooth"
  })
}

function updateActiveAnchor() {
  const container = contentRef.value
  if (!container || props.anchors.length === 0) return

  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
    activeKey.value = props.anchors[props.anchors.length - 1]?.key ?? ""
    return
  }

  const marker = container.scrollTop + 80
  let nextActive = props.anchors[0]?.key ?? ""
  const containerTop = container.getBoundingClientRect().top

  for (const anchor of props.anchors) {
    const section = findSection(anchor.key)
    if (!section) continue
    const sectionTop = section.getBoundingClientRect().top - containerTop + container.scrollTop
    if (sectionTop <= marker) {
      nextActive = anchor.key
    }
  }

  activeKey.value = nextActive
}
</script>

<template>
  <div class="grid h-full min-h-0 min-w-0 grid-cols-[280px_minmax(0,1fr)] bg-background">
    <section class="flex min-h-0 flex-col border-r border-border bg-card">
      <slot name="sidebar-header" />

      <nav class="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          v-for="anchor in anchors"
          :key="anchor.key"
          class="mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors last:mb-0"
          :class="activeKey === anchor.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'"
          @click="scrollToAnchor(anchor.key)"
        >
          <i v-if="anchor.icon" class="text-xs" :class="anchor.icon" />
          <span>{{ anchor.label }}</span>
        </button>
      </nav>
    </section>

    <section class="flex min-h-0 flex-col bg-background">
      <slot name="header" />

      <div ref="contentRef" class="min-h-0 flex-1 overflow-auto p-4" @scroll="updateActiveAnchor">
        <div class="mx-auto flex max-w-5xl flex-col gap-8">
          <slot />
          <div class="shrink-0" :style="{ height: `${bottomSpacer}px` }" aria-hidden="true" />
        </div>
      </div>
    </section>
  </div>
</template>
