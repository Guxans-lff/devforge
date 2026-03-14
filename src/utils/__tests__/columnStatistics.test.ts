/**
 * columnStatistics 工具函数测试套件
 * 覆盖：数值统计、字符串统计、NULL 处理、混合类型、列类型辅助、边界情况、异步接口
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { computeColumnStats, computeColumnStatsAsync } from '../columnStatistics'

// ─────────────────────────────────────────────
// 辅助：把一列值包装成 rows（二维数组），colIndex 固定为 0
// ─────────────────────────────────────────────
function toRows(values: unknown[]): unknown[][] {
  return values.map((v) => [v])
}

// ═══════════════════════════════════════════════════════════════
// 1. 数值列 — typeof value === 'number' 时直接走数值统计
// ═══════════════════════════════════════════════════════════════
describe('数值列统计', () => {
  const rows = toRows([10, 20, 30, 40, 50])

  it('totalCount、nonNullCount、nullCount 正确', () => {
    const result = computeColumnStats(rows, 0)
    expect(result.basic.totalCount).toBe(5)
    expect(result.basic.nonNullCount).toBe(5)
    expect(result.basic.nullCount).toBe(0)
    expect(result.basic.nullPercent).toBe(0)
  })

  it('min / max / sum / avg 计算正确', () => {
    const result = computeColumnStats(rows, 0)
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.min).toBe(10)
    expect(result.numeric!.max).toBe(50)
    expect(result.numeric!.sum).toBe(150)
    expect(result.numeric!.avg).toBe(30)
  })

  it('字符串统计应为 null（数值列不走字符串分支）', () => {
    const result = computeColumnStats(rows, 0)
    expect(result.string).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. 奇数行 median — 取中间那个值
// ═══════════════════════════════════════════════════════════════
describe('奇数行 median', () => {
  it('5 个元素，median 应为第 3 个排序后的值', () => {
    // 排序后：[1, 3, 5, 7, 9]，中间索引 2 → 5
    const rows = toRows([9, 3, 5, 1, 7])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(5)
  })

  it('1 个元素，median 等于该值本身', () => {
    const rows = toRows([42])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(42)
  })

  it('3 个元素，median 为中间值', () => {
    const rows = toRows([100, 1, 50])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(50)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. 偶数行 median — 取中间两值平均
// ═══════════════════════════════════════════════════════════════
describe('偶数行 median', () => {
  it('4 个元素，median 为第 2、3 个排序值的平均', () => {
    // 排序后：[2, 4, 6, 8]，(4+6)/2 = 5
    const rows = toRows([8, 2, 6, 4])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(5)
  })

  it('2 个元素，median 为两值平均', () => {
    const rows = toRows([3, 7])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(5)
  })

  it('偶数行含负数，median 计算正确', () => {
    // 排序后：[-10, -2, 4, 8]，(-2+4)/2 = 1
    const rows = toRows([8, -10, 4, -2])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.median).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. 字符串列 — 非数值，应计算 minLength/maxLength/avgLength/emptyCount
// ═══════════════════════════════════════════════════════════════
describe('字符串列统计', () => {
  it('基础字符串：minLength / maxLength / avgLength / emptyCount', () => {
    // 'a'=1, 'bb'=2, 'ccc'=3 → min=1, max=3, avg=2, emptyCount=0
    const rows = toRows(['a', 'bb', 'ccc'])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric).toBeNull()
    expect(result.string).not.toBeNull()
    expect(result.string!.minLength).toBe(1)
    expect(result.string!.maxLength).toBe(3)
    expect(result.string!.avgLength).toBe(2)
    expect(result.string!.emptyCount).toBe(0)
  })

  it('含空字符串：emptyCount 正确计入', () => {
    const rows = toRows(['hello', '', 'world', ''])
    const result = computeColumnStats(rows, 0)
    expect(result.string!.emptyCount).toBe(2)
    expect(result.string!.minLength).toBe(0)
    expect(result.string!.maxLength).toBe(5)
  })

  it('uniqueCount 去重正确', () => {
    const rows = toRows(['apple', 'banana', 'apple', 'cherry'])
    const result = computeColumnStats(rows, 0)
    // 3 个唯一值：apple, banana, cherry
    expect(result.basic.uniqueCount).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. NULL 处理
// ═══════════════════════════════════════════════════════════════
describe('NULL 处理', () => {
  it('null 和 undefined 都计入 nullCount', () => {
    const rows: unknown[][] = [[null], [undefined], [1], [2]]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.nullCount).toBe(2)
    expect(result.basic.nonNullCount).toBe(2)
  })

  it('nullPercent 计算正确（2/4 = 50%）', () => {
    const rows: unknown[][] = [[null], [undefined], [1], [2]]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.nullPercent).toBe(50)
  })

  it('NULL 用 __NULL__ 标记计入 uniqueSet，uniqueCount 包含 NULL 占位', () => {
    // 2 个 null + 1 个 'hello' → uniqueCount = 2（__NULL__ + hello）
    const rows: unknown[][] = [[null], [null], ['hello']]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.uniqueCount).toBe(2)
  })

  it('多个 null 仍只占 uniqueSet 一个槽', () => {
    const rows: unknown[][] = [[null], [null], [null]]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.uniqueCount).toBe(1)
    expect(result.basic.nullCount).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. 混合类型 — 数值不足 80% 时走字符串统计
// ═══════════════════════════════════════════════════════════════
describe('混合类型（数值比例不足 80%）', () => {
  it('5 个非空值中只有 1 个 number（20%），应走字符串统计', () => {
    // 只有 42 是 number，其余是字符串（非数值型 colType）
    const rows = toRows([42, 'hello', 'world', 'foo', 'bar'])
    const result = computeColumnStats(rows, 0)
    // 数值提取到 1 个，1 < 5*0.8=4，不满足条件
    expect(result.numeric).toBeNull()
    expect(result.string).not.toBeNull()
  })

  it('5 个非空值中 4 个 number（80%），应走数值统计', () => {
    // 4 >= 5*0.8=4，刚好满足
    const rows = toRows([1, 2, 3, 4, 'not-a-number'])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric).not.toBeNull()
  })

  it('5 个非空值中 3 个 number（60%），应走字符串统计', () => {
    const rows = toRows([1, 2, 3, 'foo', 'bar'])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric).toBeNull()
    expect(result.string).not.toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. 列类型辅助 — colType 为数值型时字符串 '123' 也解析为数值
// ═══════════════════════════════════════════════════════════════
describe('列类型辅助（colType）', () => {
  it("colType='INT' 时字符串 '10','20','30' 都解析为数值", () => {
    const rows = toRows(['10', '20', '30'])
    const result = computeColumnStats(rows, 0, 'INT')
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.min).toBe(10)
    expect(result.numeric!.max).toBe(30)
    expect(result.numeric!.avg).toBe(20)
  })

  it("colType='FLOAT' 时浮点字符串正确解析", () => {
    const rows = toRows(['1.1', '2.2', '3.3'])
    const result = computeColumnStats(rows, 0, 'FLOAT')
    expect(result.numeric).not.toBeNull()
    // 平均值近似比较，避免浮点精度问题
    expect(result.numeric!.avg).toBeCloseTo(2.2, 5)
  })

  it("colType='DECIMAL' 时字符串数字走数值统计", () => {
    const rows = toRows(['100', '200', '300', '400'])
    const result = computeColumnStats(rows, 0, 'DECIMAL')
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.sum).toBe(1000)
  })

  it("colType='VARCHAR' 时字符串 '123' 不解析为数值", () => {
    // VARCHAR 不匹配数值型正则，走字符串统计
    const rows = toRows(['123', '456', '789'])
    const result = computeColumnStats(rows, 0, 'VARCHAR')
    expect(result.numeric).toBeNull()
    expect(result.string).not.toBeNull()
  })

  it('colType 大小写不敏感，int 小写也应匹配', () => {
    const rows = toRows(['5', '10', '15'])
    const result = computeColumnStats(rows, 0, 'int')
    expect(result.numeric).not.toBeNull()
  })

  it("colType='MONEY' 也属于数值型", () => {
    const rows = toRows(['99', '199', '299'])
    const result = computeColumnStats(rows, 0, 'MONEY')
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.max).toBe(299)
  })
})

// ═══════════════════════════════════════════════════════════════
// 8. 空行数组
// ═══════════════════════════════════════════════════════════════
describe('空行数组边界', () => {
  it('rows 为空时 totalCount=0，nullPercent=0', () => {
    const result = computeColumnStats([], 0)
    expect(result.basic.totalCount).toBe(0)
    expect(result.basic.nullCount).toBe(0)
    expect(result.basic.nullPercent).toBe(0)
    expect(result.basic.uniqueCount).toBe(0)
    expect(result.basic.nonNullCount).toBe(0)
  })

  it('rows 为空时 numeric 和 string 都为 null', () => {
    const result = computeColumnStats([], 0)
    expect(result.numeric).toBeNull()
    expect(result.string).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. 全 NULL 列
// ═══════════════════════════════════════════════════════════════
describe('全 NULL 列', () => {
  it('nonNullCount=0，numeric 和 string 都为 null', () => {
    const rows: unknown[][] = [[null], [null], [null], [null]]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.nonNullCount).toBe(0)
    expect(result.basic.nullCount).toBe(4)
    expect(result.basic.nullPercent).toBe(100)
    expect(result.numeric).toBeNull()
    expect(result.string).toBeNull()
  })

  it('全 undefined 与全 null 表现一致', () => {
    const rows: unknown[][] = [[undefined], [undefined]]
    const result = computeColumnStats(rows, 0)
    expect(result.basic.nonNullCount).toBe(0)
    expect(result.numeric).toBeNull()
    expect(result.string).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. computeColumnStatsAsync 异步接口
// ═══════════════════════════════════════════════════════════════
describe('computeColumnStatsAsync', () => {
  it('小数据（<= threshold）：同步路径，返回正确结果', async () => {
    const rows = toRows([1, 2, 3, 4, 5])
    const result = await computeColumnStatsAsync(rows, 0)
    expect(result.basic.totalCount).toBe(5)
    expect(result.numeric!.sum).toBe(15)
  })

  it('小数据：返回值与 computeColumnStats 同步版完全一致', async () => {
    const rows = toRows([10, 20, 30])
    const sync = computeColumnStats(rows, 0)
    const async_ = await computeColumnStatsAsync(rows, 0)
    expect(async_).toEqual(sync)
  })

  it('大数据（> threshold）：异步路径，结果仍正确', async () => {
    // 构造 threshold+1 行触发异步分支（默认 threshold=50000）
    const size = 50001
    const values = Array.from({ length: size }, (_, i) => i + 1)
    const rows = toRows(values)
    const result = await computeColumnStatsAsync(rows, 0)
    expect(result.basic.totalCount).toBe(size)
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.min).toBe(1)
    expect(result.numeric!.max).toBe(size)
  }, 10000 /* 给大数据足够超时时间 */)

  it('自定义 threshold：rows.length === threshold 走同步路径', async () => {
    const rows = toRows([1, 2, 3])
    // threshold=3，rows.length=3 → 满足 <= 条件，同步返回
    const result = await computeColumnStatsAsync(rows, 0, undefined, 3)
    expect(result.basic.totalCount).toBe(3)
  })

  it('自定义 threshold：rows.length > threshold 走异步路径', async () => {
    const rows = toRows([1, 2, 3, 4])
    // threshold=3，rows.length=4 → 触发 setTimeout 分支
    const result = await computeColumnStatsAsync(rows, 0, undefined, 3)
    expect(result.basic.totalCount).toBe(4)
    expect(result.numeric!.sum).toBe(10)
  })

  it('colType 参数传透到异步版本', async () => {
    const rows = toRows(['100', '200', '300'])
    const result = await computeColumnStatsAsync(rows, 0, 'INT')
    expect(result.numeric).not.toBeNull()
    expect(result.numeric!.avg).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════
// 11. 额外边界用例
// ═══════════════════════════════════════════════════════════════
describe('额外边界用例', () => {
  it('NaN 和 Infinity 的 number 值不纳入数值统计', () => {
    // NaN 和 Infinity 不满足 isFinite/!isNaN，提取不到数值，走字符串统计
    const rows = toRows([NaN, Infinity, -Infinity])
    const result = computeColumnStats(rows, 0)
    // extractNumericValues 过滤掉 NaN/Infinity，结果 numericValues 为空
    expect(result.numeric).toBeNull()
  })

  it('列索引超出行宽时，所有值为 undefined（计为 null）', () => {
    const rows: unknown[][] = [[1, 2], [3, 4], [5, 6]]
    // colIndex=5 超出每行宽度，row[5] = undefined → nullCount=3
    const result = computeColumnStats(rows, 5)
    expect(result.basic.nullCount).toBe(3)
    expect(result.basic.nonNullCount).toBe(0)
  })

  it('单行单列：统计结果正确', () => {
    const rows = toRows([999])
    const result = computeColumnStats(rows, 0)
    expect(result.basic.totalCount).toBe(1)
    expect(result.numeric!.min).toBe(999)
    expect(result.numeric!.max).toBe(999)
    expect(result.numeric!.median).toBe(999)
  })

  it('Unicode 字符串长度统计正确（按 JS string length）', () => {
    // '你好' length=2，'hello' length=5
    const rows = toRows(['你好', 'hello', '中'])
    const result = computeColumnStats(rows, 0)
    expect(result.string!.minLength).toBe(1)
    expect(result.string!.maxLength).toBe(5)
  })

  it('负数数值列：min 为负、median 为负', () => {
    const rows = toRows([-5, -3, -1, -4, -2])
    const result = computeColumnStats(rows, 0)
    expect(result.numeric!.min).toBe(-5)
    expect(result.numeric!.max).toBe(-1)
    expect(result.numeric!.median).toBe(-3)
  })

  it('colType 字符串包含数值关键字时优先匹配（bigint 不含关键字则不匹配）', () => {
    // 'bigint' 不在正则内，走字符串统计
    const rows = toRows(['10', '20', '30'])
    const result = computeColumnStats(rows, 0, 'BIGINT')
    // BIGINT 不匹配正则（只有 int/float/double/decimal/numeric/real/number/money/serial）
    // 但 BIGINT 包含 'int'，/int/i.test('BIGINT') === true → 应走数值统计
    expect(result.numeric).not.toBeNull()
  })
})
