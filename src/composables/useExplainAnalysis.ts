/**
 * EXPLAIN 执行计划分析 composable
 * 从 useQueryExecution 提取，负责 EXPLAIN 的执行和结果解析
 */
import { ref, type Ref } from 'vue'
import * as dbApi from '@/api/database'

export interface UseExplainAnalysisOptions {
  connectionId: Ref<string>
  isConnected: Ref<boolean>
}

export function useExplainAnalysis(options: UseExplainAnalysisOptions) {
  const { connectionId, isConnected } = options

  const explainResult = ref<Record<string, unknown> | null>(null)
  const explainTableRows = ref<Record<string, unknown>[] | null>(null)
  const showExplain = ref(false)
  const isExplaining = ref(false)

  async function handleExplain(getSql: () => string) {
    const sql = getSql()
    if (!sql || !isConnected.value) return

    // 去除已有的 EXPLAIN 前缀
    const cleanSql = sql.replace(/^\s*EXPLAIN\s+(FORMAT\s*=\s*\w+\s+|ANALYZE\s+|\(.*?\)\s+)*/i, '')
    if (!cleanSql.trim()) return

    isExplaining.value = true
    showExplain.value = true
    explainResult.value = null
    explainTableRows.value = null

    try {
      const [jsonResult, tableResult] = await Promise.all([
        dbApi.dbExplain(connectionId.value, cleanSql, 'json'),
        dbApi.dbExplain(connectionId.value, cleanSql, 'table'),
      ])

      if (jsonResult.isError) {
        explainResult.value = { error: jsonResult.error }
      } else if (jsonResult.rows.length > 0) {
        const raw = String(jsonResult.rows[0]![0] ?? '{}')
        try {
          explainResult.value = JSON.parse(raw)
        } catch {
          explainResult.value = { raw }
        }
      }

      if (!tableResult.isError && tableResult.columns.length > 0) {
        explainTableRows.value = tableResult.rows.map(row => {
          const obj: Record<string, unknown> = {}
          tableResult.columns.forEach((col, i) => {
            obj[col.name] = row[i]
          })
          return obj
        })
      }
    } catch (e: any) {
      explainResult.value = { error: (e?.message || e?.msg || JSON.stringify(e)) as string }
    } finally {
      isExplaining.value = false
    }
  }

  return {
    explainResult,
    explainTableRows,
    showExplain,
    isExplaining,
    handleExplain,
  }
}
