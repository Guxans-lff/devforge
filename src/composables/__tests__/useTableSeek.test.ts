import { describe, expect, it } from 'vitest'

import {
  extractNumericCursorValue,
  isIntegerResultColumn,
  resolveTableSeekAfterFirstPage,
} from '@/composables/useTableSeek'
import type { QueryResult } from '@/types/database'

function makeResult(dataType: string, rows: unknown[][] = [[1], [2]]): QueryResult {
  return {
    columns: [{ name: 'id', dataType, nullable: false }],
    rows,
    affectedRows: 0,
    executionTimeMs: 1,
    isError: false,
    error: null,
    totalCount: rows.length,
    truncated: false,
  }
}

describe('useTableSeek', () => {
  it('extracts only safe integer cursor values', () => {
    expect(extractNumericCursorValue([[1], ['2']], makeResult('INT').columns, 'id')).toBe(2)
    expect(extractNumericCursorValue([[1.5]], makeResult('INT', [[1.5]]).columns, 'id')).toBeUndefined()
    expect(extractNumericCursorValue([['9007199254740993']], makeResult('BIGINT', [['9007199254740993']]).columns, 'id')).toBeUndefined()
  })

  it('allows integer result columns but rejects decimal cursors for keyset pagination', () => {
    expect(isIntegerResultColumn('id', makeResult('BIGINT'))).toBe(true)
    expect(isIntegerResultColumn('id', makeResult('SERIAL'))).toBe(true)
    expect(isIntegerResultColumn('id', makeResult('DECIMAL'))).toBe(false)
    expect(isIntegerResultColumn('id', makeResult('DOUBLE'))).toBe(false)
  })

  it('resolves seek state only after the first page confirms an integer cursor', () => {
    expect(resolveTableSeekAfterFirstPage(makeResult('INT', [[1], [2]]), 'id')).toEqual({
      seekOrderBy: 'id ASC',
      seekColumn: 'id',
      seekValue: 2,
    })
    expect(resolveTableSeekAfterFirstPage(makeResult('VARCHAR', [['a']]), 'id')).toEqual({})
  })
})
