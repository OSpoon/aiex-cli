import { Buffer } from 'node:buffer'
import * as XLSX from 'xlsx'

export interface ExportColumnInfo {
  name: string
  type?: string
}

export function formatRowsConformingToSchema(
  rows: any[],
  columns: ExportColumnInfo[],
  schema: any,
  format: 'csv' | 'xlsx',
): any[] {
  return rows.map((row: any) => {
    const newRow: Record<string, any> = {}
    columns.forEach((col) => {
      const colName = col.name
      const val = row[colName]

      // Look up schema type
      const prop = schema?.properties?.[colName]
      const type = prop?.type || ''

      if (val === null || val === undefined) {
        newRow[colName] = ''
      }
      else if (type === 'boolean') {
        // SQLite stores booleans as 0 or 1
        if (format === 'xlsx') {
          newRow[colName] = val === 1 || val === '1' || val === true
        }
        else {
          newRow[colName] = (val === 1 || val === '1' || val === true) ? 'true' : 'false'
        }
      }
      else if (type === 'number' || type === 'integer') {
        if (val === '') {
          newRow[colName] = ''
        }
        else {
          const num = Number(val)
          newRow[colName] = Number.isNaN(num) ? val : num
        }
      }
      else if (typeof val === 'object') {
        newRow[colName] = JSON.stringify(val)
      }
      else {
        // If SQLite type info implies numeric, ensure it's exported as number in XLSX
        const dbType = (col.type || '').toLowerCase()
        const isNumericDb = dbType.includes('int') || dbType.includes('real') || dbType.includes('num') || dbType.includes('double') || dbType.includes('float')
        if (isNumericDb && typeof val === 'string' && val !== '') {
          const num = Number(val)
          newRow[colName] = Number.isNaN(num) ? val : num
        }
        else {
          newRow[colName] = val
        }
      }
    })
    return newRow
  })
}

export function generateExportBuffer(
  tableName: string,
  formattedRows: any[],
  columns: ExportColumnInfo[],
  format: 'csv' | 'xlsx',
): Buffer {
  const ws = XLSX.utils.json_to_sheet(formattedRows, { header: columns.map(col => col.name) })

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tableName.slice(0, 31)) // Sheet name max 31 chars
    const wopts: XLSX.WritingOptions = { bookType: 'xlsx', type: 'buffer' }
    return XLSX.write(wb, wopts) as Buffer
  }
  else {
    const csv = XLSX.utils.sheet_to_csv(ws)
    const bom = '\uFEFF'
    return Buffer.from(bom + csv, 'utf8')
  }
}
