use serde::{Deserialize, Serialize};

/// Redis 键信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    /// 键名
    pub key: String,
    /// 数据类型（string/hash/list/set/zset/stream/none）
    pub key_type: String,
    /// TTL（秒，-1 表示永不过期，-2 表示键不存在）
    pub ttl: i64,
    /// 内存占用（字节，可选，部分 Redis 版本不支持）
    pub memory_usage: Option<i64>,
    /// 元素数量（String 为字符串长度，集合类型为元素数）
    pub size: i64,
}

/// Redis 值（前端展示用，统一为 JSON 可序列化的结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RedisValue {
    /// String 类型
    #[serde(rename = "string")]
    String { value: String },
    /// Hash 类型
    #[serde(rename = "hash")]
    Hash { fields: Vec<HashField> },
    /// List 类型
    #[serde(rename = "list")]
    List { items: Vec<String>, total: i64 },
    /// Set 类型
    #[serde(rename = "set")]
    Set { members: Vec<String> },
    /// ZSet (Sorted Set) 类型
    #[serde(rename = "zset")]
    ZSet { members: Vec<ZSetMember> },
    /// Stream 类型
    #[serde(rename = "stream")]
    Stream {
        entries: Vec<StreamEntry>,
        total: i64,
    },
    /// 未知或不支持的类型
    #[serde(rename = "unknown")]
    Unknown { raw: String },
}

/// Hash 字段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashField {
    pub field: String,
    pub value: String,
}

/// ZSet 成员（带 score）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

/// Stream 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    /// 条目 ID（如 1691234567890-0）
    pub id: String,
    /// 字段键值对列表
    pub fields: Vec<(String, String)>,
}

/// SCAN 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanResult {
    /// 下一个游标（"0" 表示扫描结束）
    pub cursor: u64,
    /// 本次扫描到的键列表
    pub keys: Vec<String>,
}

/// 服务器信息（按 section 分组）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisServerInfo {
    /// 各 section 的键值对
    pub sections: Vec<RedisInfoSection>,
}

/// INFO 单个 section
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisInfoSection {
    pub name: String,
    pub entries: Vec<RedisInfoEntry>,
}

/// INFO 单条记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisInfoEntry {
    pub key: String,
    pub value: String,
}

/// PubSub 消息（推送到前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PubSubMessage {
    /// 频道名
    pub channel: String,
    /// 匹配的模式（仅 PSUBSCRIBE 时有值）
    pub pattern: Option<String>,
    /// 消息内容
    pub payload: String,
    /// 时间戳（毫秒）
    pub timestamp_ms: i64,
}

/// PubSub 订阅信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PubSubSubscription {
    /// 频道列表
    pub channels: Vec<String>,
    /// 模式列表
    pub patterns: Vec<String>,
}

/// Redis 连接配置（存储在 config_json 中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConfig {
    /// 数据库索引（默认 0）
    #[serde(default)]
    pub database: u8,
    /// 是否启用 TLS
    #[serde(default)]
    pub use_tls: bool,
    /// 连接超时（秒）
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// 连接别名/备注
    #[serde(default)]
    pub notes: String,
    /// 是否为 Cluster 模式
    #[serde(default)]
    pub is_cluster: bool,
    /// Cluster 节点列表（"host:port" 格式）
    #[serde(default)]
    pub cluster_nodes: Vec<String>,
    /// 是否为 Sentinel 模式
    #[serde(default)]
    pub is_sentinel: bool,
    /// Sentinel 节点列表（"host:port" 格式）
    #[serde(default)]
    pub sentinel_nodes: Vec<String>,
    /// Sentinel Master 名称（如 "mymaster"）
    #[serde(default)]
    pub sentinel_master_name: String,
    /// Sentinel 自身密码（可选）
    #[serde(default)]
    pub sentinel_password: Option<String>,
}

fn default_timeout() -> u64 {
    10
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            database: 0,
            use_tls: false,
            timeout_secs: default_timeout(),
            notes: String::new(),
            is_cluster: false,
            cluster_nodes: Vec::new(),
            is_sentinel: false,
            sentinel_nodes: Vec::new(),
            sentinel_master_name: String::new(),
            sentinel_password: None,
        }
    }
}

/// Cluster 节点信息（CLUSTER NODES 解析结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterNodeInfo {
    /// 节点 ID
    pub id: String,
    /// 节点地址（host:port）
    pub addr: String,
    /// 角色标志（master/slave/...）
    pub flags: String,
    /// 主节点 ID（从节点指向主节点，主节点为 "-"）
    pub master_id: String,
    /// 哈希槽范围（如 "0-5460"）
    pub slots: String,
    /// 是否已连接
    pub connected: bool,
}

/// 慢查询日志条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSlowLogEntry {
    /// 日志条目 ID（唯一递增）
    pub id: i64,
    /// Unix 时间戳（秒）
    pub timestamp: i64,
    /// 执行时长（微秒）
    pub duration_us: i64,
    /// 命令名称
    pub command: String,
    /// 完整命令参数
    pub command_args: Vec<String>,
    /// 客户端 IP:端口
    pub client_addr: String,
    /// 客户端名称（可选）
    pub client_name: Option<String>,
}

/// 慢查询配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSlowLogConfig {
    /// 日志阈值（微秒）
    pub threshold_us: i64,
    /// 最大日志条数
    pub max_len: i64,
    /// 当前日志条数
    pub current_len: i64,
}

/// CLI 命令执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCliResult {
    /// 原始命令
    pub command: String,
    /// 格式化后的结果
    pub result: String,
    /// 执行耗时（毫秒）
    pub duration_ms: u64,
    /// 是否出错
    pub is_error: bool,
}

/// 内存统计信息（INFO memory 提取）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisMemoryStats {
    /// 已用内存（字节）
    pub used_memory: u64,
    /// 已用内存（人类可读）
    pub used_memory_human: String,
    /// 峰值内存（字节）
    pub used_memory_peak: u64,
    /// 峰值内存（人类可读）
    pub used_memory_peak_human: String,
    /// 内存碎片率
    pub mem_fragmentation_ratio: f64,
    /// 已逐出键数
    pub evicted_keys: u64,
}

/// 键内存占用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyMemory {
    /// 键名
    pub key: String,
    /// 内存占用（字节）
    pub memory_bytes: i64,
    /// 键类型
    pub key_type: String,
}

/// 客户端连接信息（CLIENT LIST 解析结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisClientInfo {
    /// 客户端 ID
    pub id: String,
    /// 地址（ip:port）
    pub addr: String,
    /// 客户端名称
    pub name: Option<String>,
    /// 连接时长（秒）
    pub age: i64,
    /// 空闲时长（秒）
    pub idle: i64,
    /// 标志（N=普通, M=PubSub, x=事务中, b=阻塞中...）
    pub flags: String,
    /// 当前数据库
    pub db: u8,
    /// 当前执行的命令
    pub cmd: Option<String>,
}

/// MONITOR 消息（实时推送到前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisMonitorMessage {
    /// 时间戳
    pub timestamp: f64,
    /// 客户端地址
    pub client_addr: String,
    /// 数据库编号
    pub database: String,
    /// 完整命令
    pub command: String,
    /// 原始消息
    pub raw: String,
}

/// Lua 脚本执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaExecResult {
    /// 执行结果（JSON 格式）
    pub result: serde_json::Value,
    /// 执行耗时（毫秒）
    pub duration_ms: u64,
}
