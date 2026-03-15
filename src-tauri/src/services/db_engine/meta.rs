use std::collections::HashMap;
use std::sync::Arc;
use crate::models::query::{
    ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, RoutineParameter, TableInfo, TriggerInfo, ViewInfo,
    ServerStatus, ProcessInfo, ServerVariable, MysqlUser, CreateUserRequest, ScriptOptions,
    ForeignKeyRelation
};
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use super::{DbEngine, MonitoringState};

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

    pub async fn get_table_data(self: Arc<Self>, connection_id: String, database: String, table: String, page: u32, page_size: u32, where_clause: Option<String>, order_by: Option<String>) -> Result<QueryResult, AppError> {
        let pool = self.clone().get_pool(connection_id.clone()).await?;
        let offset = page.saturating_sub(1) * page_size;
        let (data_sql, count_sql) = match pool.as_ref() {
            DriverPool::MySql(_) => (
                mysql::build_table_data_sql(&database, &table, page_size, offset, where_clause.as_deref(), order_by.as_deref()).map_err(AppError::Other)?,
                mysql::build_table_count_sql(&database, &table, where_clause.as_deref()).map_err(AppError::Other)?,
            ),
            DriverPool::Postgres(_) => (
                postgres::build_table_data_sql(&database, &table, page_size, offset, where_clause.as_deref(), order_by.as_deref()).map_err(AppError::Other)?,
                postgres::build_table_count_sql(&database, &table, where_clause.as_deref()).map_err(AppError::Other)?,
            ),
        };

        let db_clone = connection_id.clone();
        let (result, count_res) = tokio::join!(
            self.clone().execute_query(connection_id, None, data_sql, None),
            self.execute_query(db_clone, None, count_sql, None)
        );
        let mut result = result?;
        if let Ok(count_res) = count_res {
            if let Some(row) = count_res.rows.first() {
                if let Some(val) = row.first() { result.total_count = val.as_i64(); }
            }
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
                let sql = format!("CREATE USER '{}'@'{}' IDENTIFIED{} BY '{}'{}", req.username.replace('\'', "\\'"), req.host.replace('\'', "\\'"), pc, req.password.replace('\'', "\\'"), ec);
                sqlx::query(&sql).execute(p).await.map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("Only MySQL supported".into())),
        }
    }

    pub async fn drop_user(self: Arc<Self>, connection_id: String, user: String, host: String) -> Result<bool, AppError> {
        let pool: Arc<DriverPool> = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => { let sql = format!("DROP USER '{}'@'{}'", user.replace('\'', "\\'"), host.replace('\'', "\\'")); sqlx::query(&sql).execute(p).await.map_err(AppError::Database)?; Ok(true) }
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

    pub async fn export_database_ddl(self: Arc<Self>, connection_id: String, db: String, opts: ScriptOptions) -> Result<String, AppError> {
        let mut parts = vec![format!("-- Export: `{}`\n-- Time: {}\n", db, chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))];
        let tables = self.clone().get_tables(connection_id.clone(), db.clone()).await?;
        for t in tables.iter().filter(|t| t.table_type.to_uppercase() != "VIEW") {
            parts.push(format!("\n-- Table: `{}`", t.name));
            if opts.include_if_exists { parts.push(format!("DROP TABLE IF EXISTS `{}`;", t.name.replace('`', "``"))); }
            if let Ok(ddl) = self.clone().get_create_table(connection_id.clone(), db.clone(), t.name.clone()).await {
                parts.push(format!("{};", if opts.include_if_not_exists { ddl.replacen("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1) } else { ddl }));
            }
        }
        let views = self.clone().get_views(connection_id.clone(), db.clone()).await?;
        for v in views { 
            parts.push(format!("\n-- View: `{}`", v.name)); 
            if let Ok(d) = self.clone().get_object_definition(connection_id.clone(), db.clone(), v.name.clone(), "VIEW".to_string()).await { 
                parts.push(format!("{};", d)); 
            } 
        }
        let procs = self.clone().get_routines(connection_id.clone(), db.clone(), "PROCEDURE".to_string()).await?;
        for p in procs { 
            parts.push(format!("\n-- Proc: `{}`\nDELIMITER ;;\n", p.name)); 
            if let Ok(d) = self.clone().get_object_definition(connection_id.clone(), db.clone(), p.name.clone(), "PROCEDURE".to_string()).await { 
                parts.push(format!("{};;\nDELIMITER ;", d)); 
            } 
        }
        Ok(parts.join("\n"))
    }

    /// 获取指定数据库中所有外键关系（用于 SQL 补全 JOIN 推荐）
    pub async fn get_foreign_keys(self: Arc<Self>, connection_id: String, database: String) -> Result<Vec<ForeignKeyRelation>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_foreign_keys(p, &database).await,
            DriverPool::Postgres(_) => Ok(vec![]),
        }
    }
}
