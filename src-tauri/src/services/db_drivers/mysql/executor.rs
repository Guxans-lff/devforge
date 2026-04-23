use std::sync::Arc;
use std::time::Instant;

use sqlx::mysql::MySqlRow;
use sqlx::pool::PoolConnection;
use sqlx::{Column, Executor, MySqlPool, Row, TypeInfo};

use crate::models::query::{ColumnDef, QueryChunk, QueryResult};
use crate::utils::error::AppError;

use super::util::*;

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
        let columns = match pool.describe(sql).await {
            Ok(desc) => desc
                .columns()
                .iter()
                .map(|col| ColumnDef {
                    name: col.name().to_string(),
                    data_type: col.type_info().name().to_string(),
                    nullable: true,
                })
                .collect(),
            Err(_) => vec![],
        };
        return Ok(QueryResult::empty(columns, elapsed));
    }

    Ok(QueryResult {
        columns: extract_column_defs(&rows[0]),
        rows: map_rows_to_json(&rows),
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

pub async fn execute_select_stream_on_conn(
    conn_mutex: Arc<tokio::sync::Mutex<PoolConnection<sqlx::MySql>>>,
    sql: String,
    start: Instant,
    on_chunk: Arc<dyn Fn(QueryChunk) -> Result<(), String> + Send + Sync + 'static>,
) -> Result<(), AppError> {
    let mut conn = conn_mutex.lock().await;
    let mut stream = sqlx::query(&sql).fetch(&mut **conn as &mut sqlx::MySqlConnection);
    process_stream(&mut stream, None, start, move |c| on_chunk(c)).await
}

pub async fn execute_select_on_conn(
    conn_mutex: Arc<tokio::sync::Mutex<PoolConnection<sqlx::MySql>>>,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    tokio::spawn(async move {
        let mut conn = conn_mutex.lock().await;
        let rows: Vec<MySqlRow> = sqlx::query(&sql)
            .fetch_all(&mut **conn)
            .await
            .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?;

        let elapsed = start.elapsed().as_millis() as u64;
        if rows.is_empty() {
            return Ok(QueryResult::empty(vec![], elapsed));
        }

        Ok(QueryResult {
            columns: extract_column_defs(&rows[0]),
            rows: map_rows_to_json(&rows),
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: None,
            truncated: false,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("Spawn error: {}", e)))?
}

pub async fn execute_non_select_on_conn(
    conn_mutex: Arc<tokio::sync::Mutex<PoolConnection<sqlx::MySql>>>,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    tokio::spawn(async move {
        let mut conn = conn_mutex.lock().await;
        use sqlx::Executor as _;

        let raw = sqlx::raw_sql(sql.as_str());
        let result = (&mut **conn)
            .execute(raw)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?;

        Ok::<QueryResult, AppError>(QueryResult::affected(
            result.rows_affected(),
            start.elapsed().as_millis() as u64,
        ))
    })
    .await
    .map_err(|e| AppError::Other(format!("Spawn error: {}", e)))?
}

async fn process_stream<S>(
    stream: &mut S,
    initial_col_defs: Option<Vec<ColumnDef>>,
    start: Instant,
    on_chunk: impl Fn(QueryChunk) -> Result<(), String>,
) -> Result<(), AppError>
where
    S: futures::Stream<Item = Result<MySqlRow, sqlx::Error>> + Unpin,
{
    use futures::StreamExt;

    let mut columns_sent = false;
    let mut chunk_index: u32 = 0;
    let mut buffer: Vec<Vec<serde_json::Value>> = Vec::with_capacity(STREAM_CHUNK_SIZE);
    let mut col_defs = initial_col_defs.unwrap_or_default();

    while let Some(row_result) = stream.next().await {
        match row_result {
            Ok(row) => {
                if !columns_sent && col_defs.is_empty() {
                    col_defs = extract_column_defs(&row);
                }

                buffer.push(
                    row.columns()
                        .iter()
                        .enumerate()
                        .map(|(i, col)| mysql_value_to_json(&row, i, col.type_info().name()))
                        .collect(),
                );

                if buffer.len() >= STREAM_CHUNK_SIZE {
                    let chunk = QueryChunk {
                        chunk_index,
                        columns: if !columns_sent {
                            std::mem::take(&mut col_defs)
                        } else {
                            vec![]
                        },
                        rows: std::mem::take(&mut buffer),
                        is_last: false,
                        total_time_ms: None,
                        error: None,
                    };
                    columns_sent = true;
                    on_chunk(chunk)
                        .map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;
                    chunk_index += 1;
                    buffer = Vec::with_capacity(STREAM_CHUNK_SIZE);
                }
            }
            Err(e) => {
                let chunk = QueryChunk::error(
                    chunk_index,
                    start.elapsed().as_millis() as u64,
                    format!("Query stream error: {}", e),
                );
                let _ = on_chunk(chunk);
                return Err(AppError::Other(format!("Query stream error: {}", e)));
            }
        }
    }

    let final_chunk = QueryChunk {
        chunk_index,
        columns: if !columns_sent { col_defs } else { vec![] },
        rows: buffer,
        is_last: true,
        total_time_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    };
    on_chunk(final_chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;

    Ok(())
}
