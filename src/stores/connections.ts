import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, computed } from 'vue'
import type { ConnectionStatus, ReconnectParams, ReconnectResult } from '@/types/connection'
import { dbCheckAndReconnect } from '@/api/database'
import { getCredential } from '@/api/connection'
import {
  listConnections as apiListConnections,
  createConnection as apiCreateConnection,
  updateConnection as apiUpdateConnection,
  deleteConnection as apiDeleteConnection,
  listGroups as apiListGroups,
  createGroup as apiCreateGroup,
  deleteGroup as apiDeleteGroup,
  testConnection as apiTestConnection,
  moveConnection as apiMoveConnection,
  toggleFavorite as apiToggleFavorite,
  updateGroup as apiUpdateGroup,
  reorderConnections as apiReorderConnections,
  getAutoReconnect,
  getIsFavorite,
  parseConnectionConfig,
  type ConnectionRecord,
  type ConnectionGroupRecord,
  type CreateConnectionParams,
  type UpdateConnectionParams,
  type TestResult,
  type ParsedConnectionConfig,
} from '@/api/connection'
import { sshTestConnection as apiSshTestConnection } from '@/api/ssh'

export interface ConnectionState {
  record: ConnectionRecord
  parsedConfig: ParsedConnectionConfig
  status: ConnectionStatus
  error?: string
  /** 当前重连尝试次数（仅 reconnecting 状态下有效） */
  reconnectAttempt?: number
}

/** 用于判断错误信息是否为连接断开类错误的关键字列表 */
const DISCONNECT_ERROR_KEYWORDS = [
  'connection refused',
  'broken pipe',
  'connection reset',
  'server has gone away',
  'lost connection',
  'connection was reset',
  'connection timed out',
  'network is unreachable',
  'no route to host',
  'connection closed',
  'closed an existing connection',
  'forcibly closed',
  'communications link failure',
  'server closed the connection',
  'connection lost',
  'error communicating with database',
  'os error 10054',
  '10054',
  '10053',
  '远程主机强迫关闭',
  '现有的连接',
  'eof',
]

/** 从 configJson 中解析 autoReconnect 配置，默认为 true */
export function parseAutoReconnect(configJson: string): boolean {
  try {
    const config = JSON.parse(configJson)
    // 未设置时默认启用
    return config.autoReconnect !== false
  } catch {
    return true
  }
}

