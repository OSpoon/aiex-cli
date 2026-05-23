import Aura from '@primevue/themes/aura'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import { createApp } from 'vue'
import App from '@/App.vue'

import '@/lib/jsonschema-editor/index.css'
import 'primeicons/primeicons.css'
import 'vue-sonner/style.css'
import { initTheme } from '@/lib/jsonschema-editor/themes/useTheme'
import { i18n } from '@/locales'

initTheme()

const app = createApp(App)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.jscb-dark',
    },
  },
})
app.use(i18n)
app.directive('tooltip', Tooltip)

app.mount('#app')
