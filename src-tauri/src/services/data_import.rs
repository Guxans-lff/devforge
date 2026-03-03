use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use tauri::{AppHandle, Emitter};

use crate::services::db_drivers::DriverPool;
use crate::utils::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfig {
    pub file_path: String,
    pub file_type: String,
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub column_mapping: Vec<ColumnMapping>,
    pub has_header: bool,
    pub delimiter: Option<String>,
    pub batch_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub source_column: String,
    pub target_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
    pub total_rows: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub imported_rows: usize,
    pub total_rows: usize,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub success: bool,
    pub imported_rows: usize,
    pub error: Option<String>,
}

const DEFAULT_BATCH_SIZE: usize = 100;
const PREVIEW_ROWS: usize = 10;

fn escape_sql_value(val: &str) -> Cow<'_, str> {
    if val.contains('\'') || val.contains('\\') {
        Cow::Owned(val.replace('\'', "''").replace('\\', "\\\\"))
    } else {
        Cow::Borrowed(val)
    }
}

pub fn preview_file(file_path: &str, file_type: &str) -> Result<ImportPreview, AppError> {
    match file_type {
        "csv" => preview_csv(file_path),
        "json" => preview_json(file_path),
        "sql" => preview_sql(file_path),
        _ => Err(AppError::Other(format!("Unsupported file type: {}", file_type))),
    }
}

fn preview_csv(file_path: &str) -> Result<ImportPreview, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(file_path)
        .map_err(|e| AppError::Other(format!("Failed to open CSV: {}", e)))?;

    let columns: Vec<String> = reader
        .headers()
        .map_err(|e| AppError::Other(format!("Failed to read CSV headers: {}", e)))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    let mut sample_rows = Vec::new();
    let mut total = 0usize;
    for result in reader.records() {
        let record = result.map_err(|e| AppError::Other(format!("CSV parse error: {}", e)))?;
        if sample_rows.len() < PREVIEW_ROWS {
            sample_rows.push(record.iter().map(|f| f.to_string()).collect());
        }
        total += 1;
    }

    Ok(ImportPreview { columns, sample_rows, total_rows: Some(total) })
}

fn preview_json(file_path: &str) -> Result<ImportPreview, AppError> {
    let content = std::fs::read_to_string(file_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&content)?;

    let arr = parsed
        .as_array()
        .ok_or_else(|| AppError::Other("JSON file must contain an array of objects".into()))?;

    let mut columns = Vec::new();
    if let Some(first) = arr.first().and_then(|v| v.as_object()) {
        columns = first.keys().cloned().collect();
    }

    let sample_rows: Vec<Vec<String>> = arr
        .iter()
        .take(PREVIEW_ROWS)
        .filter_map(|v| v.as_object())
        .map(|obj| {
            columns
                .iter()
                .map(|col| match obj.get(col) {
                    Some(serde_json::Value::String(s)) => s.clone(),
                    Some(serde_json::Value::Null) | None => String::new(),
                    Some(other) => other.to_string(),
                })
                .collect()
        })
        .collect();

    let total_rows = Some(arr.len());
    Ok(ImportPreview { columns, sample_rows, total_rows })
}

fn preview_sql(file_path: &str) -> Result<ImportPreview, AppError> {
    let content = std::fs::read_to_string(file_path)?;
    let statements: Vec<&str> = content
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let sample_rows: Vec<Vec<String>> = statements
        .iter()
        .take(PREVIEW_ROWS)
        .map(|s| {
            let preview = if s.len() > 120 {
                format!("{}...", &s[..120])
            } else {
                s.to_string()
            };
            vec![preview]
        })
        .collect();

    Ok(ImportPreview {
        columns: vec!["SQL Statement".to_string()],
        sample_rows,
        total_rows: Some(statements.len()),
    })
}

fn emit_progress(app_handle: &AppHandle, progress: &ImportProgress) {
    let _ = app_handle.emit("import://progress", progress);
}

