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

/** SSL/TLS 连接配置 */
export interface SslConfig {
  mode: 'disabled' | 'preferred' | 'required' | 'verify-ca' | 'verify-identity'
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/** 连接池配置 */
export interface PoolConfig {
  minConnections: number   // 最小连接数，默认 1
  maxConnections: number   // 最大连接数，默认 10
  idleTimeoutSecs: number  // 空闲超时（秒），默认 300
}

/** 连接池运行状态 */
export interface PoolStatus {
  activeConnections: number
  idleConnections: number
  maxConnections: number
}

export interface DatabaseConnectionConfig extends ConnectionConfig {
  type: 'database'
  driver: DatabaseDriver
  database?: string
  ssl?: SslConfig
  pool?: PoolConfig
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

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

/** 自动重连参数（与后端 ReconnectParams 对应） */
export interface ReconnectParams {
  driver: string
  host: string
  port: number
  username: string
  password: string
  database?: string
  sslConfig?: SslConfig
  poolConfig?: PoolConfig
}

/** 自动重连结果（与后端 ReconnectResult 对应） */
export interface ReconnectResult {
  success: boolean
  attempt: number
  message: string
}

export interface ConnectionState {
  config: AnyConnectionConfig
  status: ConnectionStatus
  error?: string
}
