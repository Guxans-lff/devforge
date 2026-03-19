use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Instant;
use crate::models::query::QueryResult;
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use super::{DbEngine, TransactionConnection};

impl DbEngine {
    pub async fn begin_transaction(self: Arc<Self>, connection_id: String) -> Result<bool, AppError> {
        if self.transactions.read().await.contains_key(&connection_id) {
            return Err(AppError::Other("该连接已有活跃事务".to_string()));
        }

        let pool: Arc<DriverPool> = self.clone().get_pool(connection_id.clone()).await?;
        let txn_conn = match pool.as_ref() {
            DriverPool::MySql(p) => {
                let mut conn = p.acquire().await.map_err(AppError::Database)?;
                sqlx::query("BEGIN").execute(&mut *conn).await.map_err(AppError::Database)?;
                TransactionConnection::MySql(Arc::new(Mutex::new(conn)))
            }
            DriverPool::Postgres(p) => {
                let mut conn = p.acquire().await.map_err(AppError::Database)?;
                sqlx::query("BEGIN").execute(&mut *conn).await.map_err(AppError::Database)?;
                TransactionConnection::Postgres(Arc::new(Mutex::new(conn)))
            }
        };

        self.transactions.write().await.insert(connection_id, Arc::new(txn_conn));
        Ok(true)
    }

    pub async fn commit_transaction(self: Arc<Self>, connection_id: String) -> Result<bool, AppError> {
        let txn_conn = self.transactions.write().await.remove(&connection_id)
            .ok_or_else(|| AppError::Other("无活跃事务".to_string()))?;

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("COMMIT").execute(&mut *guard as &mut sqlx::MySqlConnection).await.map_err(AppError::Database)?;
            }
            TransactionConnection::Postgres(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("COMMIT").execute(&mut *guard as &mut sqlx::PgConnection).await.map_err(AppError::Database)?;
            }
        }
        Ok(true)
    }

    pub async fn rollback_transaction(self: Arc<Self>, connection_id: String) -> Result<bool, AppError> {
        let txn_conn = self.transactions.write().await.remove(&connection_id)
            .ok_or_else(|| AppError::Other("无活跃事务".to_string()))?;

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *guard as &mut sqlx::MySqlConnection).await.map_err(AppError::Database)?;
            }
            TransactionConnection::Postgres(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *guard as &mut sqlx::PgConnection).await.map_err(AppError::Database)?;
            }
        }
        Ok(true)
    }

    #[allow(dead_code)]
    pub async fn execute_in_transaction(
        self: Arc<Self>,
        connection_id: String,
        sql: String,
    ) -> Result<QueryResult, AppError> {
        let txn_conn = self.transactions.read().await.get(&connection_id).cloned();
        let txn_conn = match txn_conn {
            Some(c) => c,
            None => return self.execute_query(connection_id, None, sql, None).await,
        };

        let start = Instant::now();
        let trimmed = sql.trim();
        let is_select = is_select_query(trimmed);

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                if is_select {
                    mysql::execute_select_on_conn(conn.clone(), sql, start).await
                } else {
                    mysql::execute_non_select_on_conn(conn.clone(), sql, start).await
                }
            }
            TransactionConnection::Postgres(conn) => {
                if is_select {
                    postgres::execute_select_on_conn(conn.clone(), sql, start).await
                } else {
                    postgres::execute_non_select_on_conn(conn.clone(), sql, start).await
                }
            }
        }
    }
}

use super::is_select_query;
