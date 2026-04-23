use std::collections::HashMap;
use std::sync::Arc;

use crate::models::query::ColumnInfo;
use crate::models::scheduler::{SyncConfig, SyncPreview, SyncProgress};
use crate::services::db_drivers::DriverPool;
use crate::services::db_engine::DbEngine;
use crate::utils::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SyncReadStrategy {
    Offset,
    Seek { column: String },
}

/// 数据同步引擎
/// 支持同类型数据库之间的全量同步和 UPSERT 同步

/// 预览同步计划：获取每张表的行数、列信息、主键信息
///
/// 性能策略：使用 get_all_columns 批量获取列信息 + get_tables 批量获取行数，
/// 3 次并发查询替代 3N 次串行查询。
pub async fn sync_preview(
    engine: Arc<DbEngine>,
    config: &SyncConfig,
) -> Result<Vec<SyncPreview>, AppError> {
    // 3 个请求并发：源端列信息 + 源端表列表（含行数）+ 目标端表列表（含行数）
    let (source_all_cols, source_tables, target_tables) = tokio::join!(
        engine.clone().get_all_columns(
            config.source_connection_id.clone(),
            config.source_database.clone(),
        ),
        engine.clone().get_tables(
            config.source_connection_id.clone(),
            config.source_database.clone(),
        ),
        engine.clone().get_tables(
            config.target_connection_id.clone(),
            config.target_database.clone(),
        )
    );

    let source_all_cols = source_all_cols?;
    let source_tables = source_tables?;
    let target_tables = target_tables?;

    // 构建行数映射：表名 → 行数
    let source_row_counts: HashMap<&str, u64> = source_tables
        .iter()
        .map(|t| (t.name.as_str(), t.row_count.unwrap_or(0) as u64))
        .collect();

    let target_row_counts: HashMap<&str, u64> = target_tables
        .iter()
        .map(|t| (t.name.as_str(), t.row_count.unwrap_or(0) as u64))
        .collect();

    let empty_cols = Vec::new();
    let mut previews = Vec::new();

    for table in &config.tables {
        let columns = source_all_cols.get(table).unwrap_or(&empty_cols);
        let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        let primary_keys: Vec<String> = columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();

        let source_rows = *source_row_counts.get(table.as_str()).unwrap_or(&0);
        let target_rows = *target_row_counts.get(table.as_str()).unwrap_or(&0);

        previews.push(SyncPreview {
            table: table.clone(),
            source_rows,
            target_rows,
            columns: column_names,
            primary_keys,
        });
    }

    Ok(previews)
}

/// 执行数据同步
/// `on_progress` 回调用于推送进度给前端
pub async fn sync_tables(
    engine: Arc<DbEngine>,
    config: &SyncConfig,
    on_progress: impl Fn(SyncProgress) + Send + Sync,
) -> Result<String, AppError> {
    let table_count = config.tables.len();
    let mut total_synced: u64 = 0;

    // 检测数据库类型（MySQL 或 PostgreSQL）
    let db_type = detect_db_type(engine.clone(), &config.source_connection_id).await?;

    for (table_index, table) in config.tables.iter().enumerate() {
        // 获取列信息
        let columns = engine
            .clone()
            .get_columns(
                config.source_connection_id.clone(),
                config.source_database.clone(),
                table.clone(),
            )
            .await?;

        if columns.is_empty() {
            continue;
        }

        // 获取源表总行数
        let total_rows = count_table_rows(
            engine.clone(),
            &config.source_connection_id,
            &config.source_database,
            table,
            &db_type,
        )
        .await?;

        // 推送开始进度
        on_progress(SyncProgress {
            table: table.clone(),
            table_index,
            table_count,
            synced_rows: 0,
            total_rows,
            stage: "开始同步".to_string(),
            finished: false,
            error: None,
        });

        let result = match config.sync_mode.as_str() {
            "full" => {
                sync_table_full(
                    engine.clone(),
                    config,
                    table,
                    &columns,
                    total_rows,
                    table_index,
                    table_count,
                    &db_type,
                    &on_progress,
                )
                .await
            }
            "upsert" => {
                sync_table_upsert(
                    engine.clone(),
                    config,
                    table,
                    &columns,
                    total_rows,
                    table_index,
                    table_count,
                    &db_type,
                    &on_progress,
                )
                .await
            }
            _ => Err(AppError::Validation(format!(
                "不支持的同步模式: {}",
                config.sync_mode
            ))),
        };

        match result {
            Ok(rows) => total_synced += rows,
            Err(e) => {
                on_progress(SyncProgress {
                    table: table.clone(),
                    table_index,
                    table_count,
                    synced_rows: 0,
                    total_rows,
                    stage: "同步失败".to_string(),
                    finished: true,
                    error: Some(e.to_string()),
                });
                return Err(e);
            }
        }
    }

    // 推送完成进度
    on_progress(SyncProgress {
        table: String::new(),
        table_index: table_count,
        table_count,
        synced_rows: total_synced,
        total_rows: total_synced,
        stage: "全部完成".to_string(),
        finished: true,
        error: None,
    });

    Ok(format!(
        "同步完成：{} 张表，共 {} 行",
        table_count, total_synced
    ))
}

