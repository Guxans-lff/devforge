use std::time::{Duration, Instant};

use sqlx::postgres::{PgColumn, PgConnectOptions, PgConnection, PgPool, PgPoolOptions, PgRow, PgSslMode};
use sqlx::pool::PoolConnection;
use sqlx::{Column, Executor, Row, TypeInfo};

use crate::models::query::{ColumnDef, ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use crate::utils::error::AppError;
use super::{escape_pg_ident, validate_sql_clause};

/// 取消当前连接上所有活跃查询
pub async fn cancel_running_query(pool: &PgPool) -> Result<(), AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT pid FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%' AND pid != pg_backend_pid()"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get active queries: {}", e)))?;

    for row in &rows {
        if let Ok(Some(pid)) = row.try_get::<Option<i32>, _>("pid") {
            let _ = sqlx::query("SELECT pg_cancel_backend($1)")
                .bind(pid)
                .execute(pool)
                .await;
        }
    }
    Ok(())
}

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
) -> Result<PgPool, AppError> {
    let mut options = PgConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(PgSslMode::Prefer);

    if let Some(db) = database {
        if !db.is_empty() {
            options = options.database(db);
        }
    }

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("PostgreSQL connection failed: {}", e)))?;

    Ok(pool)
}

pub async fn test_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
) -> Result<u64, AppError> {
    let start = Instant::now();

    let mut options = PgConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(PgSslMode::Prefer);

    if let Some(db) = database {
        if !db.is_empty() {
            options = options.database(db);
        }
    }

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    let _: (i32,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    pool.close().await;
    Ok(start.elapsed().as_millis() as u64)
}

pub async fn execute_select(
    pool: &PgPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let rows: Vec<PgRow> = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        // 空结果时通过 describe 获取列定义，确保前端能渲染空表格
        let columns = match pool.describe(sql).await {
            Ok(desc) => desc.columns().iter().map(|col| ColumnDef {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            }).collect(),
            Err(_) => vec![],
        };
        return Ok(QueryResult {
            columns,
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &PgColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &PgRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| pg_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

pub async fn execute_non_select(
    pool: &PgPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let result = sqlx::query(sql)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在指定 schema 上下文中执行 SELECT 查询
///
/// 关键修复：接收 owned PgPool（内部是 Arc，clone 廉价），
/// 使整个函数的 Future 满足 Send + 'static，可安全用于 tokio::spawn。
pub async fn execute_select_in_database(
    pool: PgPool,
    database: String,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let mut conn = pool.acquire().await.map_err(AppError::Database)?;

    // SET search_path 走 raw_sql 文本协议
    let set_sql = format!("SET search_path TO \"{}\"", database.replace('"', "\"\""));
    {
        let c: &mut sqlx::PgConnection = &mut *conn;
        sqlx::raw_sql(&set_sql).execute(&mut *c).await.map_err(|e| {
            AppError::Other(format!("切换数据库失败: {}", e))
        })?;
    }

    let rows: Vec<PgRow> = {
        let c: &mut PgConnection = &mut *conn;
        sqlx::raw_sql(&sql)
            .fetch_all(c)
            .await
            .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &PgColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &PgRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| pg_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在指定 schema 上下文中执行非 SELECT 语句
///
/// 接收 owned PgPool，使 Future 满足 Send + 'static。
/// 完全自包含：acquire + SET search_path + execute 全在一个函数体内完成。
pub async fn execute_non_select_in_database(
    pool: PgPool,
    database: String,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let mut conn = pool.acquire().await.map_err(AppError::Database)?;

    // SET search_path 走 Executor::execute 文本协议
    let set_sql = format!("SET search_path TO \"{}\"", database.replace('"', "\"\""));
    conn.execute(set_sql.as_str())
        .await
        .map_err(|e| AppError::Other(format!("切换数据库失败: {}", e)))?;

    let result: sqlx::postgres::PgQueryResult = {
        let c: &mut PgConnection = &mut *conn;
        sqlx::raw_sql(&sql)
            .execute(c)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在专用连接上执行 SELECT 查询（用于事务内操作）
///
/// 与 execute_select 逻辑相同，但使用 PoolConnection 而非连接池
pub async fn execute_select_on_conn(
    conn: &mut PoolConnection<sqlx::Postgres>,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let rows: Vec<PgRow> = sqlx::query(sql)
        .fetch_all(&mut **conn)
        .await
        .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &PgColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &PgRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| pg_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在专用连接上执行非 SELECT 语句（用于事务内操作）
///
/// 与 execute_non_select 逻辑相同，但使用 PoolConnection 而非连接池
pub async fn execute_non_select_on_conn(
    conn: &mut PoolConnection<sqlx::Postgres>,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let result = sqlx::query(sql)
        .execute(&mut **conn)
        .await
        .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// For PostgreSQL, "databases" maps to schemas within the connected database.
/// System schemas (pg_catalog, information_schema, pg_toast) are filtered out.
pub async fn get_databases(pool: &PgPool) -> Result<Vec<DatabaseInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT schema_name as name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND schema_name NOT LIKE 'pg_temp_%'
           AND schema_name NOT LIKE 'pg_toast_temp_%'
         ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list schemas: {}", e)))?;

    let databases = rows
        .iter()
        .map(|row| DatabaseInfo {
            name: row.try_get::<String, _>("name").unwrap_or_default(),
            character_set: None,
            collation: None,
        })
        .collect();

    Ok(databases)
}

/// For PostgreSQL, the `database` parameter is the schema name.
pub async fn get_tables(
    pool: &PgPool,
    schema: &str,
) -> Result<Vec<TableInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT t.table_name as name,
                t.table_type as table_type,
                pg_catalog.obj_description(c.oid, 'pg_class') as comment
         FROM information_schema.tables t
         LEFT JOIN pg_catalog.pg_class c
           ON c.relname = t.table_name
           AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = t.table_schema)
         WHERE t.table_schema = $1
         ORDER BY t.table_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list tables: {}", e)))?;

    let tables = rows
        .iter()
        .map(|row: &PgRow| {
            let raw_type: String = row.try_get("table_type").unwrap_or_default();
            TableInfo {
                name: row.try_get::<String, _>("name").unwrap_or_default(),
                table_type: if raw_type.contains("VIEW") {
                    "VIEW".to_string()
                } else {
                    "BASE TABLE".to_string()
                },
                row_count: None,
                comment: row.try_get::<Option<String>, _>("comment").unwrap_or(None),
            }
        })
        .collect();

    Ok(tables)
}

/// For PostgreSQL, the `database` parameter is the schema name.
pub async fn get_columns(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT c.column_name as name,
                c.data_type as data_type,
                c.is_nullable as nullable,
                c.column_default as default_value,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk,
                pgd.description as comment
         FROM information_schema.columns c
         LEFT JOIN (
             SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = $1
               AND tc.table_name = $2
         ) pk ON pk.column_name = c.column_name
         LEFT JOIN pg_catalog.pg_statio_all_tables st
           ON st.schemaname = c.table_schema AND st.relname = c.table_name
         LEFT JOIN pg_catalog.pg_description pgd
           ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list columns: {}", e)))?;

    let columns = rows
        .iter()
        .map(|row: &PgRow| {
            let nullable_str: String = row.try_get("nullable").unwrap_or_default();
            ColumnInfo {
                name: row.try_get::<String, _>("name").unwrap_or_default(),
                data_type: row.try_get::<String, _>("data_type").unwrap_or_default(),
                nullable: nullable_str == "YES",
                default_value: row.try_get::<Option<String>, _>("default_value").unwrap_or(None),
                is_primary_key: row.try_get::<Option<bool>, _>("is_pk").unwrap_or(None).unwrap_or(false),
                comment: row.try_get::<Option<String>, _>("comment").unwrap_or(None),
            }
        })
        .collect();

    Ok(columns)
}

/// Reconstructs a CREATE TABLE DDL from information_schema.
/// This is a best-effort approximation since PostgreSQL has no SHOW CREATE TABLE.
pub async fn get_create_table(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<String, AppError> {
    let columns: Vec<ColumnInfo> = get_columns(pool, schema, table).await?;

    let mut ddl = format!("CREATE TABLE \"{}\".\"{}\" (\n", escape_pg_ident(schema), escape_pg_ident(table));

    let col_defs: Vec<String> = columns
        .iter()
        .map(|col| {
            let mut def = format!("    \"{}\" {}", col.name, col.data_type);
            if !col.nullable {
                def.push_str(" NOT NULL");
            }
            if let Some(ref dv) = col.default_value {
                def.push_str(&format!(" DEFAULT {}", dv));
            }
            def
        })
        .collect();

    // Find primary key columns
    let pk_cols: Vec<&str> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.as_str())
        .collect();

    ddl.push_str(&col_defs.join(",\n"));

    if !pk_cols.is_empty() {
        let pk_quoted: Vec<String> = pk_cols.iter().map(|c| format!("\"{}\"", c)).collect();
        ddl.push_str(&format!(",\n    PRIMARY KEY ({})", pk_quoted.join(", ")));
    }

    ddl.push_str("\n);");

    Ok(ddl)
}

pub async fn get_views(
    pool: &PgPool,
    schema: &str,
) -> Result<Vec<ViewInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT table_name as name,
                view_definition as definer,
                check_option as check_option,
                is_updatable as is_updatable
         FROM information_schema.views
         WHERE table_schema = $1
         ORDER BY table_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list views: {}", e)))?;

    Ok(rows.iter().map(|row| ViewInfo {
        name: row.try_get::<String, _>("name").unwrap_or_default(),
        definer: row.try_get::<Option<String>, _>("definer").unwrap_or(None),
        check_option: row.try_get::<Option<String>, _>("check_option").unwrap_or(None),
        is_updatable: row.try_get::<Option<String>, _>("is_updatable").unwrap_or(None),
    }).collect())
}

pub async fn get_routines(
    pool: &PgPool,
    schema: &str,
    routine_type: &str,
) -> Result<Vec<RoutineInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT routine_name as name,
                routine_type as routine_type,
                '' as definer,
                '' as created,
                '' as modified,
                '' as comment
         FROM information_schema.routines
         WHERE routine_schema = $1 AND routine_type = $2
         ORDER BY routine_name",
    )
    .bind(schema)
    .bind(routine_type)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list routines: {}", e)))?;

    Ok(rows.iter().map(|row| RoutineInfo {
        name: row.try_get::<String, _>("name").unwrap_or_default(),
        routine_type: row.try_get::<String, _>("routine_type").unwrap_or_default(),
        definer: None,
        created: None,
        modified: None,
        comment: None,
    }).collect())
}

pub async fn get_triggers(
    pool: &PgPool,
    schema: &str,
) -> Result<Vec<TriggerInfo>, AppError> {
    let rows: Vec<PgRow> = sqlx::query(
        "SELECT trigger_name as name,
                event_manipulation as event,
                action_timing as timing,
                event_object_table as table_name,
                action_statement as statement
         FROM information_schema.triggers
         WHERE trigger_schema = $1
         ORDER BY trigger_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list triggers: {}", e)))?;

    Ok(rows.iter().map(|row| TriggerInfo {
        name: row.try_get::<String, _>("name").unwrap_or_default(),
        event: row.try_get::<String, _>("event").unwrap_or_default(),
        timing: row.try_get::<String, _>("timing").unwrap_or_default(),
        table_name: row.try_get::<String, _>("table_name").unwrap_or_default(),
        statement: row.try_get::<Option<String>, _>("statement").unwrap_or(None),
    }).collect())
}

pub async fn get_object_definition(
    pool: &PgPool,
    schema: &str,
    name: &str,
    object_type: &str,
) -> Result<String, AppError> {
    let escaped_schema = schema.replace('\'', "''");
    let escaped_name = name.replace('\'', "''");
    let sql = match object_type {
        "VIEW" => format!(
            "SELECT pg_get_viewdef('\"{}\".\"{}'', true) as def",
            escape_pg_ident(schema), escape_pg_ident(name)
        ),
        "FUNCTION" | "PROCEDURE" => {
            format!(
                "SELECT pg_get_functiondef(p.oid) as def
                 FROM pg_proc p
                 JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname = '{}' AND p.proname = '{}'
                 LIMIT 1",
                escaped_schema, escaped_name
            )
        }
        "TRIGGER" => format!(
            "SELECT pg_get_triggerdef(t.oid) as def
             FROM pg_trigger t
             JOIN pg_class c ON t.tgrelid = c.oid
             JOIN pg_namespace n ON c.relnamespace = n.oid
             WHERE n.nspname = '{}' AND t.tgname = '{}'
             LIMIT 1",
            escaped_schema, escaped_name
        ),
        _ => return Err(AppError::Other(format!("Unknown object type: {}", object_type))),
    };

    let row: PgRow = sqlx::query(&sql)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get definition: {}", e)))?;

    let def: String = row.try_get::<String, _>("def").unwrap_or_default();
    Ok(def)
}

pub fn build_table_data_sql(schema: &str, table: &str, page_size: u32, offset: u32, where_clause: Option<&str>, order_by: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT * FROM \"{}\".\"{}\"", escape_pg_ident(schema), escape_pg_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    if let Some(o) = order_by {
        let o = o.trim();
        if !o.is_empty() {
            validate_sql_clause(o)?;
            sql.push_str(&format!(" ORDER BY {}", o));
        }
    }
    sql.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));
    Ok(sql)
}

pub fn build_table_count_sql(schema: &str, table: &str, where_clause: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT COUNT(*) AS cnt FROM \"{}\".\"{}\"", escape_pg_ident(schema), escape_pg_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    Ok(sql)
}

fn pg_value_to_json(
    row: &PgRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOL" => row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),

        "INT2" => row
            .try_get::<Option<i16>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number((v as i64).into()))
            .unwrap_or(serde_json::Value::Null),

        "INT4" => row
            .try_get::<Option<i32>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "INT8" => row
            .try_get::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "FLOAT4" | "FLOAT8" | "NUMERIC" => row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        _ => row
            .try_get::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}
