use std::time::Instant;
use std::io::Write;
use std::sync::Arc;
use tauri::Emitter;
use crate::models::import_export::{ExportFormat, ExportOptions, ExportRequest, ExportResult, ExportSource};
use crate::services::db_drivers::{mysql, DriverPool};
use crate::utils::error::AppError;
use super::DbEngine;

impl DbEngine {
    pub async fn export_data(
        self: Arc<Self>,
        connection_id: String,
        request: ExportRequest,
        app: tauri::AppHandle,
    ) -> Result<ExportResult, AppError> {
        let pool: Arc<DriverPool> = self.clone().get_pool(connection_id).await?;
        let (query_sql, table_name) = match &request.source {
            ExportSource::Query { sql, database } => {
                if let DriverPool::MySql(p) = pool.as_ref() {
                    let use_sql = format!("USE `{}`", database.replace('`', "``"));
                    sqlx::query(&use_sql).execute(p).await.map_err(AppError::Database)?;
                }
                (sql.clone(), String::from("query_result"))
            }
            ExportSource::Table { database, table } => {
                (format!("SELECT * FROM `{}`.`{}`", database.replace('`', "``"), table.replace('`', "``")), table.clone())
            }
        };

        let export_table_name = request.options.sql_table_name.as_deref().unwrap_or(&table_name).to_string();
        
        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("数据导出目前仅支持 MySQL".to_string())),
        };

        let count_sql = format!("SELECT COUNT(*) AS cnt FROM ({}) AS _export_sub", &query_sql);
        let count_result = mysql::execute_select(mysql_pool, &count_sql, Instant::now()).await?;
        let total_rows = count_result.rows.first().and_then(|r| r.first()).and_then(|v| v.as_u64()).unwrap_or(0);

        const BATCH_THRESHOLD: u64 = 100_000;
        const BATCH_SIZE: u64 = 10_000;

        if total_rows <= BATCH_THRESHOLD {
            let result = mysql::execute_select(mysql_pool, &query_sql, Instant::now()).await?;
            let _ = app.emit("export-progress", serde_json::json!({ "current": total_rows, "total": total_rows, "percentage": 100.0 }));
            self.clone().write_export_file(&request.file_path, &request.format, &request.options, &result.columns, &result.rows, &export_table_name, mysql_pool, &request.source).await
        } else {
            self.clone().export_data_batched(mysql_pool, &query_sql, total_rows, BATCH_SIZE, &request.file_path, &request.format, &request.options, &export_table_name, app, &request.source).await
        }
    }

    async fn export_data_batched(self: Arc<Self>, pool: &sqlx::MySqlPool, base_sql: &str, total_rows: u64, batch_size: u64, file_path: &str, format: &ExportFormat, options: &ExportOptions, table_name: &str, app: tauri::AppHandle, source: &ExportSource) -> Result<ExportResult, AppError> {
        let file = std::fs::File::create(file_path).map_err(|e| AppError::Other(e.to_string()))?;
        let mut writer = std::io::BufWriter::new(file);

        if matches!(format, ExportFormat::Excel) {
            return self.clone().export_excel_batched(pool, base_sql, total_rows, batch_size, file_path, app).await;
        }

        if matches!(format, ExportFormat::Json) { writer.write_all(b"[\n").map_err(|e| AppError::Other(e.to_string()))?; }
        if matches!(format, ExportFormat::Sql) && options.sql_include_create.unwrap_or(false) {
            if let ExportSource::Table { database, table } = source {
                if let Ok(ddl) = mysql::get_create_table(pool, database, table).await {
                    writeln!(writer, "{};\n", ddl).map_err(|e| AppError::Other(e.to_string()))?;
                }
            }
        }

        let mut total_exported: u64 = 0;
        let mut header_written = false;
        let mut columns_cache = Vec::new();
        let total_batches = (total_rows + batch_size - 1) / batch_size;

        for batch_idx in 0..total_batches {
            let res = mysql::execute_select(pool, &format!("{} LIMIT {} OFFSET {}", base_sql, batch_size, batch_idx * batch_size), Instant::now()).await?;
            if !header_written {
                columns_cache = res.columns.clone();
                self.clone().write_export_header(&mut writer, format, options, &columns_cache)?;
                header_written = true;
            }
            self.clone().write_export_rows(&mut writer, format, options, &columns_cache, &res.rows, table_name, total_exported > 0)?;
            total_exported += res.rows.len() as u64;
            let _ = app.emit("export-progress", serde_json::json!({ "current": total_exported, "total": total_rows, "percentage": (total_exported as f64 / total_rows as f64 * 100.0).min(100.0) }));
        }

        if matches!(format, ExportFormat::Json) { writer.write_all(b"\n]").map_err(|e| AppError::Other(e.to_string()))?; }
        writer.flush().map_err(|e| AppError::Other(e.to_string()))?;
        Ok(ExportResult { success: true, row_count: total_exported, file_size: std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0), error: None })
    }

    fn write_export_header<W: Write>(self: Arc<Self>, writer: &mut W, format: &ExportFormat, options: &ExportOptions, columns: &[crate::models::query::ColumnDef]) -> Result<(), AppError> {
        match format {
            ExportFormat::Csv if options.csv_include_header.unwrap_or(true) => {
                let q = options.csv_quote_char.as_deref().unwrap_or("\"");
                let line = columns.iter().map(|c| format!("{}{}{}", q, c.name, q)).collect::<Vec<_>>().join(options.csv_delimiter.as_deref().unwrap_or(","));
                writeln!(writer, "{}", line).map_err(|e| AppError::Other(e.to_string()))?;
            }
            ExportFormat::Markdown => {
                let h = columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(" | ");
                let s = columns.iter().map(|_| "---").collect::<Vec<_>>().join(" | ");
                writeln!(writer, "| {} |\n| {} |", h, s).map_err(|e| AppError::Other(e.to_string()))?;
            }
            _ => {}
        }
        Ok(())
    }

    fn write_export_rows<W: Write>(self: Arc<Self>, writer: &mut W, format: &ExportFormat, options: &ExportOptions, columns: &[crate::models::query::ColumnDef], rows: &[Vec<serde_json::Value>], table_name: &str, has_prev: bool) -> Result<(), AppError> {
        match format {
            ExportFormat::Csv => {
                let q = options.csv_quote_char.as_deref().unwrap_or("\"");
                let d = options.csv_delimiter.as_deref().unwrap_or(",");
                for row in rows {
                    let line = row.iter().map(|v| match v {
                        serde_json::Value::String(s) => format!("{}{}{}", q, s.replace(q, &format!("{}{}", q, q)), q),
                        serde_json::Value::Null => String::new(),
                        other => other.to_string(),
                    }).collect::<Vec<_>>().join(d);
                    writeln!(writer, "{}", line).map_err(|e| AppError::Other(e.to_string()))?;
                }
            }
            ExportFormat::Json => {
                for (i, row) in rows.iter().enumerate() {
                    let mut obj = serde_json::Map::new();
                    for (idx, col) in columns.iter().enumerate() { obj.insert(col.name.clone(), row[idx].clone()); }
                    let s = serde_json::to_string_pretty(&serde_json::Value::Object(obj)).map_err(|e| AppError::Other(e.to_string()))?;
                    if has_prev || i > 0 { write!(writer, ",\n{}", s) } else { write!(writer, "{}", s) }.map_err(|e| AppError::Other(e.to_string()))?;
                }
            }
            ExportFormat::Sql => {
                let batch = options.sql_batch_size.unwrap_or(1000) as usize;
                let cols = columns.iter().map(|c| format!("`{}`", c.name)).collect::<Vec<_>>().join(", ");
                for chunk in rows.chunks(batch) {
                    let vals = chunk.iter().map(|row| {
                        format!("({})", row.iter().enumerate().map(|(i, v)| {
                            let dt = columns.get(i).map(|c| c.data_type.as_str()).unwrap_or("");
                            self.clone().json_value_to_sql_literal(v, dt)
                        }).collect::<Vec<_>>().join(", "))
                    }).collect::<Vec<_>>().join(",\n");
                    writeln!(writer, "INSERT INTO `{}` ({}) VALUES\n{};\n", table_name, cols, vals).map_err(|e| AppError::Other(e.to_string()))?;
                }
            }
            ExportFormat::Markdown => {
                for row in rows {
                    let line = row.iter().map(|v| match v {
                        serde_json::Value::String(s) => s.replace('|', "\\|"),
                        serde_json::Value::Null => "NULL".to_string(),
                        other => other.to_string(),
                    }).collect::<Vec<_>>().join(" | ");
                    writeln!(writer, "| {} |", line).map_err(|e| AppError::Other(e.to_string()))?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn json_value_to_sql_literal(self: Arc<Self>, value: &serde_json::Value, data_type: &str) -> String {
        // BIT 类型需要特殊格式 b'0' / b'1'
        let is_bit = data_type.starts_with("BIT");
        match value {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Bool(b) => {
                if is_bit {
                    if *b { "b'1'".to_string() } else { "b'0'".to_string() }
                } else if *b { "1".to_string() } else { "0".to_string() }
            }
            serde_json::Value::Number(n) => {
                if is_bit {
                    let v = n.as_u64().unwrap_or(0);
                    format!("b'{:b}'", v)
                } else {
                    n.to_string()
                }
            }
            serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
            _ => format!("'{}'", value.to_string().replace('\'', "''")),
        }
    }

    async fn write_export_file(self: Arc<Self>, path: &str, format: &ExportFormat, options: &ExportOptions, columns: &[crate::models::query::ColumnDef], rows: &[Vec<serde_json::Value>], table_name: &str, pool: &sqlx::MySqlPool, source: &ExportSource) -> Result<ExportResult, AppError> {
        if matches!(format, ExportFormat::Excel) { self.clone().write_excel_file(path, columns, rows)?; }
        else {
            let file = std::fs::File::create(path).map_err(|e| AppError::Other(e.to_string()))?;
            let mut writer = std::io::BufWriter::new(file);
            if matches!(format, ExportFormat::Json) { writer.write_all(b"[\n").map_err(|e| AppError::Other(e.to_string()))?; }
            if matches!(format, ExportFormat::Sql) && options.sql_include_create.unwrap_or(false) {
                if let ExportSource::Table { database, table } = source {
                    if let Ok(ddl) = mysql::get_create_table(pool, database, table).await {
                        writeln!(writer, "{};\n", ddl).map_err(|e| AppError::Other(e.to_string()))?;
                    }
                }
            }
            self.clone().write_export_header(&mut writer, format, options, columns)?;
            self.clone().write_export_rows(&mut writer, format, options, columns, rows, table_name, false)?;
            if matches!(format, ExportFormat::Json) { writer.write_all(b"\n]").map_err(|e| AppError::Other(e.to_string()))?; }
            writer.flush().map_err(|e| AppError::Other(e.to_string()))?;
        }
        Ok(ExportResult { success: true, row_count: rows.len() as u64, file_size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0), error: None })
    }

    fn write_excel_file(self: Arc<Self>, path: &str, columns: &[crate::models::query::ColumnDef], rows: &[Vec<serde_json::Value>]) -> Result<(), AppError> {
        use rust_xlsxwriter::{Workbook, Format};
        let mut work = Workbook::new();
        let sheet = work.add_worksheet();
        let fmt = Format::new().set_bold();
        for (i, col) in columns.iter().enumerate() { let _ = sheet.write_string_with_format(0, i as u16, &col.name, &fmt).map_err(|e| AppError::Other(e.to_string()))?; }
        for (r_idx, row) in rows.iter().enumerate() {
            for (c_idx, val) in row.iter().enumerate() { self.clone().write_excel_cell(sheet, (r_idx + 1) as u32, c_idx as u16, val)?; }
        }
        work.save(path).map_err(|e| AppError::Other(e.to_string()))?;
        Ok(())
    }

    fn write_excel_cell(self: Arc<Self>, sheet: &mut rust_xlsxwriter::Worksheet, row: u32, col: u16, val: &serde_json::Value) -> Result<(), AppError> {
        match val {
            serde_json::Value::Null => { let _ = sheet.write_string(row, col, "").map_err(|e| AppError::Other(e.to_string()))?; },
            serde_json::Value::Bool(b) => { let _ = sheet.write_boolean(row, col, *b).map_err(|e| AppError::Other(e.to_string()))?; },
            serde_json::Value::Number(n) => { if let Some(f) = n.as_f64() { let _ = sheet.write_number(row, col, f).map_err(|e| AppError::Other(e.to_string()))?; } else { let _ = sheet.write_string(row, col, &n.to_string()).map_err(|e| AppError::Other(e.to_string()))?; } },
            serde_json::Value::String(s) => { let _ = sheet.write_string(row, col, s).map_err(|e| AppError::Other(e.to_string()))?; },
            other => { let _ = sheet.write_string(row, col, &other.to_string()).map_err(|e| AppError::Other(e.to_string()))?; },
        }
        Ok(())
    }

    async fn export_excel_batched(self: Arc<Self>, pool: &sqlx::MySqlPool, base: &str, total: u64, batch: u64, path: &str, app: tauri::AppHandle) -> Result<ExportResult, AppError> {
        use rust_xlsxwriter::{Workbook, Format};
        let mut work = Workbook::new();
        let sheet = work.add_worksheet();
        let fmt = Format::new().set_bold();
        let mut total_exp: u64 = 0;
        let mut head = false;
        let counts = (total + batch - 1) / batch;
        for i in 0..counts {
            let res = mysql::execute_select(pool, &format!("{} LIMIT {} OFFSET {}", base, batch, i * batch), Instant::now()).await?;
            if !head { for (j, c) in res.columns.iter().enumerate() { let _ = sheet.write_string_with_format(0, j as u16, &c.name, &fmt).map_err(|e| AppError::Other(e.to_string()))?; } head = true; }
            for (r_idx, row) in res.rows.iter().enumerate() {
                for (c_idx, v) in row.iter().enumerate() { self.clone().write_excel_cell(sheet, (total_exp as u32) + (r_idx as u32) + 1, c_idx as u16, v)?; }
            }
            total_exp += res.rows.len() as u64;
            let _ = app.emit("export-progress", serde_json::json!({ "current": total_exp, "total": total, "percentage": (total_exp as f64 / total as f64 * 100.0).min(100.0) }));
        }
        work.save(path).map_err(|e| AppError::Other(e.to_string()))?;
        Ok(ExportResult { success: true, row_count: total_exp, file_size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0), error: None })
    }
}
