use std::time::Instant;

use sqlx::postgres::{PgColumn, PgConnectOptions, PgPool, PgPoolOptions, PgRow, PgSslMode};
use sqlx::{Column, Row, TypeInfo};

use crate::models::query::{ColumnDef, ColumnInfo, DatabaseInfo, QueryResult, TableInfo};
use crate::utils::error::AppError;

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
        .max_connections(5)
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
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
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
        .map(|row| {
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
        .map(|row| {
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
        .map(|row| {
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
    let columns = get_columns(pool, schema, table).await?;

    let mut ddl = format!("CREATE TABLE \"{}\".\"{}\" (\n", schema, table);

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

pub fn build_table_data_sql(schema: &str, table: &str, page_size: u32, offset: u32) -> String {
    format!(
        "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
        schema, table, page_size, offset
    )
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
