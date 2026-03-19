import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TablePageCache } from '../useQueryResultCache'
import type { QueryResult } from '@/types/database'

function makeResult(rows: unknown[][] = [[1, 'a']]): QueryResult {
  return {
    columns: [
      { name: 'id', dataType: 'int', nullable: false },
      { name: 'name', dataType: 'varchar', nullable: true },
    ],
    rows,
    executionTimeMs: 5,
    affectedRows: 0,
    isError: false,
    totalCount: 100,
    truncated: false,
  }
}

describe('TablePageCache', () => {
  let cache: TablePageCache

  beforeEach(() => {
    cache = new TablePageCache()
  })

  it('缓存未命中时返回 undefined', () => {
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()
  })

  it('写入后能命中缓存', () => {
    const result = makeResult()
    cache.set('db', 'users', 1, 200, result)
    expect(cache.get('db', 'users', 1, 200)).toBe(result)
  })

  it('不同页码互不干扰', () => {
    const page1 = makeResult([[1, 'a']])
    const page2 = makeResult([[2, 'b']])
    cache.set('db', 'users', 1, 200, page1)
    cache.set('db', 'users', 2, 200, page2)
    expect(cache.get('db', 'users', 1, 200)).toBe(page1)
    expect(cache.get('db', 'users', 2, 200)).toBe(page2)
  })

  it('WHERE/ORDER BY 不同时缓存不命中', () => {
    const result = makeResult()
    cache.set('db', 'users', 1, 200, result, 'id > 10')
    // 无 where 条件时不命中
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()
    // 相同 where 条件命中
    expect(cache.get('db', 'users', 1, 200, 'id > 10')).toBe(result)
  })

  it('参数变化时自动清除旧缓存', () => {
    const old = makeResult([[1, 'old']])
    cache.set('db', 'users', 1, 200, old)
    expect(cache.size).toBe(1)

    // 切换表名，fingerprint 变化
    const newer = makeResult([[2, 'new']])
    cache.set('db', 'orders', 1, 200, newer)
    // 旧缓存已清除
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()
    expect(cache.get('db', 'orders', 1, 200)).toBe(newer)
  })

  it('clear() 清空所有缓存', () => {
    cache.set('db', 'users', 1, 200, makeResult())
    cache.set('db', 'users', 2, 200, makeResult())
    expect(cache.size).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()
  })

  it('超过 10 页时淘汰最早的缓存', () => {
    for (let i = 1; i <= 11; i++) {
      cache.set('db', 'users', i, 200, makeResult([[i, `row${i}`]])
      )
    }
    // 第 1 页被淘汰
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()
    // 第 2-11 页仍在
    expect(cache.get('db', 'users', 2, 200)).toBeDefined()
    expect(cache.get('db', 'users', 11, 200)).toBeDefined()
    expect(cache.size).toBe(10)
  })

  it('过期缓存返回 undefined', () => {
    const result = makeResult()
    cache.set('db', 'users', 1, 200, result)

    // 模拟时间流逝 61 秒
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    expect(cache.get('db', 'users', 1, 200)).toBeUndefined()

    vi.restoreAllMocks()
  })
})
