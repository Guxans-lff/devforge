use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;

use crate::models::query::{ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use crate::services::db_drivers::DriverPool;
use crate::services::db_drivers::{mysql, postgres};
use crate::utils::error::AppError;

const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;

pub struct DbEngine {
    connections: RwLock<HashMap<String, Arc<DriverPool>>>,
}

impl DbEngine {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        connection_id: &str,
        driver: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: Option<&str>,
    ) -> Result<(), AppError> {
        // 先断开已有连接
        self.disconnect(connection_id).await;

        let pool = match driver {
            "postgresql" => {
                let pg_pool = postgres::connect(host, port, username, password, database).await?;
                DriverPool::Postgres(pg_pool)
            }
            _ => {
                let my_pool = mysql::connect(host, port, username, password, database).await?;
                DriverPool::MySql(my_pool)
            }
        };

        self.connections
            .write()
            .await
            .insert(connection_id.to_string(), Arc::new(pool));
        Ok(())
    }

    pub async fn disconnect(&self, connection_id: &str) {
        let pool = self.connections.write().await.remove(connection_id);
        if let Some(pool) = pool {
            pool.close().await;
        }
    }

    pub async fn test_connect(
        driver: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: Option<&str>,
    ) -> Result<u64, AppError> {
        match driver {
            "postgresql" => postgres::test_connect(host, port, username, password, database).await,
            _ => mysql::test_connect(host, port, username, password, database).await,
        }
    }

    pub async fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.read().await.contains_key(connection_id)
    }

    pub async fn get_pool(&self, connection_id: &str) -> Result<Arc<DriverPool>, AppError> {
        self.connections
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| AppError::Other(format!("No active connection: {}", connection_id)))
    }

    pub async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let trimmed = sql.trim();

        let is_select = trimmed
            .split_whitespace()
            .next()
            .map(|w| {
                let upper = w.to_uppercase();
                upper == "SELECT" || upper == "SHOW" || upper == "DESCRIBE" || upper == "EXPLAIN"
            })
            .unwrap_or(false);

        let query_future = async {
            match pool.as_ref() {
                DriverPool::MySql(p) => {
                    if is_select {
                        mysql::execute_select(p, trimmed, start).await
                    } else {
                        mysql::execute_non_select(p, trimmed, start).await
                    }
                }
                DriverPool::Postgres(p) => {
                    if is_select {
                        postgres::execute_select(p, trimmed, start).await
                    } else {
                        postgres::execute_non_select(p, trimmed, start).await
                    }
                }
            }
        };

        match tokio::time::timeout(
            Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS),
            query_future,
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::Other(format!(
                "Query timed out after {}s",
                DEFAULT_QUERY_TIMEOUT_SECS
            ))),
        }
    }

    pub async fn get_databases(
        &self,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_databases(p).await,
            DriverPool::Postgres(p) => postgres::get_databases(p).await,
        }
    }

    pub async fn get_tables(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_tables(p, database).await,
            DriverPool::Postgres(p) => postgres::get_tables(p, database).await,
        }
    }

    pub async fn get_columns(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_columns(p, database, table).await,
            DriverPool::Postgres(p) => postgres::get_columns(p, database, table).await,
        }
    }

    pub async fn get_table_data(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
        page: u32,
        page_size: u32,
        where_clause: Option<&str>,
        order_by: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let offset = page.saturating_sub(1) * page_size;

        // 构建分页查询和 COUNT 查询
        let (data_sql, count_sql) = match pool.as_ref() {
            DriverPool::MySql(_) => (
                mysql::build_table_data_sql(database, table, page_size, offset, where_clause, order_by),
                mysql::build_table_count_sql(database, table, where_clause),
            ),
            DriverPool::Postgres(_) => (
                postgres::build_table_data_sql(database, table, page_size, offset, where_clause, order_by),
                postgres::build_table_count_sql(database, table, where_clause),
            ),
        };

        // 并行执行数据查询和 COUNT 查询
        let (data_result, count_result) = tokio::join!(
            self.execute_query(connection_id, &data_sql),
            self.execute_query(connection_id, &count_sql)
        );

        let mut result = data_result?;

        // 从 COUNT 结果中提取总行数
        if let Ok(count_res) = count_result {
            if let Some(first_row) = count_res.rows.first() {
                if let Some(val) = first_row.first() {
                    result.total_count = val.as_i64();
                }
            }
        }

        Ok(result)
    }

    pub async fn get_create_table(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<String, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_create_table(p, database, table).await,
            DriverPool::Postgres(p) => postgres::get_create_table(p, database, table).await,
        }
    }

    pub async fn get_views(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<ViewInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_views(p, database).await,
            DriverPool::Postgres(p) => postgres::get_views(p, database).await,
        }
    }

    pub async fn get_routines(
        &self,
        connection_id: &str,
        database: &str,
        routine_type: &str,
    ) -> Result<Vec<RoutineInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_routines(p, database, routine_type).await,
            DriverPool::Postgres(p) => postgres::get_routines(p, database, routine_type).await,
        }
    }

    pub async fn get_triggers(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_triggers(p, database).await,
            DriverPool::Postgres(p) => postgres::get_triggers(p, database).await,
        }
    }

    pub async fn get_object_definition(
        &self,
        connection_id: &str,
        database: &str,
        name: &str,
        object_type: &str,
    ) -> Result<String, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_object_definition(p, database, name, object_type).await,
            DriverPool::Postgres(p) => postgres::get_object_definition(p, database, name, object_type).await,
        }
    }

    /// 取消指定连接上的活跃查询（服务端取消）
    pub async fn cancel_query(&self, connection_id: &str) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::cancel_running_query(p).await,
            DriverPool::Postgres(p) => postgres::cancel_running_query(p).await,
        }
    }
}
