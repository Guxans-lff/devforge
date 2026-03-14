use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;
use sqlx::Row;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use std::sync::Arc;
use crate::services::db_drivers::DriverPool;
use crate::services::db_engine::DbEngine;
use crate::services::sql_splitter;
use crate::utils::error::AppError;

/// 备份进度事件
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub current_table: String,
    pub table_index: u32,
    pub total_tables: u32,
    pub rows_exported: u64,
    pub status: String, // "running" | "completed" | "error"
    pub error: Option<String>,
}

/// 恢复进度事件
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProgress {
    pub statements_executed: u32,
    pub total_statements: u32,
    pub status: String,
    pub error: Option<String>,
}

const BATCH_SIZE: usize = 1000;

fn emit_backup_progress(app: &AppHandle, progress: &BackupProgress) {
    let _ = app.emit("backup://progress", progress);
}

fn emit_restore_progress(app: &AppHandle, progress: &RestoreProgress) {
    let _ = app.emit("restore://progress", progress);
}

/// 执行数据库备份
pub async fn backup_database(
    engine: Arc<DbEngine>,
    connection_id: &str,
    database: &str,
    tables: Vec<String>,
    include_structure: bool,
    include_data: bool,
    output_path: &str,
    app_handle: &AppHandle,
) -> Result<(), AppError> {
    let pool = engine.clone().get_pool(connection_id.to_string()).await?;

    // 获取表列表
    let table_list = if tables.is_empty() {
        let table_infos = engine.clone().get_tables(connection_id.to_string(), database.to_string()).await?;
        table_infos.into_iter().map(|t| t.name).collect::<Vec<_>>()
    } else {
        tables
    };

    let total_tables = table_list.len() as u32;
    let mut file = tokio::fs::File::create(output_path).await?;

    // 写入头部
    match pool.as_ref() {
        DriverPool::MySql(_) => {
            write_mysql_header(&mut file, database).await?;
        }
        DriverPool::Postgres(_) => {
            write_postgres_header(&mut file, database).await?;
        }
    }

    for (i, table_name) in table_list.iter().enumerate() {
        emit_backup_progress(app_handle, &BackupProgress {
            current_table: table_name.clone(),
            table_index: i as u32 + 1,
            total_tables,
            rows_exported: 0,
            status: "running".to_string(),
            error: None,
        });

        file.write_all(format!("\n-- Table: {}\n", table_name).as_bytes()).await?;

        // 导出表结构
        if include_structure {
            let create_sql = engine.clone().get_create_table(connection_id.to_string(), database.to_string(), table_name.to_string()).await?;
            match pool.as_ref() {
                DriverPool::MySql(_) => {
                    file.write_all(format!("DROP TABLE IF EXISTS `{}`;\n", table_name).as_bytes()).await?;
                }
                DriverPool::Postgres(_) => {
                    file.write_all(format!("DROP TABLE IF EXISTS \"{}\" CASCADE;\n", table_name).as_bytes()).await?;
                }
            }
            file.write_all(create_sql.as_bytes()).await?;
            file.write_all(b";\n\n").await?;
        }

        // 导出表数据
        if include_data {
            let rows_exported = match pool.as_ref() {
                DriverPool::MySql(p) => {
                    export_mysql_data(&mut file, p, database, table_name).await?
                }
                DriverPool::Postgres(p) => {
                    export_postgres_data(&mut file, p, database, table_name).await?
                }
            };

            emit_backup_progress(app_handle, &BackupProgress {
                current_table: table_name.clone(),
                table_index: i as u32 + 1,
                total_tables,
                rows_exported,
                status: "running".to_string(),
                error: None,
            });
        }
    }

    // 写入尾部
    match pool.as_ref() {
        DriverPool::MySql(_) => {
            write_mysql_footer(&mut file).await?;
        }
        DriverPool::Postgres(_) => {
            write_postgres_footer(&mut file).await?;
        }
    }

    file.flush().await?;

    emit_backup_progress(app_handle, &BackupProgress {
        current_table: String::new(),
        table_index: total_tables,
        total_tables,
        rows_exported: 0,
        status: "completed".to_string(),
        error: None,
    });

    Ok(())
}

