use serde::Serialize;
use thiserror::Error;

/// 错误分类码，前端据此决定展示方式和处理策略
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorKind {
    /// 数据库查询/连接错误
    Database,
    /// 连接管理错误（未找到、已断开等）
    Connection,
    /// 凭据相关错误
    Credential,
    /// 用户输入验证错误
    Validation,
    /// 权限不足
    Permission,
    /// 操作超时
    Timeout,
    /// 文件 IO 错误
    Io,
    /// 序列化/反序列化错误
    Serialization,
    /// 内部错误（兜底）
    Internal,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("凭据错误: {0}")]
    Credential(String),

    #[error("连接未找到: {0}")]
    ConnectionNotFound(String),

    #[error("连接错误: {0}")]
    Connection(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("验证错误: {0}")]
    Validation(String),

    #[error("权限不足: {0}")]
    Permission(String),

    #[error("操作超时: {0}")]
    Timeout(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// 获取错误分类
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Database(_) => ErrorKind::Database,
            Self::ConnectionNotFound(_) | Self::Connection(_) => ErrorKind::Connection,
            Self::Credential(_) => ErrorKind::Credential,
            Self::Validation(_) => ErrorKind::Validation,
            Self::Permission(_) => ErrorKind::Permission,
            Self::Timeout(_) => ErrorKind::Timeout,
            Self::Io(_) => ErrorKind::Io,
            Self::Serialization(_) => ErrorKind::Serialization,
            Self::Other(_) => ErrorKind::Internal,
        }
    }

    /// 该错误是否可重试
    pub fn retryable(&self) -> bool {
        matches!(self, Self::Connection(_) | Self::Timeout(_))
    }
}

/// 序列化为结构化 JSON：{ kind, message, retryable }
/// 前端可根据 kind 字段区分错误类型并做差异化处理
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", &self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.serialize_field("retryable", &self.retryable())?;
        s.end()
    }
}

/// 保留向后兼容：未改造的命令仍可用 .map_err(|e: AppError| e.to_string())
impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}