fn quote_identifier(name: &str, is_postgres: bool) -> String {
    if is_postgres {
        // PostgreSQL: 双引号包裹，内部双引号双写转义
        format!("\"{}\"", name.replace('"', "\"\""))
    } else {
        // MySQL: 反引号包裹，内部反引号双写转义
        format!("`{}`", name.replace('`', "``"))
    }
}

fn build_insert_sql(
    database: &str,
    table: &str,
    target_columns: &[String],
    batch: &[Vec<String>],
    is_postgres: bool,
) -> String {
    let cols = target_columns
        .iter()
        .map(|c| quote_identifier(c, is_postgres))
        .collect::<Vec<_>>()
        .join(", ");

    let rows: Vec<String> = batch
        .iter()
        .map(|row| {
            let vals: Vec<String> = row
                .iter()
                .map(|v| format!("'{}'", escape_sql_value(v)))
                .collect();
            format!("({})", vals.join(", "))
        })
        .collect();

    let db_quoted = quote_identifier(database, is_postgres);
    let tbl_quoted = quote_identifier(table, is_postgres);

    format!(
        "INSERT INTO {}.{} ({}) VALUES {}",
        db_quoted,
        tbl_quoted,
        cols,
        rows.join(", ")
    )
}

pub async fn import_csv(
    config: &ImportConfig,
    pool: &DriverPool,
    app_handle: &AppHandle,
) -> Result<ImportResult, AppError> {
    let is_postgres = matches!(pool, DriverPool::Postgres(_));
    let batch_size = config.batch_size.unwrap_or(DEFAULT_BATCH_SIZE);
    let delimiter = config
        .delimiter
        .as_deref()
        .and_then(|d| d.as_bytes().first().copied())
        .unwrap_or(b',');

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(config.has_header)
        .delimiter(delimiter)
        .from_path(&config.file_path)
        .map_err(|e| AppError::Other(format!("Failed to open CSV: {}", e)))?;

    // Build source->target index mapping from headers
    let headers: Vec<String> = if config.has_header {
        reader
            .headers()
            .map_err(|e| AppError::Other(format!("CSV header error: {}", e)))?
            .iter()
            .map(|h| h.to_string())
            .collect()
    } else {
        // Use 0-based column indices as names
        (0..config.column_mapping.len())
            .map(|i| i.to_string())
            .collect()
    };

    let target_columns: Vec<String> = config.column_mapping.iter().map(|m| m.target_column.clone()).collect();
    let source_indices: Vec<Option<usize>> = config
        .column_mapping
        .iter()
        .map(|m| headers.iter().position(|h| h == &m.source_column))
        .collect();

    // Count total rows for progress (re-read is cheap for CSV)
    let total_rows = {
        let mut counter = csv::ReaderBuilder::new()
            .has_headers(config.has_header)
            .delimiter(delimiter)
            .from_path(&config.file_path)
            .map_err(|e| AppError::Other(format!("CSV count error: {}", e)))?;
        counter.records().count()
    };

    let mut imported_rows = 0usize;
    let mut batch: Vec<Vec<String>> = Vec::with_capacity(batch_size);

    for result in reader.records() {
        let record = result.map_err(|e| AppError::Other(format!("CSV parse error: {}", e)))?;
        let row: Vec<String> = source_indices
            .iter()
            .map(|idx| {
                idx.and_then(|i| record.get(i))
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        batch.push(row);

        if batch.len() >= batch_size {
            let sql = build_insert_sql(&config.database, &config.table, &target_columns, &batch, is_postgres);
            execute_sql_on_pool(pool, &sql).await?;
            imported_rows += batch.len();
            batch.clear();
            emit_progress(app_handle, &ImportProgress {
                imported_rows,
                total_rows,
                status: "importing".into(),
                error: None,
            });
        }
    }

    // Flush remaining rows
    if !batch.is_empty() {
        let sql = build_insert_sql(&config.database, &config.table, &target_columns, &batch, is_postgres);
        execute_sql_on_pool(pool, &sql).await?;
        imported_rows += batch.len();
    }

    emit_progress(app_handle, &ImportProgress {
        imported_rows,
        total_rows,
        status: "completed".into(),
        error: None,
    });

    Ok(ImportResult { success: true, imported_rows, error: None })
}

pub async fn import_json(
    config: &ImportConfig,
    pool: &DriverPool,
    app_handle: &AppHandle,
) -> Result<ImportResult, AppError> {
    let is_postgres = matches!(pool, DriverPool::Postgres(_));
    let batch_size = config.batch_size.unwrap_or(DEFAULT_BATCH_SIZE);
    let content = tokio::fs::read_to_string(&config.file_path).await?;
    let parsed: serde_json::Value = serde_json::from_str(&content)?;

    let arr = parsed
        .as_array()
        .ok_or_else(|| AppError::Other("JSON file must contain an array of objects".into()))?;

    let target_columns: Vec<String> = config.column_mapping.iter().map(|m| m.target_column.clone()).collect();
    let source_keys: Vec<String> = config.column_mapping.iter().map(|m| m.source_column.clone()).collect();
    let total_rows = arr.len();
    let mut imported_rows = 0usize;
    let mut batch: Vec<Vec<String>> = Vec::with_capacity(batch_size);

    for item in arr {
        let obj = item.as_object();
        let row: Vec<String> = source_keys
            .iter()
            .map(|key| {
                obj.and_then(|o| o.get(key))
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Null => String::new(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default()
            })
            .collect();
        batch.push(row);

        if batch.len() >= batch_size {
            let sql = build_insert_sql(&config.database, &config.table, &target_columns, &batch, is_postgres);
            execute_sql_on_pool(pool, &sql).await?;
            imported_rows += batch.len();
            batch.clear();
            emit_progress(app_handle, &ImportProgress {
                imported_rows,
                total_rows,
                status: "importing".into(),
                error: None,
            });
        }
    }

    if !batch.is_empty() {
        let sql = build_insert_sql(&config.database, &config.table, &target_columns, &batch, is_postgres);
        execute_sql_on_pool(pool, &sql).await?;
        imported_rows += batch.len();
    }

    emit_progress(app_handle, &ImportProgress {
        imported_rows,
        total_rows,
        status: "completed".into(),
        error: None,
    });

    Ok(ImportResult { success: true, imported_rows, error: None })
}

pub async fn import_sql(
    config: &ImportConfig,
    pool: &DriverPool,
    app_handle: &AppHandle,
) -> Result<ImportResult, AppError> {
    let content = tokio::fs::read_to_string(&config.file_path).await?;
    let statements: Vec<&str> = content
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let total_rows = statements.len();
    let mut imported_rows = 0usize;
    let mut last_error: Option<String> = None;

    for stmt in &statements {
        match execute_sql_on_pool(pool, stmt).await {
            Ok(_) => {
                imported_rows += 1;
            }
            Err(e) => {
                last_error = Some(format!("Statement {}: {}", imported_rows + 1, e));
                imported_rows += 1;
            }
        }
        emit_progress(app_handle, &ImportProgress {
            imported_rows,
            total_rows,
            status: "importing".into(),
            error: last_error.clone(),
        });
    }

    let success = last_error.is_none();
    emit_progress(app_handle, &ImportProgress {
        imported_rows,
        total_rows,
        status: if success { "completed" } else { "failed" }.into(),
        error: last_error.clone(),
    });

    Ok(ImportResult { success, imported_rows, error: last_error })
}

async fn execute_sql_on_pool(pool: &DriverPool, sql: &str) -> Result<(), AppError> {
    match pool {
        DriverPool::MySql(p) => {
            sqlx::query(sql)
                .execute(p)
                .await
                .map_err(|e| AppError::Other(format!("MySQL execute error: {}", e)))?;
        }
        DriverPool::Postgres(p) => {
            sqlx::query(sql)
                .execute(p)
                .await
                .map_err(|e| AppError::Other(format!("PostgreSQL execute error: {}", e)))?;
        }
    }
    Ok(())
}
