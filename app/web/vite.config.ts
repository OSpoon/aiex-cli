import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const apiTarget = env.AIEX_API_URL || 'http://localhost:13000'

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@aiex/table-schema': path.resolve(__dirname, '../cli/schemas/table-schema.json'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../cli/dist/web',
      emptyOutDir: true,
      chunkSizeWarningLimit: 2500,
    },
    optimizeDeps: {
      include: [
        'monaco-editor/esm/vs/language/json/json.worker',
        'monaco-editor/esm/vs/editor/editor.worker',
      ],
    },
  }
})
