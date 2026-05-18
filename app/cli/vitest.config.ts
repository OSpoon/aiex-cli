import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '~': path.resolve('.'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/index.ts',
        'src/**/*.test-utils.ts',
        'src/core/schema-sqlite/migrate-helper.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
    },
  },
})
