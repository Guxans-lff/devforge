import { invoke } from '@tauri-apps/api/core'

export interface ConnectionRecord {
  id: string
  name: string
  type: string
  groupId: string | null
  host: string
  port: number
  username: string
  configJson: string
  color: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ConnectionGroupRecord {
  id: string
  name: string
  sortOrder: number
  parentId: string | null
}

/** 从 configJson 中解析收藏状态 */
export function parseIsFavorite(configJson: string): boolean {
  try {
    const config = JSON.parse(configJson)
    return config.isFavorite === true
  } catch {
    return false
  }
}

export interface CreateConnectionParams {
  name: string
  type: string
  groupId?: string | null
  host: string
  port: number
  username: string
  configJson: string
  color?: string | null
  password?: string | null
}

export interface UpdateConnectionParams {
  name?: string
  groupId?: string
  host?: string
  port?: number
  username?: string
  configJson?: string
  color?: string
  password?: string
}

export interface TestResult {
  success: boolean
  message: string
  latencyMs: number | null
}

// --- Connection CRUD ---

export function createConnection(req: CreateConnectionParams): Promise<ConnectionRecord> {
  return invoke('create_connection', { req })
}

export function updateConnection(id: string, req: UpdateConnectionParams): Promise<ConnectionRecord> {
  return invoke('update_connection', { id, req })
}

export function deleteConnection(id: string): Promise<boolean> {
  return invoke('delete_connection', { id })
}

export function listConnections(): Promise<ConnectionRecord[]> {
  return invoke('list_connections')
}

export function getConnectionById(id: string): Promise<ConnectionRecord> {
  return invoke('get_connection_by_id', { id })
}

export function reorderConnections(ids: string[]): Promise<boolean> {
  return invoke('reorder_connections', { ids })
}

export function testConnection(id: string): Promise<TestResult> {
  return invoke('test_connection', { id })
}

export function testConnectionParams(params: {
  host: string
  port: number
  username: string
  password: string
  database?: string
  driver?: string
}): Promise<TestResult> {
  return invoke('test_connection_params', params)
}

// --- Groups ---

export function listGroups(): Promise<ConnectionGroupRecord[]> {
  return invoke('list_groups')
}

export function createGroup(name: string): Promise<ConnectionGroupRecord> {
  return invoke('create_group', { name })
}

export function deleteGroup(id: string): Promise<boolean> {
  return invoke('delete_group', { id })
}

// --- Credentials ---

export function getCredential(id: string): Promise<string | null> {
  return invoke('get_credential', { id })
}

export function saveCredential(id: string, password: string): Promise<boolean> {
  return invoke('save_credential', { id, password })
}

export function deleteCredential(id: string): Promise<boolean> {
  return invoke('delete_credential', { id })
}

// --- 分组与收藏管理 ---

/** 移动连接到指定分组（null 表示移到根级） */
export function moveConnection(connectionId: string, targetGroupId: string | null): Promise<boolean> {
  return invoke('move_connection', { connectionId, targetGroupId })
}

/** 切换连接的收藏状态，返回切换后的状态 */
export function toggleFavorite(connectionId: string): Promise<boolean> {
  return invoke('toggle_favorite', { connectionId })
}

/** 更新分组信息（名称、父级分组） */
export function updateGroup(groupId: string, name: string, parentId?: string | null): Promise<ConnectionGroupRecord> {
  return invoke('update_group', { groupId, name, parentId: parentId ?? null })
}

// --- App ---

export function getAppVersion(): Promise<string> {
  return invoke('get_app_version')
}
