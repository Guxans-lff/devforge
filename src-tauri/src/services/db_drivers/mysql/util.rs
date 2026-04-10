use sqlx::mysql::{MySqlRow};
use sqlx::{Row, Column, TypeInfo};
use rust_decimal::Decimal;
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
///
/// sqlx 的 `MySqlTypeInfo::name()` 可能返回带精度信息的类型名，
/// 如 `"DECIMAL(18,4)"`, `"TINYINT(1)"`, `"VARCHAR(255)"` 等。
/// 本函数先匹配带括号的特殊类型（如 TINYINT(1) → bool），
/// 再去除括号做通用匹配。
pub fn mysql_value_to_json(
    row: &MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    // 1. 先用原始 type_name 匹配需要括号信息的特殊类型
    if type_name == "BOOLEAN" || type_name == "TINYINT(1)" || type_name == "BOOL" {
        return row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null);
    }

    // 2. 规范化：去除括号内的精度信息，如 "DECIMAL(18,4)" → "DECIMAL"
    let normalized = match type_name.find('(') {
        Some(pos) => &type_name[..pos],
        None => type_name,
    };

    match normalized {
        // BIT 类型：先尝试 bool，再尝试 u64，最后 fallback 二进制
        "BIT" => row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .or_else(|| {
                row.try_get::<Option<u64>, _>(index)
                    .ok()
                    .flatten()
                    .map(|v| serde_json::Value::Number(v.into()))
            })
            .or_else(|| {
                row.try_get::<Option<Vec<u8>>, _>(index)
                    .ok()
                    .flatten()
                    .map(|bytes| {
                        if bytes.len() == 1 {
                            serde_json::Value::Bool(bytes[0] != 0)
                        } else {
                            serde_json::Value::Number(
                                bytes.iter().fold(0u64, |acc, &b| (acc << 8) | b as u64).into()
                            )
                        }
                    })
            })
            .unwrap_or(serde_json::Value::Null),

        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER"
        | "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" => row
            .try_get::<Option<i32>, _>(index)
            .or_else(|_| row.try_get::<Option<u32>, _>(index).map(|v| v.map(|n| n as i32)))
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "BIGINT" | "BIGINT UNSIGNED" | "INT UNSIGNED" | "INTEGER UNSIGNED" => row
            .try_get::<Option<i64>, _>(index)
            .or_else(|_| row.try_get::<Option<u64>, _>(index).map(|v| v.map(|n| n as i64)))
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "FLOAT" | "DOUBLE" => row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        // DECIMAL/NUMERIC：使用 rust_decimal::Decimal 精确解码
        "DECIMAL" | "NUMERIC" | "NEWDECIMAL" => {
            // 尝试1：rust_decimal::Decimal（精确解码）
            if let Ok(Some(d)) = row.try_get::<Option<Decimal>, _>(index) {
                let s = d.to_string();
                return s.parse::<f64>()
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(serde_json::Value::Number)
                    .unwrap_or_else(|| serde_json::Value::String(s));
            }
            // 尝试2：f64
            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(index) {
                if let Some(n) = serde_json::Number::from_f64(v) {
                    return serde_json::Value::Number(n);
                }
            }
            // NULL 或解码失败
            serde_json::Value::Null
        }

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

        "YEAR" => row
            .try_get::<Option<i32>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .or_else(|| {
                row.try_get::<Option<String>, _>(index)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::String)
            })
            .unwrap_or(serde_json::Value::Null),

        // JSON 类型：直接读取为 serde_json::Value
        "JSON" => row
            .try_get::<Option<serde_json::Value>, _>(index)
            .ok()
            .flatten()
            .unwrap_or(serde_json::Value::Null),

        // 兜底：未知类型 — 优先字符串/二进制，不猜测数字
        _ => {
            // 尝试字符串
            if let Ok(Some(s)) = row.try_get::<Option<String>, _>(index) {
                return serde_json::Value::String(s);
            }
            // 尝试二进制
            if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(index) {
                return serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned());
            }
            serde_json::Value::Null
        }
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
