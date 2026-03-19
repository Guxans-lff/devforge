//! 索引分析引擎
//!
//! 提供 MySQL 索引深度分析能力：
//! - 冗余索引检测（索引前缀覆盖关系分析）
//! - 未使用索引检测（基于 performance_schema）
//! - 基于 EXPLAIN JSON 的索引建议

use std::collections::HashMap;
use std::sync::Arc;
use sqlx::{MySqlPool, Row};
use crate::models::query::{
    IndexAnalysisResult, RedundantIndex, UnusedIndex, IndexSuggestion,
};
use crate::services::db_drivers::DriverPool;
use crate::utils::error::AppError;
use super::DbEngine;

impl DbEngine {
    /// 对指定数据库执行全面的索引分析
    pub async fn analyze_indexes(
        self: Arc<Self>,
        connection_id: String,
        database: String,
    ) -> Result<IndexAnalysisResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("仅 MySQL 支持索引分析".into())),
        };

        let (redundant, unused) = tokio::join!(
            detect_redundant_indexes(mysql_pool, &database),
            detect_unused_indexes(mysql_pool, &database),
        );

        Ok(IndexAnalysisResult {
            redundant_indexes: redundant.unwrap_or_default(),
            unused_indexes: unused.unwrap_or_default(),
            suggestions: vec![], // EXPLAIN 建议在单独的 API 中按需触发
        })
    }

    /// 基于 EXPLAIN JSON 对单条 SQL 生成索引建议
    pub async fn suggest_indexes_for_query(
        self: Arc<Self>,
        connection_id: String,
        database: String,
        sql: String,
    ) -> Result<Vec<IndexSuggestion>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("仅 MySQL 支持索引建议".into())),
        };

        analyze_explain_for_suggestions(mysql_pool, &database, &sql).await
    }
}

/// 检测冗余索引：当一个索引是另一个索引的前缀时，前者是冗余的
async fn detect_redundant_indexes(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<RedundantIndex>, AppError> {
    // 查询数据库中所有索引及其列顺序
    let sql = r#"
        SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS idx_columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND INDEX_NAME != 'PRIMARY'
        GROUP BY TABLE_NAME, INDEX_NAME
        ORDER BY TABLE_NAME, INDEX_NAME
    "#;

    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询索引信息失败: {}", e)))?;

    // 按表分组
    let mut table_indexes: HashMap<String, Vec<(String, Vec<String>)>> = HashMap::new();
    for row in &rows {
        let table: String = row.try_get("TABLE_NAME").unwrap_or_default();
        let index: String = row.try_get("INDEX_NAME").unwrap_or_default();
        let cols_str: String = row.try_get("idx_columns").unwrap_or_default();
        let cols: Vec<String> = cols_str.split(',').map(|s| s.to_string()).collect();
        table_indexes.entry(table).or_default().push((index, cols));
    }

    let mut redundant = Vec::new();

    for (table, indexes) in &table_indexes {
        for (i, (name_a, cols_a)) in indexes.iter().enumerate() {
            for (j, (name_b, cols_b)) in indexes.iter().enumerate() {
                if i == j { continue; }
                // 如果 A 是 B 的前缀（B 更长或等长），且 A != B，则 A 是冗余的
                if cols_a.len() < cols_b.len() && cols_b.starts_with(cols_a.as_slice()) {
                    let esc_table = table.replace('`', "``");
                    let esc_idx = name_a.replace('`', "``");
                    redundant.push(RedundantIndex {
                        table_name: table.clone(),
                        index_name: name_a.clone(),
                        index_columns: cols_a.clone(),
                        covered_by: name_b.clone(),
                        covered_by_columns: cols_b.clone(),
                        drop_sql: format!("ALTER TABLE `{}` DROP INDEX `{}`;", esc_table, esc_idx),
                    });
                    break; // 一个索引只报告一次冗余
                }
            }
        }
    }

    Ok(redundant)
}

/// 检测未使用索引：通过 performance_schema 找出从未被读取过的索引
async fn detect_unused_indexes(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<UnusedIndex>, AppError> {
    // 先检查 performance_schema 是否可用
    let check = sqlx::query("SELECT @@performance_schema")
        .fetch_one(pool)
        .await;

    let ps_enabled: bool = match check {
        Ok(row) => row.try_get::<i32, _>(0).unwrap_or(0) == 1,
        Err(_) => false,
    };

    if !ps_enabled {
        log::info!("performance_schema 未启用，跳过未使用索引检测");
        return Ok(vec![]);
    }

    let sql = r#"
        SELECT
            s.TABLE_NAME,
            s.INDEX_NAME,
            GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX) AS idx_columns,
            COALESCE(t.STAT_VALUE * @@innodb_page_size, 0) AS size_bytes
        FROM information_schema.STATISTICS s
        LEFT JOIN mysql.innodb_index_stats t
            ON t.database_name = s.TABLE_SCHEMA
           AND t.table_name = s.TABLE_NAME
           AND t.index_name = s.INDEX_NAME
           AND t.stat_name = 'size'
        LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage w
            ON w.OBJECT_SCHEMA = s.TABLE_SCHEMA
           AND w.OBJECT_NAME = s.TABLE_NAME
           AND w.INDEX_NAME = s.INDEX_NAME
        WHERE s.TABLE_SCHEMA = ?
          AND s.INDEX_NAME != 'PRIMARY'
          AND (w.COUNT_READ = 0 OR w.COUNT_READ IS NULL)
        GROUP BY s.TABLE_NAME, s.INDEX_NAME, size_bytes
        ORDER BY size_bytes DESC
    "#;

    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            log::warn!("未使用索引检测查询失败（可能缺少权限）: {}", e);
            return Ok(vec![]);
        }
    };

    let mut unused = Vec::new();
    for row in &rows {
        let table: String = row.try_get("TABLE_NAME").unwrap_or_default();
        let index: String = row.try_get("INDEX_NAME").unwrap_or_default();
        let cols_str: String = row.try_get("idx_columns").unwrap_or_default();
        let cols: Vec<String> = cols_str.split(',').map(|s| s.to_string()).collect();
        let size_bytes: i64 = row.try_get("size_bytes").unwrap_or(0);

        let size_estimate = if size_bytes > 1024 * 1024 {
            format!("{:.1} MB", size_bytes as f64 / 1024.0 / 1024.0)
        } else if size_bytes > 1024 {
            format!("{:.1} KB", size_bytes as f64 / 1024.0)
        } else {
            format!("{} B", size_bytes)
        };

        let esc_table = table.replace('`', "``");
        let esc_idx = index.replace('`', "``");

        unused.push(UnusedIndex {
            table_name: table,
            index_name: index,
            index_columns: cols,
            size_estimate,
            drop_sql: format!("ALTER TABLE `{}` DROP INDEX `{}`;", esc_table, esc_idx),
        });
    }

    Ok(unused)
}

