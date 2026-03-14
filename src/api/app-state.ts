import { invokeCommand } from '@/api/base'

/** 后端 KV 存储记录 */
export interface AppStateRecord {
  key: string
  value: string
  version: number
  updatedAt: number
}

/** 获取指定 key 的应用状态 */
export function getAppState(key: string): Promise<AppStateRecord | null> {
  return invokeCommand('get_app_state', { key }, { source: 'SYSTEM', silent: true })
}

/** 设置指定 key 的应用状态（upsert） */
export function setAppState(key: string, value: string, version?: number): Promise<void> {
  return invokeCommand('set_app_state', { key, value, version: version ?? 1 }, { source: 'SYSTEM', silent: true })
}

/** 删除指定 key 的应用状态 */
export function deleteAppState(key: string): Promise<void> {
  return invokeCommand('delete_app_state', { key }, { source: 'SYSTEM', silent: true })
}

/** 批量获取匹配前缀的应用状态 */
export function listAppState(prefix: string): Promise<AppStateRecord[]> {
  return invokeCommand('list_app_state', { prefix }, { source: 'SYSTEM', silent: true })
}

// ===== JSON 便捷封装 =====

/** 获取 JSON 值（自动反序列化） */
export async function getAppStateJson<T>(key: string): Promise<T | null> {
  const record = await getAppState(key)
  if (!record) return null
  try {
    return JSON.parse(record.value) as T
  } catch {
    return null
  }
}

/** 设置 JSON 值（自动序列化） */
export function setAppStateJson<T>(key: string, value: T, version?: number): Promise<void> {
  return setAppState(key, JSON.stringify(value), version)
}
