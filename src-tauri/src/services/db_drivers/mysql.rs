use std::time::{Duration, Instant};

use sqlx::mysql::{MySqlColumn, MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, Executor, Row, TypeInfo};

use crate::models::query::{ColumnDef, ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use crate::utils::error::AppError;
use super::{escape_mysql_ident, validate_sql_clause};

/// 取消当前用户在此连接池上的活跃查询（仅限当前用户，防止越权）
pub async fn cancel_running_query(pool: &MySqlPool) -> Result<(), AppError> {
    // 仅获取当前用户的活跃查询（排除 Sleep 和当前 PROCESSLIST 查询本身）
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT ID FROM information_schema.PROCESSLIST WHERE COMMAND != 'Sleep' AND INFO IS NOT NULL AND INFO NOT LIKE '%PROCESSLIST%' AND USER = CURRENT_USER()"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get process list: {}", e)))?;

    for row in &rows {
        if let Ok(Some(id)) = row.try_get::<Option<i64>, _>("ID") {
            // 使用参数化查询（KILL 不支持参数化，但 id 来自 i64 类型安全）
            let _ = sqlx::query(&format!("KILL QUERY {}", id))
                .execute(pool)
                .await;
        }
    }
    Ok(())
}

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
) -> Result<MySqlPool, AppError> {
    let mut options = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(MySqlSslMode::Preferred);

    if let Some(db) = database {
        if !db.is_empty() {
            options = options.database(db);
        }
    }

    let pool = MySqlPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("MySQL connection failed: {}", e)))?;

    Ok(pool)
}

pub async fn test_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
) -> Result<u64, AppError> {
    let start = Instant::now();

    let mut options = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(MySqlSslMode::Preferred);

    if let Some(db) = database {
        if !db.is_empty() {
            options = options.database(db);
        }
    }

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    let _: (i32,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    pool.close().await;
    Ok(start.elapsed().as_millis() as u64)
}

pub async fn execute_select(
    pool: &MySqlPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        // 空结果时通过 describe 获取列定义，确保前端能渲染空表格
        let columns = match pool.describe(sql).await {
            Ok(desc) => desc.columns().iter().map(|col| ColumnDef {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            }).collect(),
            Err(_) => vec![],
        };
        return Ok(QueryResult {
            columns,
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &MySqlColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| mysql_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

pub async fn execute_non_select(
    pool: &MySqlPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let result = sqlx::query(sql)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

pub async fn get_databases(pool: &MySqlPool) -> Result<Vec<DatabaseInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(SCHEMA_NAME AS CHAR) as name,
                CAST(DEFAULT_CHARACTER_SET_NAME AS CHAR) as charset,
                CAST(DEFAULT_COLLATION_NAME AS CHAR) as collation
         FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list databases: {}", e)))?;

    let databases = rows
        .iter()
        .map(|row| DatabaseInfo {
            name: get_string(row, "name"),
            character_set: get_opt_string(row, "charset"),
            collation: get_opt_string(row, "collation"),
        })
        .collect();

    Ok(databases)
}

pub async fn get_tables(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<TableInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(TABLE_TYPE AS CHAR) as table_type,
                CAST(TABLE_ROWS AS SIGNED) as row_count,
                CAST(TABLE_COMMENT AS CHAR) as comment
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list tables: {}", e)))?;

    let tables = rows
        .iter()
        .map(|row| TableInfo {
            name: get_string(row, "name"),
            table_type: get_string(row, "table_type"),
            row_count: row
                .try_get::<Option<i64>, _>("row_count")
                .or_else(|_| row.try_get::<Option<u64>, _>("row_count").map(|v| v.map(|n| n as i64)))
                .unwrap_or(None),
            comment: get_opt_string(row, "comment"),
        })
        .collect();

    Ok(tables)
}

pub async fn get_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(COLUMN_NAME AS CHAR) as name,
                CAST(COLUMN_TYPE AS CHAR) as data_type,
                CAST(IS_NULLABLE AS CHAR) as nullable,
                CAST(COLUMN_DEFAULT AS CHAR) as default_value,
                CAST(COLUMN_KEY AS CHAR) as column_key,
                CAST(COLUMN_COMMENT AS CHAR) as comment
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list columns: {}", e)))?;

    let columns = rows
        .iter()
        .map(|row| {
            let nullable_str = get_string(row, "nullable");
            let key = get_string(row, "column_key");
            ColumnInfo {
                name: get_string(row, "name"),
                data_type: get_string(row, "data_type"),
                nullable: nullable_str == "YES",
                default_value: get_opt_string(row, "default_value"),
                is_primary_key: key == "PRI",
                comment: get_opt_string(row, "comment"),
            }
        })
        .collect();

    Ok(columns)
}

pub async fn get_create_table(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<String, AppError> {
    let sql = format!("SHOW CREATE TABLE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    let row: MySqlRow = sqlx::query(&sql)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get DDL: {}", e)))?;

    let ddl: String = row
        .try_get::<String, _>(1)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(1)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default();
    Ok(ddl)
}

pub async fn get_views(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<ViewInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CHECK_OPTION AS CHAR) as check_option,
                CAST(IS_UPDATABLE AS CHAR) as is_updatable
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list views: {}", e)))?;

    Ok(rows.iter().map(|row| ViewInfo {
        name: get_string(row, "name"),
        definer: get_opt_string(row, "definer"),
        check_option: get_opt_string(row, "check_option"),
        is_updatable: get_opt_string(row, "is_updatable"),
    }).collect())
}

pub async fn get_routines(
    pool: &MySqlPool,
    database: &str,
    routine_type: &str,
) -> Result<Vec<RoutineInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(ROUTINE_NAME AS CHAR) as name,
                CAST(ROUTINE_TYPE AS CHAR) as routine_type,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CREATED AS CHAR) as created,
                CAST(LAST_ALTERED AS CHAR) as modified,
                CAST(ROUTINE_COMMENT AS CHAR) as comment
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?
         ORDER BY ROUTINE_NAME",
    )
    .bind(database)
    .bind(routine_type)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list routines: {}", e)))?;

    Ok(rows.iter().map(|row| RoutineInfo {
        name: get_string(row, "name"),
        routine_type: get_string(row, "routine_type"),
        definer: get_opt_string(row, "definer"),
        created: get_opt_string(row, "created"),
        modified: get_opt_string(row, "modified"),
        comment: get_opt_string(row, "comment"),
    }).collect())
}

