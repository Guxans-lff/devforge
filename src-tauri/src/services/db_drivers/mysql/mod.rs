mod connection;
mod executor;
mod util;

pub use connection::{connect, test_connect};
pub use executor::*;
pub use util::{get_string, get_opt_string};

use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};
use crate::models::query::{DatabaseInfo, TableInfo, ColumnInfo, ViewInfo, RoutineInfo, RoutineParameter, TriggerInfo, ForeignKeyRelation};
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

    // SHOW CREATE TABLE 返回两列：[0]=表名, [1]=建表语句
    // 用列索引取值比列名更可靠（避免 MySQL 版本差异导致列名不匹配）
    let ddl = get_string(&row, 1usize);
    if ddl.is_empty() {
        // 回退：尝试按列名获取
        let fallback = get_string(&row, "Create Table");
        if fallback.is_empty() {
            return Err(AppError::Other(format!(
                "SHOW CREATE TABLE 返回空结果，表: {}.{}",
                database, table
            )));
        }
        Ok(fallback)
    } else {
        Ok(ddl)
    }
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

/// 获取存储过程/函数的参数列表
pub async fn get_routine_parameters(
    pool: &MySqlPool,
    database: &str,
    routine_name: &str,
    routine_type: &str,
) -> Result<Vec<RoutineParameter>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(PARAMETER_NAME AS CHAR) as name,
                CAST(DATA_TYPE AS CHAR) as data_type,
                CAST(PARAMETER_MODE AS CHAR) as mode,
                CAST(DTD_IDENTIFIER AS CHAR) as dtd_identifier,
                ORDINAL_POSITION as position
         FROM information_schema.PARAMETERS
         WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ROUTINE_TYPE = ?
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(routine_name)
    .bind(routine_type)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get routine parameters: {}", e)))?;

    // PARAMETER_NAME 为 NULL 表示函数返回值（ORDINAL_POSITION = 0），过滤掉
    Ok(rows
        .iter()
        .filter(|row| get_opt_string(row, "name").is_some())
        .map(|row| {
            let pos: i64 = row.get("position");
            RoutineParameter {
                name: get_string(row, "name"),
                data_type: get_string(row, "data_type"),
                dtd_identifier: get_string(row, "dtd_identifier"),
                mode: get_opt_string(row, "mode").unwrap_or_else(|| "IN".to_string()),
                position: pos.try_into().unwrap_or(0),
            }
        })
        .collect())
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

/// 批量获取所有视图定义（一次 SQL 返回全部，避免 N 次网络往返）
pub async fn get_view_definitions(pool: &MySqlPool, database: &str) -> Result<Vec<(String, String)>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(VIEW_DEFINITION AS CHAR) as def
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get view definitions: {}", e)))?;

    Ok(rows.iter().map(|row| {
        let name = get_string(row, "name");
        let def = get_opt_string(row, "def").unwrap_or_default();
        (name, def)
    }).collect())
}

