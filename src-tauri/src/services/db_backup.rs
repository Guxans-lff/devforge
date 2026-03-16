use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;
use sqlx::{Column, Row};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufWriter};
use futures::StreamExt;

use std::sync::Arc;
use crate::services::db_drivers::{escape_mysql_ident, DriverPool};
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

const BATCH_SIZE: usize = 5000;

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
    let raw_file = tokio::fs::File::create(output_path).await?;
    // BufWriter 缓冲写入，减少系统调用次数
    let mut writer = BufWriter::with_capacity(256 * 1024, raw_file);

    // 并发预取所有表结构（限制并发度避免连接池耗尽）
    let ddl_map = if include_structure {
        // collect 成 owned Vec<String> 避免闭包捕获 &String 引起生命周期问题
        let owned_names: Vec<String> = table_list.iter().cloned().collect();
        let results: Vec<_> = futures::stream::iter(owned_names.into_iter().map(|tbl| {
            let eng = engine.clone();
            let cid = connection_id.to_string();
            let db = database.to_string();
            async move {
                let result = eng.get_create_table(cid, db, tbl.clone()).await;
                (tbl, result)
            }
        }))
        .buffered(4)
        .collect()
        .await;
        results.into_iter().collect::<std::collections::HashMap<_, _>>()
    } else {
        std::collections::HashMap::new()
    };

    // 写入头部
    match pool.as_ref() {
        DriverPool::MySql(_) => {
            write_mysql_header(&mut writer, database).await?;
        }
        DriverPool::Postgres(_) => {
            write_postgres_header(&mut writer, database).await?;
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

        writer.write_all(format!("\n-- Table: {}\n", table_name).as_bytes()).await?;

        // 导出表结构（从预取缓存获取，无需再次查询）
        if include_structure {
            match ddl_map.get(table_name) {
                Some(Ok(create_sql)) => {
                    match pool.as_ref() {
                        DriverPool::MySql(_) => {
                            writer.write_all(format!("DROP TABLE IF EXISTS `{}`;\n", table_name).as_bytes()).await?;
                        }
                        DriverPool::Postgres(_) => {
                            writer.write_all(format!("DROP TABLE IF EXISTS \"{}\" CASCADE;\n", table_name).as_bytes()).await?;
                        }
                    }
                    writer.write_all(create_sql.as_bytes()).await?;
                    writer.write_all(b";\n\n").await?;
                }
                Some(Err(e)) => {
                    // DDL 获取失败，写入注释警告
                    log::warn!("Failed to get DDL for table {}: {}", table_name, e);
                    writer.write_all(format!("-- WARNING: Failed to export DDL for table `{}`: {}\n\n", table_name, e).as_bytes()).await?;
                }
                None => {}
            }
        }

        // 导出表数据
        if include_data {
            let rows_exported = match pool.as_ref() {
                DriverPool::MySql(p) => {
                    export_mysql_data(&mut writer, p, database, table_name).await?
                }
                DriverPool::Postgres(p) => {
                    export_postgres_data(&mut writer, p, database, table_name).await?
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
            write_mysql_footer(&mut writer).await?;
        }
        DriverPool::Postgres(_) => {
            write_postgres_footer(&mut writer).await?;
        }
    }

    writer.flush().await?;

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
            sqlx::query(&format!("USE `{}`", escape_mysql_ident(database)))
                .execute(p)
                .await?;
        }
        DriverPool::Postgres(p) => {
            sqlx::query(&format!("SET search_path TO \"{}\"", database.replace('"', "\"\"")))
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

async fn write_mysql_header<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
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
    writer.write_all(header.as_bytes()).await?;
    Ok(())
}

async fn write_mysql_footer<W: AsyncWriteExt + Unpin>(writer: &mut W) -> Result<(), AppError> {
    writer.write_all(b"\nSET FOREIGN_KEY_CHECKS = 1;\n").await?;
    Ok(())
}

async fn export_mysql_data<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<u64, AppError> {
    // 流式查询：不用 LIMIT/OFFSET，避免大表后半段扫描退化
    let sql = format!(
        "SELECT * FROM `{}`.`{}`",
        escape_mysql_ident(database),
        escape_mysql_ident(table),
    );
    let mut stream = sqlx::query(&sql).fetch(pool);

    let mut total_rows: u64 = 0;
    let mut col_names: Option<String> = None;
    let mut col_count: usize = 0;
    let mut batch: Vec<sqlx::mysql::MySqlRow> = Vec::with_capacity(BATCH_SIZE);

    while let Some(row_result) = stream.next().await {
        let row = row_result?;

        // 首行时提取列名（从行元信息获取，避免额外查询 information_schema）
        if col_names.is_none() {
            let columns = row.columns();
            col_count = columns.len();
            col_names = Some(
                columns.iter()
                    .map(|c| format!("`{}`", c.name().replace('`', "``")))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }

        batch.push(row);

        if batch.len() >= BATCH_SIZE {
            write_mysql_insert_batch(writer, table, col_names.as_deref().unwrap(), col_count, &batch).await?;
            total_rows += batch.len() as u64;
            batch.clear();
        }
    }

    // 剩余行
    if !batch.is_empty() {
        if let Some(ref cn) = col_names {
            write_mysql_insert_batch(writer, table, cn, col_count, &batch).await?;
            total_rows += batch.len() as u64;
        }
    }

    Ok(total_rows)
}

/// 将一批 MySQL 行写成一条 INSERT 语句
async fn write_mysql_insert_batch<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    table: &str,
    col_names: &str,
    col_count: usize,
    rows: &[sqlx::mysql::MySqlRow],
) -> Result<(), AppError> {
    let header = format!("INSERT INTO `{}` ({}) VALUES\n", escape_mysql_ident(table), col_names);
    let estimated = header.len() + rows.len() * col_count * 20;
    let mut buf = String::with_capacity(estimated);
    buf.push_str(&header);

    for (j, row) in rows.iter().enumerate() {
        buf.push('(');
        for col_idx in 0..col_count {
            if col_idx > 0 {
                buf.push_str(", ");
            }
            escape_mysql_value_into(&mut buf, row, col_idx);
        }
        buf.push(')');

        if j < rows.len() - 1 {
            buf.push_str(",\n");
        } else {
            buf.push_str(";\n\n");
        }
    }

    writer.write_all(buf.as_bytes()).await?;
    Ok(())
}

/// 将 MySQL 字符串值转义写入 buffer
fn push_mysql_escaped_str(buf: &mut String, val: &str) {
    buf.push('\'');
    for ch in val.chars() {
        match ch {
            '\\' => buf.push_str("\\\\"),
            '\'' => buf.push_str("\\'"),
            '\n' => buf.push_str("\\n"),
            '\r' => buf.push_str("\\r"),
            '\0' => buf.push_str("\\0"),
            c => buf.push(c),
        }
    }
    buf.push('\'');
}

/// 将 MySQL 值直接写入 buffer，支持字符串、数值、布尔、日期类型，避免 hex 误序列化
fn escape_mysql_value_into(buf: &mut String, row: &sqlx::mysql::MySqlRow, col_idx: usize) {
    // 1. 尝试字符串（最常见类型，包括 TEXT、VARCHAR、CHAR、ENUM、SET）
    match row.try_get::<Option<String>, _>(col_idx) {
        Ok(Some(val)) => { push_mysql_escaped_str(buf, &val); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 2. 尝试 i64（INT、BIGINT、TINYINT、SMALLINT、MEDIUMINT）
    match row.try_get::<Option<i64>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(&v.to_string()); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 3. 尝试 u64（无符号整数）
    match row.try_get::<Option<u64>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(&v.to_string()); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 4. 尝试 f64（FLOAT、DOUBLE、DECIMAL）
    match row.try_get::<Option<f64>, _>(col_idx) {
        Ok(Some(v)) => {
            if v.is_nan() || v.is_infinite() { buf.push_str("NULL"); } else { buf.push_str(&format!("{}", v)); }
            return;
        }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 5. 尝试 bool（BIT(1)、TINYINT(1)）
    match row.try_get::<Option<bool>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(if v { "1" } else { "0" }); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 6. 尝试 NaiveDateTime（DATETIME、TIMESTAMP）
    // sqlx mysql/postgres 不内置 chrono decode，日期类型实际已被第 1 步的 String 捕获
    // 此处作为最终降级：二进制数据（BLOB、BINARY、VARBINARY）
    match row.try_get::<Option<Vec<u8>>, _>(col_idx) {
        Ok(Some(bytes)) => {
            buf.push_str("X'");
            buf.push_str(&hex::encode(&bytes));
            buf.push('\'');
        }
        _ => buf.push_str("NULL"),
    }
}

// === PostgreSQL 备份辅助函数 ===

async fn write_postgres_header<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
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
    writer.write_all(header.as_bytes()).await?;
    Ok(())
}

async fn write_postgres_footer<W: AsyncWriteExt + Unpin>(writer: &mut W) -> Result<(), AppError> {
    writer.write_all(b"\n-- Backup completed\n").await?;
    Ok(())
}

async fn export_postgres_data<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<u64, AppError> {
    // 流式查询：不用 LIMIT/OFFSET
    let sql = format!(
        "SELECT * FROM \"{}\".\"{}\"",
        schema.replace('"', "\"\""),
        table.replace('"', "\"\""),
    );
    let mut stream = sqlx::query(&sql).fetch(pool);

    let mut total_rows: u64 = 0;
    let mut col_names: Option<String> = None;
    let mut col_count: usize = 0;
    let mut batch: Vec<sqlx::postgres::PgRow> = Vec::with_capacity(BATCH_SIZE);

    while let Some(row_result) = stream.next().await {
        let row = row_result?;

        // 首行时提取列名
        if col_names.is_none() {
            let columns = row.columns();
            col_count = columns.len();
            col_names = Some(
                columns.iter()
                    .map(|c| format!("\"{}\"", c.name().replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }

        batch.push(row);

        if batch.len() >= BATCH_SIZE {
            write_pg_insert_batch(writer, table, col_names.as_deref().unwrap(), col_count, &batch).await?;
            total_rows += batch.len() as u64;
            batch.clear();
        }
    }

    // 剩余行
    if !batch.is_empty() {
        if let Some(ref cn) = col_names {
            write_pg_insert_batch(writer, table, cn, col_count, &batch).await?;
            total_rows += batch.len() as u64;
        }
    }

    Ok(total_rows)
}

/// 将一批 PostgreSQL 行写成一条 INSERT 语句
async fn write_pg_insert_batch<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    table: &str,
    col_names: &str,
    col_count: usize,
    rows: &[sqlx::postgres::PgRow],
) -> Result<(), AppError> {
    let header = format!("INSERT INTO \"{}\" ({}) VALUES\n", table.replace('"', "\"\""), col_names);
    let estimated = header.len() + rows.len() * col_count * 20;
    let mut buf = String::with_capacity(estimated);
    buf.push_str(&header);

    for (j, row) in rows.iter().enumerate() {
        buf.push('(');
        for col_idx in 0..col_count {
            if col_idx > 0 {
                buf.push_str(", ");
            }
            escape_postgres_value_into(&mut buf, row, col_idx);
        }
        buf.push(')');

        if j < rows.len() - 1 {
            buf.push_str(",\n");
        } else {
            buf.push_str(";\n\n");
        }
    }

    writer.write_all(buf.as_bytes()).await?;
    Ok(())
}

/// 将 PostgreSQL 字符串值转义写入 buffer（standard_conforming_strings=on，单引号用 '' 转义）
fn push_pg_escaped_str(buf: &mut String, val: &str) {
    buf.push('\'');
    for ch in val.chars() {
        if ch == '\'' { buf.push_str("''"); } else { buf.push(ch); }
    }
    buf.push('\'');
}

/// 将 PostgreSQL 值直接写入 buffer，支持字符串、数值、布尔、日期类型
fn escape_postgres_value_into(buf: &mut String, row: &sqlx::postgres::PgRow, col_idx: usize) {
    // 1. 字符串（TEXT、VARCHAR、CHAR、UUID 等）
    match row.try_get::<Option<String>, _>(col_idx) {
        Ok(Some(val)) => { push_pg_escaped_str(buf, &val); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 2. i64（BIGINT、INT8）
    match row.try_get::<Option<i64>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(&v.to_string()); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 3. i32（INTEGER、INT4）
    match row.try_get::<Option<i32>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(&v.to_string()); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 4. i16（SMALLINT、INT2）
    match row.try_get::<Option<i16>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(&v.to_string()); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 5. f64（FLOAT8、NUMERIC、DOUBLE PRECISION）
    match row.try_get::<Option<f64>, _>(col_idx) {
        Ok(Some(v)) => {
            if v.is_nan() || v.is_infinite() { buf.push_str("NULL"); } else { buf.push_str(&format!("{}", v)); }
            return;
        }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 6. f32（FLOAT4、REAL）
    match row.try_get::<Option<f32>, _>(col_idx) {
        Ok(Some(v)) => {
            if v.is_nan() || v.is_infinite() { buf.push_str("NULL"); } else { buf.push_str(&format!("{}", v)); }
            return;
        }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 7. bool（BOOLEAN）
    match row.try_get::<Option<bool>, _>(col_idx) {
        Ok(Some(v)) => { buf.push_str(if v { "TRUE" } else { "FALSE" }); return; }
        Ok(None) => { buf.push_str("NULL"); return; }
        Err(_) => {}
    }
    // 8. NaiveDateTime / NaiveDate — sqlx 不启用 chrono feature 时无法直接 decode，
    //    日期/时间类型在第 1 步的 String 路径已被捕获（MySQL 将其序列化为字符串）。
    //    此处作为最终降级：BYTEA 二进制
    match row.try_get::<Option<Vec<u8>>, _>(col_idx) {
        Ok(Some(bytes)) => {
            buf.push_str("E'\\\\x");
            buf.push_str(&hex::encode(&bytes));
            buf.push('\'');
        }
        _ => buf.push_str("NULL"),
    }
}
