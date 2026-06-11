import type { ComputedRef, Ref } from "vue"
import type { PresetName } from "./presets.ts"
/**
 * Composable for runtime theme switching.
 *
 * Dark mode uses VueUse `useColorMode` (system preference + localStorage).
 * PrimeVue / Tailwind still need custom classes via `applyDarkMode`.
 */
import { useColorMode } from "@vueuse/core"
import { usePrimeVue } from "primevue/config"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { presets } from "./presets.ts"

const STORAGE_KEY = "jscb-color-scheme"

const currentPreset = ref<PresetName>("aura")

/** Resolve dark state for pre-mount init (matches useColorMode storage semantics). */
export function getInitialDarkMode(): boolean {
  if (typeof window === "undefined") return false
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "dark") return true
    if (stored === "light") return false
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

const DARK_MODE_SELECTOR = ".jscb-dark"

function applyDarkMode(isDark: boolean): void {
  document.documentElement.classList.toggle("jscb-dark", isDark)
  document.documentElement.setAttribute("data-vxe-ui-theme", isDark ? "dark" : "light")

  for (const el of document.querySelectorAll<HTMLElement>(".jscb")) {
    el.classList.toggle("dark", isDark)
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-jscb-overlay-container]")) {
    el.classList.toggle("dark", isDark)
  }
}

/** Apply theme before Vue mounts to avoid a light flash on refresh. */
export function initTheme(): void {
  if (typeof document === "undefined") return
  applyDarkMode(getInitialDarkMode())
}

/**
 * Composable to control the active theme at runtime.
 *
 * Must be called inside a component that is a descendant of `app.use(PrimeVue, …)`.
 */
export function useTheme(): {
  currentPreset: Ref<PresetName>
  darkMode: ComputedRef<boolean>
  colorMode: ReturnType<typeof useColorMode>
  switchPreset: (name: PresetName) => void
  toggleDarkMode: (value?: boolean) => void
  presetNames: PresetName[]
} {
  const primevue = usePrimeVue()

  const colorMode = useColorMode({
    storageKey: STORAGE_KEY,
    initialValue: "auto",
    modes: {
      auto: "",
      light: "",
      dark: ""
    }
  })

  watch(() => colorMode.state.value, (val) => {
    applyDarkMode(val === "dark")
  })

  const ensureDarkModeSelector = (): void => {
    primevue.config.theme = {
      ...(primevue.config.theme ?? {}),
      options: {
        ...(primevue.config.theme?.options ?? {}),
        darkModeSelector: DARK_MODE_SELECTOR
      }
    }
  }

  const switchPreset = (name: PresetName): void => {
    currentPreset.value = name
    primevue.config.theme = {
      preset: presets[name],
      options: {
        ...(primevue.config.theme?.options ?? {}),
        darkModeSelector: DARK_MODE_SELECTOR
      }
    }
  }

  /** Toggle dark/light; set `colorMode.store` to `'auto'` to follow system again. */
  const toggleDarkMode = (value?: boolean): void => {
    if (value !== undefined) {
      colorMode.store.value = value ? "dark" : "light"
    } else {
      colorMode.store.value = colorMode.state.value === "dark" ? "light" : "dark"
    }
  }

  const darkMode = computed(() => colorMode.state.value === "dark")

  ensureDarkModeSelector()

  onMounted(() => {
    nextTick(() => applyDarkMode(colorMode.state.value === "dark"))
  })

  return {
    currentPreset,
    darkMode,
    colorMode,
    switchPreset,
    toggleDarkMode,
    presetNames: Object.keys(presets) as PresetName[]
  }
}