/// 全量同步：TRUNCATE 目标表 → 分页读取源表 → 批量 INSERT 到目标表
#[allow(clippy::too_many_arguments)]
async fn sync_table_full(
    engine: Arc<DbEngine>,
    config: &SyncConfig,
    table: &str,
    columns: &[ColumnInfo],
    total_rows: u64,
    table_index: usize,
    table_count: usize,
    db_type: &str,
    on_progress: &impl Fn(SyncProgress),
) -> Result<u64, AppError> {
    let page_size = config.effective_page_size();
    let primary_keys = primary_keys_of(columns);
    let read_strategy = determine_read_strategy(columns);

    // 步骤 1：TRUNCATE 目标表
    on_progress(SyncProgress {
        table: table.to_string(),
        table_index,
        table_count,
        synced_rows: 0,
        total_rows,
        stage: "清空目标表".to_string(),
        finished: false,
        error: None,
    });

    let truncate_sql = build_truncate_sql(table, db_type);
    engine
        .clone()
        .execute_query_in_database(
            config.target_connection_id.clone(),
            config.target_database.clone(),
            truncate_sql,
            Some(60),
        )
        .await?;

    // 步骤 2：分页读取源表并批量 INSERT
    let mut offset: u64 = 0;
    let mut synced_rows: u64 = 0;
    let mut last_seek_value: Option<String> = None;

    loop {
        on_progress(SyncProgress {
            table: table.to_string(),
            table_index,
            table_count,
            synced_rows,
            total_rows,
            stage: format!("读取数据 ({}/{})", synced_rows, total_rows),
            finished: false,
            error: None,
        });

        let select_sql = match &read_strategy {
            SyncReadStrategy::Seek { column } => build_seek_select_sql(
                table,
                columns,
                db_type,
                page_size,
                column,
                last_seek_value.as_deref(),
            ),
            SyncReadStrategy::Offset => {
                build_select_sql(table, columns, &primary_keys, db_type, page_size, offset)
            }
        };
        let result = engine
            .clone()
            .execute_query_in_database(
                config.source_connection_id.clone(),
                config.source_database.clone(),
                select_sql,
                Some(300),
            )
            .await?;

        if result.rows.is_empty() {
            break;
        }

        let row_count = result.rows.len() as u64;

        // 构建批量 INSERT SQL
        let insert_sql = build_insert_sql(table, columns, &result.rows, db_type);
        engine
            .clone()
            .execute_query_in_database(
                config.target_connection_id.clone(),
                config.target_database.clone(),
                insert_sql,
                Some(300),
            )
            .await?;

        synced_rows += row_count;

        let has_more_rows = row_count == page_size as u64;
        if !has_more_rows {
            break;
        }

        match &read_strategy {
            SyncReadStrategy::Seek { column } => {
                last_seek_value = Some(extract_last_seek_value(&result.rows, columns, column)?)
            }
            SyncReadStrategy::Offset => {
                offset += page_size as u64;
            }
        }
    }

    Ok(synced_rows)
}

