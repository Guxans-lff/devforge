import { invokeCommand } from '@/api/base'
import type {
  RedisKeyInfo,
  RedisValue,
  RedisScanResult,
  RedisServerInfo,
  RedisCliResult,
  HashField,
  ZSetMember,
  StreamEntry,
  PubSubSubscription,
  RedisSlowLogEntry,
  RedisSlowLogConfig,
  ClusterNodeInfo,
} from '@/types/redis'

// ─── 连接管理 ───

/** 连接 Redis */
export function redisConnect(params: {
  connectionId: string
  host: string
  port: number
  password?: string | null
  database?: number
  useTls?: boolean
  timeoutSecs?: number
}): Promise<string> {
  return invokeCommand('redis_connect', {
    connectionId: params.connectionId,
    host: params.host,
    port: params.port,
    password: params.password ?? null,
    database: params.database ?? 0,
    useTls: params.useTls ?? false,
    timeoutSecs: params.timeoutSecs ?? 10,
  })
}

/** 断开 Redis 连接 */
export function redisDisconnect(connectionId: string): Promise<void> {
  return invokeCommand('redis_disconnect', { connectionId })
}

/** 测试 Redis 连接 */
export function redisTestConnection(params: {
  host: string
  port: number
  password?: string | null
  database?: number
  useTls?: boolean
  timeoutSecs?: number
}): Promise<string> {
  return invokeCommand('redis_test_connection', {
    host: params.host,
    port: params.port,
    password: params.password ?? null,
    database: params.database ?? 0,
    useTls: params.useTls ?? false,
    timeoutSecs: params.timeoutSecs ?? 10,
  })
}

/** 检查连接状态 */
export function redisIsConnected(connectionId: string): Promise<boolean> {
  return invokeCommand('redis_is_connected', { connectionId })
}

/** 心跳检测：PING 验证连接存活 */
export function redisPing(connectionId: string): Promise<void> {
  return invokeCommand('redis_ping', { connectionId })
}

// ─── 数据库切换 ───

/** 切换数据库 */
export function redisSelectDb(connectionId: string, db: number): Promise<void> {
  return invokeCommand('redis_select_db', { connectionId, db })
}

/** 获取 DBSIZE */
export function redisDbsize(connectionId: string): Promise<number> {
  return invokeCommand('redis_dbsize', { connectionId })
}

/** 获取当前数据库索引 */
export function redisCurrentDb(connectionId: string): Promise<number> {
  return invokeCommand('redis_current_db', { connectionId })
}

// ─── 键操作 ───

/** SCAN 扫描键 */
export function redisScanKeys(params: {
  connectionId: string
  cursor: number
  pattern: string
  count?: number
}): Promise<RedisScanResult> {
  return invokeCommand('redis_scan_keys', {
    connectionId: params.connectionId,
    cursor: params.cursor,
    pattern: params.pattern,
    count: params.count ?? 100,
  })
}

/** 获取键信息 */
export function redisGetKeyInfo(connectionId: string, key: string): Promise<RedisKeyInfo> {
  return invokeCommand('redis_get_key_info', { connectionId, key })
}

/** 获取键的值 */
export function redisGetValue(connectionId: string, key: string): Promise<RedisValue> {
  return invokeCommand('redis_get_value', { connectionId, key })
}

/** 设置 String 值 */
export function redisSetString(connectionId: string, key: string, value: string, ttl?: number): Promise<void> {
  return invokeCommand('redis_set_string', { connectionId, key, value, ttl: ttl ?? null })
}

/** 删除键 */
export function redisDeleteKeys(connectionId: string, keys: string[]): Promise<number> {
  return invokeCommand('redis_delete_keys', { connectionId, keys })
}

/** 重命名键 */
export function redisRenameKey(connectionId: string, oldKey: string, newKey: string): Promise<void> {
  return invokeCommand('redis_rename_key', { connectionId, oldKey, newKey })
}

// ─── TTL ───

/** 设置 TTL */
export function redisSetTtl(connectionId: string, key: string, seconds: number): Promise<void> {
  return invokeCommand('redis_set_ttl', { connectionId, key, seconds })
}

/** 移除 TTL */
export function redisRemoveTtl(connectionId: string, key: string): Promise<void> {
  return invokeCommand('redis_remove_ttl', { connectionId, key })
}

// ─── Hash ───