pub async fn get_triggers(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<TriggerInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TRIGGER_NAME AS CHAR) as name,
                CAST(EVENT_MANIPULATION AS CHAR) as event,
                CAST(ACTION_TIMING AS CHAR) as timing,
                CAST(EVENT_OBJECT_TABLE AS CHAR) as table_name,
                CAST(ACTION_STATEMENT AS CHAR) as statement
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ?
         ORDER BY TRIGGER_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list triggers: {}", e)))?;

    Ok(rows.iter().map(|row| TriggerInfo {
        name: get_string(row, "name"),
        event: get_string(row, "event"),
        timing: get_string(row, "timing"),
        table_name: get_string(row, "table_name"),
        statement: get_opt_string(row, "statement"),
    }).collect())
}

pub async fn get_object_definition(
    pool: &MySqlPool,
    database: &str,
    name: &str,
    object_type: &str,
) -> Result<String, AppError> {
    let sql = match object_type {
        "VIEW" => format!("SHOW CREATE VIEW `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "PROCEDURE" => format!("SHOW CREATE PROCEDURE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "FUNCTION" => format!("SHOW CREATE FUNCTION `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "TRIGGER" => format!("SHOW CREATE TRIGGER `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        _ => return Err(AppError::Other(format!("Unknown object type: {}", object_type))),
    };

    let row: MySqlRow = sqlx::query(&sql)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get definition: {}", e)))?;

    // SHOW CREATE xxx 结果列位置：
    // VIEW: [View, Create View, ...]  → index 1
    // PROCEDURE: [Procedure, sql_mode, Create Procedure, ...]  → index 2
    // FUNCTION: [Function, sql_mode, Create Function, ...]  → index 2
    // TRIGGER: [Trigger, sql_mode, SQL Original Statement, ...]  → index 2
    let col_index = if object_type == "VIEW" { 1 } else { 2 };
    let ddl: String = row
        .try_get::<String, _>(col_index)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(col_index)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default();
    Ok(ddl)
}

pub fn build_table_data_sql(database: &str, table: &str, page_size: u32, offset: u32, where_clause: Option<&str>, order_by: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT * FROM `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    if let Some(o) = order_by {
        let o = o.trim();
        if !o.is_empty() {
            validate_sql_clause(o)?;
            sql.push_str(&format!(" ORDER BY {}", o));
        }
    }
    sql.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));
    Ok(sql)
}

pub fn build_table_count_sql(database: &str, table: &str, where_clause: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT COUNT(*) AS cnt FROM `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    Ok(sql)
}

/// Safely extract a String from a MySQL row column.
/// MySQL 8.0 information_schema returns VARBINARY instead of VARCHAR for many columns.
fn get_string(row: &MySqlRow, col: &str) -> String {
    row.try_get::<String, _>(col)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(col)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default()
}

fn get_opt_string(row: &MySqlRow, col: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(col)
        .or_else(|_| {
            row.try_get::<Option<Vec<u8>>, _>(col)
                .map(|opt| opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
        })
        .unwrap_or(None)
}

fn mysql_value_to_json(
    row: &MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOLEAN" | "TINYINT(1)" => row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),

        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" => row
            .try_get::<Option<i32>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "BIGINT" | "BIGINT UNSIGNED" => row
            .try_get::<Option<i64>, _>(index)
            .or_else(|_| row.try_get::<Option<u64>, _>(index).map(|v| v.map(|n| n as i64)))
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "FLOAT" | "DOUBLE" | "DECIMAL" => row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        _ => row
            .try_get::<Option<String>, _>(index)
            .or_else(|_| {
                row.try_get::<Option<Vec<u8>>, _>(index)
                    .map(|opt| opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
            })
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}
