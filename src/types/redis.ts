/** Redis 数据类型定义 */

/** Redis 键信息 */
export interface RedisKeyInfo {
  key: string
  keyType: string
  ttl: number
  memoryUsage: number | null
  size: number
}

/** Hash 字段 */
export interface HashField {
  field: string
  value: string
}

/** ZSet 成员 */
export interface ZSetMember {
  member: string
  score: number
}

/** Stream 条目 */
export interface StreamEntry {
  id: string
  fields: [string, string][]
}

/** Redis 值（tagged union） */
export type RedisValue =
  | { type: 'string'; value: string }
  | { type: 'hash'; fields: HashField[] }
  | { type: 'list'; items: string[]; total: number }
  | { type: 'set'; members: string[] }
  | { type: 'zset'; members: ZSetMember[] }
  | { type: 'stream'; entries: StreamEntry[]; total: number }
  | { type: 'unknown'; raw: string }

/** SCAN 结果 */
export interface RedisScanResult {
  cursor: number
  keys: string[]
}

/** INFO section */
export interface RedisInfoSection {
  name: string
  entries: RedisInfoEntry[]
}

export interface RedisInfoEntry {
  key: string
  value: string
}

/** 服务器信息 */
export interface RedisServerInfo {
  sections: RedisInfoSection[]
}

/** CLI 执行结果 */
export interface RedisCliResult {
  command: string
  result: string
  durationMs: number
  isError: boolean
}

/** Redis 连接配置（存 configJson） */
export interface RedisConfig {
  database: number
  useTls: boolean
  timeoutSecs: number
  notes: string
  /** 是否为 Cluster 模式 */
  isCluster?: boolean
  /** Cluster 节点列表（"host:port" 格式） */
  clusterNodes?: string[]
  /** 是否为 Sentinel 模式 */
  isSentinel?: boolean
  /** Sentinel 节点列表（"host:port" 格式） */
  sentinelNodes?: string[]
  /** Sentinel Master 名称 */
  sentinelMasterName?: string
  /** Sentinel 自身密码 */
  sentinelPassword?: string
}

/** Cluster 节点信息（CLUSTER NODES 解析结果） */
export interface ClusterNodeInfo {
  /** 节点 ID */
  id: string
  /** 节点地址（host:port） */
  addr: string
  /** 角色标志（master/slave/...） */
  flags: string
  /** 主节点 ID（从节点指向主节点，主节点为 "-"） */
  masterId: string
  /** 哈希槽范围（如 "0-5460"） */
  slots: string
  /** 是否已连接 */
  connected: boolean
}

/** PubSub 消息 */
export interface PubSubMessage {
  channel: string
  pattern: string | null
  payload: string
  timestampMs: number
}

/** PubSub 订阅信息 */
export interface PubSubSubscription {
  channels: string[]
  patterns: string[]
}

/** 慢查询日志条目 */
export interface RedisSlowLogEntry {
  id: number
  timestamp: number
  durationUs: number
  command: string
  commandArgs: string[]
  clientAddr: string
  clientName?: string
}

/** 慢查询配置 */
export interface RedisSlowLogConfig {
  thresholdUs: number
  maxLen: number
  currentLen: number
}

/** 内存统计信息 */
export interface RedisMemoryStats {
  usedMemory: number
  usedMemoryHuman: string
  usedMemoryPeak: number
  usedMemoryPeakHuman: string
  memFragmentationRatio: number
  evictedKeys: number
}

/** 键内存占用 */
export interface RedisKeyMemory {
  key: string
  memoryBytes: number
  keyType: string
}

/** 客户端连接信息 */
export interface RedisClientInfo {
  id: string
  addr: string
  name: string | null
  age: number
  idle: number
  flags: string
  db: number
  cmd: string | null
}

/** MONITOR 实时消息 */
export interface RedisMonitorMessage {
  timestamp: number
  clientAddr: string
  database: string
  command: string
  raw: string
}

/** Lua 脚本执行结果 */
export interface LuaExecResult {
  result: unknown
  durationMs: number
}

/** 批量导出的键值 */
export interface BatchExportItem {
  key: string
  keyType: string
  ttl: number
  value: unknown
}
