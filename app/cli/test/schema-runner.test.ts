import { describe, expect, it } from 'vitest'
import { parseMigrationOutput } from '@/core/schema-runner'

describe('schema-runner', () => {
  describe('parseMigrationOutput', () => {
    it('parses valid JSON migration result from stdout', () => {
      const stdout = 'line1\n{"success":true,"changes":3,"tag":"m001_person"}\nline3'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(true)
      expect(result.changes).toBe(3)
      expect(result.tag).toBe('m001_person')
    })

    it('parses failed migration result', () => {
      const stdout = '{"success":false,"error":"Table already exists"}'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Table already exists')
    })

    it('returns error when no JSON line is found', () => {
      const stdout = 'Just some output\nNo JSON here'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Migration helper did not return valid output')
    })

    it('falls back to stderr when JSON parsing fails', () => {
      const stdout = '{invalid json}'
      const stderr = 'Error: migration failed\n  at line 42'
      const result = parseMigrationOutput(stdout, stderr)
      expect(result.success).toBe(false)
      expect(result.error).toBe(stderr)
    })

    it('falls back to stdout when JSON parsing fails and stderr is empty', () => {
      const stdout = '{also invalid}'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe(stdout)
    })
  })
})
