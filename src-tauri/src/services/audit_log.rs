//! 操作审计日志服务
//! 记录所有 DDL/DML 操作（不记录 SELECT），保留 30 天

use chrono::Utc;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::services::storage::Storage;
use crate::utils::error::AppError;

/// 审计日志记录
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: String,
    pub connection_id: String,
    pub connection_name: Option<String>,
    pub database_name: Option<String>,
    pub operation_type: String,
    pub sql_text: String,
    pub affected_rows: i64,
    pub execution_time_ms: i64,
    pub is_error: bool,
    pub error_message: Option<String>,
    pub created_at: i64,
}

/// 审计日志查询过滤器
#[derive(Debug, Default)]
pub struct AuditFilter {
    pub connection_id: Option<String>,
    pub operation_type: Option<String>,
    pub database_name: Option<String>,
    pub search: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

/// 从 SQL 文本推断操作类型（DDL/DML/ADMIN）
pub fn classify_operation(sql: &str) -> Option<&'static str> {
    let trimmed = sql.trim_start();
    // 取首个关键词（忽略注释）
    let upper = trimmed.to_uppercase();

    // SELECT / SHOW / DESCRIBE / EXPLAIN 不记录
    if upper.starts_with("SELECT")
        || upper.starts_with("SHOW")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("DESC ")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("USE ")
        || upper.starts_with("SET ")
    {
        return None;
    }

    // DML
    if upper.starts_with("INSERT") {
        return Some("INSERT");
    }
    if upper.starts_with("UPDATE") {
        return Some("UPDATE");
    }
    if upper.starts_with("DELETE") {
        return Some("DELETE");
    }
    if upper.starts_with("REPLACE") {
        return Some("REPLACE");
    }

    // DDL
    if upper.starts_with("CREATE") {
        return Some("CREATE");
    }
    if upper.starts_with("ALTER") {
        return Some("ALTER");
    }
    if upper.starts_with("DROP") {
        return Some("DROP");
    }
    if upper.starts_with("TRUNCATE") {
        return Some("TRUNCATE");
    }
    if upper.starts_with("RENAME") {
        return Some("RENAME");
    }

    // ADMIN
    if upper.starts_with("GRANT") {
        return Some("GRANT");
    }
    if upper.starts_with("REVOKE") {
        return Some("REVOKE");
    }
    if upper.starts_with("KILL") {
        return Some("KILL");
    }
    if upper.starts_with("FLUSH") {
        return Some("FLUSH");
    }

    // 其他修改型操作
    if upper.starts_with("CALL") {
        return Some("CALL");
    }
    if upper.starts_with("LOAD") {
        return Some("LOAD");
    }

    None
}

/// 写入审计日志
pub async fn record(
    storage: &Storage,
    connection_id: &str,
    connection_name: Option<&str>,
    database_name: Option<&str>,
    sql: &str,
    affected_rows: i64,
    execution_time_ms: i64,
    is_error: bool,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    let op_type = match classify_operation(sql) {
        Some(t) => t,
        None => return Ok(()), // SELECT 等不记录
    };

    let pool = storage.get_pool().await;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    // SQL 文本截断到 4000 字符，避免存储巨型 SQL
    let sql_text = if sql.len() > 4000 {
        format!("{}...(truncated)", &sql[..4000])
    } else {
        sql.to_string()
    };

    sqlx::query(
        "INSERT INTO audit_logs (id, connection_id, connection_name, database_name, operation_type, sql_text, affected_rows, execution_time_ms, is_error, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(connection_id)
    .bind(connection_name)
    .bind(database_name)
    .bind(op_type)
    .bind(&sql_text)
    .bind(affected_rows)
    .bind(execution_time_ms)
    .bind(is_error as i32)
    .bind(error_message)
    .bind(now)
    .execute(&*pool)
    .await?;

    Ok(())
}

/// 查询审计日志
pub async fn query_logs(
    storage: &Storage,
    filter: AuditFilter,
) -> Result<Vec<AuditLogEntry>, AppError> {
    let pool = storage.get_pool().await;

    // 动态构建参数化查询，避免 SQL 注入
    let mut conditions = Vec::new();
    let mut bind_values: Vec<String> = Vec::new();

    if let Some(ref cid) = filter.connection_id {
        conditions.push("connection_id = ?");
        bind_values.push(cid.clone());
    }
    if let Some(ref op) = filter.operation_type {
        conditions.push("operation_type = ?");
        bind_values.push(op.clone());
    }
    if let Some(ref db) = filter.database_name {
        conditions.push("database_name = ?");
        bind_values.push(db.clone());
    }
    if let Some(ref s) = filter.search {
        conditions.push("sql_text LIKE '%' || ? || '%'");
        bind_values.push(s.clone());
    }

    let limit = if filter.limit > 0 && filter.limit <= 500 { filter.limit } else { 100 };

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT id, connection_id, connection_name, database_name, operation_type, sql_text, affected_rows, execution_time_ms, is_error, error_message, created_at FROM audit_logs WHERE 1=1{} ORDER BY created_at DESC LIMIT {} OFFSET {}",
        where_clause, limit, filter.offset
    );

    let mut query = sqlx::query(&sql);
    for val in &bind_values {
        query = query.bind(val);
    }

    let rows = query
        .fetch_all(&*pool)
        .await?;

    let entries = rows
        .iter()
        .map(|row| AuditLogEntry {
            id: row.get("id"),
            connection_id: row.get("connection_id"),
            connection_name: row.get("connection_name"),
            database_name: row.get("database_name"),
            operation_type: row.get("operation_type"),
            sql_text: row.get("sql_text"),
            affected_rows: row.get("affected_rows"),
            execution_time_ms: row.get("execution_time_ms"),
            is_error: row.get::<i32, _>("is_error") != 0,
            error_message: row.get("error_message"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(entries)
}

/// 清理过期审计日志（默认 30 天前）
pub async fn cleanup(storage: &Storage, retention_days: u32) -> Result<u64, AppError> {
    let pool = storage.get_pool().await;
    let cutoff = Utc::now().timestamp_millis() - (retention_days as i64 * 86_400_000);

    let result = sqlx::query("DELETE FROM audit_logs WHERE created_at < ?")
        .bind(cutoff)
        .execute(&*pool)
        .await?;

    Ok(result.rows_affected())
}

/// 获取审计日志统计信息
pub async fn get_stats(
    storage: &Storage,
    connection_id: Option<&str>,
) -> Result<AuditStats, AppError> {
    let pool = storage.get_pool().await;

    let (sql, bind_cid) = match connection_id {
        Some(cid) => (
            "SELECT COUNT(*) as total,
             SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as error_count,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
             FROM audit_logs WHERE connection_id = ?".to_string(),
            Some(cid.to_string()),
        ),
        None => (
            "SELECT COUNT(*) as total,
             SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as error_count,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
             FROM audit_logs".to_string(),
            None,
        ),
    };

    let mut query = sqlx::query(&sql);
    if let Some(ref cid) = bind_cid {
        query = query.bind(cid);
    }

    let row = query.fetch_one(&*pool).await?;

    Ok(AuditStats {
        total: row.get::<i64, _>("total") as u64,
        error_count: row.get::<i64, _>("error_count") as u64,
        earliest: row.get("earliest"),
        latest: row.get("latest"),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditStats {
    pub total: u64,
    pub error_count: u64,
    pub earliest: Option<i64>,
    pub latest: Option<i64>,
}
