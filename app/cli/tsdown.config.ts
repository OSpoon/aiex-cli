import path from 'node:path'
import process from 'node:process'
import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/infrastructure/schema/migrate-helper.ts',
  ],
  alias: {
    '@': path.resolve('./src'),
    '~': path.resolve('.'),
  },
  dts: true,
  exports: true,
  external: ['@llamaindex/liteparse', '@napi-rs/system-ocr'],
  publint: true,
  copy: ['schemas', 'assets'],
  plugins: [
    ApiSnapshot({
      // TODO: remove this when the library is stable to guard against breaking changes
      update: !process.env.CI,
    }),
  ],
})
