import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig, loadEnv } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PRIMEICONS_LEGACY_FONT_SOURCES_RE = /src:\s*url\('\.\/fonts\/primeicons\.eot'\);\s*src:\s*url\('\.\/fonts\/primeicons\.eot\?#iefix'\)\s*format\('embedded-opentype'\),\s*url\('\.\/fonts\/primeicons\.woff2'\)\s*format\('woff2'\),\s*url\('\.\/fonts\/primeicons\.woff'\)\s*format\('woff'\),\s*url\('\.\/fonts\/primeicons\.ttf'\)\s*format\('truetype'\),\s*url\('\.\/fonts\/primeicons\.svg\?#primeicons'\)\s*format\('svg'\);/

function primeIconsModernFontPlugin() {
  return {
    name: "aiex-primeicons-modern-font",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.endsWith("primeicons.css")) return null
      return code.replace(
        PRIMEICONS_LEGACY_FONT_SOURCES_RE,
        "src: url('./fonts/primeicons.woff2') format('woff2');"
      )
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const apiTarget = env.AIEX_API_URL || "http://localhost:13000"

  return {
    plugins: [primeIconsModernFontPlugin(), vue(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@aiex/default-prompts": path.resolve(__dirname, "../cli/assets/default-prompts.json"),
        "@aiex/table-schema": path.resolve(__dirname, "../cli/schemas/table-schema.json")
      }
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: "../cli/dist/web",
      emptyOutDir: true,
      chunkSizeWarningLimit: 2500
    },
    optimizeDeps: {
      include: [
        "monaco-editor/esm/vs/language/json/json.worker",
        "monaco-editor/esm/vs/editor/editor.worker"
      ]
    }
  }
})
