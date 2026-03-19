/**
 * 事务管理 composable
 * 从 useQueryExecution 提取，负责 BEGIN/COMMIT/ROLLBACK 操作
 */
import { type Ref } from 'vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import * as dbApi from '@/api/database'

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
    } catch (e: any) {
      notification.error('开始事务失败', (e?.message || e?.msg || JSON.stringify(e)) as string, true)
    }
  }

  async function handleCommit() {
    if (!isConnected.value) return
    try {
      await dbApi.dbCommit(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e: any) {
      notification.error('提交事务失败', (e?.message || e?.msg || JSON.stringify(e)) as string, true)
    }
  }

  async function handleRollback() {
    if (!isConnected.value) return
    try {
      await dbApi.dbRollback(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e: any) {
      notification.error('回滚事务失败', (e?.message || e?.msg || JSON.stringify(e)) as string, true)
    }
  }

  return {
    handleBeginTransaction,
    handleCommit,
    handleRollback,
  }
}
