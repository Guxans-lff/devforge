import { watch, type WatchSource } from 'vue'
import { getAppStateJson, setAppStateJson } from '@/api/app-state'

/** 持久化配置 */
export interface PersistConfig<T> {
  /** 存储 key（SQLite app_state 表中的 key） */
  key: string
  /** 版本号（用于迁移） */
  version: number
  /** 需要持久化的字段提取器（从 store state 中提取需要保存的部分） */
  serialize: () => T
  /** 恢复数据到 store 的方法 */
  deserialize: (data: T) => void
  /** 防抖延迟（毫秒），默认 500ms */
  debounce?: number
  /** 版本迁移函数映射 */
  migrations?: Record<number, (oldData: unknown) => unknown>
}

/** 持久化包装格式（存储在 SQLite 中的 JSON 结构） */
interface PersistedData<T> {
  version: number
  data: T
}

/**
 * 通用持久化工具
 * 用于将 Pinia store 的状态持久化到 SQLite KV 存储
 *
 * @example
 * ```ts
 * const store = useSomeStore()
 * const { load, save } = usePersistence({
 *   key: 'some-store',
 *   version: 1,
 *   serialize: () => ({ field1: store.field1, field2: store.field2 }),
 *   deserialize: (data) => { store.field1 = data.field1; store.field2 = data.field2 },
 * })
 * await load() // 启动时恢复
 * ```
 */
export function usePersistence<T>(config: PersistConfig<T>) {
  const { key, version, serialize, deserialize, debounce = 500, migrations } = config

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let isSaving = false

  /** 从 SQLite 加载并恢复状态 */
  async function load(): Promise<boolean> {
    try {
      const persisted = await getAppStateJson<PersistedData<T>>(key)
      if (!persisted) return false

      let { data, version: storedVersion } = persisted

      // 版本迁移
      if (storedVersion < version && migrations) {
        for (let v = storedVersion + 1; v <= version; v++) {
          const migrateFn = migrations[v]
          if (migrateFn) {
            data = migrateFn(data) as T
          }
        }
        // 迁移后立即保存新版本
        await saveImmediate(data)
      }

      deserialize(data)
      return true
    } catch (e) {
      console.warn(`[Persistence] 加载 ${key} 失败:`, e)
      return false
    }
  }

  /** 立即保存（不防抖） */
  async function saveImmediate(data?: T): Promise<void> {
    isSaving = true
    try {
      const payload: PersistedData<T> = {
        version,
        data: data ?? serialize(),
      }
      await setAppStateJson(key, payload, version)
    } catch (e) {
      console.warn(`[Persistence] 保存 ${key} 失败:`, e)
    } finally {
      isSaving = false
    }
  }

  /** 防抖保存 */
  function save(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveImmediate()
    }, debounce)
  }

  /** 设置自动监听保存（watch 指定的响应式源） */
  function autoSave(source: WatchSource | WatchSource[]): void {
    watch(source, () => {
      if (!isSaving) {
        save()
      }
    }, { deep: true })
  }

  /** 清除持久化数据 */
  async function clear(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const { deleteAppState } = await import('@/api/app-state')
    await deleteAppState(key)
  }

  return {
    load,
    save,
    saveImmediate,
    autoSave,
    clear,
  }
}