/// UPSERT 同步：分页读取源表 → 使用 UPSERT 语句写入目标表
#[allow(clippy::too_many_arguments)]
async fn sync_table_upsert(
    engine: Arc<DbEngine>,
    config: &SyncConfig,
    table: &str,
    columns: &[ColumnInfo],
    total_rows: u64,
    table_index: usize,
    table_count: usize,
    db_type: &str,
    on_progress: &impl Fn(SyncProgress),
) -> Result<u64, AppError> {
    let page_size = config.effective_page_size();

    let primary_keys: Vec<String> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.clone())
        .collect();

    if primary_keys.is_empty() {
        return Err(AppError::Validation(format!(
            "Table {} has no primary key; UPSERT mode is unavailable",
            table
        )));
    }

    let read_strategy = determine_read_strategy(columns);
    let mut offset: u64 = 0;
    let mut synced_rows: u64 = 0;
    let mut last_seek_value: Option<String> = None;

    loop {
        on_progress(SyncProgress {
            table: table.to_string(),
            table_index,
            table_count,
            synced_rows,
            total_rows,
            stage: format!("UPSERT data ({}/{})", synced_rows, total_rows),
            finished: false,
            error: None,
        });

        let select_sql = match &read_strategy {
            SyncReadStrategy::Seek { column } => build_seek_select_sql(
                table,
                columns,
                db_type,
                page_size,
                column.as_str(),
                last_seek_value.as_deref(),
            ),
            SyncReadStrategy::Offset => {
                build_select_sql(table, columns, &primary_keys, db_type, page_size, offset)
            }
        };
        let result = engine
            .clone()
            .execute_query_in_database(
                config.source_connection_id.clone(),
                config.source_database.clone(),
                select_sql,
                Some(300),
            )
            .await?;

        if result.rows.is_empty() {
            break;
        }

        let row_count = result.rows.len() as u64;

        let upsert_sql = build_upsert_sql(table, columns, &result.rows, &primary_keys, db_type);
        engine
            .clone()
            .execute_query_in_database(
                config.target_connection_id.clone(),
                config.target_database.clone(),
                upsert_sql,
                Some(300),
            )
            .await?;

        synced_rows += row_count;

        let has_more_rows = row_count == page_size as u64;
        if !has_more_rows {
            break;
        }

        match &read_strategy {
            SyncReadStrategy::Seek { column } => {
                last_seek_value = Some(extract_last_seek_value(
                    &result.rows,
                    columns,
                    column.as_str(),
                )?)
            }
            SyncReadStrategy::Offset => {
                offset += page_size as u64;
            }
        }
    }

    Ok(synced_rows)
}

// ==================== SQL 构建辅助函数 ====================

/// 获取表行数
async fn count_table_rows(
    engine: Arc<DbEngine>,
    connection_id: &str,
    database: &str,
    table: &str,
    db_type: &str,
) -> Result<u64, AppError> {
    let sql = build_count_rows_sql(table, db_type);
    let result = engine
        .execute_query_in_database(
            connection_id.to_string(),
            database.to_string(),
            sql,
            Some(60),
        )
        .await?;

    if let Some(row) = result.rows.first() {
        if let Some(val) = row.first() {
            return Ok(val.as_u64().unwrap_or(0));
        }
    }
    Ok(0)
}

/// 检测连接的数据库类型
async fn detect_db_type(engine: Arc<DbEngine>, connection_id: &str) -> Result<String, AppError> {
    let pool = engine.get_pool(connection_id.to_string()).await?;
    match pool.as_ref() {
        DriverPool::MySql(_) => Ok("mysql".to_string()),
        DriverPool::Postgres(_) => Ok("postgres".to_string()),
    }
}

/// 构建 TRUNCATE 语句
fn build_truncate_sql(table: &str, db_type: &str) -> String {
    format!("TRUNCATE TABLE {}", quote_identifier(table, db_type))
}

fn build_count_rows_sql(table: &str, db_type: &str) -> String {
    format!(
        "SELECT COUNT(*) AS cnt FROM {}",
        quote_identifier(table, db_type)
    )
}

fn primary_keys_of(columns: &[ColumnInfo]) -> Vec<String> {
    columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.clone())
        .collect()
}

fn determine_read_strategy(columns: &[ColumnInfo]) -> SyncReadStrategy {
    let Some(primary_key) = columns.iter().find(|c| c.is_primary_key) else {
        return SyncReadStrategy::Offset;
    };

    if columns.iter().filter(|c| c.is_primary_key).count() == 1
        && is_seek_compatible_type(&primary_key.data_type)
    {
        SyncReadStrategy::Seek {
            column: primary_key.name.clone(),
        }
    } else {
        SyncReadStrategy::Offset
    }
}

fn is_seek_compatible_type(data_type: &str) -> bool {
    let normalized = data_type.trim().to_ascii_lowercase();
    let base = normalized
        .split(|c: char| c == '(' || c.is_whitespace())
        .next()
        .unwrap_or("");

    matches!(
        base,
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "serial"
            | "smallserial"
            | "bigserial"
            | "int2"
            | "int4"
            | "int8"
    )
}

