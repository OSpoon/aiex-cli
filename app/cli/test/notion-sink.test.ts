import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectNotionDatabase, parseNotionDatabaseId, writeNotionPage } from '@/infrastructure/integrations/notion-sink'

const notionMock = vi.hoisted(() => ({
  databasesRetrieve: vi.fn(),
  dataSourcesRetrieve: vi.fn(),
  pagesCreate: vi.fn(),
}))

vi.mock('@notionhq/client', () => {
  function formatUuid(compactId: string): string {
    const clean = compactId.toLowerCase()
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`
  }

  function extractNotionId(urlOrId: string): string | null {
    const trimmed = urlOrId.trim()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed))
      return trimmed.toLowerCase()
    if (/^[0-9a-f]{32}$/i.test(trimmed))
      return formatUuid(trimmed)

    const pathMatch = trimmed.match(/\/[^/?#]*-([0-9a-f]{32})(?:[/?#]|$)/i)
    if (pathMatch?.[1])
      return formatUuid(pathMatch[1])

    const queryMatch = trimmed.match(/[?&](?:p|page_id|database_id)=([0-9a-f]{32})/i)
    if (queryMatch?.[1])
      return formatUuid(queryMatch[1])

    const anyMatch = trimmed.match(/([0-9a-f]{32})/i)
    return anyMatch?.[1] ? formatUuid(anyMatch[1]) : null
  }

  return {
    extractNotionId,
    Client: vi.fn(class {
      databases = { retrieve: notionMock.databasesRetrieve }
      dataSources = { retrieve: notionMock.dataSourcesRetrieve }
      pages = { create: notionMock.pagesCreate }
    }),
  }
})

describe('notion sink', () => {
  beforeEach(() => {
    notionMock.databasesRetrieve.mockReset()
    notionMock.dataSourcesRetrieve.mockReset()
    notionMock.pagesCreate.mockReset()
  })

  it('parses Notion URLs by preferring the page path ID over the view query ID', () => {
    const id = parseNotionDatabaseId('https://www.notion.so/ospoon/AIEX-Test-366206f7418180eda145c03fa9f219bc?v=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    expect(id).toBe('366206f7-4181-80ed-a145-c03fa9f219bc')
  })

  it('inspects a database container by resolving its first data source', async () => {
    notionMock.dataSourcesRetrieve
      .mockRejectedValueOnce(new Error('not a data source'))
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: {
          name: { type: 'title' },
          totalScore: { type: 'number' },
        },
      })
    notionMock.databasesRetrieve.mockResolvedValueOnce({
      object: 'database',
      id: 'database-1',
      data_sources: [{ id: 'source-1', name: 'AIEX Notion Test' }],
    })

    const result = await inspectNotionDatabase({
      token: 'token',
      databaseId: 'database-1',
      schemaFields: [{ name: 'name' }, { name: 'totalScore' }],
    })

    expect(notionMock.databasesRetrieve).toHaveBeenCalledWith({ database_id: 'database-1' })
    expect(notionMock.dataSourcesRetrieve).toHaveBeenLastCalledWith({ data_source_id: 'source-1' })
    expect(result).toMatchObject({
      databaseId: 'database-1',
      dataSourceId: 'source-1',
      titleProperty: 'name',
      suggestedFieldMap: {
        name: 'name',
        totalScore: 'totalScore',
      },
    })
  })

  it('ignores legacy database properties and requires a data source reference', async () => {
    notionMock.dataSourcesRetrieve.mockRejectedValueOnce(new Error('not a data source'))
    notionMock.databasesRetrieve.mockResolvedValueOnce({
      object: 'database',
      id: 'legacy-database',
      properties: {
        name: { type: 'title' },
      },
    })

    await expect(inspectNotionDatabase({
      token: 'token',
      databaseId: 'legacy-database',
      schemaFields: [{ name: 'name' }],
    })).rejects.toThrow('No data source found')

    expect(notionMock.pagesCreate).not.toHaveBeenCalled()
  })

  it('writes extracted top-level fields to a resolved data source', async () => {
    notionMock.dataSourcesRetrieve
      .mockRejectedValueOnce(new Error('not a data source'))
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: {
          name: { type: 'title' },
          totalScore: { type: 'number' },
          printDate: { type: 'date' },
        },
      })
    notionMock.databasesRetrieve.mockResolvedValueOnce({
      object: 'database',
      id: 'database-1',
      data_sources: [{ id: 'source-1', name: 'AIEX Notion Test' }],
    })
    notionMock.pagesCreate.mockResolvedValueOnce({ id: 'page-1' })

    const result = await writeNotionPage({
      enabled: true,
      token: 'token',
      schemas: {
        score_report: {
          databaseId: 'database-1',
          fieldMap: {
            name: 'name',
            totalScore: 'totalScore',
            printDate: 'printDate',
          },
        },
      },
    }, 'score_report', {
      name: 'Alice',
      totalScore: '680',
      printDate: '2026-05-20',
      nested: { ignored: true },
    })

    expect(notionMock.pagesCreate).toHaveBeenCalledWith({
      parent: { data_source_id: 'source-1' },
      properties: {
        name: { title: [{ text: { content: 'Alice' } }] },
        totalScore: { number: 680 },
        printDate: { date: { start: '2026-05-20T00:00:00.000Z' } },
      },
    })
    expect(result).toEqual({
      pageId: 'page-1',
      databaseId: 'database-1',
      dataSourceId: 'source-1',
    })
  })

  it('uses the schema name as the title fallback when the title property is not mapped', async () => {
    notionMock.dataSourcesRetrieve
      .mockRejectedValueOnce(new Error('not a data source'))
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: {
          名称: { type: 'title' },
          reportNumber: { type: 'rich_text' },
        },
      })
    notionMock.databasesRetrieve.mockResolvedValueOnce({
      object: 'database',
      id: 'database-1',
      data_sources: [{ id: 'source-1', name: 'AIEX Notion Test' }],
    })
    notionMock.pagesCreate.mockResolvedValueOnce({ id: 'page-1' })

    await writeNotionPage({
      enabled: true,
      token: 'token',
      schemas: {
        score_report: {
          databaseId: 'database-1',
          fieldMap: {
            name: 'name',
            reportNumber: 'reportNumber',
          },
        },
      },
    }, 'score_report', {
      name: 'Alice',
      reportNumber: '500000500',
    })

    expect(notionMock.pagesCreate).toHaveBeenCalledWith({
      parent: { data_source_id: 'source-1' },
      properties: {
        名称: { title: [{ text: { content: 'score_report' } }] },
        reportNumber: { rich_text: [{ text: { content: '500000500' } }] },
      },
    })
  })

  it('writes nested object fields through dot-path field mappings', async () => {
    notionMock.dataSourcesRetrieve
      .mockRejectedValueOnce(new Error('not a data source'))
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: {
          名称: { type: 'title' },
          studentName: { type: 'rich_text' },
          chinese: { type: 'number' },
        },
      })
    notionMock.databasesRetrieve.mockResolvedValueOnce({
      object: 'database',
      id: 'database-1',
      data_sources: [{ id: 'source-1', name: 'AIEX Notion Test' }],
    })
    notionMock.pagesCreate.mockResolvedValueOnce({ id: 'page-1' })

    await writeNotionPage({
      enabled: true,
      token: 'token',
      schemas: {
        score_report: {
          databaseId: 'database-1',
          fieldMap: {
            'student.name': 'studentName',
            'scores.chinese': 'chinese',
          },
        },
      },
    }, 'score_report', {
      student: { name: 'Alice' },
      scores: { chinese: '132' },
    })

    expect(notionMock.pagesCreate).toHaveBeenCalledWith({
      parent: { data_source_id: 'source-1' },
      properties: {
        名称: { title: [{ text: { content: 'score_report' } }] },
        studentName: { rich_text: [{ text: { content: 'Alice' } }] },
        chinese: { number: 132 },
      },
    })
  })
})
