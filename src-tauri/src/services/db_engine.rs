use std::collections::HashMap;
use std::time::Instant;

use crate::models::query::{ColumnInfo, DatabaseInfo, QueryResult, TableInfo};
use crate::services::db_drivers::DriverPool;
use crate::services::db_drivers::{mysql, postgres};
use crate::utils::error::AppError;

pub struct DbEngine {
    connections: HashMap<String, DriverPool>,
}

impl DbEngine {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &mut self,
        connection_id: &str,
        driver: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: Option<&str>,
    ) -> Result<(), AppError> {
        if self.connections.contains_key(connection_id) {
            self.disconnect(connection_id).await;
        }

        let pool = match driver {
            "postgresql" => {
                let pg_pool = postgres::connect(host, port, username, password, database).await?;
                DriverPool::Postgres(pg_pool)
            }
            _ => {
                // Default to MySQL for "mysql" and any unrecognized driver
                let my_pool = mysql::connect(host, port, username, password, database).await?;
                DriverPool::MySql(my_pool)
            }
        };

        self.connections.insert(connection_id.to_string(), pool);
        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) {
        if let Some(pool) = self.connections.remove(connection_id) {
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

    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.contains_key(connection_id)
    }

    pub fn get_pool(&self, connection_id: &str) -> Result<&DriverPool, AppError> {
        self.connections
            .get(connection_id)
            .ok_or_else(|| AppError::Other(format!("No active connection: {}", connection_id)))
    }

    pub async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id)?;
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

        match pool {
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
    }

    pub async fn get_databases(
        &self,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let pool = self.get_pool(connection_id)?;
        match pool {
            DriverPool::MySql(p) => mysql::get_databases(p).await,
            DriverPool::Postgres(p) => postgres::get_databases(p).await,
        }
    }

    pub async fn get_tables(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.get_pool(connection_id)?;
        match pool {
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
        let pool = self.get_pool(connection_id)?;
        match pool {
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
    ) -> Result<QueryResult, AppError> {
        let offset = page.saturating_sub(1) * page_size;
        let sql = match self.get_pool(connection_id)? {
            DriverPool::MySql(_) => mysql::build_table_data_sql(database, table, page_size, offset),
            DriverPool::Postgres(_) => postgres::build_table_data_sql(database, table, page_size, offset),
        };
        self.execute_query(connection_id, &sql).await
    }

    pub async fn get_create_table(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<String, AppError> {
        let pool = self.get_pool(connection_id)?;
        match pool {
            DriverPool::MySql(p) => mysql::get_create_table(p, database, table).await,
            DriverPool::Postgres(p) => postgres::get_create_table(p, database, table).await,
        }
    }
}
