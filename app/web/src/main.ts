import Aura from '@primevue/themes/aura'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import { createApp } from 'vue'
import App from '@/App.vue'

import VxeUI from 'vxe-pc-ui'
import 'vxe-pc-ui/lib/style.css'
import VxeUITable from 'vxe-table'
import 'vxe-table/lib/style.css'

import '@/lib/jsonschema-editor/index.css'
import 'primeicons/primeicons.css'
import 'vue-sonner/style.css'
import { initTheme } from '@/lib/jsonschema-editor/themes/useTheme'

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
app.directive('tooltip', Tooltip)
app.use(VxeUI)
app.use(VxeUITable)

app.mount('#app')
