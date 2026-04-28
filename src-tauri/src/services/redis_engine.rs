use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::RwLock;

use redis::aio::MultiplexedConnection;
use redis::cluster::ClusterClient;
use redis::cluster_async::ClusterConnection;
use redis::{Client, Cmd, Value};

use crate::models::redis::{
    ClusterNodeInfo, HashField, RedisCliResult, RedisKeyInfo, RedisScanResult, RedisServerInfo,
    RedisInfoSection, RedisInfoEntry, RedisSlowLogConfig, RedisSlowLogEntry,
    RedisValue, StreamEntry, ZSetMember,
    RedisMemoryStats, RedisKeyMemory, RedisClientInfo, LuaExecResult,
};

/// 连接类型枚举
enum RedisConn {
    /// 单机模式（连接, 当前数据库索引）
    Standalone(MultiplexedConnection, u8),
    /// 集群模式（只有 DB 0）
    Cluster(ClusterConnection),
}

/// Redis 引擎
///
/// 管理多个 Redis 连接（单机/集群），提供键值操作、服务器管理、CLI 执行等功能。
/// 内部使用 RwLock，线程安全，无需外层 Mutex。
pub struct RedisEngine {
    connections: RwLock<HashMap<String, RedisConn>>,
}

impl RedisEngine {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    /// 构建 Redis 连接 URL
    fn build_url(host: &str, port: u16, password: Option<&str>, database: u8, use_tls: bool) -> String {
        let scheme = if use_tls { "rediss" } else { "redis" };
        let auth = match password {
            Some(pw) if !pw.is_empty() => format!(":{}@", urlencoding::encode(pw)),
            _ => String::new(),
        };
        format!("{}://{}{}:{}/{}", scheme, auth, host, port, database)
    }

    /// 构建 Cluster 节点 URL 列表
    fn build_cluster_urls(nodes: &[String], password: Option<&str>, use_tls: bool) -> Vec<String> {
        let scheme = if use_tls { "rediss" } else { "redis" };
        let auth = match password {
            Some(pw) if !pw.is_empty() => format!(":{}@", urlencoding::encode(pw)),
            _ => String::new(),
        };
        nodes.iter().map(|node| format!("{}://{}{}", scheme, auth, node)).collect()
    }

    /// 在任意连接上执行 redis 命令（统一入口）
    async fn exec_cmd<T: redis::FromRedisValue>(
        &self,
        connection_id: &str,
        cmd: &mut Cmd,
    ) -> Result<T, String> {
        let mut conns = self.connections.write().await;
        match conns.get_mut(connection_id) {
            Some(RedisConn::Standalone(conn, _)) => {
                cmd.query_async(conn).await.map_err(|e| e.to_string())
            }
            Some(RedisConn::Cluster(conn)) => {
                cmd.query_async(conn).await.map_err(|e| e.to_string())
            }
            None => Err("Redis 连接已断开，请重新连接".to_string()),
        }
    }

    /// 在任意连接上执行 redis 命令（不可变引用版，用于只读操作）
    /// 注意：MultiplexedConnection 和 ClusterConnection 的 query_async 需要 &mut self
    /// 所以这里也需要 write lock

    // ─── 连接管理 ───

    /// 连接 Redis 单机实例
    pub async fn connect(
        &self,
        connection_id: &str,
        host: &str,
        port: u16,
        password: Option<&str>,
        database: u8,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let url = Self::build_url(host, port, password, database, use_tls);
        let client = Client::open(url.as_str()).map_err(|e| format!("创建客户端失败: {}", e))?;

        let conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_multiplexed_async_connection(),
        )
        .await
        .map_err(|_| format!("连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("连接失败: {}", e))?;

        let mut conns = self.connections.write().await;
        conns.insert(connection_id.to_string(), RedisConn::Standalone(conn, database));

        Ok(format!("已连接到 {}:{}/{}", host, port, database))
    }

    /// 连接 Redis 集群
    pub async fn connect_cluster(
        &self,
        connection_id: &str,
        nodes: Vec<String>,
        password: Option<&str>,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let urls = Self::build_cluster_urls(&nodes, password, use_tls);

        let client = if let Some(pw) = password.filter(|p| !p.is_empty()) {
            redis::cluster::ClusterClientBuilder::new(urls.clone())
                .password(pw.to_string())
                .build()
                .map_err(|e| format!("创建集群客户端失败: {}", e))?
        } else {
            ClusterClient::new(urls.clone())
                .map_err(|e| format!("创建集群客户端失败: {}", e))?
        };

        let conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_async_connection(),
        )
        .await
        .map_err(|_| format!("集群连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("集群连接失败: {}", e))?;

        let mut conns = self.connections.write().await;
        conns.insert(connection_id.to_string(), RedisConn::Cluster(conn));

        let node_count = nodes.len();
        Ok(format!("已连接到集群（{} 个节点）", node_count))
    }

    /// 断开连接
    pub async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        let mut conns = self.connections.write().await;
        conns.remove(connection_id);
        Ok(())
    }

    /// 测试单机连接（不保存）
    pub async fn test_connection(
        &self,
        host: &str,
        port: u16,
        password: Option<&str>,
        database: u8,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let url = Self::build_url(host, port, password, database, use_tls);
        let client = Client::open(url.as_str()).map_err(|e| format!("创建客户端失败: {}", e))?;

        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_multiplexed_async_connection(),
        )
        .await
        .map_err(|_| format!("连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("连接失败: {}", e))?;

        // PING 验证
        let pong: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("PING 失败: {}", e))?;

        // 获取版本信息
        let info: String = redis::cmd("INFO")
            .arg("server")
            .query_async(&mut conn)
            .await
            .unwrap_or_default();

        let version = info
            .lines()
            .find(|l| l.starts_with("redis_version:"))
            .map(|l| l.trim_start_matches("redis_version:").trim())
            .unwrap_or("unknown");

        Ok(format!("{} — Redis {}", pong, version))
    }

    /// 测试集群连接（不保存）
    pub async fn test_cluster_connection(
        &self,
        nodes: Vec<String>,
        password: Option<&str>,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let urls = Self::build_cluster_urls(&nodes, password, use_tls);

        let client = if let Some(pw) = password.filter(|p| !p.is_empty()) {
            redis::cluster::ClusterClientBuilder::new(urls)
                .password(pw.to_string())
                .build()
                .map_err(|e| format!("创建集群客户端失败: {}", e))?
        } else {
            ClusterClient::new(urls)
                .map_err(|e| format!("创建集群客户端失败: {}", e))?
        };

        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_async_connection(),
        )
        .await
        .map_err(|_| format!("集群连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("集群连接失败: {}", e))?;

        // PING 验证
        let pong: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("PING 失败: {}", e))?;

        // CLUSTER INFO 获取节点数
        let cluster_info: String = redis::cmd("CLUSTER")
            .arg("INFO")
            .query_async(&mut conn)
            .await
            .unwrap_or_default();

        let cluster_size = cluster_info
            .lines()
            .find(|l| l.starts_with("cluster_known_nodes:"))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|v| v.trim().parse::<u32>().ok())
            .unwrap_or(0);

        Ok(format!("{} — Cluster ({} nodes)", pong, cluster_size))
    }

