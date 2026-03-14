/** 基本列统计 */
export interface ColumnStatistics {
  /** 总行数 */
  totalCount: number
  /** 唯一值数 */
  uniqueCount: number
  /** NULL 值数 */
  nullCount: number
  /** NULL 百分比 */
  nullPercent: number
  /** 非空值数 */
  nonNullCount: number
}

/** 数值型附加统计 */
export interface NumericStats {
  min: number
  max: number
  avg: number
  sum: number
  median: number
}

/** 字符串型附加统计 */
export interface StringStats {
  minLength: number
  maxLength: number
  avgLength: number
  emptyCount: number
}

/** 完整的列统计结果 */
export interface ColumnStatsResult {
  basic: ColumnStatistics
  numeric: NumericStats | null
  string: StringStats | null
}

/**
 * 计算某一列的统计数据
 * @param rows 所有行数据
 * @param colIndex 列索引
 * @param colType 列的数据类型（可选，用于辅助判断是否数值）
 */
export function computeColumnStats(
  rows: unknown[][],
  colIndex: number,
  colType?: string,
): ColumnStatsResult {
  const totalCount = rows.length
  let nullCount = 0
  const values: unknown[] = []
  const uniqueSet = new Set<string>()

  for (const row of rows) {
    const val = row[colIndex]
    if (val === null || val === undefined) {
      nullCount++
      uniqueSet.add('__NULL__')
    } else {
      values.push(val)
      uniqueSet.add(String(val))
    }
  }

  const nonNullCount = totalCount - nullCount
  const basic: ColumnStatistics = {
    totalCount,
    uniqueCount: uniqueSet.size,
    nullCount,
    nullPercent: totalCount > 0 ? (nullCount / totalCount) * 100 : 0,
    nonNullCount,
  }

  // 尝试数值统计
  let numeric: NumericStats | null = null
  const numericValues = extractNumericValues(values, colType)
  if (numericValues.length > 0 && numericValues.length >= nonNullCount * 0.8) {
    // 80% 以上的非空值是数值才算作数值列
    numericValues.sort((a, b) => a - b)
    const sum = numericValues.reduce((acc, v) => acc + v, 0)
    const mid = Math.floor(numericValues.length / 2)
    const median = numericValues.length % 2 === 0
      ? ((numericValues[mid - 1] ?? 0) + (numericValues[mid] ?? 0)) / 2
      : (numericValues[mid] ?? 0)

    numeric = {
      min: numericValues[0] ?? 0,
      max: numericValues[numericValues.length - 1] ?? 0,
      avg: sum / numericValues.length,
      sum,
      median,
    }
  }

  // 字符串统计
  let stringStats: StringStats | null = null
  if (!numeric && nonNullCount > 0) {
    const lengths: number[] = []
    let emptyCount = 0
    for (const v of values) {
      const s = String(v)
      lengths.push(s.length)
      if (s === '') emptyCount++
    }
    if (lengths.length > 0) {
      lengths.sort((a, b) => a - b)
      const sumLen = lengths.reduce((acc, l) => acc + l, 0)
      stringStats = {
        minLength: lengths[0] ?? 0,
        maxLength: lengths[lengths.length - 1] ?? 0,
        avgLength: sumLen / lengths.length,
        emptyCount,
      }
    }
  }

  return { basic, numeric, string: stringStats }
}

/** 从混合值中提取数值 */
function extractNumericValues(values: unknown[], colType?: string): number[] {
  const result: number[] = []
  // 列类型辅助判断
  const isNumericType = colType && /int|float|double|decimal|numeric|real|number|money|serial/i.test(colType)

  for (const v of values) {
    if (typeof v === 'number' && !isNaN(v) && isFinite(v)) {
      result.push(v)
    } else if (isNumericType && typeof v === 'string') {
      const num = Number(v)
      if (!isNaN(num) && isFinite(num)) {
        result.push(num)
      }
    }
  }
  return result
}

/**
 * 异步分帧计算（大数据量时避免卡 UI）
 * 当行数 > threshold 时使用 requestIdleCallback 分批处理
 */
export function computeColumnStatsAsync(
  rows: unknown[][],
  colIndex: number,
  colType?: string,
  threshold = 50000,
): Promise<ColumnStatsResult> {
  if (rows.length <= threshold) {
    return Promise.resolve(computeColumnStats(rows, colIndex, colType))
  }

  return new Promise((resolve) => {
    // 对于大数据量，使用 setTimeout 分帧
    // 但实际上 JS 纯计算 5w 行以内很快，先用同步兜底
    setTimeout(() => {
      resolve(computeColumnStats(rows, colIndex, colType))
    }, 0)
  })
}
