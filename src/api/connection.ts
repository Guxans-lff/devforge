import { invokeCommand } from '@/api/base'
import type { EnvironmentType } from '@/types/environment'

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

export interface ParsedConnectionConfig {
  isFavorite?: boolean
  environment?: unknown
  readOnly?: boolean
  confirmDanger?: boolean
  autoReconnect?: boolean
  driver?: unknown
  [key: string]: unknown
}

const VALID_ENVIRONMENTS: EnvironmentType[] = ['production', 'staging', 'development', 'testing', 'local']

export function parseConnectionConfig(configJson: string): ParsedConnectionConfig {
  try {
    const config = JSON.parse(configJson)
    return config && typeof config === 'object' ? config as ParsedConnectionConfig : {}
  } catch {
    return {}
  }
}

export function getIsFavorite(config: ParsedConnectionConfig | null | undefined): boolean {
  return config?.isFavorite === true
}

export function parseIsFavorite(configJson: string): boolean {
  return getIsFavorite(parseConnectionConfig(configJson))
}

export function getEnvironment(config: ParsedConnectionConfig | null | undefined): EnvironmentType {
  return VALID_ENVIRONMENTS.includes(config?.environment as EnvironmentType)
    ? config?.environment as EnvironmentType
    : 'development'
}

export function parseEnvironment(configJson: string): EnvironmentType {
  return getEnvironment(parseConnectionConfig(configJson))
}

export function getReadOnly(config: ParsedConnectionConfig | null | undefined): boolean {
  return config?.readOnly === true
}

export function parseReadOnly(configJson: string): boolean {
  return getReadOnly(parseConnectionConfig(configJson))
}

export function getConfirmDanger(config: ParsedConnectionConfig | null | undefined): boolean {
  if (typeof config?.confirmDanger === 'boolean') return config.confirmDanger
  const env = config?.environment
  return env === 'production' || env === 'staging'
}

export function parseConfirmDanger(configJson: string): boolean {
  return getConfirmDanger(parseConnectionConfig(configJson))
}

export function getAutoReconnect(config: ParsedConnectionConfig | null | undefined): boolean {
  return config?.autoReconnect !== false
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

export function listGroups(): Promise<ConnectionGroupRecord[]> {
  return invokeCommand('list_groups')
}

export function createGroup(name: string): Promise<ConnectionGroupRecord> {
  return invokeCommand('create_group', { name })
}

export function deleteGroup(id: string): Promise<boolean> {
  return invokeCommand('delete_group', { id })
}

export function getCredential(id: string): Promise<string | null> {
  return invokeCommand('get_credential', { id })
}

export function saveCredential(id: string, password: string): Promise<boolean> {
  return invokeCommand('save_credential', { id, password })
}

export function deleteCredential(id: string): Promise<boolean> {
  return invokeCommand('delete_credential', { id })
}

export function moveConnection(connectionId: string, targetGroupId: string | null): Promise<boolean> {
  return invokeCommand('move_connection', { connectionId, targetGroupId })
}

export function toggleFavorite(connectionId: string): Promise<boolean> {
  return invokeCommand('toggle_favorite', { connectionId })
}

export function updateGroup(groupId: string, name: string, parentId?: string | null): Promise<ConnectionGroupRecord> {
  return invokeCommand('update_group', { groupId, name, parentId: parentId ?? null })
}

export function getAppVersion(): Promise<string> {
  return invokeCommand('get_app_version')
}
