import type { NotionConfig } from '@/core/ai-extraction'
import { Client, extractNotionId } from '@notionhq/client'

export interface NotionWriteResult {
  pageId: string
  databaseId: string
  dataSourceId?: string
}

export interface NotionSchemaField {
  name: string
  title?: string
  description?: string
}

export interface NotionDatabaseProperty {
  name: string
  type: string
}

export interface NotionDatabaseInfo {
  databaseId: string
  dataSourceId?: string
  titleProperty?: string
  properties: NotionDatabaseProperty[]
  suggestedFieldMap: Record<string, string>
}

interface NotionPropertyObject {
  type: string
  [key: string]: unknown
}

interface NotionDataSourceResponse {
  id: string
  properties: Record<string, NotionPropertyObject>
  parent?: { database_id?: string }
}

interface NotionDatabaseResponse {
  id: string
  data_sources?: Array<{ id: string }>
}

const RICH_TEXT_LIMIT = 2000
const UUID_RE = /^[0-9a-f]{32}$/i
const HYPHENATED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ResolvedNotionDataSource {
  databaseId: string
  dataSourceId?: string
  properties: Record<string, NotionPropertyObject>
  parent: { database_id: string } | { data_source_id: string }
}

function truncateText(value: string): string {
  return value.length > RICH_TEXT_LIMIT ? value.slice(0, RICH_TEXT_LIMIT) : value
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean')
    return value
  if (typeof value === 'number')
    return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return ['true', 'yes', '1', 'y'].includes(normalized)
  }
  return !!value
}

function asDateStart(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value)
    if (Number.isNaN(ms))
      return null
    return new Date(ms).toISOString()
  }
  return null
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => stringifyValue(item).trim())
      .filter(Boolean)
  }
  const text = stringifyValue(value).trim()
  return text ? [text] : []
}

function getValueAtPath(data: Record<string, unknown>, path: string): { found: boolean, value: unknown } {
  if (!path.includes('.'))
    return Object.hasOwn(data, path) ? { found: true, value: data[path] } : { found: false, value: undefined }

  let current: unknown = data
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      return { found: false, value: undefined }
    const record = current as Record<string, unknown>
    if (!Object.hasOwn(record, part))
      return { found: false, value: undefined }
    current = record[part]
  }
  return { found: true, value: current }
}

interface NotionPropertyValueInput {
  title?: Array<{ text: { content: string } }>
  rich_text?: Array<{ text: { content: string } }>
  number?: number | null
  checkbox?: boolean
  date?: { start: string } | null
  select?: { name: string } | null
  multi_select?: Array<{ name: string }>
  url?: string | null
  email?: string | null
  phone_number?: string | null
}

function buildPropertyValue(type: string, value: unknown): NotionPropertyValueInput | null {
  const text = truncateText(stringifyValue(value))

  switch (type) {
    case 'title':
      return { title: text ? [{ text: { content: text } }] : [] }
    case 'rich_text':
      return { rich_text: text ? [{ text: { content: text } }] : [] }
    case 'number':
      return { number: asNumber(value) }
    case 'checkbox':
      return { checkbox: asBoolean(value) }
    case 'date': {
      const start = asDateStart(value)
      return { date: start ? { start } : null }
    }
    case 'select': {
      const name = stringifyValue(value).trim()
      return { select: name ? { name } : null }
    }
    case 'multi_select':
      return { multi_select: asStringArray(value).map(name => ({ name })) }
    case 'url':
      return { url: text || null }
    case 'email':
      return { email: text || null }
    case 'phone_number':
      return { phone_number: text || null }
    default:
      return null
  }
}

function findTitleProperty(properties: Record<string, NotionPropertyObject>, preferred?: string): string | null {
  if (preferred && properties[preferred]?.type === 'title')
    return preferred

  return Object.entries(properties).find(([, property]) => property?.type === 'title')?.[0] ?? null
}

function hyphenateDatabaseId(value: string): string {
  const id = value.replace(/-/g, '')
  if (!UUID_RE.test(id))
    return value
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

export function parseNotionDatabaseId(value: string): string {
  const input = value.trim()
  if (!input)
    return ''
  const extracted = extractNotionId(input)
  if (extracted)
    return extracted
  if (HYPHENATED_UUID_RE.test(input))
    return input
  if (UUID_RE.test(input))
    return hyphenateDatabaseId(input)
  return input
}

function normalizeFieldName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function buildMatchKeys(field: NotionSchemaField): string[] {
  return [field.name, field.title, field.description]
    .filter((value): value is string => !!value?.trim())
    .map(normalizeFieldName)
    .filter(Boolean)
}

function suggestFieldMap(
  schemaFields: NotionSchemaField[],
  databaseProperties: Record<string, NotionPropertyObject>,
): Record<string, string> {
  const propertyByKey = new Map<string, string>()
  for (const propertyName of Object.keys(databaseProperties)) {
    propertyByKey.set(normalizeFieldName(propertyName), propertyName)
  }

  const fieldMap: Record<string, string> = {}
  for (const field of schemaFields) {
    for (const key of buildMatchKeys(field)) {
      const propertyName = propertyByKey.get(key)
      if (propertyName) {
        fieldMap[field.name] = propertyName
        break
      }
    }
  }
  return fieldMap
}

function isDataSourceResponse(value: unknown): value is NotionDataSourceResponse {
  return !!value
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).properties === 'object'
    && !Array.isArray(value)
}

