use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use std::sync::Arc;
use crate::models::query::ColumnInfo;
use crate::services::db_engine::DbEngine;
use crate::utils::error::AppError;

/// 列级别的修改详情
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnModification {
    pub column_name: String,
    pub source: ColumnInfo,
    pub target: ColumnInfo,
    pub changes: Vec<String>,
}

/// 单表的差异
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDiff {
    pub table_name: String,
    pub columns_added: Vec<ColumnInfo>,
    pub columns_removed: Vec<ColumnInfo>,
    pub columns_modified: Vec<ColumnModification>,
}

/// 完整的 Schema 差异结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiff {
    pub tables_only_in_source: Vec<String>,
    pub tables_only_in_target: Vec<String>,
    pub table_diffs: Vec<TableDiff>,
}

/// 对比两个数据库的 schema
///
/// 性能策略：使用 get_all_columns 一次性获取整个数据库的所有列信息，
/// 源和目标各一次 SQL 查询（总共 4 次：2 次 get_tables + 2 次 get_all_columns），
/// 而非逐表查询（N 次往返）。
pub async fn compare_schemas(
    engine: Arc<DbEngine>,
    source_connection_id: &str,
    source_database: &str,
    target_connection_id: &str,
    target_database: &str,
) -> Result<SchemaDiff, AppError> {
    // 并发获取：源表列表 + 目标表列表 + 源所有列 + 目标所有列（4 个请求并发）
    let (source_tables, target_tables, source_all_cols, target_all_cols) = tokio::join!(
        engine.clone().get_tables(source_connection_id.to_string(), source_database.to_string()),
        engine.clone().get_tables(target_connection_id.to_string(), target_database.to_string()),
        engine.clone().get_all_columns(source_connection_id.to_string(), source_database.to_string()),
        engine.clone().get_all_columns(target_connection_id.to_string(), target_database.to_string())
    );

    let source_tables = source_tables?;
    let target_tables = target_tables?;
    let source_all_cols = source_all_cols?;
    let target_all_cols = target_all_cols?;

    // 构建表名集合
    let source_names: HashMap<String, ()> = source_tables
        .iter()
        .filter(|t| t.table_type == "BASE TABLE")
        .map(|t| (t.name.clone(), ()))
        .collect();

    let target_names: HashMap<String, ()> = target_tables
        .iter()
        .filter(|t| t.table_type == "BASE TABLE")
        .map(|t| (t.name.clone(), ()))
        .collect();

    // 仅在源端存在的表
    let tables_only_in_source: Vec<String> = source_names
        .keys()
        .filter(|name| !target_names.contains_key(*name))
        .cloned()
        .collect();

    // 仅在目标端存在的表
    let tables_only_in_target: Vec<String> = target_names
        .keys()
        .filter(|name| !source_names.contains_key(*name))
        .cloned()
        .collect();

    // 两边都存在的表 — 直接从内存中的 HashMap 对比列差异（零网络开销）
    let empty_cols = Vec::new();
    let mut table_diffs = Vec::new();

    for table_name in source_names.keys() {
        if !target_names.contains_key(table_name) {
            continue; // 仅源端有，已记录
        }

        let source_cols = source_all_cols.get(table_name).unwrap_or(&empty_cols);
        let target_cols = target_all_cols.get(table_name).unwrap_or(&empty_cols);

        let diff = compare_table_columns(table_name, source_cols, target_cols);
        if !diff.columns_added.is_empty()
            || !diff.columns_removed.is_empty()
            || !diff.columns_modified.is_empty()
        {
            table_diffs.push(diff);
        }
    }

    // 排序，使输出稳定
    let mut tables_only_in_source = tables_only_in_source;
    tables_only_in_source.sort();
    let mut tables_only_in_target = tables_only_in_target;
    tables_only_in_target.sort();
    table_diffs.sort_by(|a, b| a.table_name.cmp(&b.table_name));

    Ok(SchemaDiff {
        tables_only_in_source,
        tables_only_in_target,
        table_diffs,
    })
}

/// 对比两个表的列定义差异
fn compare_table_columns(
    table_name: &str,
    source_cols: &[ColumnInfo],
    target_cols: &[ColumnInfo],
) -> TableDiff {
    let source_map: HashMap<&str, &ColumnInfo> = source_cols
        .iter()
        .map(|c| (c.name.as_str(), c))
        .collect();

    let target_map: HashMap<&str, &ColumnInfo> = target_cols
        .iter()
        .map(|c| (c.name.as_str(), c))
        .collect();

    // 仅在源端（需要在目标端添加）
    let columns_added: Vec<ColumnInfo> = source_cols
        .iter()
        .filter(|c| !target_map.contains_key(c.name.as_str()))
        .cloned()
        .collect();

    // 仅在目标端（源端没有，目标端多余）
    let columns_removed: Vec<ColumnInfo> = target_cols
        .iter()
        .filter(|c| !source_map.contains_key(c.name.as_str()))
        .cloned()
        .collect();

    // 两边都有但定义不同
    let mut columns_modified = Vec::new();
    for source_col in source_cols {
        if let Some(target_col) = target_map.get(source_col.name.as_str()) {
            let changes = diff_column(source_col, target_col);
            if !changes.is_empty() {
                columns_modified.push(ColumnModification {
                    column_name: source_col.name.clone(),
                    source: source_col.clone(),
                    target: (*target_col).clone(),
                    changes,
                });
            }
        }
    }

    TableDiff {
        table_name: table_name.to_string(),
        columns_added,
        columns_removed,
        columns_modified,
    }
}

