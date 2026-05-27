import { describe, expect, it, vi } from 'vitest'
import { parseAllSchemas } from '@/core/schema-sqlite/helpers'

vi.mock('@/core/schema-sqlite/generator', () => ({
  generateDrizzleSchema: vi.fn(() => '-- mock drizzle schema code'),
}))

describe('schema helpers', () => {
  describe('parseAllSchemas', () => {
    it('should parse a single valid schema entry', () => {
      const entries = [{
        filePath: '/schemas/user.json',
        content: JSON.stringify({
          title: 'User',
          type: 'object',
          table: { name: 'users' },
          properties: {
            id: { type: 'integer', primary: true },
            name: { type: 'string' },
          },
        }),
      }]

      const result = parseAllSchemas(entries)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toHaveLength(1)
        expect(result.data.tables[0].name).toBe('users')
        expect(result.data.warnings).toEqual([])
      }
    })

    it('should parse multiple schema entries', () => {
      const entries = [
        {
          filePath: '/schemas/user.json',
          content: JSON.stringify({
            title: 'User',
            type: 'object',
            table: { name: 'users' },
            properties: { id: { type: 'integer', primary: true }, name: { type: 'string' } },
          }),
        },
        {
          filePath: '/schemas/product.json',
          content: JSON.stringify({
            title: 'Product',
            type: 'object',
            table: { name: 'products' },
            properties: { id: { type: 'integer', primary: true }, title: { type: 'string' } },
          }),
        },
      ]

      const result = parseAllSchemas(entries)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toHaveLength(2)
      }
    })

    it('should return error for invalid JSON', () => {
      const entries = [{
        filePath: '/schemas/bad.json',
        content: 'not valid json',
      }]

      const result = parseAllSchemas(entries)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Failed to parse JSON')
        expect(result.error).toContain('bad.json')
      }
    })

    it('should return error for invalid schema (Zod validation)', () => {
      const entries = [{
        filePath: '/schemas/invalid.json',
        content: JSON.stringify({
          title: 'Bad',
          type: 'object',
          table: { name: 'bad' },
          properties: {},
        }),
      }]

      const result = parseAllSchemas(entries)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('invalid.json')
      }
    })

    it('should fail fast on first invalid entry', () => {
      const entries = [
        {
          filePath: '/schemas/good.json',
          content: JSON.stringify({
            title: 'Good',
            type: 'object',
            table: { name: 'good' },
            properties: { id: { type: 'integer', primary: true } },
          }),
        },
        {
          filePath: '/schemas/bad.json',
          content: 'not json',
        },
      ]

      const result = parseAllSchemas(entries)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('bad.json')
      }
    })
  })

  describe('getErrorMessage', () => {
    it('should extract message from Error objects', async () => {
      const { getErrorMessage } = await import('@/core/schema-sqlite/helpers')
      expect(getErrorMessage(new Error('test error'))).toBe('test error')
    })

    it('should stringify non-Error values', async () => {
      const { getErrorMessage } = await import('@/core/schema-sqlite/helpers')
      expect(getErrorMessage('string error')).toBe('string error')
      expect(getErrorMessage(42)).toBe('42')
    })
  })

  describe('resolveTsxPath', () => {
    it('should resolve tsx path', async () => {
      const { resolveTsxPath } = await import('@/core/schema-sqlite/helpers')
      const resolved = resolveTsxPath()
      expect(resolved).toBeTruthy()
      expect(resolved.endsWith('.mjs') || resolved.endsWith('.cjs') || resolved.endsWith('.js') || resolved.endsWith('.ts')).toBe(true)
    })
  })

  describe('resolveHelperPath', () => {
    it('should resolve helper path', async () => {
      const { resolveHelperPath } = await import('@/core/schema-sqlite/helpers')
      const resolved = resolveHelperPath()
      expect(resolved).toBeTruthy()
      expect(resolved).toContain('migrate-helper.ts')
    })
  })
})