/// 批量获取所有存储过程/函数定义（一次 SQL 返回全部，含完整 CREATE 头部）
pub async fn get_routine_definitions(pool: &MySqlPool, database: &str, routine_type: &str) -> Result<Vec<(String, String)>, AppError> {
    // 从 information_schema 拼接完整 DDL：
    // ROUTINE_DEFINITION 只含过程体，还需要拼接参数列表和特性声明
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(r.ROUTINE_NAME AS CHAR) as name,
                CAST(r.ROUTINE_TYPE AS CHAR) as rtype,
                CAST(r.DTD_IDENTIFIER AS CHAR) as return_type,
                CAST(r.IS_DETERMINISTIC AS CHAR) as is_deterministic,
                CAST(r.SQL_DATA_ACCESS AS CHAR) as data_access,
                CAST(r.SECURITY_TYPE AS CHAR) as security_type,
                CAST(r.ROUTINE_DEFINITION AS CHAR) as body,
                GROUP_CONCAT(
                    CASE WHEN p.ORDINAL_POSITION > 0 THEN
                        CONCAT(
                            CASE p.PARAMETER_MODE WHEN 'IN' THEN 'IN ' WHEN 'OUT' THEN 'OUT ' WHEN 'INOUT' THEN 'INOUT ' ELSE '' END,
                            CAST(p.PARAMETER_NAME AS CHAR), ' ',
                            CAST(p.DTD_IDENTIFIER AS CHAR)
                        )
                    END
                    ORDER BY p.ORDINAL_POSITION SEPARATOR ', '
                ) as params
         FROM information_schema.ROUTINES r
         LEFT JOIN information_schema.PARAMETERS p
           ON p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA
           AND p.SPECIFIC_NAME = r.ROUTINE_NAME
           AND p.ROUTINE_TYPE = r.ROUTINE_TYPE
         WHERE r.ROUTINE_SCHEMA = ? AND r.ROUTINE_TYPE = ?
         GROUP BY r.ROUTINE_NAME, r.ROUTINE_TYPE, r.DTD_IDENTIFIER,
                  r.IS_DETERMINISTIC, r.SQL_DATA_ACCESS, r.SECURITY_TYPE, r.ROUTINE_DEFINITION
         ORDER BY r.ROUTINE_NAME",
    )
    .bind(database)
    .bind(routine_type)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get routine definitions: {}", e)))?;

    Ok(rows.iter().map(|row| {
        let name = get_string(row, "name");
        let rtype = get_string(row, "rtype");
        let body = get_opt_string(row, "body").unwrap_or_default();
        let params = get_opt_string(row, "params").unwrap_or_default();
        let is_det = get_string(row, "is_deterministic");
        let data_access = get_string(row, "data_access");
        let security = get_string(row, "security_type");

        // 拼接完整 DDL：CREATE PROCEDURE/FUNCTION name(params) [特性] body
        let det_clause = if is_det == "YES" { "DETERMINISTIC" } else { "NOT DETERMINISTIC" };
        let access_clause = match data_access.as_str() {
            "CONTAINS SQL"    => "CONTAINS SQL",
            "NO SQL"          => "NO SQL",
            "READS SQL DATA"  => "READS SQL DATA",
            "MODIFIES SQL DATA" => "MODIFIES SQL DATA",
            _ => "CONTAINS SQL",
        };
        let sec_clause = if security == "INVOKER" { "SQL SECURITY INVOKER" } else { "SQL SECURITY DEFINER" };

        let ddl = if rtype == "FUNCTION" {
            let ret = get_opt_string(row, "return_type").unwrap_or_default();
            format!(
                "CREATE FUNCTION `{}`({}) RETURNS {}\n    {} {} {}\n{}",
                name.replace('`', "``"), params, ret, det_clause, access_clause, sec_clause, body
            )
        } else {
            format!(
                "CREATE PROCEDURE `{}`({})\n    {} {} {}\n{}",
                name.replace('`', "``"), params, det_clause, access_clause, sec_clause, body
            )
        };

        (name, ddl)
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

#[allow(dead_code)]
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

/// 获取指定数据库中所有外键关系（用于 SQL 补全 JOIN 推荐）
pub async fn get_foreign_keys(pool: &MySqlPool, database: &str) -> Result<Vec<ForeignKeyRelation>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(kcu.TABLE_NAME AS CHAR) AS tbl,
                CAST(kcu.COLUMN_NAME AS CHAR) AS col,
                CAST(kcu.REFERENCED_TABLE_NAME AS CHAR) AS ref_tbl,
                CAST(kcu.REFERENCED_COLUMN_NAME AS CHAR) AS ref_col
         FROM information_schema.KEY_COLUMN_USAGE kcu
         WHERE kcu.TABLE_SCHEMA = ?
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY kcu.TABLE_NAME, kcu.ORDINAL_POSITION"
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("获取外键关系失败: {}", e)))?;

    Ok(rows.iter().map(|row| ForeignKeyRelation {
        table_name: get_string(row, "tbl"),
        column_name: get_string(row, "col"),
        referenced_table_name: get_string(row, "ref_tbl"),
        referenced_column_name: get_string(row, "ref_col"),
    }).collect())
}
