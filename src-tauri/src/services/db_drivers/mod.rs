pub mod mysql;
pub mod postgres;

use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;

/// 转义 MySQL 标识符中的反引号（` → ``），防止标识符注入
pub fn escape_mysql_ident(name: &str) -> String {
    name.replace('`', "``")
}

/// 转义 PostgreSQL 标识符中的双引号（" → ""），防止标识符注入
pub fn escape_pg_ident(name: &str) -> String {
    name.replace('"', "\"\"")
}

/// 校验 WHERE/ORDER BY 子句，禁止分号（防止语句注入）
pub fn validate_sql_clause(clause: &str) -> Result<(), String> {
    if clause.contains(';') {
        return Err("SQL 子句中不允许包含分号".to_string());
    }
    Ok(())
}

/// Wraps the concrete connection pool for each supported database driver.
pub enum DriverPool {
    MySql(MySqlPool),
    Postgres(PgPool),
}

impl DriverPool {
    pub async fn close(&self) {
        match self {
            DriverPool::MySql(pool) => pool.close().await,
            DriverPool::Postgres(pool) => pool.close().await,
        }
    }

    /// 将内部 pool clone 为 owned 值，避免引用跨越 await 点
    ///
    /// 用于 tokio::spawn 场景：在 spawn 之前调用此方法，
    /// 将 owned pool 移入 async block，使 Future 满足 Send + 'static。
    pub fn clone_inner_pools(&self) -> (Option<MySqlPool>, Option<PgPool>) {
        match self {
            DriverPool::MySql(p) => (Some(p.clone()), None),
            DriverPool::Postgres(p) => (None, Some(p.clone())),
        }
    }
}
