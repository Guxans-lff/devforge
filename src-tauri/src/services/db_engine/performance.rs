//! 性能深度诊断模块
//!
//! 提供 MySQL 深度性能分析能力：
//! - 慢查询 Top N（基于 performance_schema.events_statements_summary_by_digest）
//! - InnoDB 引擎状态详情

use std::sync::Arc;
use sqlx::{MySqlPool, Row};
use crate::models::query::{SlowQueryDigest, InnoDbStatus};
use crate::services::db_drivers::DriverPool;
use crate::utils::error::AppError;
use super::DbEngine;

impl DbEngine {
    /// 获取慢查询 Top N（基于 performance_schema）
    pub async fn get_slow_query_digest(
        self: Arc<Self>,
        connection_id: String,
        limit: u32,
    ) -> Result<Vec<SlowQueryDigest>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("仅 MySQL 支持慢查询分析".into())),
        };

        get_slow_queries(mysql_pool, limit).await
    }

    /// 获取 InnoDB 引擎状态
    pub async fn get_innodb_status(
        self: Arc<Self>,
        connection_id: String,
    ) -> Result<InnoDbStatus, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("仅 MySQL 支持 InnoDB 状态查询".into())),
        };

        get_innodb_status(mysql_pool).await
    }
}

/// 从 performance_schema 获取慢查询摘要
async fn get_slow_queries(pool: &MySqlPool, limit: u32) -> Result<Vec<SlowQueryDigest>, AppError> {
    // 先检查 performance_schema 是否可用
    let check = sqlx::query("SELECT @@performance_schema")
        .fetch_one(pool)
        .await;

    let ps_enabled: bool = match check {
        Ok(row) => row.try_get::<i32, _>(0).unwrap_or(0) == 1,
        Err(_) => false,
    };

    if !ps_enabled {
        return Err(AppError::Other("performance_schema 未启用，无法获取慢查询信息。请在 MySQL 配置中开启 performance_schema=ON".into()));
    }

    let sql = format!(r#"
        SELECT
            DIGEST_TEXT,
            COUNT_STAR AS exec_count,
            ROUND(AVG_TIMER_WAIT / 1000000, 2) AS avg_time_ms,
            ROUND(MAX_TIMER_WAIT / 1000000, 2) AS max_time_ms,
            ROUND(SUM_TIMER_WAIT / 1000000, 2) AS total_time_ms,
            SUM_ROWS_EXAMINED AS rows_examined,
            SUM_ROWS_SENT AS rows_sent,
            FIRST_SEEN,
            LAST_SEEN
        FROM performance_schema.events_statements_summary_by_digest
        WHERE DIGEST_TEXT IS NOT NULL
          AND SCHEMA_NAME IS NOT NULL
        ORDER BY SUM_TIMER_WAIT DESC
        LIMIT {}
    "#, limit.min(100));

    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询慢查询摘要失败: {}", e)))?;

    let mut digests = Vec::new();
    for row in &rows {
        digests.push(SlowQueryDigest {
            digest_text: row.try_get::<String, _>("DIGEST_TEXT").unwrap_or_default(),
            exec_count: row.try_get::<u64, _>("exec_count").unwrap_or(0),
            avg_time_ms: row.try_get::<f64, _>("avg_time_ms").unwrap_or(0.0),
            max_time_ms: row.try_get::<f64, _>("max_time_ms").unwrap_or(0.0),
            total_time_ms: row.try_get::<f64, _>("total_time_ms").unwrap_or(0.0),
            rows_examined: row.try_get::<u64, _>("rows_examined").unwrap_or(0),
            rows_sent: row.try_get::<u64, _>("rows_sent").unwrap_or(0),
            first_seen: row.try_get::<String, _>("FIRST_SEEN").ok(),
            last_seen: row.try_get::<String, _>("LAST_SEEN").ok(),
        });
    }

    Ok(digests)
}

/// 从 SHOW GLOBAL STATUS 获取 InnoDB 状态
async fn get_innodb_status(pool: &MySqlPool) -> Result<InnoDbStatus, AppError> {
    let rows = sqlx::query("SHOW GLOBAL STATUS")
        .fetch_all(pool)
        .await
        .map_err(AppError::Database)?;

    let mut smap = std::collections::HashMap::new();
    for row in &rows {
        let name: String = row.try_get("Variable_name").unwrap_or_default();
        let value: String = row.try_get("Value").unwrap_or_default();
        smap.insert(name.to_lowercase(), value);
    }

    let get_u64 = |key: &str| -> u64 {
        smap.get(key).and_then(|v| v.parse().ok()).unwrap_or(0)
    };
    let get_f64 = |key: &str| -> f64 {
        smap.get(key).and_then(|v| v.parse().ok()).unwrap_or(0.0)
    };

    let bp_total = get_u64("innodb_buffer_pool_pages_total");
    let bp_free = get_u64("innodb_buffer_pool_pages_free");
    let bp_read_requests = get_f64("innodb_buffer_pool_read_requests");
    let bp_reads = get_f64("innodb_buffer_pool_reads");

    let hit_rate = if bp_read_requests > 0.0 {
        (bp_read_requests - bp_reads) / bp_read_requests
    } else {
        1.0
    };

    Ok(InnoDbStatus {
        buffer_pool_pages_total: bp_total,
        buffer_pool_pages_free: bp_free,
        buffer_pool_pages_dirty: get_u64("innodb_buffer_pool_pages_dirty"),
        buffer_pool_hit_rate: hit_rate,
        row_lock_current_waits: get_u64("innodb_row_lock_current_waits"),
        row_lock_time_avg_ms: get_f64("innodb_row_lock_time_avg"),
        deadlocks: get_u64("innodb_deadlocks"),
        log_bytes_written: get_u64("innodb_os_log_written"),
        log_pending_fsyncs: get_u64("innodb_os_log_pending_fsyncs"),
        rows_read: get_u64("innodb_rows_read"),
        rows_inserted: get_u64("innodb_rows_inserted"),
        rows_updated: get_u64("innodb_rows_updated"),
        rows_deleted: get_u64("innodb_rows_deleted"),
    })
}
