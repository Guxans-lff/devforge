mod connection;
mod executor;
mod util;

pub use connection::{connect};
pub use executor::*;
pub use util::{get_string, get_opt_string};

use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};
use crate::models::query::{DatabaseInfo, TableInfo, ColumnInfo, ViewInfo, RoutineInfo, TriggerInfo};
use crate::utils::error::AppError;
use super::escape_mysql_ident;

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

    Ok(rows.iter().map(|row| DatabaseInfo {
        name: get_string(row, "name"),
        character_set: get_opt_string(row, "charset"),
        collation: get_opt_string(row, "collation"),
    }).collect())
}

pub async fn get_tables(pool: &MySqlPool, database: &str) -> Result<Vec<TableInfo>, AppError> {
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

    Ok(rows.iter().map(|row| TableInfo {
        name: get_string(row, "name"),
        table_type: get_string(row, "table_type"),
        row_count: row.try_get::<Option<i64>, _>("row_count")
            .or_else(|_| row.try_get::<Option<u64>, _>("row_count").map(|v| v.map(|n| n as i64)))
            .unwrap_or(None),
        comment: get_opt_string(row, "comment"),
    }).collect())
}

pub async fn get_columns(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
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

    Ok(rows.iter().map(|row| {
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
    }).collect())
}

pub async fn get_create_table(pool: &MySqlPool, database: &str, table: &str) -> Result<String, AppError> {
    let sql = format!("SHOW CREATE TABLE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    let row: MySqlRow = sqlx::query(&sql).fetch_one(pool).await
        .map_err(|e| AppError::Other(format!("Failed to get DDL: {}", e)))?;

    let ddl = get_string(&row, "Create Table");
    Ok(ddl)
}

pub async fn get_views(pool: &MySqlPool, database: &str) -> Result<Vec<ViewInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CHECK_OPTION AS CHAR) as check_option,
                CAST(IS_UPDATABLE AS CHAR) as is_updatable
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
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

pub async fn get_routines(pool: &MySqlPool, database: &str, routine_type: &str) -> Result<Vec<RoutineInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(ROUTINE_NAME AS CHAR) as name,
                CAST(ROUTINE_TYPE AS CHAR) as routine_type,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CREATED AS CHAR) as created,
                CAST(LAST_ALTERED AS CHAR) as modified,
                CAST(ROUTINE_COMMENT AS CHAR) as comment
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ? ORDER BY ROUTINE_NAME",
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

pub async fn get_triggers(pool: &MySqlPool, database: &str) -> Result<Vec<TriggerInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TRIGGER_NAME AS CHAR) as name,
                CAST(EVENT_MANIPULATION AS CHAR) as event,
                CAST(ACTION_TIMING AS CHAR) as timing,
                CAST(EVENT_OBJECT_TABLE AS CHAR) as table_name,
                CAST(ACTION_STATEMENT AS CHAR) as statement
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME",
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

pub async fn get_object_definition(pool: &MySqlPool, database: &str, name: &str, object_type: &str) -> Result<String, AppError> {
    let sql = match object_type {
        "VIEW" => format!("SHOW CREATE VIEW `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "PROCEDURE" => format!("SHOW CREATE PROCEDURE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "FUNCTION" => format!("SHOW CREATE FUNCTION `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "TRIGGER" => format!("SHOW CREATE TRIGGER `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        _ => return Err(AppError::Other(format!("Unknown object type: {}", object_type))),
    };

    let row: MySqlRow = sqlx::query(&sql).fetch_one(pool).await
        .map_err(|e| AppError::Other(format!("Failed to get definition: {}", e)))?;

    let col_index = if object_type == "VIEW" { 1 } else { 2 };
    let ddl = get_string(&row, col_index);
    Ok(ddl)
}

pub async fn cancel_running_query(pool: &MySqlPool) -> Result<(), AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT ID FROM information_schema.PROCESSLIST WHERE COMMAND != 'Sleep' AND INFO IS NOT NULL AND INFO NOT LIKE '%PROCESSLIST%' AND USER = CURRENT_USER()"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get process list: {}", e)))?;

    for row in &rows {
        if let Ok(id) = row.try_get::<i64, usize>(0usize) {
            let _ = sqlx::query(&format!("KILL QUERY {}", id)).execute(pool).await;
        }
    }
    Ok(())
}

pub fn build_table_data_sql(database: &str, table: &str, page_size: u32, offset: u32, where_clause: Option<&str>, order_by: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT * FROM `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            super::validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    if let Some(o) = order_by {
        let o = o.trim();
        if !o.is_empty() {
            super::validate_sql_clause(o)?;
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
            super::validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    Ok(sql)
}
