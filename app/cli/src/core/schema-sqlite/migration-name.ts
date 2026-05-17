export function sanitizeMigrationName(name?: string): string | undefined {
  if (!name)
    return undefined

  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '_')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return slug || undefined
}
