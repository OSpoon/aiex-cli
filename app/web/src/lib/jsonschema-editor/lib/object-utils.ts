import { dequal } from "dequal"
import { toRaw } from "vue"

export function cloneJson<T>(value: T): T {
  const raw = toRaw(value)
  try {
    return structuredClone(raw)
  } catch {
    return JSON.parse(JSON.stringify(raw)) as T
  }
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
  return dequal(a, b)
}
