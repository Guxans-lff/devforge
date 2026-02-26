export type ConnectionType = 'database' | 'ssh' | 'sftp'

export type DatabaseDriver = 'mysql' | 'postgresql' | 'sqlite' | 'mssql'

export interface ConnectionConfig {
  id: string
  name: string
  type: ConnectionType
  group?: string
  host: string
  port: number
  username: string
  color?: string
  createdAt: number
  updatedAt: number
}

export interface DatabaseConnectionConfig extends ConnectionConfig {
  type: 'database'
  driver: DatabaseDriver
  database?: string
  sshTunnel?: {
    enabled: boolean
    sshConnectionId: string
  }
}

export interface SshConnectionConfig extends ConnectionConfig {
  type: 'ssh'
  authMethod: 'password' | 'key' | 'agent'
  privateKeyPath?: string
}

export interface SftpConnectionConfig extends ConnectionConfig {
  type: 'sftp'
  sshConnectionId?: string
  authMethod: 'password' | 'key' | 'agent'
  privateKeyPath?: string
  remotePath?: string
}

export type AnyConnectionConfig =
  | DatabaseConnectionConfig
  | SshConnectionConfig
  | SftpConnectionConfig

export interface ConnectionGroup {
  id: string
  name: string
  expanded: boolean
  connections: string[]
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionState {
  config: AnyConnectionConfig
  status: ConnectionStatus
  error?: string
}
