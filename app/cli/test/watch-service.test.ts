import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFileHash, WatchRegistry } from '@/core/watch-service'

describe('watchService utils and registry', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = path.join('/tmp', `aiex-watch-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true })
  })

  it('getFileHash computes SHA-256 correctly', async () => {
    const filePath = path.join(tempDir, 'test.txt')
    await fsp.writeFile(filePath, 'hello world', 'utf-8')

    const hash = await getFileHash(filePath)
    // SHA-256 for 'hello world' is b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('watchRegistry handles saving and loading status', async () => {
    const registry = new WatchRegistry(tempDir)

    // Initially status should be null
    let status = await registry.getStatus('hash123')
    expect(status).toBeNull()

    // Mark as succeeded
    await registry.markSucceeded('hash123', '/path/to/file.txt')
    status = await registry.getStatus('hash123')
    expect(status).toBe('succeeded')

    // Mark as failed
    await registry.markFailed('hash456', '/path/to/another.txt', 'error message')
    status = await registry.getStatus('hash456')
    expect(status).toBe('failed')

    // Read details from registry file directly
    const registryFile = path.join(tempDir, 'watch-registry.json')
    const fileExists = fs.existsSync(registryFile)
    expect(fileExists).toBe(true)

    const content = JSON.parse(await fsp.readFile(registryFile, 'utf-8'))
    expect(content.processed.hash123.status).toBe('succeeded')
    expect(content.processed.hash456.status).toBe('failed')
    expect(content.processed.hash456.error).toBe('error message')
  })
})
