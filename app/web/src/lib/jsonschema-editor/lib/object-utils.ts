import { dequal } from 'dequal'

export function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
  return dequal(a, b)
}

