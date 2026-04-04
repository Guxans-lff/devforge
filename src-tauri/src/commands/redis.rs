use std::sync::Arc;
use tauri::State;

use crate::models::redis::{
    ClusterNodeInfo, HashField, RedisCliResult, RedisKeyInfo, RedisScanResult, RedisServerInfo,
    RedisSlowLogConfig, RedisSlowLogEntry, RedisValue, StreamEntry, ZSetMember, PubSubSubscription,
    RedisMemoryStats, RedisKeyMemory, RedisClientInfo, LuaExecResult,
};
use crate::services::redis_engine::RedisEngine;
use crate::services::redis_pubsub::RedisPubSubManager;
use crate::services::redis_monitor::RedisMonitorManager;

/// Redis 引擎全局状态
pub type RedisEngineState = Arc<RedisEngine>;

/// PubSub 管理器全局状态
pub type RedisPubSubState = Arc<RedisPubSubManager>;

/// MONITOR 管理器全局状态
pub type RedisMonitorState = Arc<RedisMonitorManager>;

// ─── 连接管理 ───

/// 连接 Redis
#[tauri::command]
pub async fn redis_connect(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    host: String,
    port: u16,
    password: Option<String>,
    database: u8,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .connect(
            &connection_id,
            &host,
            port,
            password.as_deref(),
            database,
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

/// 断开 Redis 连接
#[tauri::command]
pub async fn redis_disconnect(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<(), String> {
    state.disconnect(&connection_id).await
}

/// 测试 Redis 连接
#[tauri::command]
pub async fn redis_test_connection(
    state: State<'_, RedisEngineState>,
    host: String,
    port: u16,
    password: Option<String>,
    database: u8,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .test_connection(
            &host,
            port,
            password.as_deref(),
            database,
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

/// 检查连接状态
#[tauri::command]
pub async fn redis_is_connected(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    Ok(state.is_connected(&connection_id).await)
}

/// 心跳检测：PING 验证连接存活
#[tauri::command]
pub async fn redis_ping(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<(), String> {
    state.ping(&connection_id).await
}

// ─── 数据库切换 ───

/// 切换数据库
#[tauri::command]
pub async fn redis_select_db(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    db: u8,
) -> Result<(), String> {
    state.select_db(&connection_id, db).await
}

/// 获取当前数据库键数量
#[tauri::command]
pub async fn redis_dbsize(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<u64, String> {
    state.dbsize(&connection_id).await
}

/// 获取当前数据库索引
#[tauri::command]
pub async fn redis_current_db(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<u8, String> {
    state.current_db(&connection_id).await
}

// ─── 键操作 ───

/// SCAN 扫描键
#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    cursor: u64,
    pattern: String,
    count: Option<u64>,
) -> Result<RedisScanResult, String> {
    state
        .scan_keys(&connection_id, cursor, &pattern, count.unwrap_or(100))
        .await
}

/// 获取键详细信息
#[tauri::command]
pub async fn redis_get_key_info(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<RedisKeyInfo, String> {
    state.get_key_info(&connection_id, &key).await
}

/// 获取键的值
#[tauri::command]
pub async fn redis_get_value(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<RedisValue, String> {
    state.get_value(&connection_id, &key).await
}

/// 设置 String 值
#[tauri::command]
pub async fn redis_set_string(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    value: String,
    ttl: Option<i64>,
) -> Result<(), String> {
    state
        .set_string(&connection_id, &key, &value, ttl)
        .await
}

/// 删除键
#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    keys: Vec<String>,
) -> Result<u64, String> {
    state.delete_keys(&connection_id, keys).await
}

/// 重命名键
#[tauri::command]
pub async fn redis_rename_key(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    state.rename_key(&connection_id, &old_key, &new_key).await
}

// ─── TTL ───

/// 设置 TTL
#[tauri::command]
pub async fn redis_set_ttl(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    seconds: i64,
) -> Result<(), String> {
    state.set_ttl(&connection_id, &key, seconds).await
}

/// 移除 TTL
#[tauri::command]
pub async fn redis_remove_ttl(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<(), String> {
    state.remove_ttl(&connection_id, &key).await
}

// ─── Hash ───

/// 获取 Hash 所有字段
#[tauri::command]
pub async fn redis_hash_get_all(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<Vec<HashField>, String> {
    state.hash_get_all(&connection_id, &key).await
}

/// 设置 Hash 字段
#[tauri::command]
pub async fn redis_hash_set(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    field: String,
    value: String,
) -> Result<(), String> {
    state.hash_set(&connection_id, &key, &field, &value).await
}

/// 删除 Hash 字段
#[tauri::command]
pub async fn redis_hash_del(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    fields: Vec<String>,
) -> Result<u64, String> {
    state.hash_del(&connection_id, &key, fields).await
}

// ─── List ───

/// 获取 List 范围
#[tauri::command]
pub async fn redis_list_range(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    start: isize,
    stop: isize,
) -> Result<Vec<String>, String> {
    state.list_range(&connection_id, &key, start, stop).await
}

/// 向 List 推入元素
#[tauri::command]
pub async fn redis_list_push(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    values: Vec<String>,
    head: bool,
) -> Result<u64, String> {
    state.list_push(&connection_id, &key, values, head).await
}

/// 设置 List 元素
#[tauri::command]
pub async fn redis_list_set(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    index: isize,
    value: String,
) -> Result<(), String> {
    state.list_set(&connection_id, &key, index, &value).await
}

/// 删除 List 元素
#[tauri::command]
pub async fn redis_list_rem(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    count: isize,
    value: String,
) -> Result<u64, String> {
    state.list_rem(&connection_id, &key, count, &value).await
}

// ─── Set ───

/// 获取 Set 成员
#[tauri::command]
pub async fn redis_set_members(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<Vec<String>, String> {
    state.set_members(&connection_id, &key).await
}

/// 添加 Set 成员
#[tauri::command]
pub async fn redis_set_add(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, String> {
    state.set_add(&connection_id, &key, members).await
}

/// 删除 Set 成员
#[tauri::command]
pub async fn redis_set_rem(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, String> {
    state.set_rem(&connection_id, &key, members).await
}

// ─── ZSet ───

/// 获取 ZSet 范围
#[tauri::command]
pub async fn redis_zset_range(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    start: isize,
    stop: isize,
) -> Result<Vec<ZSetMember>, String> {
    state.zset_range(&connection_id, &key, start, stop).await
}

/// 添加 ZSet 成员
#[tauri::command]
pub async fn redis_zset_add(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    member: String,
    score: f64,
) -> Result<(), String> {
    state
        .zset_add(&connection_id, &key, &member, score)
        .await
}

/// 删除 ZSet 成员
#[tauri::command]
pub async fn redis_zset_rem(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    members: Vec<String>,
) -> Result<u64, String> {
    state.zset_rem(&connection_id, &key, members).await
}

// ─── 服务器信息 ───

/// 获取服务器 INFO
#[tauri::command]
pub async fn redis_get_info(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    section: Option<String>,
) -> Result<RedisServerInfo, String> {
    state
        .get_info(&connection_id, section.as_deref())
        .await
}

// ─── CLI ───

/// 执行 Redis 命令
#[tauri::command]
pub async fn redis_execute_command(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    command: String,
) -> Result<RedisCliResult, String> {
    state.execute_command(&connection_id, &command).await
}

// ─── PubSub ───

/// 订阅 PubSub 频道/模式
#[tauri::command]
pub async fn redis_pubsub_subscribe(
    pubsub_state: State<'_, RedisPubSubState>,
    app_handle: tauri::AppHandle,
    connection_id: String,
    url: String,
    channels: Vec<String>,
    patterns: Vec<String>,
) -> Result<(), String> {
    pubsub_state
        .subscribe(&connection_id, &url, channels, patterns, app_handle)
        .await
}

/// 追加 PubSub 订阅
#[tauri::command]
pub async fn redis_pubsub_add(
    pubsub_state: State<'_, RedisPubSubState>,
    app_handle: tauri::AppHandle,
    connection_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
) -> Result<(), String> {
    pubsub_state
        .add_subscription(&connection_id, channels, patterns, app_handle)
        .await
}

/// 取消 PubSub 订阅
#[tauri::command]
pub async fn redis_pubsub_unsubscribe(
    pubsub_state: State<'_, RedisPubSubState>,
    app_handle: tauri::AppHandle,
    connection_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
) -> Result<(), String> {
    pubsub_state
        .remove_subscription(&connection_id, channels, patterns, app_handle)
        .await
}

/// 停止所有 PubSub 订阅
#[tauri::command]
pub async fn redis_pubsub_stop(
    pubsub_state: State<'_, RedisPubSubState>,
    connection_id: String,
) -> Result<(), String> {
    pubsub_state.stop(&connection_id).await;
    Ok(())
}

/// 获取当前 PubSub 订阅列表
#[tauri::command]
pub async fn redis_pubsub_get_subscriptions(
    pubsub_state: State<'_, RedisPubSubState>,
    connection_id: String,
) -> Result<PubSubSubscription, String> {
    let (channels, patterns) = pubsub_state.get_subscriptions(&connection_id).await;
    Ok(PubSubSubscription { channels, patterns })
}

/// 发布消息到频道
#[tauri::command]
pub async fn redis_publish(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    channel: String,
    message: String,
) -> Result<u64, String> {
    state.publish(&connection_id, &channel, &message).await
}

// ─── SLOWLOG ───

/// 获取慢查询日志条目
#[tauri::command]
pub async fn redis_slowlog_get(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    count: Option<i64>,
) -> Result<Vec<RedisSlowLogEntry>, String> {
    state.slowlog_get(&connection_id, count).await
}

/// 获取慢查询日志条数
#[tauri::command]
pub async fn redis_slowlog_len(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<i64, String> {
    state.slowlog_len(&connection_id).await
}

/// 重置慢查询日志
#[tauri::command]
pub async fn redis_slowlog_reset(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<(), String> {
    state.slowlog_reset(&connection_id).await
}

/// 获取慢查询配置（阈值 + 最大条数 + 当前条数）
#[tauri::command]
pub async fn redis_slowlog_config(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<RedisSlowLogConfig, String> {
    state.slowlog_config(&connection_id).await
}

/// 设置慢查询阈值（微秒）
#[tauri::command]
pub async fn redis_set_slowlog_threshold(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    microseconds: i64,
) -> Result<(), String> {
    state.set_slowlog_threshold(&connection_id, microseconds).await
}

/// 设置慢查询最大条数
#[tauri::command]
pub async fn redis_set_slowlog_max_len(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    max_len: i64,
) -> Result<(), String> {
    state.set_slowlog_max_len(&connection_id, max_len).await
}

// ─── Stream ───

/// 获取 Stream 条目范围
#[tauri::command]
pub async fn redis_stream_range(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    start: String,
    stop: String,
    count: Option<u64>,
    reverse: Option<bool>,
) -> Result<Vec<StreamEntry>, String> {
    state
        .stream_range(
            &connection_id,
            &key,
            &start,
            &stop,
            count,
            reverse.unwrap_or(false),
        )
        .await
}

/// 添加 Stream 条目
#[tauri::command]
pub async fn redis_stream_add(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    fields: Vec<(String, String)>,
    entry_id: Option<String>,
) -> Result<String, String> {
    state
        .stream_add(&connection_id, &key, fields, entry_id.as_deref())
        .await
}

/// 删除 Stream 条目
#[tauri::command]
pub async fn redis_stream_del(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
    ids: Vec<String>,
) -> Result<u64, String> {
    state.stream_del(&connection_id, &key, ids).await
}

/// 获取 Stream 长度
#[tauri::command]
pub async fn redis_stream_len(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<i64, String> {
    state.stream_len(&connection_id, &key).await
}

// ─── Cluster ───

/// 连接 Redis 集群
#[tauri::command]
pub async fn redis_connect_cluster(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    nodes: Vec<String>,
    password: Option<String>,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .connect_cluster(
            &connection_id,
            nodes,
            password.as_deref(),
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

/// 测试 Redis 集群连接
#[tauri::command]
pub async fn redis_test_cluster_connection(
    state: State<'_, RedisEngineState>,
    nodes: Vec<String>,
    password: Option<String>,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .test_cluster_connection(
            nodes,
            password.as_deref(),
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

/// 检查是否为 Cluster 连接
#[tauri::command]
pub async fn redis_is_cluster(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    Ok(state.is_cluster(&connection_id).await)
}

/// 获取集群信息（CLUSTER INFO）
#[tauri::command]
pub async fn redis_cluster_info(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<String, String> {
    state.cluster_info(&connection_id).await
}

/// 获取集群节点列表（CLUSTER NODES）
#[tauri::command]
pub async fn redis_cluster_nodes(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<Vec<ClusterNodeInfo>, String> {
    state.cluster_nodes(&connection_id).await
}

// ─── Sentinel ───

/// 通过 Sentinel 连接 Redis
#[tauri::command]
pub async fn redis_connect_sentinel(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    sentinel_nodes: Vec<String>,
    master_name: String,
    password: Option<String>,
    sentinel_password: Option<String>,
    database: u8,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .connect_sentinel(
            &connection_id,
            sentinel_nodes,
            &master_name,
            password.as_deref(),
            sentinel_password.as_deref(),
            database,
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

/// 测试 Sentinel 连接
#[tauri::command]
pub async fn redis_test_sentinel_connection(
    state: State<'_, RedisEngineState>,
    sentinel_nodes: Vec<String>,
    master_name: String,
    password: Option<String>,
    sentinel_password: Option<String>,
    database: u8,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    state
        .test_sentinel_connection(
            sentinel_nodes,
            &master_name,
            password.as_deref(),
            sentinel_password.as_deref(),
            database,
            use_tls,
            timeout_secs.unwrap_or(10),
        )
        .await
}

// ─── 内存分析 ───

/// 获取内存统计
#[tauri::command]
pub async fn redis_memory_stats(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<RedisMemoryStats, String> {
    state.memory_stats(&connection_id).await
}

/// 获取 MEMORY DOCTOR 建议
#[tauri::command]
pub async fn redis_memory_doctor(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<String, String> {
    state.memory_doctor(&connection_id).await
}

/// 获取单个键的内存占用
#[tauri::command]
pub async fn redis_memory_usage(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    key: String,
) -> Result<i64, String> {
    state.memory_usage_key(&connection_id, &key).await
}

/// 获取占用内存最多的 Top-N 键
#[tauri::command]
pub async fn redis_top_keys_by_memory(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    count: Option<usize>,
    pattern: Option<String>,
    scan_limit: Option<u64>,
) -> Result<Vec<RedisKeyMemory>, String> {
    state
        .top_keys_by_memory(
            &connection_id,
            count.unwrap_or(20),
            pattern.as_deref().unwrap_or("*"),
            scan_limit.unwrap_or(10000),
        )
        .await
}

// ─── 批量操作 ───

/// 批量删除键
#[tauri::command]
pub async fn redis_batch_delete(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    keys: Vec<String>,
) -> Result<u64, String> {
    state.batch_delete(&connection_id, keys).await
}

/// 批量设置 TTL
#[tauri::command]
pub async fn redis_batch_set_ttl(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    keys: Vec<String>,
    ttl_secs: i64,
) -> Result<u64, String> {
    state.batch_set_ttl(&connection_id, keys, ttl_secs).await
}

/// 批量导出键值
#[tauri::command]
pub async fn redis_batch_export(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    keys: Vec<String>,
) -> Result<Vec<serde_json::Value>, String> {
    state.batch_export(&connection_id, keys).await
}

/// 批量导入键值（接受 batch_export 相同格式的 JSON）
#[tauri::command]
pub async fn redis_batch_import(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    items: Vec<serde_json::Value>,
) -> Result<u64, String> {
    state.batch_import(&connection_id, items).await
}

// ─── CLIENT LIST ───

/// 获取客户端列表
#[tauri::command]
pub async fn redis_client_list(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<Vec<RedisClientInfo>, String> {
    state.client_list(&connection_id).await
}

/// 断开指定客户端
#[tauri::command]
pub async fn redis_client_kill(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    addr: String,
) -> Result<(), String> {
    state.client_kill(&connection_id, &addr).await
}

// ─── MONITOR ───

/// 启动 MONITOR
#[tauri::command]
pub async fn redis_monitor_start(
    monitor_state: State<'_, RedisMonitorState>,
    app_handle: tauri::AppHandle,
    connection_id: String,
    host: String,
    port: u16,
    password: Option<String>,
    use_tls: bool,
    timeout_secs: Option<u64>,
) -> Result<(), String> {
    monitor_state
        .start(
            &connection_id,
            &host,
            port,
            password.as_deref(),
            use_tls,
            timeout_secs.unwrap_or(10),
            app_handle,
        )
        .await
}

/// 停止 MONITOR
#[tauri::command]
pub async fn redis_monitor_stop(
    monitor_state: State<'_, RedisMonitorState>,
    connection_id: String,
) -> Result<(), String> {
    monitor_state.stop(&connection_id).await;
    Ok(())
}

// ─── Lua 脚本 ───

/// 执行 Lua 脚本
#[tauri::command]
pub async fn redis_eval_lua(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    script: String,
    keys: Vec<String>,
    args: Vec<String>,
) -> Result<LuaExecResult, String> {
    state.eval_lua(&connection_id, &script, keys, args).await
}

/// 加载 Lua 脚本到服务器
#[tauri::command]
pub async fn redis_script_load(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    script: String,
) -> Result<String, String> {
    state.script_load(&connection_id, &script).await
}

/// 检查脚本是否存在
#[tauri::command]
pub async fn redis_script_exists(
    state: State<'_, RedisEngineState>,
    connection_id: String,
    shas: Vec<String>,
) -> Result<Vec<bool>, String> {
    state.script_exists(&connection_id, shas).await
}

/// 清除脚本缓存
#[tauri::command]
pub async fn redis_script_flush(
    state: State<'_, RedisEngineState>,
    connection_id: String,
) -> Result<(), String> {
    state.script_flush(&connection_id).await
}