/// 基于 EXPLAIN JSON 分析 SQL，生成索引建议
async fn analyze_explain_for_suggestions(
    pool: &MySqlPool,
    database: &str,
    sql: &str,
) -> Result<Vec<IndexSuggestion>, AppError> {
    // 先切换到目标数据库
    let use_sql = format!("USE `{}`", database.replace('`', "``"));
    let mut conn = pool.acquire().await.map_err(AppError::Database)?;
    use sqlx::Executor;
    conn.execute(sqlx::raw_sql(&use_sql)).await
        .map_err(|e| AppError::Other(format!("切换数据库失败: {}", e)))?;

    // 执行 EXPLAIN FORMAT=JSON
    let explain_sql = format!("EXPLAIN FORMAT=JSON {}", sql.trim());
    let explain_row = sqlx::query(&explain_sql)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| AppError::Other(format!("EXPLAIN 执行失败: {}", e)))?;

    let json_str: String = explain_row.try_get(0)
        .map_err(|e| AppError::Other(format!("EXPLAIN 结果解析失败: {}", e)))?;

    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Other(format!("EXPLAIN JSON 解析失败: {}", e)))?;

    let mut suggestions = Vec::new();
    extract_suggestions_from_explain(&json, &mut suggestions);

    Ok(suggestions)
}

/// 递归分析 EXPLAIN JSON 树，提取索引建议
fn extract_suggestions_from_explain(
    node: &serde_json::Value,
    suggestions: &mut Vec<IndexSuggestion>,
) {
    // 检查 query_block.table
    if let Some(query_block) = node.get("query_block") {
        if let Some(table) = query_block.get("table") {
            check_table_node(table, suggestions);
        }
        // 嵌套查询
        if let Some(nested) = query_block.get("nested_loop") {
            if let Some(arr) = nested.as_array() {
                for item in arr {
                    if let Some(t) = item.get("table") {
                        check_table_node(t, suggestions);
                    }
                }
            }
        }
        // ORDER BY 优化
        if let Some(ordering) = query_block.get("ordering_operation") {
            if let Some(using_filesort) = ordering.get("using_filesort") {
                if using_filesort.as_bool() == Some(true) {
                    // filesort 意味着可能缺少排序索引
                    if let Some(nested) = ordering.get("nested_loop") {
                        if let Some(arr) = nested.as_array() {
                            for item in arr {
                                if let Some(t) = item.get("table") {
                                    check_filesort_node(t, suggestions);
                                }
                            }
                        }
                    }
                    if let Some(t) = ordering.get("table") {
                        check_filesort_node(t, suggestions);
                    }
                }
            }
        }
    }
}

