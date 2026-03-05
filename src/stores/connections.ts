import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ConnectionStatus } from '@/types/connection'
import {
  listConnections as apiListConnections,
  createConnection as apiCreateConnection,
  updateConnection as apiUpdateConnection,
  deleteConnection as apiDeleteConnection,
  listGroups as apiListGroups,
  createGroup as apiCreateGroup,
  deleteGroup as apiDeleteGroup,
  testConnection as apiTestConnection,
  type ConnectionRecord,
  type ConnectionGroupRecord,
  type CreateConnectionParams,
  type UpdateConnectionParams,
  type TestResult,
} from '@/api/connection'
import { sshTestConnection as apiSshTestConnection } from '@/api/ssh'

export interface ConnectionState {
  record: ConnectionRecord
  status: ConnectionStatus
  error?: string
}

export const useConnectionStore = defineStore('connections', () => {
  const connections = ref<Map<string, ConnectionState>>(new Map())
  const groups = ref<ConnectionGroupRecord[]>([])
  const searchQuery = ref('')
  const loading = ref(false)

  const connectionList = computed(() => Array.from(connections.value.values()))

  const filteredConnections = computed(() => {
    const query = searchQuery.value.toLowerCase()
    if (!query) return connectionList.value
    return connectionList.value.filter(
      (c) =>
        c.record.name.toLowerCase().includes(query) ||
        c.record.host.toLowerCase().includes(query),
    )
  })

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
    connections.value = new Map(connections.value).set(record.id, {
      record,
      status: 'disconnected',
    })
    return record
  }

  async function editConnection(id: string, params: UpdateConnectionParams): Promise<ConnectionRecord> {
    const record = await apiUpdateConnection(id, params)
    const existing = connections.value.get(id)
    connections.value = new Map(connections.value).set(id, {
      record,
      status: existing?.status ?? 'disconnected',
      error: existing?.error,
    })
    return record
  }

  async function removeConnection(id: string) {
    await apiDeleteConnection(id)
    const next = new Map(connections.value)
    next.delete(id)
    connections.value = next
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
    connections.value = new Map(connections.value).set(id, {
      ...state,
      status,
      error,
    })
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

  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  return {
    connections,
    groups,
    searchQuery,
    loading,
    connectionList,
    filteredConnections,
    loadConnections,
    addConnection,
    editConnection,
    removeConnection,
    testConnectionById,
    updateConnectionStatus,
    addGroup,
    removeGroup,
    setSearchQuery,
  }
})