/// 对比单列的差异
/// 注释格式："目标端当前值 → 源端目标值"，表示迁移方向
fn diff_column(source: &ColumnInfo, target: &ColumnInfo) -> Vec<String> {
    let mut changes = Vec::new();

    // 类型比较（忽略大小写）
    if source.data_type.to_lowercase() != target.data_type.to_lowercase() {
        changes.push(format!(
            "类型: {} → {}",
            target.data_type, source.data_type
        ));
    }

    if source.nullable != target.nullable {
        let s = if source.nullable { "YES" } else { "NO" };
        let t = if target.nullable { "YES" } else { "NO" };
        changes.push(format!("可空: {} → {}", t, s));
    }

    if source.default_value != target.default_value {
        let s = source.default_value.as_deref().unwrap_or("NULL");
        let t = target.default_value.as_deref().unwrap_or("NULL");
        changes.push(format!("默认值: {} → {}", t, s));
    }

    if source.is_primary_key != target.is_primary_key {
        let s = if source.is_primary_key { "是" } else { "否" };
        let t = if target.is_primary_key { "是" } else { "否" };
        changes.push(format!("主键: {} → {}", t, s));
    }

    if source.comment != target.comment {
        let s = source.comment.as_deref().unwrap_or("");
        let t = target.comment.as_deref().unwrap_or("");
        if s != t {
            changes.push(format!("注释: '{}' → '{}'", t, s));
        }
    }

    changes
}

/// 根据差异生成迁移 SQL（将目标同步到源的结构）
pub async fn generate_migration_sql(
    engine: Arc<DbEngine>,
    diff: &SchemaDiff,
    driver: &str,
    source_connection_id: &str,
    source_database: &str,
    target_database: &str,
) -> Result<String, AppError> {
    let mut statements = Vec::new();
    let q = if driver == "postgresql" { '"' } else { '`' };

    // 1. 仅在源端的表 — 从源端获取建表语句
    for table in &diff.tables_only_in_source {
        match engine
            .clone()
            .get_create_table(source_connection_id.to_string(), source_database.to_string(), table.to_string())
            .await
        {
            Ok(create_sql) if !create_sql.trim().is_empty() => {
                statements.push(format!("-- 表 {q}{}{q} 仅在源端存在，以下为建表语句", table));
                statements.push(format!("{};", create_sql.trim_end_matches(';')));
            }
            Ok(_) => {
                // 建表语句为空，回退到手动拼接 CREATE TABLE
                statements.push(format!(
                    "-- 表 {q}{}{q} 仅在源端存在，无法获取建表语句，请手动创建",
                    table
                ));
            }
            Err(e) => {
                statements.push(format!(
                    "-- 表 {q}{}{q} 仅在源端存在，获取建表语句失败: {}",
                    table, e
                ));
            }
        }
    }

    // 2. 仅在目标端的表 — 删除
    for table in &diff.tables_only_in_target {
        statements.push(format!(
            "-- 表 {q}{}{q} 仅在目标端存在，需删除",
            table
        ));
        statements.push(format!(
            "DROP TABLE IF EXISTS {q}{}{q}.{q}{}{q};",
            target_database, table
        ));
    }

    // 3. 列差异
    for table_diff in &diff.table_diffs {
        let tbl = &table_diff.table_name;

        // 需要新增的列
        for col in &table_diff.columns_added {
            let mut col_def = format!(
                "ALTER TABLE {q}{}{q}.{q}{}{q} ADD COLUMN {q}{}{q} {}",
                target_database, tbl, col.name, col.data_type
            );
            if !col.nullable {
                col_def.push_str(" NOT NULL");
            }
            if let Some(ref dv) = col.default_value {
                col_def.push_str(&format!(" DEFAULT {}", format_default_value(dv)));
            }
            if let Some(ref comment) = col.comment {
                if !comment.is_empty() {
                    if driver == "postgresql" {
                        col_def.push(';');
                        col_def.push_str(&format!(
                            "\nCOMMENT ON COLUMN {q}{}{q}.{q}{}{q}.{q}{}{q} IS '{}';",
                            target_database,
                            tbl,
                            col.name,
                            comment.replace('\'', "''")
                        ));
                    } else {
                        col_def.push_str(&format!(
                            " COMMENT '{}'",
                            comment.replace('\'', "\\'")
                        ));
                    }
                }
            }
            if !col_def.ends_with(';') {
                col_def.push(';');
            }
            statements.push(col_def);
        }

        // 需要移除的列
        for col in &table_diff.columns_removed {
            statements.push(format!(
                "ALTER TABLE {q}{}{q}.{q}{}{q} DROP COLUMN {q}{}{q};",
                target_database, tbl, col.name
            ));
        }

        // 需要修改的列
        for modification in &table_diff.columns_modified {
            let col = &modification.source;
            let changes_comment = modification.changes.join(", ");

            if driver == "postgresql" {
                // PostgreSQL 用 ALTER COLUMN
                for change in &modification.changes {
                    if change.starts_with("类型:") {
                        statements.push(format!(
                            "ALTER TABLE {q}{}{q}.{q}{}{q} ALTER COLUMN {q}{}{q} TYPE {};  -- {}",
                            target_database, tbl, col.name, col.data_type, changes_comment
                        ));
                    }
                    if change.starts_with("可空:") {
                        if col.nullable {
                            statements.push(format!(
                                "ALTER TABLE {q}{}{q}.{q}{}{q} ALTER COLUMN {q}{}{q} DROP NOT NULL;",
                                target_database, tbl, col.name
                            ));
                        } else {
                            statements.push(format!(
                                "ALTER TABLE {q}{}{q}.{q}{}{q} ALTER COLUMN {q}{}{q} SET NOT NULL;",
                                target_database, tbl, col.name
                            ));
                        }
                    }
                    if change.starts_with("默认值:") {
                        if let Some(ref dv) = col.default_value {
                            statements.push(format!(
                                "ALTER TABLE {q}{}{q}.{q}{}{q} ALTER COLUMN {q}{}{q} SET DEFAULT {};",
                                target_database, tbl, col.name, format_default_value(dv)
                            ));
                        } else {
                            statements.push(format!(
                                "ALTER TABLE {q}{}{q}.{q}{}{q} ALTER COLUMN {q}{}{q} DROP DEFAULT;",
                                target_database, tbl, col.name
                            ));
                        }
                    }
                }
            } else {
                // MySQL 用 MODIFY COLUMN
                let mut modify = format!(
                    "ALTER TABLE {q}{}{q}.{q}{}{q} MODIFY COLUMN {q}{}{q} {}",
                    target_database, tbl, col.name, col.data_type
                );
                if !col.nullable {
                    modify.push_str(" NOT NULL");
                }
                if let Some(ref dv) = col.default_value {
                    modify.push_str(&format!(" DEFAULT {}", format_default_value(dv)));
                }
                if let Some(ref comment) = col.comment {
                    if !comment.is_empty() {
                        modify.push_str(&format!(
                            " COMMENT '{}'",
                            comment.replace('\'', "\\'")
                        ));
                    }
                }
                modify.push_str(&format!(";  -- {}", changes_comment));
                statements.push(modify);
            }
        }
    }

    if statements.is_empty() {
        Ok("-- 两个数据库结构完全一致，无需迁移".to_string())
    } else {
        Ok(statements.join("\n\n"))
    }
}