export const useConnectionStore = defineStore('connections', () => {
  const connections = shallowRef<Map<string, ConnectionState>>(new Map())
  const groups = ref<ConnectionGroupRecord[]>([])
  const searchQuery = ref('')
  const loading = ref(false)
  /** 正在进行重连的连接 ID 集合，防止并发重连 */
  const reconnectingIds = ref<Set<string>>(new Set())

  const connectionList = computed(() => Array.from(connections.value.values()))

  /** 收藏的连接列表 */
  const favoriteConnections = computed(() =>
    connectionList.value.filter((c) => getIsFavorite(c.parsedConfig)),
  )

  /** 非收藏的连接列表 */
  const nonFavoriteConnections = computed(() =>
    connectionList.value.filter((c) => !getIsFavorite(c.parsedConfig)),
  )

  /** 搜索过滤：支持按名称、主机、分组名匹配 */
  const filteredConnections = computed(() => {
    const query = searchQuery.value.toLowerCase()
    if (!query) return connectionList.value

    // 构建分组名称映射
    const groupNameMap = new Map<string, string>()
    for (const g of groups.value) {
      groupNameMap.set(g.id, g.name.toLowerCase())
    }

    return connectionList.value.filter((c) => {
      const nameMatch = c.record.name.toLowerCase().includes(query)
      const hostMatch = c.record.host.toLowerCase().includes(query)
      // 按分组名匹配
      const groupName = c.record.groupId ? groupNameMap.get(c.record.groupId) : null
      const groupMatch = groupName ? groupName.includes(query) : false
      return nameMatch || hostMatch || groupMatch
    })
  })

  /** 过滤后的收藏连接 */
  const filteredFavorites = computed(() =>
    filteredConnections.value.filter((c) => getIsFavorite(c.parsedConfig)),
  )

  /** 过滤后的非收藏连接 */
  const filteredNonFavorites = computed(() =>
    filteredConnections.value.filter((c) => !getIsFavorite(c.parsedConfig)),
  )

  async function loadConnections() {
    // 防止并发加载
    if (loading.value) return
    loading.value = true
    try {
      const [records, groupRecords] = await Promise.all([
        apiListConnections(),
        apiListGroups(),
      ])
      const newMap = new Map<string, ConnectionState>()
      for (const record of records) {
        const existing = connections.value.get(record.id)
        newMap.set(record.id, {
          record,
          parsedConfig: parseConnectionConfig(record.configJson),
          status: existing?.status ?? 'disconnected',
          error: existing?.error,
        })
      }
      connections.value = newMap
      groups.value = groupRecords
    } catch (err) {
      console.warn('Failed to load connections:', err)
    } finally {
      loading.value = false
    }
  }

  async function addConnection(params: CreateConnectionParams): Promise<ConnectionRecord> {
    const record = await apiCreateConnection(params)
    connections.value.set(record.id, {
      record,
      parsedConfig: parseConnectionConfig(record.configJson),
      status: 'disconnected',
    })
    triggerRef(connections)
    return record
  }

  async function editConnection(id: string, params: UpdateConnectionParams): Promise<ConnectionRecord> {
    const record = await apiUpdateConnection(id, params)
    const existing = connections.value.get(id)
    connections.value.set(id, {
      record,
      parsedConfig: parseConnectionConfig(record.configJson),
      status: existing?.status ?? 'disconnected',
      error: existing?.error,
    })
    triggerRef(connections)
    return record
  }

  async function removeConnection(id: string) {
    await apiDeleteConnection(id)
    connections.value.delete(id)
    triggerRef(connections)
  }

  async function testConnectionById(id: string): Promise<TestResult> {
    updateConnectionStatus(id, 'connecting')
    try {
      const state = connections.value.get(id)
      const connType = state?.record.type
      const result = connType === 'ssh' || connType === 'sftp'
        ? await apiSshTestConnection(id)
        : await apiTestConnection(id)
      updateConnectionStatus(id, result.success ? 'connected' : 'error', result.message)
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      updateConnectionStatus(id, 'error', msg)
      throw e
    }
  }

  function updateConnectionStatus(id: string, status: ConnectionStatus, error?: string) {
    const state = connections.value.get(id)
    if (!state) return
    connections.value.set(id, {
      ...state,
      status,
      error,
    })
    triggerRef(connections)
  }

  async function addGroup(name: string): Promise<ConnectionGroupRecord> {
    const group = await apiCreateGroup(name)
    groups.value = [...groups.value, group]
    return group
  }

  async function removeGroup(id: string) {
    await apiDeleteGroup(id)
    groups.value = groups.value.filter((g) => g.id !== id)
  }

  /** 更新分组信息 */
  async function editGroup(id: string, name: string, parentId?: string | null): Promise<ConnectionGroupRecord> {
    const group = await apiUpdateGroup(id, name, parentId)
    groups.value = groups.value.map((g) => (g.id === id ? group : g))
    return group
  }

  /** 移动连接到指定分组 */
  async function moveConnectionToGroup(connectionId: string, targetGroupId: string | null) {
    await apiMoveConnection(connectionId, targetGroupId)
    // 更新本地状态
    const state = connections.value.get(connectionId)
    if (state) {
      const updatedRecord = { ...state.record, groupId: targetGroupId }
      connections.value.set(connectionId, {
        ...state,
        record: updatedRecord,
        parsedConfig: parseConnectionConfig(updatedRecord.configJson),
      })
      triggerRef(connections)
    }
  }

  /** 切换连接收藏状态 */
  async function toggleConnectionFavorite(connectionId: string): Promise<boolean> {
    const newFavorite = await apiToggleFavorite(connectionId)
    // 重新加载以获取最新的 configJson
    await loadConnections()
    return newFavorite
  }

  /** 拖拽排序连接 */
  async function reorderConnectionList(orderedIds: string[]) {
    await apiReorderConnections(orderedIds)
    // 更新本地排序
    let sortOrder = 0
    for (const id of orderedIds) {
      const state = connections.value.get(id)
      if (state) {
        connections.value.set(id, {
          ...state,
          record: { ...state.record, sortOrder: sortOrder++ },
        })
      }
    }
    triggerRef(connections)
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  /**
   * 检测错误信息是否为连接断开类错误
   * @param errorMessage 错误信息字符串
   * @returns 是否为连接断开错误
   */
  function isDisconnectError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase()
    return DISCONNECT_ERROR_KEYWORDS.some((keyword) => lower.includes(keyword))
  }

  /**
   * 自动重连逻辑：检测连接断开后触发重连（最多 3 次，间隔 5 秒）
   * @param connectionId 连接 ID
   * @returns 重连结果，如果不满足重连条件则返回 null
   */
  async function attemptAutoReconnect(connectionId: string): Promise<ReconnectResult | null> {
    const state = connections.value.get(connectionId)
    if (!state) return null

    // 仅数据库连接支持自动重连
    if (state.record.type !== 'database') return null

    // 检查是否启用了自动重连
    if (!getAutoReconnect(state.parsedConfig)) return null

    // 防止并发重连
    if (reconnectingIds.value.has(connectionId)) return null
    reconnectingIds.value.add(connectionId)

    try {
      // 解析连接配置，构建重连参数
      const config = state.parsedConfig

      // 获取存储的密码
      let password = ''
      try {
        password = (await getCredential(connectionId)) ?? ''
      } catch {
        // 密码获取失败，使用空字符串
      }

      const reconnectParams: ReconnectParams = {
        driver: (config.driver as string) ?? 'mysql',
        host: state.record.host,
        port: state.record.port,
        username: state.record.username,
        password,
        database: (config.database as string) || undefined,
        sslConfig: config.ssl as ReconnectParams['sslConfig'],
        poolConfig: config.pool as ReconnectParams['poolConfig'],
      }

      // 更新状态为 reconnecting
      updateConnectionStatus(connectionId, 'reconnecting')
      updateReconnectAttempt(connectionId, 1)

      const result = await dbCheckAndReconnect(connectionId, reconnectParams)

      if (result.success) {
        updateConnectionStatus(connectionId, 'connected')
        updateReconnectAttempt(connectionId, 0)
      } else {
        updateConnectionStatus(connectionId, 'disconnected', result.message)
        updateReconnectAttempt(connectionId, 0)
      }

      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      updateConnectionStatus(connectionId, 'disconnected', msg)
      updateReconnectAttempt(connectionId, 0)
      return { success: false, attempt: 0, message: msg }
    } finally {
      reconnectingIds.value.delete(connectionId)
    }
  }

  /**
   * 更新连接的重连尝试次数
   * @param id 连接 ID
   * @param attempt 当前尝试次数
   */
  function updateReconnectAttempt(id: string, attempt: number) {
    const state = connections.value.get(id)
    if (!state) return
    connections.value.set(id, {
      ...state,
      reconnectAttempt: attempt,
    })
    triggerRef(connections)
  }

  /**
   * 处理查询错误：检测是否为连接断开错误，如果是则触发自动重连
   * @param connectionId 连接 ID
   * @param errorMessage 错误信息
   * @returns 重连结果，如果不是连接断开错误则返回 null
   */
  async function handleQueryError(connectionId: string, errorMessage: string): Promise<ReconnectResult | null> {
    if (!isDisconnectError(errorMessage)) return null
    return attemptAutoReconnect(connectionId)
  }

  return {
    connections,
    groups,
    searchQuery,
    loading,
    reconnectingIds,
    connectionList,
    favoriteConnections,
    nonFavoriteConnections,
    filteredConnections,
    filteredFavorites,
    filteredNonFavorites,
    loadConnections,
    addConnection,
    editConnection,
    removeConnection,
    testConnectionById,
    updateConnectionStatus,
    addGroup,
    removeGroup,
    editGroup,
    moveConnectionToGroup,
    toggleConnectionFavorite,
    reorderConnectionList,
    setSearchQuery,
    isDisconnectError,
    attemptAutoReconnect,
    updateReconnectAttempt,
    handleQueryError,
  }
})
