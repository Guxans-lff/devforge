import { format as formatSql } from 'sql-formatter'

/** SQL 格式化选项 */
export interface SqlFormatOptions {
  /** SQL 方言：mysql 或 postgresql */
  language?: 'mysql' | 'postgresql'
  /** 缩进宽度（空格数） */
  tabWidth?: number
  /** 关键字大小写：upper / lower / preserve */
  keywordCase?: 'upper' | 'lower' | 'preserve'
}

/** 格式化结果 */
export interface SqlFormatResult {
  /** 格式化后的 SQL */
  formatted: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}

/**
 * SQL 格式化 composable
 * 封装 sql-formatter 库，提供统一的格式化接口
 */
export function useSqlFormatter() {
  /**
   * 格式化 SQL 文本
   * @param sql 待格式化的 SQL
   * @param options 格式化选项
   * @returns 格式化结果
   */
  function formatSqlText(sql: string, options?: SqlFormatOptions): SqlFormatResult {
    // 空白文本直接返回
    if (!sql.trim()) {
      return { formatted: sql, success: true }
    }

    try {
      const formatted = formatSql(sql, {
        language: options?.language ?? 'mysql',
        tabWidth: options?.tabWidth ?? 2,
        keywordCase: options?.keywordCase ?? 'upper',
      })
      return { formatted, success: true }
    } catch (e) {
      return {
        formatted: sql,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  return { formatSqlText }
}
