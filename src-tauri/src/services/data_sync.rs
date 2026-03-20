use std::sync::Arc;

use crate::models::query::ColumnInfo;
use crate::models::scheduler::{SyncConfig, SyncPreview, SyncProgress};
use crate::services::db_drivers::DriverPool;
use crate::services::db_engine::DbEngine;
use crate::utils::error::AppError;

/// 数据同步引擎
/// 支持同类型数据库之间的全量同步和 UPSERT 同步

/// 预览同步计划：获取每张表的行数、列信息、主键信息
pub async fn sync_preview(
    engine: Arc<DbEngine>,
    config: &SyncConfig,
) -> Result<Vec<SyncPreview>, AppError> {
    let mut previews = Vec::new();

    for table in &config.tables {
        // 获取源表列信息
        let columns = engine
            .clone()
            .get_columns(
                config.source_connection_id.clone(),
                config.source_database.clone(),
                table.clone(),
            )
            .await?;

        let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        let primary_keys: Vec<String> = columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();

        // 获取源表行数
        let source_rows = count_table_rows(
            engine.clone(),
            &config.source_connection_id,
            &config.source_database,
            table,
        )
        .await?;

        // 获取目标表行数
        let target_rows = count_table_rows(
            engine.clone(),
            &config.target_connection_id,
            &config.target_database,
            table,
        )
        .await?;

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

        let select_sql = build_select_sql(table, db_type, page_size, offset);
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
        offset += page_size as u64;

        if row_count < page_size as u64 {
            break;
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

    // 获取主键列
    let primary_keys: Vec<String> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.clone())
        .collect();

    if primary_keys.is_empty() {
        return Err(AppError::Validation(format!(
            "表 {} 没有主键，无法使用 UPSERT 模式",
            table
        )));
    }

    let mut offset: u64 = 0;
    let mut synced_rows: u64 = 0;

    loop {
        on_progress(SyncProgress {
            table: table.to_string(),
            table_index,
            table_count,
            synced_rows,
            total_rows,
            stage: format!("UPSERT 数据 ({}/{})", synced_rows, total_rows),
            finished: false,
            error: None,
        });

        let select_sql = build_select_sql(table, db_type, page_size, offset);
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

        // 构建 UPSERT SQL
        let upsert_sql =
            build_upsert_sql(table, columns, &result.rows, &primary_keys, db_type);
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
        offset += page_size as u64;

        if row_count < page_size as u64 {
            break;
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
) -> Result<u64, AppError> {
    let sql = format!("SELECT COUNT(*) AS cnt FROM {}", quote_identifier(table, "mysql"));
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

/// 构建分页 SELECT 语句
fn build_select_sql(table: &str, db_type: &str, page_size: usize, offset: u64) -> String {
    format!(
        "SELECT * FROM {} LIMIT {} OFFSET {}",
        quote_identifier(table, db_type),
        page_size,
        offset
    )
}

/// 构建批量 INSERT 语句
fn build_insert_sql(
    table: &str,
    columns: &[ColumnInfo],
    rows: &[Vec<serde_json::Value>],
    db_type: &str,
) -> String {
    let col_names: Vec<String> = columns.iter().map(|c| quote_identifier(&c.name, db_type)).collect();
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
    let col_names: Vec<String> = columns.iter().map(|c| quote_identifier(&c.name, db_type)).collect();
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
            if *b { "1".to_string() } else { "0".to_string() }
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