/// 格式化 DEFAULT 值为合法 SQL 表达式
/// MySQL information_schema 返回的 COLUMN_DEFAULT 是原始字符串值（不带引号），
/// 需要根据内容判断是否需要加单引号：
/// - 数字（整数/小数/负数）→ 不加
/// - NULL → 不加
/// - 函数/表达式（CURRENT_TIMESTAMP、now()、uuid() 等）→ 不加
/// - 其他字符串 → 加单引号并转义内部单引号
fn format_default_value(dv: &str) -> String {
    let trimmed = dv.trim();

    // NULL
    if trimmed.eq_ignore_ascii_case("NULL") {
        return "NULL".to_string();
    }

    // 数字（含负数、小数）
    if trimmed.parse::<f64>().is_ok() {
        return trimmed.to_string();
    }

    // b'0' / b'1' 等 MySQL bit 字面量
    if trimmed.starts_with("b'") && trimmed.ends_with('\'') {
        return trimmed.to_string();
    }

    // 常见 MySQL/PG 函数和表达式（不加引号）
    let upper = trimmed.to_uppercase();
    let is_expression = upper.starts_with("CURRENT_TIMESTAMP")
        || upper.starts_with("NOW(")
        || upper.starts_with("UUID(")
        || upper.starts_with("LOCALTIME")
        || upper.starts_with("CURRENT_DATE")
        || upper.starts_with("CURRENT_USER")
        || upper.starts_with("NEXTVAL(")
        || upper.starts_with("GEN_RANDOM_")
        || upper == "TRUE"
        || upper == "FALSE"
        // MySQL on update CURRENT_TIMESTAMP
        || upper.contains("ON UPDATE");

    if is_expression {
        return trimmed.to_string();
    }

    // 已经被引号包裹的值（部分 PG driver 会这样返回）
    if (trimmed.starts_with('\'') && trimmed.ends_with('\''))
        || (trimmed.starts_with('"') && trimmed.ends_with('"'))
    {
        return trimmed.to_string();
    }

    // 其他情况视为字符串，加单引号
    format!("'{}'", trimmed.replace('\'', "''"))
}
