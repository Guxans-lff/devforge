import type { QueryResult } from '@/types/database'
import { fetchPrimaryKeys } from '@/composables/usePrimaryKey'

const INTEGER_TYPE_RE = /\b(?:tinyint|smallint|mediumint|int|integer|bigint|serial|bigserial|smallserial)\b/i

export interface TableSeekState {
  seekOrderBy?: string
  seekColumn?: string
  seekValue?: number
}

export interface ResolvedTableSeekState extends TableSeekState {
  effectiveOrderBy?: string
}

export function extractNumericCursorValue(rows: unknown[][], columns: QueryResult['columns'], seekColumn?: string): number | undefined {
  if (!seekColumn || rows.length === 0) return undefined
  const columnIndex = columns.findIndex(column => column.name === seekColumn)
  if (columnIndex < 0) return undefined

  const lastRow = rows[rows.length - 1]
  if (!lastRow) return undefined
  const rawValue = lastRow[columnIndex]
  if (typeof rawValue === 'number' && Number.isSafeInteger(rawValue)) return rawValue
  if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    const parsed = Number(rawValue)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return undefined
}

export function isIntegerResultColumn(columnName: string | undefined, queryResult: QueryResult): boolean {
  if (!columnName) return false
  const dataType = queryResult.columns.find(column => column.name === columnName)?.dataType ?? ''
  return INTEGER_TYPE_RE.test(dataType)
}

export function resolveTableSeekAfterFirstPage(
  queryResult: QueryResult,
  seekColumn?: string,
): TableSeekState {
  if (!isIntegerResultColumn(seekColumn, queryResult)) return {}
  const seekValue = extractNumericCursorValue(queryResult.rows, queryResult.columns, seekColumn)
  if (seekValue === undefined) return {}
  return {
    seekOrderBy: `${seekColumn} ASC`,
    seekColumn,
    seekValue,
  }
}

export async function resolveInitialTableSeek(
  connectionId: string,
  database: string,
  table: string,
  orderBy?: string | null,
): Promise<ResolvedTableSeekState> {
  const userOrderBy = orderBy?.trim()
  if (userOrderBy) return { effectiveOrderBy: userOrderBy }

  const primaryKeys = await fetchPrimaryKeys(connectionId, database, table)
  if (primaryKeys.length !== 1) return {}

  const seekColumn = primaryKeys[0]
  return {
    effectiveOrderBy: `${seekColumn} ASC`,
    seekOrderBy: `${seekColumn} ASC`,
    seekColumn,
  }
}
