pub mod mysql;
pub mod postgres;

use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;

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
}
