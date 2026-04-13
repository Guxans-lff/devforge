/**
 * 事务管理 composable
 * 从 useQueryExecution 提取，负责 BEGIN/COMMIT/ROLLBACK 操作
 */
import { watch, type Ref } from 'vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import * as dbApi from '@/api/database'
import { parseBackendError } from '@/types/error'

export interface UseTransactionControlOptions {
  connectionId: Ref<string>
  tabId: Ref<string>
  isConnected: Ref<boolean>
}

export function useTransactionControl(options: UseTransactionControlOptions) {
  const { connectionId, tabId, isConnected } = options
  const store = useDatabaseWorkspaceStore()
  const notification = useNotification()

  async function handleBeginTransaction() {
    if (!isConnected.value) return
    try {
      await dbApi.dbBeginTransaction(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: true,
      })
    } catch (e: unknown) {
      notification.error('开始事务失败', parseBackendError(e).message, true)
    }
  }

  async function handleCommit() {
    if (!isConnected.value) return
    try {
      await dbApi.dbCommit(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e: unknown) {
      notification.error('提交事务失败', parseBackendError(e).message, true)
    }
  }

  async function handleRollback() {
    if (!isConnected.value) return
    try {
      await dbApi.dbRollback(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e: unknown) {
      notification.error('回滚事务失败', parseBackendError(e).message, true)
    }
  }

  // 连接断开时自动清除事务状态
  watch(isConnected, (connected) => {
    if (!connected) {
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    }
  })

  return {
    handleBeginTransaction,
    handleCommit,
    handleRollback,
  }
}