function firstDataSourceId(database: NotionDatabaseResponse): string | undefined {
  return database.data_sources?.find(source => typeof source.id === 'string' && source.id.trim())?.id
}

async function resolveNotionDataSource(
  notion: Client,
  inputId: string,
): Promise<ResolvedNotionDataSource> {
  const id = parseNotionDatabaseId(inputId)
  if (!id)
    throw new Error('Notion database or data source URL/ID is required.')

  try {
    const dataSource = await notion.dataSources.retrieve({ data_source_id: id })
    if (isDataSourceResponse(dataSource)) {
      const parentDatabaseId = typeof dataSource.parent?.database_id === 'string'
        ? dataSource.parent.database_id
        : id
      return {
        databaseId: parentDatabaseId,
        dataSourceId: dataSource.id,
        properties: dataSource.properties,
        parent: { data_source_id: dataSource.id },
      }
    }
  }
  catch {
    // Fall through and try the ID as a database container for Notion's data source model.
  }

  const database = await notion.databases.retrieve({ database_id: id })
  const dataSourceId = firstDataSourceId(database)
  if (!dataSourceId) {
    throw new Error('No data source found for this Notion database. Copy the data source link from Notion, or share the source database with the integration.')
  }

  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId })
  if (!isDataSourceResponse(dataSource)) {
    throw new Error('Notion data source did not return properties. Make sure it is shared with the integration and is not a linked data source.')
  }

  return {
    databaseId: database.id,
    dataSourceId: dataSource.id,
    properties: dataSource.properties,
    parent: { data_source_id: dataSource.id },
  }
}

export async function inspectNotionDatabase(input: {
  token: string
  databaseId: string
  schemaFields: NotionSchemaField[]
}): Promise<NotionDatabaseInfo> {
  if (!input.token.trim())
    throw new Error('Notion integration token is required.')

  const id = parseNotionDatabaseId(input.databaseId)
  if (!id)
    throw new Error('Notion database or data source URL/ID is required.')

  const notion = new Client({ auth: input.token })
  const resolved = await resolveNotionDataSource(notion, id)
  const databaseProperties = resolved.properties
  const titleProperty = findTitleProperty(databaseProperties) ?? undefined

  return {
    databaseId: resolved.databaseId,
    dataSourceId: resolved.dataSourceId,
    titleProperty,
    properties: Object.entries(databaseProperties)
      .map(([name, property]) => ({ name, type: property?.type ?? 'unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    suggestedFieldMap: suggestFieldMap(input.schemaFields, databaseProperties),
  }
}

export function validateNotionConfig(config: NotionConfig | undefined): string | null {
  if (!config?.enabled)
    return 'Notion export is not enabled. Configure Notion settings first.'
  if (!config.token.trim())
    return 'Notion integration token is required.'
  return null
}

export async function writeNotionPage(
  config: NotionConfig | undefined,
  schemaName: string,
  data: Record<string, unknown>,
): Promise<NotionWriteResult> {
  const configError = validateNotionConfig(config)
  if (configError)
    throw new Error(configError)

  const notionConfig = config as NotionConfig
  const schemaConfig = notionConfig.schemas[schemaName]
  if (!schemaConfig)
    throw new Error(`Notion database is not configured for schema "${schemaName}".`)
  if (!schemaConfig.databaseId.trim())
    throw new Error(`Notion database ID is required for schema "${schemaName}".`)

  const notion = new Client({ auth: notionConfig.token })
  const resolved = await resolveNotionDataSource(notion, schemaConfig.databaseId)
  const databaseProperties = resolved.properties
  const fieldMap = schemaConfig.fieldMap ?? {}
  const properties: Record<string, NotionPropertyValueInput> = {}
  const sourceFields = new Set([...Object.keys(data), ...Object.keys(fieldMap)])

  for (const sourceField of sourceFields) {
    const source = getValueAtPath(data, sourceField)
    if (!source.found)
      continue

    const notionPropertyName = fieldMap[sourceField] ?? sourceField
    const notionProperty = databaseProperties[notionPropertyName]
    if (!notionProperty)
      continue

    const propertyValue = buildPropertyValue(notionProperty.type, source.value)
    if (propertyValue)
      properties[notionPropertyName] = propertyValue
  }

  const titleProperty = findTitleProperty(databaseProperties, schemaConfig.titleProperty)
  if (titleProperty && !properties[titleProperty]) {
    properties[titleProperty] = buildPropertyValue('title', schemaName)!
  }

  if (Object.keys(properties).length === 0)
    throw new Error('No extracted fields matched Notion database properties.')

  const page = await notion.pages.create({
    parent: resolved.parent,
    properties: properties as any,
  })

  return {
    pageId: page.id,
    databaseId: resolved.databaseId,
    dataSourceId: resolved.dataSourceId,
  }
}