    /// 检查连接是否存活
    pub async fn is_connected(&self, connection_id: &str) -> bool {
        let conns = self.connections.read().await;
        conns.contains_key(connection_id)
    }

    /// 当前是否为 Cluster 连接
    pub async fn is_cluster(&self, connection_id: &str) -> bool {
        let conns = self.connections.read().await;
        matches!(conns.get(connection_id), Some(RedisConn::Cluster(_)))
    }

    /// 心跳检测
    pub async fn ping(&self, connection_id: &str) -> Result<(), String> {
        self.exec_cmd::<String>(connection_id, &mut redis::cmd("PING"))
            .await?;
        Ok(())
    }

    // ─── 数据库切换 ───

    /// 切换数据库（Cluster 模式不支持）
    pub async fn select_db(&self, connection_id: &str, db: u8) -> Result<(), String> {
        let mut conns = self.connections.write().await;
        match conns.get_mut(connection_id) {
            Some(RedisConn::Standalone(conn, current_db)) => {
                redis::cmd("SELECT")
                    .arg(db)
                    .query_async::<()>(conn)
                    .await
                    .map_err(|e| format!("切换数据库失败: {}", e))?;
                *current_db = db;
                Ok(())
            }
            Some(RedisConn::Cluster(_)) => {
                Err("集群模式不支持切换数据库".to_string())
            }
            None => Err("Redis 连接已断开，请重新连接".to_string()),
        }
    }

    /// 获取当前数据库键数量
    pub async fn dbsize(&self, connection_id: &str) -> Result<u64, String> {
        self.exec_cmd(connection_id, &mut redis::cmd("DBSIZE")).await
            .map_err(|e| format!("DBSIZE 失败: {}", e))
    }

    /// 获取当前数据库索引（Cluster 返回 0）
    pub async fn current_db(&self, connection_id: &str) -> Result<u8, String> {
        let conns = self.connections.read().await;
        match conns.get(connection_id) {
            Some(RedisConn::Standalone(_, db)) => Ok(*db),
            Some(RedisConn::Cluster(_)) => Ok(0),
            None => Err("Redis 连接已断开，请重新连接".to_string()),
        }
    }

    // ─── 键操作 ───

    /// SCAN 扫描键
    pub async fn scan_keys(
        &self,
        connection_id: &str,
        cursor: u64,
        pattern: &str,
        count: u64,
    ) -> Result<RedisScanResult, String> {
        let result: (u64, Vec<String>) = self.exec_cmd(
            connection_id,
            redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count),
        ).await.map_err(|e| format!("SCAN 失败: {}", e))?;

