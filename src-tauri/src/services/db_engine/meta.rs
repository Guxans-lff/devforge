use std::collections::HashMap;
use std::sync::Arc;
use crate::models::query::{
    ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, RoutineParameter, TableInfo, TriggerInfo, ViewInfo,
    ServerStatus, ProcessInfo, ServerVariable, MysqlUser, CreateUserRequest, ScriptOptions,
    ForeignKeyRelation, SchemaBundle
};
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use super::{DbEngine, MonitoringState};

/// MySQL 字符串字面量转义：处理反斜杠和单引号
fn escape_mysql_str(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

impl DbEngine {
    pub async fn get_databases(self: Arc<Self>, connection_id: String) -> Result<Vec<DatabaseInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_databases(p).await,
            DriverPool::Postgres(p) => postgres::get_databases(p).await,
        }
    }

    pub async fn get_tables(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<TableInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_tables(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_tables(p, &database).await,
        }
    }

    pub async fn get_columns(self: Arc<Self>, connection_id: String, database: String, table: String) -> Result<Vec<ColumnInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_columns(p, &database, &table).await,
            DriverPool::Postgres(p) => postgres::get_columns(p, &database, &table).await,
        }
    }

    /// 批量获取指定数据库中所有表的列信息（SQL 补全预加载用）
    pub async fn get_all_columns(self: Arc<Self>, connection_id: String, database: String) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_all_columns(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_all_columns(p, &database).await,
        }
    }

    pub async fn get_schema_bundle(self: Arc<Self>, connection_id: String, database: String) -> Result<SchemaBundle, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        let (tables, foreign_keys, all_columns) = match pool.as_ref() {
            DriverPool::MySql(p) => {
                let (tables, foreign_keys, all_columns) = tokio::try_join!(
                    mysql::get_tables(p, &database),
                    mysql::get_foreign_keys(p, &database),
                    mysql::get_all_columns(p, &database),
                )?;
                (tables, foreign_keys, all_columns)
            }
            DriverPool::Postgres(p) => {
                let (tables, foreign_keys, all_columns) = tokio::try_join!(
                    postgres::get_tables(p, &database),
                    postgres::get_foreign_keys(p, &database),
                    postgres::get_all_columns(p, &database),
                )?;
                (tables, foreign_keys, all_columns)
            }
        };
        Ok(SchemaBundle { tables, foreign_keys, all_columns })
    }

    pub async fn get_table_data(self: Arc<Self>, connection_id: String, database: String, table: String, page: u32, page_size: u32, where_clause: Option<String>, order_by: Option<String>, seek_column: Option<String>, seek_value: Option<i64>) -> Result<QueryResult, AppError> {
        let pool = self.clone().get_pool(connection_id.clone()).await?;
        let offset = page.saturating_sub(1) * page_size;
        let has_seek_column = seek_column
            .as_deref()
            .map(|col| !col.trim().is_empty())
            .unwrap_or(false);
        let order_by_trimmed = order_by.as_deref().map(str::trim);
        let order_by_is_seek_order = match (order_by_trimmed, seek_column.as_deref()) {
            (Some(order_by), Some(column)) => order_by.eq_ignore_ascii_case(&format!("{} ASC", column))
                || order_by.eq_ignore_ascii_case(&format!("`{}` ASC", column.replace('`', "``")))
                || order_by.eq_ignore_ascii_case(&format!("\"{}\" ASC", column.replace('"', "\"\""))),
            _ => false,
        };
        let has_order_by = order_by
            .as_deref()
            .map(|o| !o.trim().is_empty())
            .unwrap_or(false);
        let use_seek = has_seek_column && seek_value.is_some() && (!has_order_by || order_by_is_seek_order);
        let loaded_before = if use_seek { page.saturating_sub(1) * page_size } else { offset };
        let data_sql = match pool.as_ref() {
            DriverPool::MySql(_) => {
                if use_seek {
                    mysql::build_table_data_seek_sql(&database, &table, page_size + 1, where_clause.as_deref(), seek_column.as_deref().unwrap_or_default(), seek_value.unwrap_or_default()).map_err(AppError::Other)?
                } else {
                    mysql::build_table_data_sql(&database, &table, page_size + 1, offset, where_clause.as_deref(), order_by.as_deref()).map_err(AppError::Other)?
                }
            },
            DriverPool::Postgres(_) => {
                if use_seek {
                    postgres::build_table_data_seek_sql(&database, &table, page_size + 1, where_clause.as_deref(), seek_column.as_deref().unwrap_or_default(), seek_value.unwrap_or_default()).map_err(AppError::Other)?
                } else {
                    postgres::build_table_data_sql(&database, &table, page_size + 1, offset, where_clause.as_deref(), order_by.as_deref()).map_err(AppError::Other)?
                }
            },
        };

        let mut result = self.execute_query(connection_id, None, data_sql, None).await?;
        if result.rows.len() as u32 > page_size {
            result.rows.truncate(page_size as usize);
            result.total_count = Some((loaded_before + page_size + 1) as i64);
        } else {
            result.total_count = Some((loaded_before + result.rows.len() as u32) as i64);
        }
        Ok(result)
    }

    pub async fn get_create_table(self: Arc<Self>, connection_id: String, database: String, table: String) -> Result<String, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_create_table(p, &database, &table).await,
            DriverPool::Postgres(p) => postgres::get_create_table(p, &database, &table).await,
        }
    }

    pub async fn get_views(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<ViewInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_views(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_views(p, &database).await,
        }
    }

    pub async fn get_routines(self: Arc<Self>, connection_id: String, database: String, routine_type: String) -> Result<Vec<RoutineInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_routines(p, &database, &routine_type).await,
            DriverPool::Postgres(p) => postgres::get_routines(p, &database, &routine_type).await,
        }
    }

    /// 获取存储过程/函数的参数列表（仅 MySQL 支持）
    pub async fn get_routine_parameters(self: Arc<Self>, connection_id: String, database: String, routine_name: String, routine_type: String) -> Result<Vec<RoutineParameter>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_routine_parameters(p, &database, &routine_name, &routine_type).await,
            DriverPool::Postgres(_) => Err(AppError::Other("PostgreSQL routine parameters not supported yet".to_string())),
        }
    }

    pub async fn get_triggers(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<TriggerInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_triggers(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_triggers(p, &database).await,
        }
    }

    pub async fn get_object_definition(self: Arc<Self>, connection_id: String, database: String, name: String, object_type: String) -> Result<String, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_object_definition(p, &database, &name, &object_type).await,
            DriverPool::Postgres(p) => postgres::get_object_definition(p, &database, &name, &object_type).await,
        }
    }

    pub async fn get_server_status(self: Arc<Self>, connection_id: String) -> Result<ServerStatus, AppError> {
        let pool: Arc<DriverPool> = self.clone().get_pool(connection_id.clone()).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                use sqlx::Row;
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query("SHOW GLOBAL STATUS").fetch_all(p).await.map_err(AppError::Database)?;
                let mut smap = HashMap::new();
                let raw: Vec<ServerVariable> = rows.iter().map(|r| {
                    let n: String = r.try_get("Variable_name").unwrap_or_default();
                    let v: String = r.try_get("Value").unwrap_or_default();
                    smap.insert(n.to_lowercase(), v.clone());
                    ServerVariable { name: n, value: v }
                }).collect();

                let q: u64 = smap.get("questions").and_then(|v| v.parse().ok()).unwrap_or(0);
                let u: u64 = smap.get("uptime").and_then(|v| v.parse().ok()).unwrap_or(1);
                let c: u64 = smap.get("com_commit").and_then(|v| v.parse().ok()).unwrap_or(0);
                let r: u64 = smap.get("com_rollback").and_then(|v| v.parse().ok()).unwrap_or(0);
                let bpt: f64 = smap.get("innodb_buffer_pool_pages_total").and_then(|v| v.parse().ok()).unwrap_or(1.0);
                let bpf: f64 = smap.get("innodb_buffer_pool_pages_free").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                
                let mut m = self.monitoring_states.write().await;
                let (qps, tps) = if let Some(l) = m.get(&connection_id) {
                    let dt = u.saturating_sub(l.uptime);
                    if dt > 0 { ((q.saturating_sub(l.questions)) as f64 / dt as f64, (c+r).saturating_sub(l.com_commit+l.com_rollback) as f64 / dt as f64) }
                    else { (q as f64 / u as f64, (c+r) as f64 / u as f64) }
                } else { (q as f64 / u as f64, (c+r) as f64 / u as f64) };

                m.insert(connection_id.clone(), MonitoringState { questions: q, com_commit: c, com_rollback: r, uptime: u });
                Ok(ServerStatus {
                    qps, tps, active_connections: smap.get("threads_running").and_then(|v| v.parse().ok()).unwrap_or(0),
                    total_connections: smap.get("threads_connected").and_then(|v| v.parse().ok()).unwrap_or(0),
                    buffer_pool_usage: if bpt > 0.0 { (bpt - bpf) / bpt } else { 0.0 },
                    slow_queries: smap.get("slow_queries").and_then(|v| v.parse().ok()).unwrap_or(0),
                    uptime: u, bytes_sent: smap.get("bytes_sent").and_then(|v| v.parse().ok()).unwrap_or(0),
                    bytes_received: smap.get("bytes_received").and_then(|v| v.parse().ok()).unwrap_or(0),
                    raw_status: raw,
                })
            }
            _ => Err(AppError::Other("Only MySQL supported for monitoring".into())),
        }
    }

    pub async fn get_process_list(self: Arc<Self>, connection_id: String) -> Result<Vec<ProcessInfo>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                use sqlx::{Row, Column};
                let rows = sqlx::query("SHOW FULL PROCESSLIST").fetch_all(p).await.map_err(AppError::Database)?;
                Ok(rows.iter().map(|r| {
                    let cols = r.columns().iter().enumerate().map(|(i, c)| (c.name().to_lowercase(), i)).collect::<HashMap<_, _>>();
                    let get_s = |k: &str| cols.get(k).and_then(|&idx| r.try_get::<&str, _>(idx).ok()).unwrap_or_default().to_string();
                    let get_u = |k: &str| cols.get(k).and_then(|&idx| r.try_get::<u64, _>(idx).or_else(|_| r.try_get::<i64, _>(idx).map(|v| v as u64)).ok()).unwrap_or(0);
                    ProcessInfo {
                        id: get_u("id"), user: get_s("user"), host: get_s("host"), db: cols.get("db").and_then(|&i| r.try_get::<Option<&str>, _>(i).ok().flatten()).map(|s| s.to_string()),
                        command: get_s("command"), time: get_u("time"), state: cols.get("state").and_then(|&i| r.try_get::<Option<&str>, _>(i).ok().flatten()).map(|s| s.to_string()),
                        info: cols.get("info").and_then(|&i| r.try_get::<Option<&str>, _>(i).ok().flatten()).map(|s| s.to_string()),
                    }
                }).collect())
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn kill_process(self: Arc<Self>, connection_id: String, pid: u64) -> Result<bool, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => { sqlx::query(&format!("KILL {}", pid)).execute(p).await.map_err(AppError::Database)?; Ok(true) }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn get_server_variables(self: Arc<Self>, connection_id: String) -> Result<Vec<ServerVariable>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                use sqlx::Row;
                let rows = sqlx::query("SHOW GLOBAL VARIABLES").fetch_all(p).await.map_err(AppError::Database)?;
                Ok(rows.iter().map(|r| ServerVariable { name: r.try_get("Variable_name").unwrap_or_default(), value: r.try_get("Value").unwrap_or_default() }).collect())
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn get_users(self: Arc<Self>, connection_id: String) -> Result<Vec<MysqlUser>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                use sqlx::Row;
                let rows = sqlx::query("SELECT User, Host, authentication_string, plugin, account_locked, password_expired FROM mysql.user ORDER BY User, Host").fetch_all(p).await.map_err(AppError::Database)?;
                Ok(rows.iter().map(|r| {
                    let u = r.try_get::<String, _>("User").or_else(|_| r.try_get::<Vec<u8>, _>("User").map(|b| String::from_utf8_lossy(&b).to_string())).unwrap_or_default();
                    let h = r.try_get::<String, _>("Host").or_else(|_| r.try_get::<Vec<u8>, _>("Host").map(|b| String::from_utf8_lossy(&b).to_string())).unwrap_or_default();
                    MysqlUser { user: u, host: h, authentication_string: r.try_get("authentication_string").ok(), plugin: r.try_get("plugin").ok(), account_locked: r.try_get("account_locked").ok(), password_expired: r.try_get("password_expired").ok() }
                }).collect())
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn create_user(self: Arc<Self>, connection_id: String, req: CreateUserRequest) -> Result<bool, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                let pc = req.plugin.as_ref().map(|pl| format!(" WITH '{}'", pl)).unwrap_or_default();
                let ec = req.password_expire_days.map(|d| format!(" PASSWORD EXPIRE INTERVAL {} DAY", d)).unwrap_or_default();
                let sql = format!(
                    "CREATE USER '{}'@'{}' IDENTIFIED{} BY '{}'{}",
                    escape_mysql_str(&req.username), escape_mysql_str(&req.host), pc, escape_mysql_str(&req.password), ec
                );
                sqlx::query(&sql).execute(p).await.map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn drop_user(self: Arc<Self>, connection_id: String, user: String, host: String) -> Result<bool, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => { let sql = format!("DROP USER '{}'@'{}'", escape_mysql_str(&user), escape_mysql_str(&host)); sqlx::query(&sql).execute(p).await.map_err(AppError::Database)?; Ok(true) }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn get_user_grants(self: Arc<Self>, user: String, host: String, connection_id: String) -> Result<Vec<String>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                use sqlx::Row;
                let uf = if user.is_empty() { "''" } else { &user };
                let hf = if host.is_empty() { "%" } else { &host };
                let sql = format!("SHOW GRANTS FOR '{}'@'{}'", uf.replace('\'', "\\'"), hf.replace('\'', "\\'"));
                let rows = sqlx::query(&sql).fetch_all(p).await.map_err(AppError::Database)?;
                Ok(rows.iter().map(|r| r.try_get::<String, _>(0).unwrap_or_default()).collect())
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn apply_grants(self: Arc<Self>, stmts: Vec<String>, connection_id: String) -> Result<bool, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                for s in &stmts { sqlx::query(s).execute(p).await.map_err(|e| AppError::Other(format!("Error: {} | SQL: {}", e, s)))?; }
                sqlx::query("FLUSH PRIVILEGES").execute(p).await.map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn generate_script(self: Arc<Self>, connection_id: String, db: String, obj: String, stype: String, opts: ScriptOptions) -> Result<String, AppError> {
        match stype.as_str() {
            "create" => {
                let ddl = self.clone().get_create_table(connection_id, db, obj).await?;
                Ok(if opts.include_if_not_exists { ddl.replacen("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1) } else { ddl })
            }
            "drop" => { let esc = obj.replace('`', "``"); Ok(if opts.include_if_exists { format!("DROP TABLE IF EXISTS `{}`;", esc) } else { format!("DROP TABLE `{}`;", esc) }) }
            "insert-template" => {
                let cols = self.clone().get_columns(connection_id, db.clone(), obj.clone()).await?;
                if cols.is_empty() { return Err(AppError::Other("Empty columns".into())); }
                let names = cols.iter().map(|c| format!("`{}`", c.name.replace('`', "``"))).collect::<Vec<_>>().join(", ");
                let phs = vec!["?"; cols.len()].join(", ");
                Ok(format!("INSERT INTO `{}` ({}) VALUES ({});", obj.replace('`', "``"), names, phs))
            }
            "select-template" => {
                let cols = self.clone().get_columns(connection_id, db.clone(), obj.clone()).await?;
                if cols.is_empty() { return Err(AppError::Other("Empty columns".into())); }
                let names = cols.iter().map(|c| format!("`{}`", c.name.replace('`', "``"))).collect::<Vec<_>>().join(", ");
                Ok(format!("SELECT {} FROM `{}`;", names, obj.replace('`', "``")))
            }
            "update-template" => {
                let cols = self.clone().get_columns(connection_id, db.clone(), obj.clone()).await?;
                if cols.is_empty() { return Err(AppError::Other("Empty columns".into())); }
                let set_clause = cols.iter().map(|c| format!("`{}` = ?", c.name.replace('`', "``"))).collect::<Vec<_>>().join(", ");
                Ok(format!("UPDATE `{}` SET {} WHERE /* 条件 */;", obj.replace('`', "``"), set_clause))
            }
            _ => Err(AppError::Other("Unknown script type".into())),
        }
    }

    /// 批量获取所有视图定义（一次 SQL）
    pub async fn get_view_definitions(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<(String, String)>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_view_definitions(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_view_definitions(p, &database).await,
        }
    }

    /// 批量获取所有存储过程/函数定义（一次 SQL）
    pub async fn get_routine_definitions(self: Arc<Self>, connection_id: String, database: String, routine_type: String) -> Result<Vec<(String, String)>, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_routine_definitions(p, &database, &routine_type).await,
            DriverPool::Postgres(p) => postgres::get_routine_definitions(p, &database, &routine_type).await,
        }
    }

    pub async fn export_database_ddl(self: Arc<Self>, connection_id: String, db: String, opts: ScriptOptions) -> Result<String, AppError> {
        let mut parts = vec![format!("-- Export: `{}`\n-- Time: {}\n", db, chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))];

        // 1. 获取表列表
        let tables = self.clone().get_tables(connection_id.clone(), db.clone()).await?;
        let table_names: Vec<String> = tables.iter()
            .filter(|t| t.table_type.to_uppercase() != "VIEW")
            .map(|t| t.name.clone())
            .collect();

        // 2. 并发获取所有表 DDL（限制并发度）+ 批量获取视图、存储过程、函数定义
        use futures::StreamExt;
        // collect 成 owned Vec<String> 避免闭包捕获 &String 引起生命周期问题
        let table_ddl_task = {
            let owned_table_names: Vec<String> = table_names.iter().cloned().collect();
            let engine = self.clone();
            let cid = connection_id.clone();
            let database = db.clone();
            async move {
                futures::stream::iter(owned_table_names.into_iter().map(|table_name| {
                    let engine = engine.clone();
                    let cid = cid.clone();
                    let database = database.clone();
                    async move {
                        engine.get_create_table(cid, database, table_name).await
                    }
                }))
                .buffered(4)
                .collect::<Vec<_>>()
                .await
            }
        };

        let definitions_task = async {
            tokio::join!(
                self.clone().get_view_definitions(connection_id.clone(), db.clone()),
                self.clone().get_routine_definitions(connection_id.clone(), db.clone(), "PROCEDURE".to_string()),
                self.clone().get_routine_definitions(connection_id.clone(), db.clone(), "FUNCTION".to_string())
            )
        };

        let (ddl_results, (view_defs, proc_defs, func_defs)) = tokio::join!(
            table_ddl_task,
            definitions_task
        );

        // 3. 组装表 DDL
        for (name, ddl_result) in table_names.iter().zip(ddl_results.into_iter()) {
            parts.push(format!("\n-- Table: `{}`", name));
            if opts.include_if_exists {
                parts.push(format!("DROP TABLE IF EXISTS `{}`;", name.replace('`', "``")));
            }
            if let Ok(ddl) = ddl_result {
                let ddl = if opts.include_if_not_exists {
                    ddl.replacen("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
                } else {
                    ddl
                };
                parts.push(format!("{};", ddl));
            }
        }

        // 4. 组装视图定义（已批量获取，无需逐个请求）
        match view_defs {
            Ok(views) => {
                for (name, def) in views {
                    parts.push(format!("\n-- View: `{}`", name));
                    if !def.is_empty() {
                        parts.push(format!("CREATE OR REPLACE VIEW `{}` AS {};", name.replace('`', "``"), def));
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to export views for {}: {}", db, e);
                parts.push(format!("\n-- WARNING: Failed to export views: {}", e));
            }
        }

        // 5. 组装存储过程定义（已批量获取）
        match proc_defs {
            Ok(procs) => {
                for (name, def) in procs {
                    parts.push(format!("\n-- Proc: `{}`\nDELIMITER ;;\n", name));
                    if !def.is_empty() {
                        parts.push(format!("{};;\nDELIMITER ;", def));
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to export procedures for {}: {}", db, e);
                parts.push(format!("\n-- WARNING: Failed to export procedures: {}", e));
            }
        }

        // 6. 组装函数定义（已批量获取）
        match func_defs {
            Ok(funcs) => {
                for (name, def) in funcs {
                    parts.push(format!("\n-- Function: `{}`\nDELIMITER ;;\n", name));
                    if !def.is_empty() {
                        parts.push(format!("{};;\nDELIMITER ;", def));
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to export functions for {}: {}", db, e);
                parts.push(format!("\n-- WARNING: Failed to export functions: {}", e));
            }
        }

        Ok(parts.join("\n"))
    }

    /// 获取指定数据库中所有外键关系（用于 SQL 补全 JOIN 推荐）
    pub async fn get_foreign_keys(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<ForeignKeyRelation>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_foreign_keys(p, &database).await,
            DriverPool::Postgres(p) => postgres::get_foreign_keys(p, &database).await,
        }
    }
}
