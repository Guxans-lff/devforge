use sqlx::mysql::{MySqlRow};
use sqlx::{Row, Column, TypeInfo};
use crate::models::query::{ColumnDef};

/// MySQL 结果转 JSON 的块大小
pub const STREAM_CHUNK_SIZE: usize = 100;

/// 安全地从 MySQL 行中提取字符串（处理 MySQL 8.0 的 VARBINARY 陷阱）
pub fn get_string<'r, I>(row: &'r MySqlRow, col: I) -> String 
where I: sqlx::ColumnIndex<MySqlRow> + Copy
{
    row.try_get::<String, _>(col)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(col)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default()
}

/// 安全地从 MySQL 行中提取可选字符串
pub fn get_opt_string<'r, I>(row: &'r MySqlRow, col: I) -> Option<String> 
where I: sqlx::ColumnIndex<MySqlRow> + Copy
{
    row.try_get::<Option<String>, _>(col)
        .or_else(|_| {
            row.try_get::<Option<Vec<u8>>, _>(col)
                .map(|opt| opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
        })
        .unwrap_or(None)
}

/// 将 MySQL 行数据映射为 JSON 值
pub fn mysql_value_to_json(
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

        // 日期时间类型：先尝试原生类型，再 fallback 字符串/二进制
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<Option<chrono::NaiveDateTime>, _>(index)
            .ok()
            .flatten()
            .map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
            .or_else(|| {
                row.try_get::<Option<String>, _>(index)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::String)
            })
            .unwrap_or(serde_json::Value::Null),

        "DATE" => row
            .try_get::<Option<chrono::NaiveDate>, _>(index)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.format("%Y-%m-%d").to_string()))
            .or_else(|| {
                row.try_get::<Option<String>, _>(index)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::String)
            })
            .unwrap_or(serde_json::Value::Null),

        "TIME" => row
            .try_get::<Option<chrono::NaiveTime>, _>(index)
            .ok()
            .flatten()
            .map(|t| serde_json::Value::String(t.format("%H:%M:%S").to_string()))
            .or_else(|| {
                row.try_get::<Option<String>, _>(index)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::String)
            })
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

/// 通用：将 sqlx Row 集合转换为 QueryResult 内部的行数据
pub fn map_rows_to_json(rows: &[MySqlRow]) -> Vec<Vec<serde_json::Value>> {
    rows.iter()
        .map(|row| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| mysql_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect()
}

/// 通用：提取列定义
pub fn extract_column_defs(row: &MySqlRow) -> Vec<ColumnDef> {
    row.columns()
        .iter()
        .map(|col| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect()
}