        Ok(RedisScanResult {
            cursor: result.0,
            keys: result.1,
        })
    }

    /// 获取键详细信息（类型、TTL、大小、内存）
    pub async fn get_key_info(&self, connection_id: &str, key: &str) -> Result<RedisKeyInfo, String> {
        // TYPE
        let key_type: String = self.exec_cmd(
            connection_id,
            redis::cmd("TYPE").arg(key),
        ).await.map_err(|e| format!("TYPE 失败: {}", e))?;

        // TTL
        let ttl: i64 = self.exec_cmd(
            connection_id,
            redis::cmd("TTL").arg(key),
        ).await.map_err(|e| format!("TTL 失败: {}", e))?;

        // 内存占用（MEMORY USAGE 可能不可用）
        let memory_usage: Option<i64> = self.exec_cmd(
            connection_id,
            redis::cmd("MEMORY").arg("USAGE").arg(key),
        ).await.ok();

        // 元素数量
        let size: i64 = match key_type.as_str() {
            "string" => self.exec_cmd(connection_id, redis::cmd("STRLEN").arg(key)).await.unwrap_or(0),
            "hash" => self.exec_cmd(connection_id, redis::cmd("HLEN").arg(key)).await.unwrap_or(0),
            "list" => self.exec_cmd(connection_id, redis::cmd("LLEN").arg(key)).await.unwrap_or(0),
            "set" => self.exec_cmd(connection_id, redis::cmd("SCARD").arg(key)).await.unwrap_or(0),
            "zset" => self.exec_cmd(connection_id, redis::cmd("ZCARD").arg(key)).await.unwrap_or(0),
            "stream" => self.exec_cmd(connection_id, redis::cmd("XLEN").arg(key)).await.unwrap_or(0),
            _ => 0,
        };

        Ok(RedisKeyInfo {
            key: key.to_string(),
            key_type,
            ttl,
            memory_usage,
            size,
        })
    }

    /// 获取键的值
    pub async fn get_value(&self, connection_id: &str, key: &str) -> Result<RedisValue, String> {
        let key_type: String = self.exec_cmd(
            connection_id,
            redis::cmd("TYPE").arg(key),
        ).await.map_err(|e| format!("TYPE 失败: {}", e))?;

        match key_type.as_str() {
            "string" => {
                let value: String = self.exec_cmd(
                    connection_id,
                    redis::cmd("GET").arg(key),
                ).await.map_err(|e| format!("GET 失败: {}", e))?;
                Ok(RedisValue::String { value })
            }
            "hash" => {
                let raw: Vec<(String, String)> = self.exec_cmd(
                    connection_id,
                    redis::cmd("HGETALL").arg(key),
                ).await.map_err(|e| format!("HGETALL 失败: {}", e))?;
                let fields = raw.into_iter().map(|(f, v)| HashField { field: f, value: v }).collect();
                Ok(RedisValue::Hash { fields })
            }
            "list" => {
                let total: i64 = self.exec_cmd(
                    connection_id,
                    redis::cmd("LLEN").arg(key),
                ).await.unwrap_or(0);
                let end = std::cmp::min(total, 500) - 1;
                let items: Vec<String> = self.exec_cmd(
                    connection_id,
                    redis::cmd("LRANGE").arg(key).arg(0).arg(end),
                ).await.map_err(|e| format!("LRANGE 失败: {}", e))?;
                Ok(RedisValue::List { items, total })
            }
            "set" => {
                let members: Vec<String> = self.exec_cmd(
                    connection_id,
                    redis::cmd("SMEMBERS").arg(key),
                ).await.map_err(|e| format!("SMEMBERS 失败: {}", e))?;
                Ok(RedisValue::Set { members })
            }
            "zset" => {
                let raw: Value = self.exec_cmd(
                    connection_id,
                    redis::cmd("ZRANGE").arg(key).arg(0).arg(-1).arg("WITHSCORES"),
                ).await.map_err(|e| format!("ZRANGE 失败: {}", e))?;
                let members = Self::parse_zset_withscores(raw);
                Ok(RedisValue::ZSet { members })
            }
            "stream" => {
                let total: i64 = self.exec_cmd(
                    connection_id,
                    redis::cmd("XLEN").arg(key),
                ).await.unwrap_or(0);
                let raw: Value = self.exec_cmd(
                    connection_id,
                    redis::cmd("XRANGE").arg(key).arg("-").arg("+").arg("COUNT").arg(500),
                ).await.map_err(|e| format!("XRANGE 失败: {}", e))?;
                let entries = Self::parse_stream_entries(raw);
                Ok(RedisValue::Stream { entries, total })
            }
            other => Ok(RedisValue::Unknown {
                raw: format!("不支持的类型: {}", other),
            }),
        }
    }

    /// 解析 ZRANGE ... WITHSCORES 返回的原始 Value
    fn parse_zset_withscores(value: Value) -> Vec<ZSetMember> {
        let mut members = Vec::new();
        if let Value::Array(items) = value {
            let mut i = 0;
            while i + 1 < items.len() {
                let member = Self::value_to_string(&items[i]);
                let score = match &items[i + 1] {
                    Value::BulkString(bytes) => String::from_utf8_lossy(bytes).parse::<f64>().unwrap_or(0.0),
                    Value::Double(f) => *f,
                    Value::Int(n) => *n as f64,
                    _ => 0.0,
                };
                members.push(ZSetMember { member, score });
                i += 2;
            }
        }
        members
    }

    /// 设置 String 值
    pub async fn set_string(
        &self,
        connection_id: &str,
        key: &str,
        value: &str,
        ttl: Option<i64>,
    ) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("SET").arg(key).arg(value),
        ).await.map_err(|e| format!("SET 失败: {}", e))?;

        if let Some(seconds) = ttl {
            if seconds > 0 {
                self.exec_cmd::<()>(
                    connection_id,
                    redis::cmd("EXPIRE").arg(key).arg(seconds),
                ).await.map_err(|e| format!("EXPIRE 失败: {}", e))?;
            }
        }
        Ok(())
    }

    /// 删除键
    pub async fn delete_keys(&self, connection_id: &str, keys: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("DEL");
        for k in &keys {
            cmd.arg(k);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("DEL 失败: {}", e))
    }

    /// 重命名键
    pub async fn rename_key(&self, connection_id: &str, old_key: &str, new_key: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("RENAME").arg(old_key).arg(new_key),
        ).await.map_err(|e| format!("RENAME 失败: {}", e))
    }

    // ─── TTL ───

    /// 设置 TTL
    pub async fn set_ttl(&self, connection_id: &str, key: &str, seconds: i64) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("EXPIRE").arg(key).arg(seconds),
        ).await.map_err(|e| format!("EXPIRE 失败: {}", e))
    }

    /// 移除 TTL（永不过期）
    pub async fn remove_ttl(&self, connection_id: &str, key: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("PERSIST").arg(key),
        ).await.map_err(|e| format!("PERSIST 失败: {}", e))
    }

    // ─── Hash ───

    /// 获取 Hash 所有字段
    pub async fn hash_get_all(&self, connection_id: &str, key: &str) -> Result<Vec<HashField>, String> {
        let raw: Vec<(String, String)> = self.exec_cmd(
            connection_id,
            redis::cmd("HGETALL").arg(key),
        ).await.map_err(|e| format!("HGETALL 失败: {}", e))?;
        Ok(raw.into_iter().map(|(f, v)| HashField { field: f, value: v }).collect())
    }

    /// 设置 Hash 字段
    pub async fn hash_set(&self, connection_id: &str, key: &str, field: &str, value: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("HSET").arg(key).arg(field).arg(value),
        ).await.map_err(|e| format!("HSET 失败: {}", e))
    }

    /// 删除 Hash 字段
    pub async fn hash_del(&self, connection_id: &str, key: &str, fields: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("HDEL");
        cmd.arg(key);
        for f in &fields {
            cmd.arg(f);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("HDEL 失败: {}", e))
    }

    // ─── List ───

    /// 获取 List 范围
    pub async fn list_range(&self, connection_id: &str, key: &str, start: isize, stop: isize) -> Result<Vec<String>, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("LRANGE").arg(key).arg(start).arg(stop),
        ).await.map_err(|e| format!("LRANGE 失败: {}", e))
    }

    /// 向 List 推入元素
    pub async fn list_push(&self, connection_id: &str, key: &str, values: Vec<String>, head: bool) -> Result<u64, String> {
        let cmd_name = if head { "LPUSH" } else { "RPUSH" };
        let mut cmd = redis::cmd(cmd_name);
        cmd.arg(key);
        for v in &values {
            cmd.arg(v);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("{} 失败: {}", cmd_name, e))
    }

    /// 设置 List 元素
    pub async fn list_set(&self, connection_id: &str, key: &str, index: isize, value: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("LSET").arg(key).arg(index).arg(value),
        ).await.map_err(|e| format!("LSET 失败: {}", e))
    }

    /// 删除 List 元素
    pub async fn list_rem(&self, connection_id: &str, key: &str, count: isize, value: &str) -> Result<u64, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("LREM").arg(key).arg(count).arg(value),
        ).await.map_err(|e| format!("LREM 失败: {}", e))
    }

    // ─── Set ───

    /// 获取 Set 成员
    pub async fn set_members(&self, connection_id: &str, key: &str) -> Result<Vec<String>, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("SMEMBERS").arg(key),
        ).await.map_err(|e| format!("SMEMBERS 失败: {}", e))
    }

    /// 添加 Set 成员
    pub async fn set_add(&self, connection_id: &str, key: &str, members: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("SADD");
        cmd.arg(key);
        for m in &members {
            cmd.arg(m);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("SADD 失败: {}", e))
    }

    /// 删除 Set 成员
    pub async fn set_rem(&self, connection_id: &str, key: &str, members: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("SREM");
        cmd.arg(key);
        for m in &members {
            cmd.arg(m);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("SREM 失败: {}", e))
    }

    // ─── ZSet ───

    /// 获取 ZSet 范围（带 score）
    pub async fn zset_range(&self, connection_id: &str, key: &str, start: isize, stop: isize) -> Result<Vec<ZSetMember>, String> {
        let raw: Value = self.exec_cmd(
            connection_id,
            redis::cmd("ZRANGE").arg(key).arg(start).arg(stop).arg("WITHSCORES"),
        ).await.map_err(|e| format!("ZRANGE 失败: {}", e))?;
        Ok(Self::parse_zset_withscores(raw))
    }

    /// 添加 ZSet 成员
    pub async fn zset_add(&self, connection_id: &str, key: &str, member: &str, score: f64) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("ZADD").arg(key).arg(score).arg(member),
        ).await.map_err(|e| format!("ZADD 失败: {}", e))
    }

    /// 删除 ZSet 成员
    pub async fn zset_rem(&self, connection_id: &str, key: &str, members: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("ZREM");
        cmd.arg(key);
        for m in &members {
            cmd.arg(m);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("ZREM 失败: {}", e))
    }

    // ─── Stream ───

    /// 获取 Stream 条目范围（XRANGE / XREVRANGE）
    pub async fn stream_range(
        &self,
        connection_id: &str,
        key: &str,
        start: &str,
        stop: &str,
        count: Option<u64>,
        reverse: bool,
    ) -> Result<Vec<StreamEntry>, String> {
        let cmd_name = if reverse { "XREVRANGE" } else { "XRANGE" };
        let (arg_start, arg_stop) = if reverse { (stop, start) } else { (start, stop) };

        let mut cmd = redis::cmd(cmd_name);
        cmd.arg(key).arg(arg_start).arg(arg_stop);
        if let Some(c) = count {
            cmd.arg("COUNT").arg(c);
        }

        let raw: Value = self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("{} 失败: {}", cmd_name, e))?;

        Ok(Self::parse_stream_entries(raw))
    }

    /// 添加 Stream 条目（XADD）
    pub async fn stream_add(
        &self,
        connection_id: &str,
        key: &str,
        fields: Vec<(String, String)>,
        entry_id: Option<&str>,
    ) -> Result<String, String> {
        let mut cmd = redis::cmd("XADD");
        cmd.arg(key).arg(entry_id.unwrap_or("*"));
        for (f, v) in &fields {
            cmd.arg(f).arg(v);
        }

        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("XADD 失败: {}", e))
    }

    /// 删除 Stream 条目（XDEL）
    pub async fn stream_del(&self, connection_id: &str, key: &str, ids: Vec<String>) -> Result<u64, String> {
        let mut cmd = redis::cmd("XDEL");
        cmd.arg(key);
        for id in &ids {
            cmd.arg(id);
        }

        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("XDEL 失败: {}", e))
    }

    /// 获取 Stream 长度（XLEN）
    pub async fn stream_len(&self, connection_id: &str, key: &str) -> Result<i64, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("XLEN").arg(key),
        ).await.map_err(|e| format!("XLEN 失败: {}", e))
    }

    /// 解析 XRANGE/XREVRANGE 返回的原始 Value 为 Vec<StreamEntry>
    fn parse_stream_entries(value: Value) -> Vec<StreamEntry> {
        let mut entries = Vec::new();
        if let Value::Array(items) = value {
            for item in items {
                if let Value::Array(pair) = item {
                    if pair.len() == 2 {
                        let id = Self::value_to_string(&pair[0]);
                        let fields = Self::parse_stream_fields(&pair[1]);
                        entries.push(StreamEntry { id, fields });
                    }
                }
            }
        }
        entries
    }

    /// 解析 Stream 条目的字段列表
    fn parse_stream_fields(value: &Value) -> Vec<(String, String)> {
        let mut fields = Vec::new();
        if let Value::Array(items) = value {
            let mut i = 0;
            while i + 1 < items.len() {
                let k = Self::value_to_string(&items[i]);
                let v = Self::value_to_string(&items[i + 1]);
                fields.push((k, v));
                i += 2;
            }
        }
        fields
    }

    /// 将 Redis Value 转为 String
    fn value_to_string(value: &Value) -> String {
        match value {
            Value::BulkString(bytes) => String::from_utf8_lossy(bytes).to_string(),
            Value::SimpleString(s) => s.clone(),
            Value::Int(n) => n.to_string(),
            Value::Double(f) => f.to_string(),
            Value::Boolean(b) => b.to_string(),
            Value::Nil => "(nil)".to_string(),
            _ => format!("{:?}", value),
        }
    }

    // ─── 服务器信息 ───

    /// 获取服务器 INFO
    pub async fn get_info(&self, connection_id: &str, section: Option<&str>) -> Result<RedisServerInfo, String> {
        let mut cmd = redis::cmd("INFO");
        if let Some(s) = section {
            cmd.arg(s);
        }
        let raw: String = self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("INFO 失败: {}", e))?;

        Ok(Self::parse_info(&raw))
    }

    /// 解析 INFO 输出
    fn parse_info(raw: &str) -> RedisServerInfo {
        let mut sections = Vec::new();
        let mut current_name = String::new();
        let mut current_entries = Vec::new();

        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('#') {
                if !current_name.is_empty() {
                    sections.push(RedisInfoSection {
                        name: current_name.clone(),
                        entries: std::mem::take(&mut current_entries),
                    });
                }
                current_name = line.trim_start_matches('#').trim().to_string();
            } else if let Some((k, v)) = line.split_once(':') {
                current_entries.push(RedisInfoEntry {
                    key: k.to_string(),
                    value: v.to_string(),
                });
            }
        }
        if !current_name.is_empty() {
            sections.push(RedisInfoSection {
                name: current_name,
                entries: current_entries,
            });
        }

        RedisServerInfo { sections }
    }

    // ─── Cluster ───

    /// 获取集群信息（CLUSTER INFO 原始字符串）
    pub async fn cluster_info(&self, connection_id: &str) -> Result<String, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("CLUSTER").arg("INFO"),
        ).await.map_err(|e| format!("CLUSTER INFO 失败: {}", e))
    }

    /// 获取集群节点列表（CLUSTER NODES → 解析为结构化数据）
    pub async fn cluster_nodes(&self, connection_id: &str) -> Result<Vec<ClusterNodeInfo>, String> {
        let raw: String = self.exec_cmd(
            connection_id,
            redis::cmd("CLUSTER").arg("NODES"),
        ).await.map_err(|e| format!("CLUSTER NODES 失败: {}", e))?;

        Ok(Self::parse_cluster_nodes(&raw))
    }

    /// 解析 CLUSTER NODES 输出
    /// 格式: <id> <ip:port@cport> <flags> <master> <ping-sent> <pong-recv> <config-epoch> <link-state> <slot> ...
    fn parse_cluster_nodes(raw: &str) -> Vec<ClusterNodeInfo> {
        let mut nodes = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 8 {
                continue;
            }

            let id = parts[0].to_string();
            // 地址可能是 ip:port@cport 格式，只取 ip:port
            let addr = parts[1].split('@').next().unwrap_or(parts[1]).to_string();
            let flags = parts[2].to_string();
            let master_id = parts[3].to_string();
            let connected = parts[7] == "connected";

            // 哈希槽范围（第 8 个字段起）
            let slots = if parts.len() > 8 {
                parts[8..].join(" ")
            } else {
                String::new()
            };

            nodes.push(ClusterNodeInfo {
                id,
                addr,
                flags,
                master_id,
                slots,
                connected,
            });
        }
        nodes
    }

    // ─── CLI ───

    /// 执行 Redis 命令（CLI 模式）
    pub async fn execute_command(&self, connection_id: &str, command: &str) -> Result<RedisCliResult, String> {
        let args = Self::parse_command(command);
        if args.is_empty() {
            return Err("空命令".to_string());
        }

        let start = Instant::now();
        let mut cmd = Cmd::new();
        for arg in &args {
            cmd.arg(arg);
        }

        let result: Result<Value, String> = self.exec_cmd(connection_id, &mut cmd).await;
        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(value) => Ok(RedisCliResult {
                command: command.to_string(),
                result: Self::format_value(&value, 0),
                duration_ms,
                is_error: false,
            }),
            Err(e) => Ok(RedisCliResult {
                command: command.to_string(),
                result: format!("(error) {}", e),
                duration_ms,
                is_error: true,
            }),
        }
    }

    /// 解析命令字符串（支持引号）
    fn parse_command(input: &str) -> Vec<String> {
        let mut args = Vec::new();
        let mut current = String::new();
        let mut in_single = false;
        let mut in_double = false;
        let mut escape = false;

        for ch in input.chars() {
            if escape {
                current.push(ch);
                escape = false;
                continue;
            }
            match ch {
                '\\' if !in_single => {
                    escape = true;
                }
                '\'' if !in_double => {
                    in_single = !in_single;
                }
                '"' if !in_single => {
                    in_double = !in_double;
                }
                ' ' | '\t' if !in_single && !in_double => {
                    if !current.is_empty() {
                        args.push(std::mem::take(&mut current));
                    }
                }
                _ => {
                    current.push(ch);
                }
            }
        }
        if !current.is_empty() {
            args.push(current);
        }
        args
    }

    /// 格式化 Redis Value 为可读字符串
    fn format_value(value: &Value, indent: usize) -> String {
        let prefix = "  ".repeat(indent);
        match value {
            Value::Nil => "(nil)".to_string(),
            Value::Int(n) => format!("(integer) {}", n),
            Value::BulkString(bytes) => {
                match String::from_utf8(bytes.clone()) {
                    Ok(s) => format!("\"{}\"", s),
                    Err(_) => format!("(binary) {} bytes", bytes.len()),
                }
            }
            Value::SimpleString(s) => s.clone(),
            Value::Okay => "OK".to_string(),
            Value::Array(items) => {
                if items.is_empty() {
                    return "(empty array)".to_string();
                }
                let mut lines = Vec::new();
                for (i, item) in items.iter().enumerate() {
                    let formatted = Self::format_value(item, indent + 1);
                    lines.push(format!("{}{}) {}", prefix, i + 1, formatted));
                }
                lines.join("\n")
            }
            Value::Double(f) => format!("(double) {}", f),
            Value::Boolean(b) => format!("(boolean) {}", b),
            _ => format!("{:?}", value),
        }
    }

    // ─── PubSub (Publish) ───

    /// 发布消息到频道
    pub async fn publish(&self, connection_id: &str, channel: &str, message: &str) -> Result<u64, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("PUBLISH").arg(channel).arg(message),
        ).await.map_err(|e| format!("PUBLISH 失败: {}", e))
    }

    // ─── SLOWLOG ───

    /// 获取慢查询日志条目
    pub async fn slowlog_get(&self, connection_id: &str, count: Option<i64>) -> Result<Vec<RedisSlowLogEntry>, String> {
        let mut cmd = redis::cmd("SLOWLOG");
        cmd.arg("GET");
        if let Some(n) = count {
            cmd.arg(n);
        }

        let raw: Value = self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("SLOWLOG GET 失败: {}", e))?;

        Ok(Self::parse_slowlog(raw))
    }

    /// 获取慢查询日志条数
    pub async fn slowlog_len(&self, connection_id: &str) -> Result<i64, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("SLOWLOG").arg("LEN"),
        ).await.map_err(|e| format!("SLOWLOG LEN 失败: {}", e))
    }

    /// 重置慢查询日志
    pub async fn slowlog_reset(&self, connection_id: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("SLOWLOG").arg("RESET"),
        ).await.map_err(|e| format!("SLOWLOG RESET 失败: {}", e))
    }

    /// 获取慢查询配置
    pub async fn slowlog_config(&self, connection_id: &str) -> Result<RedisSlowLogConfig, String> {
        let threshold_raw: Vec<String> = self.exec_cmd(
            connection_id,
            redis::cmd("CONFIG").arg("GET").arg("slowlog-log-slower-than"),
        ).await.map_err(|e| format!("CONFIG GET 失败: {}", e))?;
        let threshold_us = threshold_raw.get(1).and_then(|v| v.parse::<i64>().ok()).unwrap_or(10000);

        let max_raw: Vec<String> = self.exec_cmd(
            connection_id,
            redis::cmd("CONFIG").arg("GET").arg("slowlog-max-len"),
        ).await.map_err(|e| format!("CONFIG GET 失败: {}", e))?;
        let max_len = max_raw.get(1).and_then(|v| v.parse::<i64>().ok()).unwrap_or(128);

        let current_len: i64 = self.exec_cmd(
            connection_id,
            redis::cmd("SLOWLOG").arg("LEN"),
        ).await.unwrap_or(0);

        Ok(RedisSlowLogConfig {
            threshold_us,
            max_len,
            current_len,
        })
    }

    /// 设置慢查询阈值（微秒）
    pub async fn set_slowlog_threshold(&self, connection_id: &str, microseconds: i64) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("CONFIG").arg("SET").arg("slowlog-log-slower-than").arg(microseconds),
        ).await.map_err(|e| format!("CONFIG SET 失败: {}", e))
    }

    /// 设置慢查询最大条数
    pub async fn set_slowlog_max_len(&self, connection_id: &str, max_len: i64) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("CONFIG").arg("SET").arg("slowlog-max-len").arg(max_len),
        ).await.map_err(|e| format!("CONFIG SET 失败: {}", e))
    }

    /// 解析 SLOWLOG GET 结果
    fn parse_slowlog(value: Value) -> Vec<RedisSlowLogEntry> {
        let mut entries = Vec::new();
        if let Value::Array(items) = value {
            for item in items {
                if let Value::Array(fields) = item {
                    if fields.len() >= 4 {
                        let id = Self::value_to_i64(&fields[0]);
                        let timestamp = Self::value_to_i64(&fields[1]);
                        let duration_us = Self::value_to_i64(&fields[2]);

                        let mut command_args = Vec::new();
                        if let Value::Array(args) = &fields[3] {
                            for a in args {
                                command_args.push(Self::value_to_string(a));
                            }
                        }

                        let command = command_args.first().cloned().unwrap_or_default();
                        let client_addr = if fields.len() > 4 { Self::value_to_string(&fields[4]) } else { String::new() };
                        let client_name = if fields.len() > 5 {
                            let name = Self::value_to_string(&fields[5]);
                            if name.is_empty() { None } else { Some(name) }
                        } else {
                            None
                        };

                        entries.push(RedisSlowLogEntry {
                            id,
                            timestamp,
                            duration_us,
                            command,
                            command_args,
                            client_addr,
                            client_name,
                        });
                    }
                }
            }
        }
        entries
    }

    /// Value -> i64 辅助
    fn value_to_i64(value: &Value) -> i64 {
        match value {
            Value::Int(n) => *n,
            Value::BulkString(bytes) => String::from_utf8_lossy(bytes).parse().unwrap_or(0),
            _ => 0,
        }
    }

    // ─── Sentinel ───

    /// 通过 Sentinel 发现 Master 并连接
    ///
    /// 遍历 sentinel_nodes 列表，连接第一个可用的 Sentinel 节点，
    /// 执行 SENTINEL get-master-addr-by-name 获取 Master 地址，然后建立 Standalone 连接。
    pub async fn connect_sentinel(
        &self,
        connection_id: &str,
        sentinel_nodes: Vec<String>,
        master_name: &str,
        password: Option<&str>,
        sentinel_password: Option<&str>,
        database: u8,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        if sentinel_nodes.is_empty() {
            return Err("Sentinel 节点列表为空".to_string());
        }

        // 遍历 Sentinel 节点，找到第一个可用的
        let mut last_error = String::new();
        for node in &sentinel_nodes {
            match self.resolve_master_from_sentinel(
                node, master_name, sentinel_password, use_tls, timeout_secs,
            ).await {
                Ok((host, port)) => {
                    // 通过发现的 Master 地址建立 Standalone 连接
                    return self.connect(
                        connection_id, &host, port, password, database, use_tls, timeout_secs,
                    ).await
                    .map(|_| format!("已通过 Sentinel 连接到 Master {}:{}/{}", host, port, database));
                }
                Err(e) => {
                    last_error = format!("Sentinel {} 失败: {}", node, e);
                    continue;
                }
            }
        }

        Err(format!("所有 Sentinel 节点均不可用。最后错误: {}", last_error))
    }

    /// 从单个 Sentinel 节点解析 Master 地址
    async fn resolve_master_from_sentinel(
        &self,
        sentinel_addr: &str,
        master_name: &str,
        sentinel_password: Option<&str>,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<(String, u16), String> {
        // 构建 Sentinel 连接 URL（database 固定 0）
        let parts: Vec<&str> = sentinel_addr.splitn(2, ':').collect();
        let host = parts.first().copied().unwrap_or("127.0.0.1");
        let port: u16 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(26379);

        let url = Self::build_url(host, port, sentinel_password, 0, use_tls);
        let client = Client::open(url.as_str())
            .map_err(|e| format!("创建 Sentinel 客户端失败: {}", e))?;

        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_multiplexed_async_connection(),
        )
        .await
        .map_err(|_| format!("Sentinel 连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("Sentinel 连接失败: {}", e))?;

        // SENTINEL get-master-addr-by-name <master_name>
        let result: Vec<String> = redis::cmd("SENTINEL")
            .arg("get-master-addr-by-name")
            .arg(master_name)
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("SENTINEL get-master-addr-by-name 失败: {}", e))?;

        if result.len() < 2 {
            return Err(format!("Master '{}' 未找到", master_name));
        }

        let master_host = result[0].clone();
        let master_port: u16 = result[1].parse()
            .map_err(|_| format!("无效的 Master 端口: {}", result[1]))?;

        Ok((master_host, master_port))
    }

    /// 测试 Sentinel 连接（不保存）
    pub async fn test_sentinel_connection(
        &self,
        sentinel_nodes: Vec<String>,
        master_name: &str,
        password: Option<&str>,
        sentinel_password: Option<&str>,
        database: u8,
        use_tls: bool,
        timeout_secs: u64,
    ) -> Result<String, String> {
        if sentinel_nodes.is_empty() {
            return Err("Sentinel 节点列表为空".to_string());
        }

        // 尝试解析 Master
        let mut last_error = String::new();
        for node in &sentinel_nodes {
            match self.resolve_master_from_sentinel(
                node, master_name, sentinel_password, use_tls, timeout_secs,
            ).await {
                Ok((host, port)) => {
                    // 尝试连接 Master 并 PING
                    let result = self.test_connection(
                        &host, port, password, database, use_tls, timeout_secs,
                    ).await?;
                    return Ok(format!("{} — via Sentinel → Master {}:{}", result, host, port));
                }
                Err(e) => {
                    last_error = format!("Sentinel {} 失败: {}", node, e);
                    continue;
                }
            }
        }

        Err(format!("所有 Sentinel 节点均不可用。最后错误: {}", last_error))
    }

    // ─── 内存分析 ───

    /// 获取内存统计信息（解析 INFO memory）
    pub async fn memory_stats(&self, connection_id: &str) -> Result<RedisMemoryStats, String> {
        let raw: String = self.exec_cmd(
            connection_id,
            redis::cmd("INFO").arg("memory"),
        ).await.map_err(|e| format!("INFO memory 失败: {}", e))?;

        let get = |key: &str| -> String {
            raw.lines()
                .find(|l| l.starts_with(key))
                .and_then(|l| l.split_once(':'))
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default()
        };

        // 从 INFO stats 获取 evicted_keys
        let stats_raw: String = self.exec_cmd(
            connection_id,
            redis::cmd("INFO").arg("stats"),
        ).await.unwrap_or_default();

        let evicted_keys = stats_raw.lines()
            .find(|l| l.starts_with("evicted_keys:"))
            .and_then(|l| l.split_once(':'))
            .and_then(|(_, v)| v.trim().parse::<u64>().ok())
            .unwrap_or(0);

        Ok(RedisMemoryStats {
            used_memory: get("used_memory:").parse().unwrap_or(0),
            used_memory_human: get("used_memory_human:"),
            used_memory_peak: get("used_memory_peak:").parse().unwrap_or(0),
            used_memory_peak_human: get("used_memory_peak_human:"),
            mem_fragmentation_ratio: get("mem_fragmentation_ratio:").parse().unwrap_or(0.0),
            evicted_keys,
        })
    }

    /// 获取 MEMORY DOCTOR 建议
    pub async fn memory_doctor(&self, connection_id: &str) -> Result<String, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("MEMORY").arg("DOCTOR"),
        ).await.map_err(|e| format!("MEMORY DOCTOR 失败: {}", e))
    }

    /// 获取单个键的内存占用
    pub async fn memory_usage_key(&self, connection_id: &str, key: &str) -> Result<i64, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("MEMORY").arg("USAGE").arg(key),
        ).await.map_err(|e| format!("MEMORY USAGE 失败: {}", e))
    }

    /// 获取占用内存最多的 Top-N 键
    ///
    /// 通过 SCAN + MEMORY USAGE 遍历，limit 限制最大扫描键数以防性能问题。
    pub async fn top_keys_by_memory(
        &self,
        connection_id: &str,
        count: usize,
        pattern: &str,
        scan_limit: u64,
    ) -> Result<Vec<RedisKeyMemory>, String> {
        let mut all_keys: Vec<RedisKeyMemory> = Vec::new();
        let mut cursor: u64 = 0;
        let mut scanned: u64 = 0;

        loop {
            let result: (u64, Vec<String>) = self.exec_cmd(
                connection_id,
                redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH").arg(pattern)
                    .arg("COUNT").arg(200u64),
            ).await.map_err(|e| format!("SCAN 失败: {}", e))?;

            cursor = result.0;

            for key in &result.1 {
                // TYPE
                let key_type: String = self.exec_cmd(
                    connection_id,
                    redis::cmd("TYPE").arg(key.as_str()),
                ).await.unwrap_or_else(|_| "unknown".to_string());

                // MEMORY USAGE
                let memory_bytes: i64 = self.exec_cmd(
                    connection_id,
                    redis::cmd("MEMORY").arg("USAGE").arg(key.as_str()),
                ).await.unwrap_or(0);

                all_keys.push(RedisKeyMemory {
                    key: key.clone(),
                    memory_bytes,
                    key_type,
                });

                scanned += 1;
                if scanned >= scan_limit {
                    break;
                }
            }

            if cursor == 0 || scanned >= scan_limit {
                break;
            }
        }

        // 按内存降序排列，取前 N 个
        all_keys.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
        all_keys.truncate(count);

        Ok(all_keys)
    }

    // ─── 批量操作 ───

    /// 批量删除键（Pipeline DEL）
    pub async fn batch_delete(&self, connection_id: &str, keys: Vec<String>) -> Result<u64, String> {
        if keys.is_empty() {
            return Ok(0);
        }
        let mut cmd = redis::cmd("DEL");
        for k in &keys {
            cmd.arg(k);
        }
        self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("批量删除失败: {}", e))
    }

    /// 批量设置 TTL（逐个 EXPIRE）
    pub async fn batch_set_ttl(
        &self,
        connection_id: &str,
        keys: Vec<String>,
        ttl_secs: i64,
    ) -> Result<u64, String> {
        if keys.is_empty() {
            return Ok(0);
        }
        let mut success_count: u64 = 0;
        for key in &keys {
            let ok: Result<i64, String> = self.exec_cmd(
                connection_id,
                redis::cmd("EXPIRE").arg(key).arg(ttl_secs),
            ).await;
            if ok.unwrap_or(0) == 1 {
                success_count += 1;
            }
        }
        Ok(success_count)
    }

    /// 批量导出键值（逐个获取类型+TTL+值）
    pub async fn batch_export(
        &self,
        connection_id: &str,
        keys: Vec<String>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let mut results = Vec::new();
        for key in &keys {
            let key_type: String = self.exec_cmd(
                connection_id,
                redis::cmd("TYPE").arg(key.as_str()),
            ).await.unwrap_or_else(|_| "unknown".to_string());

            let ttl: i64 = self.exec_cmd(
                connection_id,
                redis::cmd("TTL").arg(key.as_str()),
            ).await.unwrap_or(-1);

            // 获取值
            let value = self.get_value(connection_id, key).await
                .unwrap_or(RedisValue::Unknown { raw: "(error)".to_string() });

            results.push(serde_json::json!({
                "key": key,
                "type": key_type,
                "ttl": ttl,
                "value": value,
            }));
        }
        Ok(results)
    }

    /// 批量导入键值（接受与 batch_export 相同的 JSON 格式）
    ///
    /// 每个条目格式：{ key, type, ttl, value }
    /// value 使用 serde 内部标记: { "type": "string", "value": "..." }
    /// 根据 value.type 使用不同命令恢复：string→SET, hash→HSET, list→RPUSH, set→SADD, zset→ZADD
    /// ttl > 0 时自动设置过期时间
    pub async fn batch_import(
        &self,
        connection_id: &str,
        items: Vec<serde_json::Value>,
    ) -> Result<u64, String> {
        let mut success_count: u64 = 0;

        for item in &items {
            let key = item["key"].as_str().unwrap_or_default();
            if key.is_empty() { continue; }

            let ttl = item["ttl"].as_i64().unwrap_or(-1);
            let value = &item["value"];
            // value 内部 "type" 字段标识类型（serde tag = "type" 序列化格式）
            let val_type = value.get("type").and_then(|t| t.as_str())
                .or_else(|| item["type"].as_str())
                .unwrap_or("string");

            let result = match val_type {
                "string" => {
                    // value: { "type": "string", "value": "..." }
                    let str_val = value.get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    self.exec_cmd::<()>(
                        connection_id,
                        redis::cmd("SET").arg(key).arg(str_val),
                    ).await
                }
                "hash" => {
                    // value: { "type": "hash", "fields": [{ "field": "...", "value": "..." }, ...] }
                    if let Some(fields) = value.get("fields").and_then(|f| f.as_array()) {
                        let _ = self.exec_cmd::<()>(connection_id, redis::cmd("DEL").arg(key)).await;
                        let mut cmd = redis::cmd("HSET");
                        cmd.arg(key);
                        for field in fields {
                            let f = field.get("field").and_then(|v| v.as_str()).unwrap_or_default();
                            let v = field.get("value").and_then(|v| v.as_str()).unwrap_or_default();
                            cmd.arg(f).arg(v);
                        }
                        if !fields.is_empty() {
                            self.exec_cmd::<()>(connection_id, &mut cmd).await
                        } else {
                            Ok(())
                        }
                    } else {
                        Ok(())
                    }
                }
                "list" => {
                    // value: { "type": "list", "items": ["a", "b", ...], "total": N }
                    if let Some(items_arr) = value.get("items").and_then(|i| i.as_array()) {
                        let _ = self.exec_cmd::<()>(connection_id, redis::cmd("DEL").arg(key)).await;
                        if !items_arr.is_empty() {
                            let mut cmd = redis::cmd("RPUSH");
                            cmd.arg(key);
                            for item in items_arr {
                                cmd.arg(item.as_str().unwrap_or_default());
                            }
                            self.exec_cmd::<()>(connection_id, &mut cmd).await
                        } else {
                            Ok(())
                        }
                    } else {
                        Ok(())
                    }
                }
                "set" => {
                    // value: { "type": "set", "members": ["a", "b", ...] }
                    if let Some(members) = value.get("members").and_then(|m| m.as_array()) {
                        let _ = self.exec_cmd::<()>(connection_id, redis::cmd("DEL").arg(key)).await;
                        if !members.is_empty() {
                            let mut cmd = redis::cmd("SADD");
                            cmd.arg(key);
                            for m in members {
                                cmd.arg(m.as_str().unwrap_or_default());
                            }
                            self.exec_cmd::<()>(connection_id, &mut cmd).await
                        } else {
                            Ok(())
                        }
                    } else {
                        Ok(())
                    }
                }
                "zset" => {
                    // value: { "type": "zset", "members": [{ "member": "...", "score": N }, ...] }
                    if let Some(members) = value.get("members").and_then(|m| m.as_array()) {
                        let _ = self.exec_cmd::<()>(connection_id, redis::cmd("DEL").arg(key)).await;
                        if !members.is_empty() {
                            let mut cmd = redis::cmd("ZADD");
                            cmd.arg(key);
                            for m in members {
                                let score = m.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0);
                                let member = m.get("member").and_then(|v| v.as_str()).unwrap_or_default();
                                cmd.arg(score).arg(member);
                            }
                            self.exec_cmd::<()>(connection_id, &mut cmd).await
                        } else {
                            Ok(())
                        }
                    } else {
                        Ok(())
                    }
                }
                _ => {
                    continue; // 跳过不支持的类型（stream、unknown）
                }
            };

            if result.is_ok() {
                // 设置 TTL
                if ttl > 0 {
                    let _ = self.exec_cmd::<()>(
                        connection_id,
                        redis::cmd("EXPIRE").arg(key).arg(ttl),
                    ).await;
                }
                success_count += 1;
            }
        }

        Ok(success_count)
    }

    // ─── CLIENT LIST ───

    /// 获取客户端列表（解析 CLIENT LIST 输出）
    pub async fn client_list(&self, connection_id: &str) -> Result<Vec<RedisClientInfo>, String> {
        let raw: String = self.exec_cmd(
            connection_id,
            redis::cmd("CLIENT").arg("LIST"),
        ).await.map_err(|e| format!("CLIENT LIST 失败: {}", e))?;

        Ok(Self::parse_client_list(&raw))
    }

    /// 断开指定客户端（CLIENT KILL ADDR addr）
    pub async fn client_kill(&self, connection_id: &str, addr: &str) -> Result<(), String> {
        self.exec_cmd::<i64>(
            connection_id,
            redis::cmd("CLIENT").arg("KILL").arg("ADDR").arg(addr),
        ).await.map_err(|e| format!("CLIENT KILL 失败: {}", e))?;
        Ok(())
    }

    /// 解析 CLIENT LIST 输出
    /// 每行格式: key1=value1 key2=value2 ...
    fn parse_client_list(raw: &str) -> Vec<RedisClientInfo> {
        let mut clients = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut fields: HashMap<String, String> = HashMap::new();
            for pair in line.split_whitespace() {
                if let Some((k, v)) = pair.split_once('=') {
                    fields.insert(k.to_string(), v.to_string());
                }
            }

            let get = |k: &str| fields.get(k).cloned().unwrap_or_default();

            clients.push(RedisClientInfo {
                id: get("id"),
                addr: get("addr"),
                name: {
                    let n = get("name");
                    if n.is_empty() { None } else { Some(n) }
                },
                age: get("age").parse().unwrap_or(0),
                idle: get("idle").parse().unwrap_or(0),
                flags: get("flags"),
                db: get("db").parse().unwrap_or(0),
                cmd: {
                    let c = get("cmd");
                    if c.is_empty() || c == "NULL" { None } else { Some(c) }
                },
            });
        }
        clients
    }

    // ─── Lua 脚本 ───

    /// 执行 Lua 脚本（EVAL）
    pub async fn eval_lua(
        &self,
        connection_id: &str,
        script: &str,
        keys: Vec<String>,
        args: Vec<String>,
    ) -> Result<LuaExecResult, String> {
        let start = Instant::now();

        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(keys.len());
        for k in &keys {
            cmd.arg(k);
        }
        for a in &args {
            cmd.arg(a);
        }

        let result: Value = self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("EVAL 失败: {}", e))?;

        let duration_ms = start.elapsed().as_millis() as u64;
        let json_value = Self::redis_value_to_json(&result);

        Ok(LuaExecResult {
            result: json_value,
            duration_ms,
        })
    }

    /// 加载脚本到服务器缓存（SCRIPT LOAD）
    pub async fn script_load(&self, connection_id: &str, script: &str) -> Result<String, String> {
        self.exec_cmd(
            connection_id,
            redis::cmd("SCRIPT").arg("LOAD").arg(script),
        ).await.map_err(|e| format!("SCRIPT LOAD 失败: {}", e))
    }

    /// 检查脚本是否存在（SCRIPT EXISTS）
    pub async fn script_exists(&self, connection_id: &str, shas: Vec<String>) -> Result<Vec<bool>, String> {
        let mut cmd = redis::cmd("SCRIPT");
        cmd.arg("EXISTS");
        for sha in &shas {
            cmd.arg(sha);
        }
        let results: Vec<i64> = self.exec_cmd(connection_id, &mut cmd).await
            .map_err(|e| format!("SCRIPT EXISTS 失败: {}", e))?;
        Ok(results.into_iter().map(|v| v == 1).collect())
    }

    /// 清除所有脚本缓存（SCRIPT FLUSH）
    pub async fn script_flush(&self, connection_id: &str) -> Result<(), String> {
        self.exec_cmd::<()>(
            connection_id,
            redis::cmd("SCRIPT").arg("FLUSH"),
        ).await.map_err(|e| format!("SCRIPT FLUSH 失败: {}", e))
    }

    /// 将 Redis Value 递归转换为 serde_json::Value
    fn redis_value_to_json(value: &Value) -> serde_json::Value {
        match value {
            Value::Nil => serde_json::Value::Null,
            Value::Int(n) => serde_json::json!(*n),
            Value::BulkString(bytes) => {
                match String::from_utf8(bytes.clone()) {
                    Ok(s) => serde_json::json!(s),
                    Err(_) => serde_json::json!(format!("(binary) {} bytes", bytes.len())),
                }
            }
            Value::SimpleString(s) => serde_json::json!(s),
            Value::Okay => serde_json::json!("OK"),
            Value::Array(items) => {
                let arr: Vec<serde_json::Value> = items.iter().map(Self::redis_value_to_json).collect();
                serde_json::json!(arr)
            }
            Value::Double(f) => serde_json::json!(*f),
            Value::Boolean(b) => serde_json::json!(*b),
            _ => serde_json::json!(format!("{:?}", value)),
        }
    }
}
