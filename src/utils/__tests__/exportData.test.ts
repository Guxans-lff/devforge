import { describe, it, expect } from 'vitest'
import { toCSV, toJSON, toSQL, toMarkdown, formatData, getFileExtension, getFilters } from '../exportData'
import type { QueryResult } from '@/types/database'

// 构造标准测试数据
function makeResult(overrides?: Partial<QueryResult>): QueryResult {
  return {
    columns: [
      { name: 'id', dataType: 'int', nullable: false },
      { name: 'name', dataType: 'varchar', nullable: true },
      { name: 'amount', dataType: 'decimal', nullable: true },
    ],
    rows: [
      [1, 'Alice', 100.5],
      [2, 'Bob', null],
      [3, "O'Brien", 200],
    ],
    executionTimeMs: 10,
    affectedRows: 0,
    isError: false,
    ...overrides,
  }
}

describe('toCSV', () => {
  it('应包含 UTF-8 BOM 和表头', () => {
    const csv = toCSV(makeResult())
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('id,name,amount')
  })

  it('null 值应输出空字符串', () => {
    const csv = toCSV(makeResult())
    const lines = csv.split('\n')
    // 第三行（Bob）的 amount 为 null
    expect(lines[2]).toBe('2,Bob,')
  })

  it('包含逗号的值应被双引号包裹', () => {
    const result = makeResult({
      rows: [[1, 'hello, world', 100]],
    })
    const csv = toCSV(result)
    expect(csv).toContain('"hello, world"')
  })

  it('包含双引号的值应被转义', () => {
    const result = makeResult({
      rows: [[1, 'say "hi"', 100]],
    })
    const csv = toCSV(result)
    expect(csv).toContain('"say ""hi"""')
  })

  it('包含换行的值应被双引号包裹', () => {
    const result = makeResult({
      rows: [[1, 'line1\nline2', 100]],
    })
    const csv = toCSV(result)
    expect(csv).toContain('"line1\nline2"')
  })
})

describe('toJSON', () => {
  it('应返回合法的 JSON 字符串', () => {
    const json = toJSON(makeResult())
    const parsed = JSON.parse(json)
    expect(parsed).toBeTruthy()
  })

  it('metadata 应包含正确的行数和列信息', () => {
    const json = toJSON(makeResult(), 'test_table')
    const parsed = JSON.parse(json)
    expect(parsed.metadata.source).toBe('test_table')
    expect(parsed.metadata.rowCount).toBe(3)
    expect(parsed.metadata.columns).toHaveLength(3)
    expect(parsed.metadata.columns[0].name).toBe('id')
  })

  it('data 数组应将行映射为对象', () => {
    const json = toJSON(makeResult())
    const parsed = JSON.parse(json)
    expect(parsed.data[0]).toEqual({ id: 1, name: 'Alice', amount: 100.5 })
    expect(parsed.data[1].amount).toBeNull()
  })
})

describe('toSQL', () => {
  it('空数据应返回注释', () => {
    const result = makeResult({ rows: [] })
    expect(toSQL(result)).toBe('-- No data to export')
  })

  it('应生成 INSERT 语句', () => {
    const sql = toSQL(makeResult(), 'users')
    expect(sql).toContain('INSERT INTO `users`')
    expect(sql).toContain('(`id`, `name`, `amount`)')
  })

  it('null 值应输出 NULL', () => {
    const sql = toSQL(makeResult())
    expect(sql).toContain('NULL')
  })

  it("单引号应被转义为两个单引号", () => {
    const sql = toSQL(makeResult(), 'users')
    expect(sql).toContain("'O''Brien'")
  })

  it('应包含外键检查的开关语句', () => {
    const sql = toSQL(makeResult())
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS = 0')
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS = 1')
  })

  it('布尔值应被转换为 0/1', () => {
    const result = makeResult({
      columns: [{ name: 'active', dataType: 'tinyint', nullable: false }],
      rows: [[true], [false]],
    })
    const sql = toSQL(result)
    expect(sql).toContain('VALUES (1)')
    expect(sql).toContain('VALUES (0)')
  })
})

describe('toMarkdown', () => {
  it('空列应返回空字符串', () => {
    const result = makeResult({ columns: [], rows: [] })
    expect(toMarkdown(result)).toBe('')
  })

  it('应包含导出概览和详细数据', () => {
    const md = toMarkdown(makeResult(), '测试数据')
    expect(md).toContain('## 测试数据 导出报告')
    expect(md).toContain('### 📋 导出概览')
    expect(md).toContain('### 🔍 详细数据')
  })

  it('null 值应显示为 _NULL_', () => {
    const md = toMarkdown(makeResult())
    expect(md).toContain('_NULL_')
  })

  it('数字列应右对齐', () => {
    const md = toMarkdown(makeResult())
    // int 和 decimal 列的分隔行应为 ---:
    const lines = md.split('\n')
    const sepLine = lines.find(l => l.includes('---:'))
    expect(sepLine).toBeTruthy()
  })

  it('管道符应被转义', () => {
    const result = makeResult({
      rows: [[1, 'a|b', 100]],
    })
    const md = toMarkdown(result)
    expect(md).toContain('a\\|b')
  })
})

describe('formatData', () => {
  it('应根据格式调用对应函数', () => {
    const result = makeResult()
    expect(formatData(result, 'csv')).toContain('\uFEFF')
    expect(() => JSON.parse(formatData(result, 'json'))).not.toThrow()
    expect(formatData(result, 'sql')).toContain('INSERT INTO')
    expect(formatData(result, 'markdown')).toContain('##')
  })
})

describe('getFileExtension', () => {
  it('应返回正确的扩展名', () => {
    expect(getFileExtension('csv')).toBe('csv')
    expect(getFileExtension('json')).toBe('json')
    expect(getFileExtension('sql')).toBe('sql')
    expect(getFileExtension('markdown')).toBe('md')
  })
})

describe('getFilters', () => {
  it('应返回包含对应扩展名的过滤器', () => {
    expect(getFilters('csv')[0].extensions).toContain('csv')
    expect(getFilters('json')[0].extensions).toContain('json')
    expect(getFilters('sql')[0].extensions).toContain('sql')
    expect(getFilters('markdown')[0].extensions).toContain('md')
  })
})
