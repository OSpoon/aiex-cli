import { vi } from 'vitest'

const silentLogger = {
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  ready: vi.fn(),
  start: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}

vi.mock('consola', () => ({
  consola: silentLogger,
}))
