use crate::models::query::{SqlFileProgress, SqlImportOptions};
use crate::services::db_engine::{DbEngine, ImportCommand, get_import_states};
use crate::utils::error::AppError;
use std::sync::Arc;
use tauri::ipc::Channel;
use crate::services::sql_splitter;

/// 等待取消信号（通过 watch channel 订阅）
async fn wait_for_cancel(rx: &mut tokio::sync::watch::Receiver<ImportCommand>) {
    loop {
        if *rx.borrow() == ImportCommand::Cancelled {
            return;
        }
        if rx.changed().await.is_err() {
            // sender 已关闭，视为取消
            return;
        }
        if *rx.borrow() == ImportCommand::Cancelled {
            return;
        }
    }
}

impl DbEngine {
    pub async fn run_sql_file_stream(
        self: Arc<Self>,
        connection_id: String,
        import_id: String,
        file_path: String,
        options: SqlImportOptions,
        database: Option<String>,
        on_progress: Channel<SqlFileProgress>,
    ) -> Result<(), AppError> {
        // 读取文件内容
        if !std::path::Path::new(&file_path).exists() {
            return Err(AppError::Other(format!("File not found: {}", file_path)));
        }
        let sql = tokio::fs::read_to_string(&file_path)
            .await
            .map_err(|e| AppError::Other(format!("Failed to read file: {}", e)))?;

        // 创建导入专用 session
        let session_id = format!("import_{}", uuid::Uuid::new_v4());
        self.clone().acquire_session(connection_id.clone(), session_id.clone()).await?;

        if let Some(db) = database.clone() {
            if let Err(e) = self.clone().switch_session_database(connection_id.clone(), session_id.clone(), db).await {
                let _ = self.clone().release_session(connection_id.clone(), session_id.clone()).await;
                return Err(e);
            }
        }

        // 禁用外键检查，根据选项管理事务
        let mut initial_statements = vec!["SET FOREIGN_KEY_CHECKS=0;".to_string()];
        if options.disable_auto_commit {
            initial_statements.push("SET autocommit=0;".to_string());
            initial_statements.push("START TRANSACTION;".to_string());
        }
        let stmt = initial_statements.join("\n");
        let _ = self.clone().execute_query_on_session(connection_id.clone(), session_id.clone(), database.clone(), stmt, None).await;

        // 注册导入状态（watch channel）
        let (tx, mut rx) = tokio::sync::watch::channel(ImportCommand::Running);
        {
            let mut states = get_import_states().write().await;
            states.insert(import_id.clone(), tx);
        }

        // 分割 SQL 语句
        let statements: Vec<String> = sql_splitter::split_sql_statements(&sql).into_iter().map(|s| s.to_string()).collect();
        let total_statements = statements.len();

        let mut executed: usize = 0;
        let mut success: usize = 0;
        let mut fail: usize = 0;

        // 批量缓冲区
        let mut query_buffer: Vec<String> = Vec::new();
        let mut buffer_size: usize = 0;
        const MAX_BUFFER_SIZE: usize = 1024 * 1024; // 1MB
        const COMMIT_INTERVAL: usize = 2000;
        let mut uncommitted_count: usize = 0;

        if total_statements == 0 {
            let _ = on_progress.send(SqlFileProgress {
                total_statements: 0,
                executed: 0,
                success: 0,
                fail: 0,
                current_sql: String::new(),
                is_finished: true,
                error: None,
            });
            let _ = self.clone().release_session(connection_id.clone(), session_id.clone()).await;
            get_import_states().write().await.remove(&import_id);
            return Ok(());
        }

        let mut cancelled = false;
        // 进度推送频率控制：最多每 100ms 推送一次
        let mut last_progress_time = std::time::Instant::now();
        const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

        for (idx, stmt_str) in statements.into_iter().enumerate() {
            // ===== 检查暂停/取消状态 =====
            loop {
                let cmd = *rx.borrow();
                match cmd {
                    ImportCommand::Cancelled => {
                        if !query_buffer.is_empty() {
                            executed += query_buffer.len();
                            fail += query_buffer.len();
                            query_buffer.clear();
                        }
                        cancelled = true;
                        break;
                    }
                    ImportCommand::Paused => {
                        // 等待状态变化（暂停 → 恢复或取消）
                        let _ = rx.changed().await;
                    }
                    ImportCommand::Running => break,
                }
            }
            if cancelled { break; }

            let is_last = idx + 1 == total_statements;
            let trimmed = stmt_str.trim();
            if trimmed.is_empty() {
                executed += 1;
                success += 1;
                continue;
            }

            // 进度上报：按时间间隔节流
            let now = std::time::Instant::now();
            let should_report = idx == 0 || is_last || now.duration_since(last_progress_time) >= PROGRESS_INTERVAL;
            if should_report {
                let current_sql_chunk = trimmed.chars().take(200).collect::<String>();
                let _ = on_progress.send(SqlFileProgress {
                    total_statements,
                    executed,
                    success,
                    fail,
                    current_sql: current_sql_chunk,
                    is_finished: false,
                    error: None,
                });
                last_progress_time = now;
            }

            let mut loop_error: Option<String> = None;
            let mut executed_count_in_this_step: usize = 1;

            if options.multiple_queries {
                query_buffer.push(trimmed.to_string());
                buffer_size += trimmed.len();

                let is_ddl = trimmed.to_uppercase().starts_with("CREATE") ||
                             trimmed.to_uppercase().starts_with("DROP") ||
                             trimmed.to_uppercase().starts_with("ALTER") ||
                             crate::services::db_engine::is_select_query(trimmed);

                if buffer_size >= MAX_BUFFER_SIZE || is_last || is_ddl || query_buffer.len() >= 500 {
                    let batch_sql = query_buffer.join(";\n");
                    let batch_count = query_buffer.len();

                    let exec_future = self.clone().execute_query_on_session(
                        connection_id.clone(),
                        session_id.clone(),
                        database.clone(),
                        batch_sql,
                        None,
                    );
                    let cancel_future = wait_for_cancel(&mut rx);

                    tokio::select! {
                        result = exec_future => {
                            if *rx.borrow() == ImportCommand::Cancelled {
                                executed += batch_count;
                                fail += batch_count;
                                cancelled = true;
                                query_buffer.clear();
                                break;
                            }
                            match result {
                                Ok(r) => {
                                    if r.is_error {
                                        loop_error = r.error;
                                    }
                                }
                                Err(e) => {
                                    loop_error = Some(e.to_string());
                                }
                            }
                        }
                        _ = cancel_future => {
                            executed += batch_count;
                            fail += batch_count;
                            cancelled = true;
                            query_buffer.clear();
                            break;
                        }
                    }

                    executed_count_in_this_step = batch_count;
                    query_buffer.clear();
                    buffer_size = 0;
                } else {
                    continue;
                }
            } else {
                // 非批量模式
                let exec_future = self.clone().execute_query_on_session(
                    connection_id.clone(),
                    session_id.clone(),
                    database.clone(),
                    trimmed.to_string(),
                    None,
                );
                let cancel_future = wait_for_cancel(&mut rx);

                tokio::select! {
                    result = exec_future => {
                        if *rx.borrow() == ImportCommand::Cancelled {
                            executed += 1;
                            fail += 1;
                            cancelled = true;
                            break;
                        }
                        match result {
                            Ok(r) => {
                                if r.is_error {
                                    loop_error = r.error;
                                }
                            }
                            Err(e) => {
                                loop_error = Some(e.to_string());
                            }
                        }
                    }
                    _ = cancel_future => {
                        executed += 1;
                        fail += 1;
                        cancelled = true;
                        break;
                    }
                }
            }

            executed += executed_count_in_this_step;

            match loop_error {
                None => {
                    success += executed_count_in_this_step;
                    uncommitted_count += executed_count_in_this_step;

                    let _ = on_progress.send(SqlFileProgress {
                        total_statements,
                        executed,
                        success,
                        fail,
                        current_sql: trimmed.chars().take(200).collect(),
                        is_finished: false,
                        error: None,
                    });
                    last_progress_time = std::time::Instant::now();

                    if options.disable_auto_commit && uncommitted_count >= COMMIT_INTERVAL {
                        let _ = self.clone().execute_query_on_session(connection_id.clone(), session_id.clone(), database.clone(), "COMMIT; START TRANSACTION;".to_string(), None).await;
                        uncommitted_count = 0;
                    }
                }
                Some(e) => {
                    fail += executed_count_in_this_step;
                    let err_msg = if executed_count_in_this_step > 1 {
                        format!("{} (batch: {} statements affected)", e, executed_count_in_this_step)
                    } else {
                        e.clone()
                    };
                    let _ = on_progress.send(SqlFileProgress {
                        total_statements,
                        executed,
                        success,
                        fail,
                        current_sql: trimmed.chars().take(200).collect(),
                        is_finished: false,
                        error: Some(err_msg),
                    });

                    if !options.continue_on_error {
                        break;
                    }
                }
            }
        }

        if cancelled {
            let _ = on_progress.send(SqlFileProgress {
                total_statements,
                executed,
                success,
                fail,
                current_sql: String::from("Cancelled"),
                is_finished: true,
                error: None,
            });
            get_import_states().write().await.remove(&import_id);

            let engine = self.clone();
            let conn_id = connection_id.clone();
            let sess_id = session_id.clone();
            tokio::spawn(async move {
                let _ = engine.release_session(conn_id, sess_id).await;
            });
        } else {
            if options.disable_auto_commit {
                let _ = self.clone().execute_query_on_session(connection_id.clone(), session_id.clone(), database.clone(), "COMMIT; SET autocommit=1;".to_string(), None).await;
            }
            let _ = self.clone().execute_query_on_session(connection_id.clone(), session_id.clone(), database.clone(), "SET FOREIGN_KEY_CHECKS=1;".to_string(), None).await;
            let _ = self.clone().release_session(connection_id.clone(), session_id.clone()).await;
            get_import_states().write().await.remove(&import_id);

            let _ = on_progress.send(SqlFileProgress {
                total_statements,
                executed,
                success,
                fail,
                current_sql: String::from("Finished"),
                is_finished: true,
                error: None,
            });
        }

        Ok(())
    }
}
