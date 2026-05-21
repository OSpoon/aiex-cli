import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openBrowser, resolveWebStaticDir } from '@/core/web-runner'

vi.mock('@/core/schema-sqlite', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original as any,
    resolvePackageRoot: vi.fn(() => '/mock/package/root'),
  }
})

vi.mock('open', () => ({
  default: vi.fn(() => Promise.resolve()),
}))

describe('web-runner', () => {
  describe('resolveWebStaticDir', () => {
    it('returns static dir under dist/web', () => {
      const result = resolveWebStaticDir()
      expect(result).toBe(path.join('/mock/package/root', 'dist/web'))
    })
  })

  describe('openBrowser', () => {
    it('calls open with the given url', async () => {
      const openMock = (await import('open')).default as any
      await openBrowser('http://localhost:3000')
      expect(openMock).toHaveBeenCalledWith('http://localhost:3000')
    })
  })

  describe('startWebServer integration', () => {
    it('resolveWebStaticDir returns a non-empty path', () => {
      expect(resolveWebStaticDir().length).toBeGreaterThan(0)
      expect(resolveWebStaticDir()).toContain(path.join('dist', 'web'))
    })
  })
})
