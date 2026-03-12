use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Instant;
use sqlx::Executor;
use crate::models::query::{ApplyChangesResult, ChangeType, KeyValue, QueryResult, RowChange};
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use super::{DbEngine, TransactionConnection};

impl DbEngine {
    pub async fn begin_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        if self.transactions.read().await.contains_key(connection_id) {
            return Err(AppError::Other("该连接已有活跃事务".to_string()));
        }

        let pool = self.get_pool(connection_id).await?;
        let txn_conn = match pool.as_ref() {
            DriverPool::MySql(p) => {
                let mut conn = p.acquire().await.map_err(AppError::Database)?;
                sqlx::query("BEGIN").execute(&mut *conn).await.map_err(AppError::Database)?;
                TransactionConnection::MySql(Mutex::new(conn))
            }
            DriverPool::Postgres(p) => {
                let mut conn = p.acquire().await.map_err(AppError::Database)?;
                sqlx::query("BEGIN").execute(&mut *conn).await.map_err(AppError::Database)?;
                TransactionConnection::Postgres(Mutex::new(conn))
            }
        };

        self.transactions.write().await.insert(connection_id.to_string(), Arc::new(txn_conn));
        Ok(true)
    }

    pub async fn commit_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        let txn_conn = self.transactions.write().await.remove(connection_id)
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

    pub async fn rollback_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        let txn_conn = self.transactions.write().await.remove(connection_id)
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

    pub async fn execute_in_transaction(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let txn_conn = self.transactions.read().await.get(connection_id).cloned();
        let txn_conn = match txn_conn {
            Some(c) => c,
            None => return self.execute_query(connection_id, sql, None).await,
        };

        let start = Instant::now();
        let trimmed = sql.trim();
        let is_select = is_select_query(trimmed);

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                let mut guard = conn.lock().await;
                if is_select {
                    mysql::execute_select_on_conn(&mut *guard, trimmed, start).await
                } else {
                    mysql::execute_non_select_on_conn(&mut *guard, trimmed, start).await
                }
            }
            TransactionConnection::Postgres(conn) => {
                let mut guard = conn.lock().await;
                if is_select {
                    postgres::execute_select_on_conn(&mut *guard, trimmed, start).await
                } else {
                    postgres::execute_non_select_on_conn(&mut *guard, trimmed, start).await
                }
            }
        }
    }

    pub async fn apply_row_changes(
        &self,
        connection_id: &str,
        changes: Vec<RowChange>,
    ) -> Result<ApplyChangesResult, AppError> {
        if changes.is_empty() {
            return Ok(ApplyChangesResult { success: true, affected_rows: 0, generated_sql: vec![], error: None });
        }

        let mut sql_statements = Vec::new();
        for change in &changes {
            sql_statements.push(self.generate_change_sql(change)?);
        }

        let pool = self.get_pool(connection_id).await?;
        let result = match pool.as_ref() {
            DriverPool::MySql(p) => self.execute_changes_in_transaction_mysql(p, &sql_statements).await,
            DriverPool::Postgres(p) => self.execute_changes_in_transaction_pg(p, &sql_statements).await,
        };

        match result {
            Ok(affected) => Ok(ApplyChangesResult { success: true, affected_rows: affected, generated_sql: sql_statements, error: None }),
            Err(e) => Ok(ApplyChangesResult { success: false, affected_rows: 0, generated_sql: sql_statements, error: Some(e.to_string()) }),
        }
    }

    fn generate_change_sql(&self, change: &RowChange) -> Result<String, AppError> {
        let table_ref = format!("`{}`.`{}`", change.database, change.table);
        match change.change_type {
            ChangeType::Update => {
                let set_clause: Vec<String> = change.values.iter()
                    .map(|cv| format!("`{}` = {}", cv.column, self.value_to_sql(&cv.value)))
                    .collect();
                let where_clause = self.build_where_clause(&change.primary_keys)?;
                Ok(format!("UPDATE {} SET {} WHERE {}", table_ref, set_clause.join(", "), where_clause))
            }
            ChangeType::Insert => {
                let columns: Vec<String> = change.values.iter().map(|cv| format!("`{}`", cv.column)).collect();
                let values: Vec<String> = change.values.iter().map(|cv| self.value_to_sql(&cv.value)).collect();
                Ok(format!("INSERT INTO {} ({}) VALUES ({})", table_ref, columns.join(", "), values.join(", ")))
            }
            ChangeType::Delete => {
                let where_clause = self.build_where_clause(&change.primary_keys)?;
                Ok(format!("DELETE FROM {} WHERE {}", table_ref, where_clause))
            }
        }
    }

    fn value_to_sql(&self, value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
            _ => format!("'{}'", value.to_string().replace('\'', "''")),
        }
    }

    fn build_where_clause(&self, keys: &[KeyValue]) -> Result<String, AppError> {
        if keys.is_empty() { return Err(AppError::Other("WHERE 子句需要主键".to_string())); }
        Ok(keys.iter().map(|kv| {
            if kv.value.is_null() { format!("`{}` IS NULL", kv.column) }
            else { format!("`{}` = {}", kv.column, self.value_to_sql(&kv.value)) }
        }).collect::<Vec<_>>().join(" AND "))
    }

    async fn execute_changes_in_transaction_mysql(&self, pool: &sqlx::MySqlPool, statements: &[String]) -> Result<u64, AppError> {
        let mut conn = pool.acquire().await.map_err(AppError::Database)?;
        conn.execute("BEGIN").await.map_err(AppError::Database)?;
        let mut total: u64 = 0;
        for sql in statements {
            match conn.execute(sql.as_str()).await {
                Ok(res) => total += res.rows_affected(),
                Err(e) => { let _ = conn.execute("ROLLBACK").await; return Err(AppError::Other(e.to_string())); }
            }
        }
        conn.execute("COMMIT").await.map_err(AppError::Database)?;
        Ok(total)
    }

    async fn execute_changes_in_transaction_pg(&self, pool: &sqlx::PgPool, statements: &[String]) -> Result<u64, AppError> {
        let mut conn = pool.acquire().await.map_err(AppError::Database)?;
        conn.execute("BEGIN").await.map_err(AppError::Database)?;
        let mut total: u64 = 0;
        for sql in statements {
            match conn.execute(sql.as_str()).await {
                Ok(res) => total += res.rows_affected(),
                Err(e) => { let _ = conn.execute("ROLLBACK").await; return Err(AppError::Other(e.to_string())); }
            }
        }
        conn.execute("COMMIT").await.map_err(AppError::Database)?;
        Ok(total)
    }
}


use super::is_select_query;
