import { describe, expect, it, vi } from 'vitest'
import { createConfig, seedConfig } from '@/config'

vi.mock('conf', () => {
  const MockConf = vi.fn(function MockConf(this: any, _opts: any) {
    this.store = {}
    this.path = '/mock/config/path'
    this.get = (key: string) => this.store[key]
    this.set = (key: string, value: any) => this.store[key] = value
    this.has = (key: string) => key in this.store
  })
  return { default: MockConf }
})

vi.mock('~/package.json', () => ({
  default: { name: 'aiex-cli', version: '0.0.0' },
}))

describe('config', () => {
  describe('createConfig', () => {
    it('should create a config instance', () => {
      process.env.CLI_CONFIG_DIR = '/tmp/test-config'
      const config = createConfig()
      expect(config).toBeDefined()
      delete process.env.CLI_CONFIG_DIR
    })
  })

  describe('seedConfig', () => {
    it('should seed config with name and version when not set', () => {
      const config = createConfig()
      expect(config.has('name')).toBe(false)
      expect(config.has('version')).toBe(false)

      seedConfig(config)

      expect(config.has('name')).toBe(true)
      expect(config.has('version')).toBe(true)
    })

    it('should not overwrite existing name and version', () => {
      const config = createConfig()
      config.set('name', 'custom-name')
      config.set('version', '1.0.0')

      seedConfig(config)

      expect(config.get('name')).toBe('custom-name')
      expect(config.get('version')).toBe('1.0.0')
    })
  })
})