/** 获取 Hash 所有字段 */
export function redisHashGetAll(connectionId: string, key: string): Promise<HashField[]> {
  return invokeCommand('redis_hash_get_all', { connectionId, key })
}

/** 设置 Hash 字段 */
export function redisHashSet(connectionId: string, key: string, field: string, value: string): Promise<void> {
  return invokeCommand('redis_hash_set', { connectionId, key, field, value })
}

/** 删除 Hash 字段 */
export function redisHashDel(connectionId: string, key: string, fields: string[]): Promise<number> {
  return invokeCommand('redis_hash_del', { connectionId, key, fields })
}

// ─── List ───

/** 获取 List 范围 */
export function redisListRange(connectionId: string, key: string, start: number, stop: number): Promise<string[]> {
  return invokeCommand('redis_list_range', { connectionId, key, start, stop })
}

/** 推入 List 元素 */
export function redisListPush(connectionId: string, key: string, values: string[], head: boolean): Promise<number> {
  return invokeCommand('redis_list_push', { connectionId, key, values, head })
}

/** 设置 List 元素 */
export function redisListSet(connectionId: string, key: string, index: number, value: string): Promise<void> {
  return invokeCommand('redis_list_set', { connectionId, key, index, value })
}

/** 删除 List 元素 */
export function redisListRem(connectionId: string, key: string, count: number, value: string): Promise<number> {
  return invokeCommand('redis_list_rem', { connectionId, key, count, value })
}

// ─── Set ───

/** 获取 Set 成员 */
export function redisSetMembers(connectionId: string, key: string): Promise<string[]> {
  return invokeCommand('redis_set_members', { connectionId, key })
}

/** 添加 Set 成员 */
export function redisSetAdd(connectionId: string, key: string, members: string[]): Promise<number> {
  return invokeCommand('redis_set_add', { connectionId, key, members })
}

/** 删除 Set 成员 */
export function redisSetRem(connectionId: string, key: string, members: string[]): Promise<number> {
  return invokeCommand('redis_set_rem', { connectionId, key, members })
}

// ─── ZSet ───

/** 获取 ZSet 范围 */
export function redisZsetRange(connectionId: string, key: string, start: number, stop: number): Promise<ZSetMember[]> {
  return invokeCommand('redis_zset_range', { connectionId, key, start, stop })
}

/** 添加 ZSet 成员 */
export function redisZsetAdd(connectionId: string, key: string, member: string, score: number): Promise<void> {
  return invokeCommand('redis_zset_add', { connectionId, key, member, score })
}

/** 删除 ZSet 成员 */
export function redisZsetRem(connectionId: string, key: string, members: string[]): Promise<number> {
  return invokeCommand('redis_zset_rem', { connectionId, key, members })
}

// ─── 服务器信息 ───

/** 获取 INFO */
export function redisGetInfo(connectionId: string, section?: string): Promise<RedisServerInfo> {
  return invokeCommand('redis_get_info', { connectionId, section: section ?? null })
}

// ─── CLI ───

/** 执行 Redis 命令 */
export function redisExecuteCommand(connectionId: string, command: string): Promise<RedisCliResult> {
  return invokeCommand('redis_execute_command', { connectionId, command })
}

// ─── PubSub ───

/** 订阅 PubSub 频道/模式 */
export function redisPubsubSubscribe(
  connectionId: string,
  url: string,
  channels: string[],
  patterns: string[],
): Promise<void> {
  return invokeCommand('redis_pubsub_subscribe', { connectionId, url, channels, patterns })
}

/** 追加 PubSub 订阅 */
export function redisPubsubAdd(
  connectionId: string,
  channels: string[],
  patterns: string[],
): Promise<void> {
  return invokeCommand('redis_pubsub_add', { connectionId, channels, patterns })
}

/** 取消 PubSub 订阅 */
export function redisPubsubUnsubscribe(
  connectionId: string,
  channels: string[],
  patterns: string[],
): Promise<void> {
  return invokeCommand('redis_pubsub_unsubscribe', { connectionId, channels, patterns })
}

/** 停止所有 PubSub 订阅 */
export function redisPubsubStop(connectionId: string): Promise<void> {
  return invokeCommand('redis_pubsub_stop', { connectionId })
}

/** 获取当前 PubSub 订阅列表 */
export function redisPubsubGetSubscriptions(connectionId: string): Promise<PubSubSubscription> {
  return invokeCommand('redis_pubsub_get_subscriptions', { connectionId })
}