fn build_select_column_list(columns: &[ColumnInfo], db_type: &str) -> String {
    if columns.is_empty() {
        "*".to_string()
    } else {
        columns
            .iter()
            .map(|c| quote_identifier(&c.name, db_type))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn build_order_by_clause(primary_keys: &[String], db_type: &str) -> String {
    if primary_keys.is_empty() {
        String::new()
    } else {
        let keys = primary_keys
            .iter()
            .map(|key| format!("{} ASC", quote_identifier(key, db_type)))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ORDER BY {}", keys)
    }
}

fn extract_last_seek_value(
    rows: &[Vec<serde_json::Value>],
    columns: &[ColumnInfo],
    seek_column: &str,
) -> Result<String, AppError> {
    let column_index = columns
        .iter()
        .position(|column| column.name == seek_column)
        .ok_or_else(|| AppError::Validation(format!("Seek column not found: {}", seek_column)))?;

    let row = rows.last().ok_or_else(|| {
        AppError::Validation("No last row available for seek pagination".to_string())
    })?;

    let value = row.get(column_index).ok_or_else(|| {
        AppError::Validation(format!("Seek column value missing: {}", seek_column))
    })?;

    match value {
        serde_json::Value::Number(number) => Ok(number.to_string()),
        _ => Err(AppError::Validation(format!(
            "Seek column value must be numeric: {}",
            seek_column
        ))),
    }
}

/// 构建分页 SELECT 语句
fn build_select_sql(
    table: &str,
    columns: &[ColumnInfo],
    primary_keys: &[String],
    db_type: &str,
    page_size: usize,
    offset: u64,
) -> String {
    format!(
        "SELECT {} FROM {}{} LIMIT {} OFFSET {}",
        build_select_column_list(columns, db_type),
        quote_identifier(table, db_type),
        build_order_by_clause(primary_keys, db_type),
        page_size,
        offset
    )
}

fn build_seek_select_sql(
    table: &str,
    columns: &[ColumnInfo],
    db_type: &str,
    page_size: usize,
    seek_column: &str,
    last_seek_value: Option<&str>,
) -> String {
    let seek_identifier = quote_identifier(seek_column, db_type);
    let where_clause = last_seek_value
        .filter(|value| !value.is_empty())
        .map(|value| format!(" WHERE {} > {}", seek_identifier, value))
        .unwrap_or_default();

    format!(
        "SELECT {} FROM {}{} ORDER BY {} ASC LIMIT {}",
        build_select_column_list(columns, db_type),
        quote_identifier(table, db_type),
        where_clause,
        seek_identifier,
        page_size
    )
}

/// 构建批量 INSERT 语句
fn build_insert_sql(
    table: &str,
    columns: &[ColumnInfo],
    rows: &[Vec<serde_json::Value>],
    db_type: &str,
) -> String {
    let col_names: Vec<String> = columns
        .iter()
        .map(|c| quote_identifier(&c.name, db_type))
        .collect();
    let col_list = col_names.join(", ");

    let value_rows: Vec<String> = rows
        .iter()
        .map(|row| {
            let values: Vec<String> = row.iter().map(|v| escape_value(v)).collect();
            format!("({})", values.join(", "))
        })
        .collect();

    format!(
        "INSERT INTO {} ({}) VALUES {}",
        quote_identifier(table, db_type),
        col_list,
        value_rows.join(", ")
    )
}

/// 构建 UPSERT 语句
/// MySQL: INSERT ... ON DUPLICATE KEY UPDATE
/// PostgreSQL: INSERT ... ON CONFLICT (pk) DO UPDATE SET
fn build_upsert_sql(
    table: &str,
    columns: &[ColumnInfo],
    rows: &[Vec<serde_json::Value>],
    primary_keys: &[String],
    db_type: &str,
) -> String {
    let col_names: Vec<String> = columns
        .iter()
        .map(|c| quote_identifier(&c.name, db_type))
        .collect();
    let col_list = col_names.join(", ");

    let value_rows: Vec<String> = rows
        .iter()
        .map(|row| {
            let values: Vec<String> = row.iter().map(|v| escape_value(v)).collect();
            format!("({})", values.join(", "))
        })
        .collect();

    let insert_part = format!(
        "INSERT INTO {} ({}) VALUES {}",
        quote_identifier(table, db_type),
        col_list,
        value_rows.join(", ")
    );

    // 非主键列用于 UPDATE
    let update_columns: Vec<&ColumnInfo> = columns
        .iter()
        .filter(|c| !primary_keys.contains(&c.name))
        .collect();

    match db_type {
        "mysql" => {
            if update_columns.is_empty() {
                // 如果全是主键列，使用 IGNORE 避免重复报错
                return insert_part.replacen("INSERT INTO", "INSERT IGNORE INTO", 1);
            }
            let update_clause: Vec<String> = update_columns
                .iter()
                .map(|c| {
                    let qname = quote_identifier(&c.name, db_type);
                    format!("{} = VALUES({})", qname, qname)
                })
                .collect();
            format!(
                "{} ON DUPLICATE KEY UPDATE {}",
                insert_part,
                update_clause.join(", ")
            )
        }
        "postgres" => {
            let pk_cols: Vec<String> = primary_keys
                .iter()
                .map(|pk| quote_identifier(pk, db_type))
                .collect();
            let conflict_cols = pk_cols.join(", ");

            if update_columns.is_empty() {
                return format!("{} ON CONFLICT ({}) DO NOTHING", insert_part, conflict_cols);
            }

            let update_clause: Vec<String> = update_columns
                .iter()
                .map(|c| {
                    let qname = quote_identifier(&c.name, db_type);
                    format!("{} = EXCLUDED.{}", qname, qname)
                })
                .collect();
            format!(
                "{} ON CONFLICT ({}) DO UPDATE SET {}",
                insert_part,
                conflict_cols,
                update_clause.join(", ")
            )
        }
        _ => insert_part,
    }
}

/// 转义 SQL 值（将 serde_json::Value 转为 SQL 字面量）
fn escape_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            // 转义单引号
            format!("'{}'", s.replace('\'', "''"))
        }
        _ => {
            // Array / Object 序列化为 JSON 字符串
            let s = serde_json::to_string(value).unwrap_or_default();
            format!("'{}'", s.replace('\'', "''"))
        }
    }
}

