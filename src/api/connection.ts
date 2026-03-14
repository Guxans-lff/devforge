import { invokeCommand } from '@/api/base'

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

/** 从 configJson 中解析环境类型 */
export function parseEnvironment(configJson: string): import('@/types/environment').EnvironmentType {
  try {
    const config = JSON.parse(configJson)
    const valid = ['production', 'staging', 'development', 'testing', 'local']
    return valid.includes(config.environment) ? config.environment : 'development'
  } catch {
    return 'development'
  }
}

/** 从 configJson 中解析只读模式 */
export function parseReadOnly(configJson: string): boolean {
  try {
    const config = JSON.parse(configJson)
    return config.readOnly === true
  } catch {
    return false
  }
}

/** 从 configJson 中解析危险操作确认开关 */
export function parseConfirmDanger(configJson: string): boolean {
  try {
    const config = JSON.parse(configJson)
    if (typeof config.confirmDanger === 'boolean') return config.confirmDanger
    // 未显式设置时，production/staging 默认开启
    const env = config.environment
    return env === 'production' || env === 'staging'
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
  return invokeCommand('create_connection', { req })
}

export function updateConnection(id: string, req: UpdateConnectionParams): Promise<ConnectionRecord> {
  return invokeCommand('update_connection', { id, req })
}

export function deleteConnection(id: string): Promise<boolean> {
  return invokeCommand('delete_connection', { id })
}

export function listConnections(): Promise<ConnectionRecord[]> {
  return invokeCommand('list_connections')
}

export function getConnectionById(id: string): Promise<ConnectionRecord> {
  return invokeCommand('get_connection_by_id', { id })
}

export function reorderConnections(ids: string[]): Promise<boolean> {
  return invokeCommand('reorder_connections', { ids })
}

export function testConnection(id: string): Promise<TestResult> {
  return invokeCommand('test_connection', { id })
}

export function testConnectionParams(params: {
  host: string
  port: number
  username: string
  password: string
  database?: string
  driver?: string
}): Promise<TestResult> {
  return invokeCommand('test_connection_params', params)
}

// --- Groups ---

export function listGroups(): Promise<ConnectionGroupRecord[]> {
  return invokeCommand('list_groups')
}

export function createGroup(name: string): Promise<ConnectionGroupRecord> {
  return invokeCommand('create_group', { name })
}

export function deleteGroup(id: string): Promise<boolean> {
  return invokeCommand('delete_group', { id })
}

// --- Credentials ---

export function getCredential(id: string): Promise<string | null> {
  return invokeCommand('get_credential', { id })
}

export function saveCredential(id: string, password: string): Promise<boolean> {
  return invokeCommand('save_credential', { id, password })
}

export function deleteCredential(id: string): Promise<boolean> {
  return invokeCommand('delete_credential', { id })
}

// --- 分组与收藏管理 ---

/** 移动连接到指定分组（null 表示移到根级） */
export function moveConnection(connectionId: string, targetGroupId: string | null): Promise<boolean> {
  return invokeCommand('move_connection', { connectionId, targetGroupId })
}

/** 切换连接的收藏状态，返回切换后的状态 */
export function toggleFavorite(connectionId: string): Promise<boolean> {
  return invokeCommand('toggle_favorite', { connectionId })
}

/** 更新分组信息（名称、父级分组） */
export function updateGroup(groupId: string, name: string, parentId?: string | null): Promise<ConnectionGroupRecord> {
  return invokeCommand('update_group', { groupId, name, parentId: parentId ?? null })
}

// --- App ---

export function getAppVersion(): Promise<string> {
  return invokeCommand('get_app_version')
}