/// 检查单个表节点是否有优化空间
fn check_table_node(table: &serde_json::Value, suggestions: &mut Vec<IndexSuggestion>) {
    let table_name = table.get("table_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if table_name.is_empty() { return; }

    let access_type = table.get("access_type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let rows_examined = table.get("rows_examined_per_scan")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let key = table.get("key")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let possible_keys = table.get("possible_keys")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    // 全表扫描且扫描行数较多：强烈建议添加索引
    if access_type == "ALL" && rows_examined > 100 {
        let used_columns = extract_used_columns(table);
        if !used_columns.is_empty() {
            let esc_table = table_name.replace('`', "``");
            let col_list = used_columns.iter()
                .map(|c| format!("`{}`", c.replace('`', "``")))
                .collect::<Vec<_>>()
                .join(", ");
            let idx_name = format!("idx_{}", used_columns.join("_"));

            suggestions.push(IndexSuggestion {
                table_name: table_name.clone(),
                columns: used_columns,
                reason: format!(
                    "全表扫描（type=ALL），预估扫描 {} 行，无可用索引",
                    rows_examined,
                ),
                estimated_improvement: if rows_examined > 10000 {
                    "高：大幅减少扫描行数".into()
                } else {
                    "中：减少扫描行数".into()
                },
                create_sql: format!(
                    "ALTER TABLE `{}` ADD INDEX `{}` ({});",
                    esc_table, idx_name, col_list,
                ),
            });
        }
    }

    // 有可用索引但未使用（possible_keys 不为空，key 为空）
    if !possible_keys.is_empty() && key.is_empty() && rows_examined > 50 {
        suggestions.push(IndexSuggestion {
            table_name: table_name.clone(),
            columns: possible_keys.iter().map(|s| s.to_string()).collect(),
            reason: format!(
                "存在候选索引 ({}) 但优化器未选择使用，可能需要 ANALYZE TABLE 更新统计信息",
                possible_keys.join(", "),
            ),
            estimated_improvement: "中：运行 ANALYZE TABLE 后可能自动改善".into(),
            create_sql: format!(
                "ANALYZE TABLE `{}`;",
                table_name.replace('`', "``"),
            ),
        });
    }
}

/// 检查 filesort 节点
fn check_filesort_node(table: &serde_json::Value, suggestions: &mut Vec<IndexSuggestion>) {
    let table_name = table.get("table_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if table_name.is_empty() { return; }

    let rows_examined = table.get("rows_examined_per_scan")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if rows_examined > 1000 {
        suggestions.push(IndexSuggestion {
            table_name: table_name.clone(),
            columns: vec![],
            reason: format!(
                "使用 filesort 对 {} 行数据排序，考虑为 ORDER BY 列添加索引",
                rows_examined,
            ),
            estimated_improvement: "中：消除 filesort 可提升排序性能".into(),
            create_sql: format!(
                "-- 请检查 ORDER BY 子句中的列，为其创建索引\n-- ALTER TABLE `{}` ADD INDEX idx_sort (...);",
                table_name.replace('`', "``"),
            ),
        });
    }
}

/// 从 EXPLAIN 的 attached_condition 中提取可能的列名
fn extract_used_columns(table: &serde_json::Value) -> Vec<String> {
    let mut columns = Vec::new();

    if let Some(condition) = table.get("attached_condition").and_then(|v| v.as_str()) {
        // 简单正则匹配 `table`.`column` 或 column = 模式
        // 注意：这只是启发式提取，不是完整的 SQL 解析
        let re = regex::Regex::new(r"`(\w+)`\.`(\w+)`|(?:^|\s)(\w+)\s*[=<>!]").ok();
        if let Some(re) = re {
            for cap in re.captures_iter(condition) {
                if let Some(col) = cap.get(2) {
                    let col_name = col.as_str().to_string();
                    if !columns.contains(&col_name) {
                        columns.push(col_name);
                    }
                } else if let Some(col) = cap.get(3) {
                    let col_name = col.as_str().to_string();
                    // 排除 SQL 关键字
                    let keywords = ["AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN"];
                    if !keywords.contains(&col_name.to_uppercase().as_str()) && !columns.contains(&col_name) {
                        columns.push(col_name);
                    }
                }
            }
        }
    }

    columns
}