/// 执行数据库恢复
pub async fn restore_database(
    engine: Arc<DbEngine>,
    connection_id: &str,
    database: &str,
    file_path: &str,
    app_handle: &AppHandle,
) -> Result<(), AppError> {
    let pool = engine.clone().get_pool(connection_id.to_string()).await?;
    let content = tokio::fs::read_to_string(file_path).await?;

    // 分割 SQL 语句
    let statements = sql_splitter::split_sql_statements(&content);
    let total = statements.len() as u32;

    // 切换数据库
    match pool.as_ref() {
        DriverPool::MySql(p) => {
            sqlx::query(&format!("USE `{}`", database))
                .execute(p)
                .await?;
        }
        DriverPool::Postgres(p) => {
            sqlx::query(&format!("SET search_path TO \"{}\"", database))
                .execute(p)
                .await?;
        }
    }

    for (i, stmt) in statements.iter().enumerate() {
        if stmt.trim().is_empty() {
            continue;
        }

        emit_restore_progress(app_handle, &RestoreProgress {
            statements_executed: i as u32,
            total_statements: total,
            status: "running".to_string(),
            error: None,
        });

        match pool.as_ref() {
            DriverPool::MySql(p) => {
                if let Err(e) = sqlx::query(stmt).execute(p).await {
                    // 记录错误但继续
                    log::warn!("Restore statement failed: {}", e);
                }
            }
            DriverPool::Postgres(p) => {
                if let Err(e) = sqlx::query(stmt).execute(p).await {
                    log::warn!("Restore statement failed: {}", e);
                }
            }
        }
    }

    emit_restore_progress(app_handle, &RestoreProgress {
        statements_executed: total,
        total_statements: total,
        status: "completed".to_string(),
        error: None,
    });

    Ok(())
}

// === MySQL 备份辅助函数 ===

async fn write_mysql_header(
    file: &mut tokio::fs::File,
    database: &str,
) -> Result<(), AppError> {
    let header = format!(
        "-- DevForge Database Backup\n\
         -- Database: {}\n\
         -- Generated at: {}\n\n\
         SET NAMES utf8mb4;\n\
         SET FOREIGN_KEY_CHECKS = 0;\n\
         SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n",
        database,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
    );
    file.write_all(header.as_bytes()).await?;
    Ok(())
}

async fn write_mysql_footer(file: &mut tokio::fs::File) -> Result<(), AppError> {
    file.write_all(b"\nSET FOREIGN_KEY_CHECKS = 1;\n").await?;
    Ok(())
}

async fn export_mysql_data(
    file: &mut tokio::fs::File,
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<u64, AppError> {
    // 获取列名
    let columns: Vec<String> = sqlx::query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION"
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| row.get::<String, _>("COLUMN_NAME"))
    .collect();

    if columns.is_empty() {
        return Ok(0);
    }

    let col_names = columns.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ");

    // 分批查询数据
    let mut offset: u64 = 0;
    let mut total_rows: u64 = 0;

    loop {
        let sql = format!(
            "SELECT * FROM `{}`.`{}` LIMIT {} OFFSET {}",
            database, table, BATCH_SIZE, offset
        );

        let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(&sql).fetch_all(pool).await?;

        if rows.is_empty() {
            break;
        }

        let row_count = rows.len();

        // 生成 INSERT 语句
        file.write_all(format!("INSERT INTO `{}` ({}) VALUES\n", table, col_names).as_bytes()).await?;

        for (j, row) in rows.iter().enumerate() {
            let values: Vec<String> = (0..columns.len())
                .map(|col_idx| format_mysql_value(row, col_idx))
                .collect();

            let line = format!("({})", values.join(", "));
            file.write_all(line.as_bytes()).await?;

            if j < row_count - 1 {
                file.write_all(b",\n").await?;
            } else {
                file.write_all(b";\n\n").await?;
            }
        }

        total_rows += row_count as u64;
        offset += BATCH_SIZE as u64;

        if row_count < BATCH_SIZE {
            break;
        }
    }

    Ok(total_rows)
}