/** 发布消息到频道 */
export function redisPublish(connectionId: string, channel: string, message: string): Promise<number> {
  return invokeCommand('redis_publish', { connectionId, channel, message })
}

// ─── SLOWLOG ───

/** 获取慢查询日志 */
export function redisSlowlogGet(connectionId: string, count?: number): Promise<RedisSlowLogEntry[]> {
  return invokeCommand('redis_slowlog_get', { connectionId, count: count ?? null })
}

/** 获取慢查询日志条数 */
export function redisSlowlogLen(connectionId: string): Promise<number> {
  return invokeCommand('redis_slowlog_len', { connectionId })
}

/** 重置慢查询日志 */
export function redisSlowlogReset(connectionId: string): Promise<void> {
  return invokeCommand('redis_slowlog_reset', { connectionId })
}

/** 获取慢查询配置 */
export function redisSlowlogConfig(connectionId: string): Promise<RedisSlowLogConfig> {
  return invokeCommand('redis_slowlog_config', { connectionId })
}

/** 设置慢查询阈值（微秒） */
export function redisSetSlowlogThreshold(connectionId: string, microseconds: number): Promise<void> {
  return invokeCommand('redis_set_slowlog_threshold', { connectionId, microseconds })
}

/** 设置慢查询最大条数 */
export function redisSetSlowlogMaxLen(connectionId: string, maxLen: number): Promise<void> {
  return invokeCommand('redis_set_slowlog_max_len', { connectionId, maxLen })
}

// ─── Stream ───

/** 获取 Stream 条目范围（XRANGE/XREVRANGE） */
export function redisStreamRange(params: {
  connectionId: string
  key: string
  start: string
  stop: string
  count?: number
  reverse?: boolean
}): Promise<StreamEntry[]> {
  return invokeCommand('redis_stream_range', {
    connectionId: params.connectionId,
    key: params.key,
    start: params.start,
    stop: params.stop,
    count: params.count ?? null,
    reverse: params.reverse ?? false,
  })
}

/** 添加 Stream 条目（XADD） */
export function redisStreamAdd(params: {
  connectionId: string
  key: string
  fields: [string, string][]
  entryId?: string
}): Promise<string> {
  return invokeCommand('redis_stream_add', {
    connectionId: params.connectionId,
    key: params.key,
    fields: params.fields,
    entryId: params.entryId ?? null,
  })
}

/** 删除 Stream 条目（XDEL） */
export function redisStreamDel(connectionId: string, key: string, ids: string[]): Promise<number> {
  return invokeCommand('redis_stream_del', { connectionId, key, ids })
}

/** 获取 Stream 长度（XLEN） */
export function redisStreamLen(connectionId: string, key: string): Promise<number> {
  return invokeCommand('redis_stream_len', { connectionId, key })
}

// ─── Cluster ───

/** 连接 Redis 集群 */
export function redisConnectCluster(params: {
  connectionId: string
  nodes: string[]
  password?: string | null
  useTls?: boolean
  timeoutSecs?: number
}): Promise<string> {
  return invokeCommand('redis_connect_cluster', {
    connectionId: params.connectionId,
    nodes: params.nodes,
    password: params.password ?? null,
    useTls: params.useTls ?? false,
    timeoutSecs: params.timeoutSecs ?? 10,
  })
}

/** 测试 Redis 集群连接 */
export function redisTestClusterConnection(params: {
  nodes: string[]
  password?: string | null
  useTls?: boolean
  timeoutSecs?: number
}): Promise<string> {
  return invokeCommand('redis_test_cluster_connection', {
    nodes: params.nodes,
    password: params.password ?? null,
    useTls: params.useTls ?? false,
    timeoutSecs: params.timeoutSecs ?? 10,
  })
}

/** 检查是否为 Cluster 连接 */
export function redisIsCluster(connectionId: string): Promise<boolean> {
  return invokeCommand('redis_is_cluster', { connectionId })
}

/** 获取集群信息（CLUSTER INFO） */
export function redisClusterInfo(connectionId: string): Promise<string> {
  return invokeCommand('redis_cluster_info', { connectionId })
}

/** 获取集群节点列表（CLUSTER NODES） */
export function redisClusterNodes(connectionId: string): Promise<ClusterNodeInfo[]> {
  return invokeCommand('redis_cluster_nodes', { connectionId })
}
