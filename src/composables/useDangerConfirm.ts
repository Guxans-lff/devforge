/**
 * 危险操作确认 composable
 * 从 useQueryExecution 提取，处理生产环境下危险 SQL 的二次确认逻辑
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { detectDangerousStatements, isReadOnlyStatement } from '@/utils/dangerousSqlDetector'
import type { DangerousStatement, EnvironmentType } from '@/types/environment'

export interface UseDangerConfirmOptions {
  environment: Ref<EnvironmentType | undefined>
  readOnly: Ref<boolean>
  confirmDanger: Ref<boolean>
  connectionName: Ref<string | undefined>
  currentDatabase: ComputedRef<string | undefined>
}

export function useDangerConfirm(options: UseDangerConfirmOptions) {
  const { environment, readOnly, confirmDanger, connectionName, currentDatabase } = options

  const dangerConfirmOpen = ref(false)
  const dangerConfirmSql = ref('')
  const dangerStatements = ref<DangerousStatement[]>([])
  const dangerConfirmInput = ref('')

  const dangerNeedInput = computed(() => environment.value === 'production')
  const dangerInputTarget = computed(() => currentDatabase.value || connectionName.value || '')
  const dangerCanConfirm = computed(() =>
    !dangerNeedInput.value || dangerConfirmInput.value === dangerInputTarget.value,
  )

  /**
   * 检查 SQL 是否需要拦截（只读模式或危险操作）
   * @returns null 表示放行，'readonly' 表示只读拦截，'danger' 表示需要确认
   */
  function checkExecution(sql: string): 'readonly' | 'danger' | null {
    if (readOnly.value && !isReadOnlyStatement(sql)) {
      return 'readonly'
    }
    if (confirmDanger.value) {
      const dangers = detectDangerousStatements(sql)
      if (dangers.length > 0) {
        dangerStatements.value = dangers
        dangerConfirmSql.value = sql
        dangerConfirmInput.value = ''
        dangerConfirmOpen.value = true
        return 'danger'
      }
    }
    return null
  }

  /** 确认危险操作后获取待执行 SQL 并重置状态 */
  function confirmAndGetSql(): string | null {
    if (!dangerCanConfirm.value) return null
    dangerConfirmOpen.value = false
    const sql = dangerConfirmSql.value
    dangerConfirmSql.value = ''
    dangerStatements.value = []
    dangerConfirmInput.value = ''
    return sql
  }

  return {
    dangerConfirmOpen,
    dangerConfirmSql,
    dangerStatements,
    dangerConfirmInput,
    dangerNeedInput,
    dangerInputTarget,
    dangerCanConfirm,
    checkExecution,
    confirmAndGetSql,
  }
}