fn format_mysql_value(row: &sqlx::mysql::MySqlRow, col_idx: usize) -> String {
    // 尝试读取为字符串，处理 NULL
    match row.try_get::<Option<String>, _>(col_idx) {
        Ok(Some(val)) => {
            // 转义特殊字符
            let escaped = val
                .replace('\\', "\\\\")
                .replace('\'', "\\'")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\0', "\\0");
            format!("'{}'", escaped)
        }
        Ok(None) => "NULL".to_string(),
        Err(_) => {
            // 尝试读取为 bytes
            match row.try_get::<Option<Vec<u8>>, _>(col_idx) {
                Ok(Some(bytes)) => {
                    format!("X'{}'", hex::encode(&bytes))
                }
                Ok(None) => "NULL".to_string(),
                Err(_) => "NULL".to_string(),
            }
        }
    }
}

// === PostgreSQL 备份辅助函数 ===

async fn write_postgres_header(
    file: &mut tokio::fs::File,
    database: &str,
) -> Result<(), AppError> {
    let header = format!(
        "-- DevForge Database Backup\n\
         -- Database: {}\n\
         -- Generated at: {}\n\n\
         SET client_encoding = 'UTF8';\n\
         SET standard_conforming_strings = on;\n\n",
        database,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
    );
    file.write_all(header.as_bytes()).await?;
    Ok(())
}

async fn write_postgres_footer(file: &mut tokio::fs::File) -> Result<(), AppError> {
    file.write_all(b"\n-- Backup completed\n").await?;
    Ok(())
}

async fn export_postgres_data(
    file: &mut tokio::fs::File,
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<u64, AppError> {
    // 获取列名
    let columns: Vec<String> = sqlx::query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| row.get::<String, _>("column_name"))
    .collect();

    if columns.is_empty() {
        return Ok(0);
    }

    let col_names = columns.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ");

    let mut offset: u64 = 0;
    let mut total_rows: u64 = 0;

    loop {
        let sql = format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, table, BATCH_SIZE, offset
        );

        let rows: Vec<sqlx::postgres::PgRow> = sqlx::query(&sql).fetch_all(pool).await?;

        if rows.is_empty() {
            break;
        }

        let row_count = rows.len();

        file.write_all(format!("INSERT INTO \"{}\" ({}) VALUES\n", table, col_names).as_bytes()).await?;

        for (j, row) in rows.iter().enumerate() {
            let values: Vec<String> = (0..columns.len())
                .map(|col_idx| format_postgres_value(row, col_idx))
                .collect();

            let line = format!("({})", values.join(", "));
            file.write_all(line.as_bytes()).await?;

            if j < row_count - 1 {
                file.write_all(b",\n").await?;
            } else {
                file.write_all(b";\n\n").await?;
            }
        }

        total_rows += row_count as u64;
        offset += BATCH_SIZE as u64;

        if row_count < BATCH_SIZE {
            break;
        }
    }

    Ok(total_rows)
}

fn format_postgres_value(row: &sqlx::postgres::PgRow, col_idx: usize) -> String {
    match row.try_get::<Option<String>, _>(col_idx) {
        Ok(Some(val)) => {
            let escaped = val.replace('\'', "''");
            format!("'{}'", escaped)
        }
        Ok(None) => "NULL".to_string(),
        Err(_) => {
            match row.try_get::<Option<Vec<u8>>, _>(col_idx) {
                Ok(Some(bytes)) => {
                    format!("E'\\\\x{}'", hex::encode(&bytes))
                }
                Ok(None) => "NULL".to_string(),
                Err(_) => "NULL".to_string(),
            }
        }
    }
}