/// 引用标识符（表名、列名），防止与关键字冲突
/// MySQL 使用反引号，PostgreSQL 使用双引号
fn quote_identifier(name: &str, db_type: &str) -> String {
    match db_type {
        "postgres" => format!("\"{}\"", name.replace('"', "\"\"")),
        _ => format!("`{}`", name.replace('`', "``")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_column(name: &str, data_type: &str, is_primary_key: bool) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: false,
            default_value: None,
            is_primary_key,
            comment: None,
        }
    }

    #[test]
    fn count_rows_sql_uses_actual_database_dialect() {
        assert_eq!(
            build_count_rows_sql("orders", "mysql"),
            "SELECT COUNT(*) AS cnt FROM `orders`",
        );
        assert_eq!(
            build_count_rows_sql("orders", "postgres"),
            "SELECT COUNT(*) AS cnt FROM \"orders\"",
        );
    }

    #[test]
    fn offset_select_sql_uses_explicit_columns_and_primary_key_order() {
        let columns = vec![
            make_column("id", "bigint", true),
            make_column("created_at", "timestamp", false),
        ];
        let primary_keys = primary_keys_of(&columns);

        assert_eq!(
            build_select_sql("orders", &columns, &primary_keys, "mysql", 500, 1000),
            "SELECT `id`, `created_at` FROM `orders` ORDER BY `id` ASC LIMIT 500 OFFSET 1000",
        );
    }

    #[test]
    fn seek_select_sql_uses_explicit_columns_and_cursor_predicate() {
        let columns = vec![
            make_column("id", "int8", true),
            make_column("name", "text", false),
        ];

        assert_eq!(
            build_seek_select_sql("users", &columns, "postgres", 200, "id", Some("42")),
            "SELECT \"id\", \"name\" FROM \"users\" WHERE \"id\" > 42 ORDER BY \"id\" ASC LIMIT 200",
        );
    }

    #[test]
    fn choose_seek_strategy_for_single_numeric_primary_key() {
        let columns = vec![
            make_column("id", "bigint", true),
            make_column("name", "varchar(255)", false),
        ];

        assert_eq!(
            determine_read_strategy(&columns),
            SyncReadStrategy::Seek {
                column: "id".to_string(),
            },
        );
    }

    #[test]
    fn choose_offset_strategy_for_composite_primary_key() {
        let columns = vec![
            make_column("tenant_id", "int", true),
            make_column("id", "int", true),
            make_column("name", "varchar(255)", false),
        ];

        assert_eq!(determine_read_strategy(&columns), SyncReadStrategy::Offset);
    }

    #[test]
    fn extract_seek_value_from_last_row_number() {
        let columns = vec![
            make_column("id", "bigint", true),
            make_column("name", "varchar(255)", false),
        ];
        let rows = vec![
            vec![serde_json::json!(1), serde_json::json!("a")],
            vec![serde_json::json!(9), serde_json::json!("b")],
        ];

        assert_eq!(extract_last_seek_value(&rows, &columns, "id").unwrap(), "9");
    }
}
