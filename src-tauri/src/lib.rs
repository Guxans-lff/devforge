mod commands;
mod models;
mod services;
mod utils;

use commands::ai::{self as ai_cmd, AiEngineState};
use commands::connection::{self, StorageState};
use commands::db::{self, DbEngineState};
use commands::data_sync;
use commands::db_backup;
use commands::diagnostics;
use commands::import;
use commands::import_export;
use commands::local_shell::{self, LocalShellEngineState};
use commands::query_history;
use commands::redis::{self as redis_cmd, RedisEngineState, RedisPubSubState, RedisMonitorState};
use commands::scheduler;
use commands::schema_compare;
use commands::sftp::{self, SftpEngineState};
use commands::file_editor;
use commands::sync;
use commands::sql_snippet;
use commands::command_snippet;
use commands::app_state;
use commands::audit_log;
use commands::background_job;
use commands::ssh::{self, SshEngineState};
use commands::feature_gate;
use commands::git::{self as git_cmd, GitEngineState};
use commands::screenshot::{self as screenshot_cmd, ScreenshotEngineState};
use commands::workspace_fs::{self, FileWatcherState};
use services::file_watcher::FileWatcher;
use commands::table_editor;
use commands::terminal_recorder::{self, TerminalRecorderState};
use commands::tunnel::{self, SshTunnelEngineState};
use commands::transfer;
use commands::updater;
use services::db_engine::DbEngine;
use services::local_shell_engine::LocalShellEngine;
use services::redis_engine::RedisEngine;
use services::redis_monitor::RedisMonitorManager;
use services::redis_pubsub::RedisPubSubManager;
use services::sftp_engine::SftpEngine;
use services::ssh_engine::SshEngine;
use services::ssh_tunnel::SshTunnelEngine;
use services::git_engine::GitEngine;
use services::screenshot_engine::ScreenshotEngine;
use services::terminal_recorder::TerminalRecorder;
use services::ai::AiEngine;
use services::storage::Storage;
use services::transfer_manager::{TransferManager, TransferManagerState};
use tauri::Manager;

use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化崩溃日志收集（必须在最前面）
    services::crash_reporter::init_panic_hook();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .level_for("devforge", log::LevelFilter::Debug)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("devforge".into()) }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // .plugin(tauri_plugin_updater::Builder::new().build()) // 暂时禁用：当前 endpoint 为 HTTP，Tauri updater 要求 HTTPS，启动时会 panic
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            log::info!("App setup started");

            // Initialize AiEngine — Provider 注册表 + 中断控制
            let ai_engine_state: AiEngineState = Arc::new(AiEngine::new());
            app.manage(ai_engine_state);

            // Initialize DbEngine — 不再需要 Mutex，内部使用 RwLock
            let db_engine_state: DbEngineState = Arc::new(DbEngine::new());
            app.manage(db_engine_state);

            // Initialize RedisEngine — 内部使用 RwLock，无需外层 Mutex
            let redis_engine_state: RedisEngineState = Arc::new(RedisEngine::new());
            app.manage(redis_engine_state);

            // Initialize RedisPubSubManager
            let pubsub_state: RedisPubSubState = Arc::new(RedisPubSubManager::new());
            app.manage(pubsub_state);

            // Initialize RedisMonitorManager
            let monitor_state: RedisMonitorState = Arc::new(RedisMonitorManager::new());
            app.manage(monitor_state);

            // Initialize SshEngine — 内部使用 RwLock，无需外层 Mutex
            let ssh_engine_state: SshEngineState = Arc::new(SshEngine::new());
            app.manage(ssh_engine_state);

            // Initialize SftpEngine — 内部使用 RwLock，无需外层 Mutex
            let sftp_engine_state: SftpEngineState = Arc::new(SftpEngine::new());
            app.manage(sftp_engine_state);

            // Initialize SshTunnelEngine — 内部使用 RwLock，无需外层 Mutex
            let tunnel_engine_state: SshTunnelEngineState =
                Arc::new(SshTunnelEngine::new());
            app.manage(tunnel_engine_state);

            // Initialize TerminalRecorder — 内部使用 RwLock，无需外层 Mutex
            let recorder_state: TerminalRecorderState =
                Arc::new(TerminalRecorder::new());
            app.manage(recorder_state);

            // Initialize LocalShellEngine — 内部使用 RwLock
            let local_shell_state: LocalShellEngineState =
                Arc::new(LocalShellEngine::new());
            app.manage(local_shell_state);

            // Initialize GitEngine — 内部使用 RwLock
            let git_engine_state: GitEngineState = Arc::new(GitEngine::new());
            app.manage(git_engine_state);

            // Initialize ScreenshotEngine — 无状态引擎，管理截图文件
            let app_data_dir = app.path().app_data_dir().expect("获取 app data 目录失败");
            let screenshot_engine_state: ScreenshotEngineState =
                Arc::new(ScreenshotEngine::new(app_data_dir));
            app.manage(screenshot_engine_state);

            // Initialize FileWatcher — 文件系统监听引擎
            let file_watcher_state: FileWatcherState = Arc::new(FileWatcher::new());
            app.manage(file_watcher_state);

            // 全局快捷键注册 — 截图功能
            {
                use tauri_plugin_global_shortcut::{
                    Builder as GsBuilder, Code, Modifiers, ShortcutState,
                };
                use tauri::Emitter;

                let screenshot_state_for_gs =
                    app.state::<ScreenshotEngineState>().inner().clone();

                let gs_plugin = GsBuilder::new()
                        .with_shortcuts(["ctrl+shift+a", "ctrl+shift+n"])?
                        .with_handler(move |app, shortcut, event| {
                            println!("[GlobalShortcut] 收到快捷键事件: {:?}, state: {:?}", shortcut, event.state);
                            if event.state == ShortcutState::Pressed {
                                println!("[GlobalShortcut] Pressed 状态确认");
                                // Ctrl+Shift+A → 全屏截图 + 触发区域选择覆盖层
                                if shortcut
                                    .matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyA)
                                {
                                    println!("[GlobalShortcut] 匹配 Ctrl+Shift+A → 区域截图");
                                    let engine = screenshot_state_for_gs.clone();
                                    let handle = app.clone();
                                    std::thread::spawn(move || {
                                        // 销毁可能残留的旧截图窗口
                                        if let Some(win) = handle.get_webview_window("region-select") {
                                            let _ = win.destroy();
                                            std::thread::sleep(std::time::Duration::from_millis(100));
                                        }
                                        // 先隐藏主窗口，避免截到应用自身
                                        if let Some(win) = handle.get_webview_window("main") {
                                            let _ = win.hide();
                                        }
                                        // 等待窗口隐藏动画完成
                                        std::thread::sleep(std::time::Duration::from_millis(200));

                                        match engine.capture_fullscreen(None) {
                                            Ok(result) => {
                                                let _ = handle.emit(
                                                    "global-screenshot-region-start",
                                                    &result,
                                                );
                                            }
                                            Err(e) => {
                                                // 截图失败时恢复主窗口
                                                if let Some(win) = handle.get_webview_window("main") {
                                                    let _ = win.show();
                                                }
                                                let _ = handle.emit(
                                                    "global-screenshot-error",
                                                    e.to_string(),
                                                );
                                            }
                                        }
                                    });
                                }

                                // Ctrl+Shift+N → 新建 AI 独立窗口
                                if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyN) {
                                    println!("[GlobalShortcut] 匹配 Ctrl+Shift+N → 新建 AI 窗口");
                                    let handle = app.clone();
                                    std::thread::spawn(move || {
                                        let ai_count = handle.webview_windows().keys()
                                            .filter(|k| k.starts_with("ai-"))
                                            .count();
                                        if ai_count >= 5 {
                                            log::warn!("[AI] AI 窗口数量已达上限 5");
                                            return;
                                        }
                                        let window_id = format!("ai-{}", chrono::Utc::now().timestamp_millis());
                                        let url = format!("/ai-standalone?windowId={}", window_id);
                                        if let Err(e) = tauri::WebviewWindowBuilder::new(
                                            &handle,
                                            &window_id,
                                            tauri::WebviewUrl::App(url.into()),
                                        )
                                        .title("AI 对话")
                                        .inner_size(800.0, 700.0)
                                        .min_inner_size(480.0, 400.0)
                                        .build()
                                        {
                                            log::error!("[AI] 创建 AI 窗口失败: {e}");
                                        }
                                    });
                                }
                            }
                        })
                        .build();
                if let Err(e) = app.handle().plugin(gs_plugin) {
                    eprintln!("[GlobalShortcut] 全局快捷键注册失败（可能被其他程序占用）: {e}");
                } else {
                    println!("[GlobalShortcut] 全局快捷键注册成功: Ctrl+Shift+A, Ctrl+Shift+N");
                }
            }

            // Initialize TransferManager
            let transfer_manager = TransferManager::with_default_config();
            let transfer_manager_state: TransferManagerState =
                Arc::new(Mutex::new(transfer_manager));
            app.manage(transfer_manager_state.clone());

            // Start scheduler in async context
            let app_handle_for_scheduler = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut mgr = transfer_manager_state.lock().await;
                mgr.start_scheduler(app_handle_for_scheduler);
            });

            // Initialize SQLite storage (同步初始化，确保 setup 完成时 Storage 已就绪)
            // Storage 内部使用 SqlitePool（线程安全），无需外层 Mutex
            log::info!("Storage initialization started");
            match tauri::async_runtime::block_on(Storage::new()) {
                Ok(storage) => {
                    let state: StorageState = Arc::new(storage);
                    handle.manage(state.clone());
                    log::info!("Storage initialized successfully");

                    // 初始化 AI 相关表
                    let ai_init_state = state.clone();
                    tauri::async_runtime::block_on(async {
                        let pool = ai_init_state.get_pool().await;
                        if let Err(e) = services::ai::session_store::init_tables(&pool).await {
                            log::error!("AI 表初始化失败: {}", e);
                        } else {
                            log::info!("AI tables initialized");
                        }
                        if let Err(e) = services::background_job::init_table(&pool).await {
                            log::error!("background_jobs 表初始化失败: {}", e);
                        } else {
                            log::info!("Background job table initialized");
                        }
                    });

                    // 启动定时调度器（需在 Tokio 运行时上下文中 spawn）
                    let scheduler_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        services::scheduler::start(scheduler_handle);
                    });
                    log::info!("Scheduler started successfully");
                }
                Err(e) => {
                    log::error!("Failed to initialize storage: {}", e);
                }
            }

            log::info!("App setup completed");

            // 启动 AI 工具结果落盘目录的 GC：只清理 DB 中已不存在的孤儿会话目录
            if let Ok(data_dir) = app.path().app_data_dir() {
                let storage_state = app.state::<StorageState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    let pool = storage_state.get_pool().await;
                    let live_ids: std::collections::HashSet<String> =
                        match services::ai::session_store::list_session_ids(&pool).await {
                            Ok(ids) => ids.into_iter().collect(),
                            Err(e) => {
                                log::warn!("读取会话列表失败，跳过工具结果 GC: {}", e);
                                return;
                            }
                        };
                    match services::ai::tool_result_store::gc_orphan_results(
                        &data_dir, &live_ids,
                    )
                    .await
                    {
                        Ok(n) if n > 0 => {
                            log::info!("AI 工具结果 GC 清理了 {} 个孤儿会话目录", n)
                        }
                        Ok(_) => {}
                        Err(e) => log::warn!("AI 工具结果 GC 失败: {}", e),
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection CRUD
            connection::create_connection,
            connection::update_connection,
            connection::delete_connection,
            connection::list_connections,
            connection::get_connection_by_id,
            connection::reorder_connections,
            connection::test_connection,
            connection::test_connection_params,
            // Groups
            connection::list_groups,
            connection::create_group,
            connection::delete_group,
            connection::update_group,
            connection::move_connection,
            connection::toggle_favorite,
            // Credentials
            connection::get_credential,
            connection::save_credential,
            connection::delete_credential,
            // App
            connection::get_app_version,
            connection::show_main_window,
            connection::update_boot_config,
            connection::reload_storage,
            connection::get_suggested_data_path,
            // Database engine
            db::db_connect,
            db::db_disconnect,
            db::db_is_connected,
            db::db_execute_query,
            db::db_execute_query_stream,
            db::db_execute_query_in_database,
            db::db_execute_query_stream_in_database,
            db::db_execute_query_in_databases,
            db::db_execute_multi,
            db::db_execute_multi_v2,
            db::db_execute_multi_v2_on_session,
            db::db_run_sql_file_stream,
            db::db_pause_sql_import,
            db::db_resume_sql_import,
            db::db_cancel_sql_import,
            db::db_get_databases,
            db::db_get_tables,
            db::db_get_tables_light,
            db::db_get_columns,
            db::db_get_table_data,
            db::db_get_create_table,
            db::db_cancel_query,
            db::db_cancel_query_on_session,
            db::db_get_views,
            db::db_get_procedures,
            db::db_get_functions,
            db::db_get_triggers,
            db::db_get_object_definition,
            db::db_get_routine_parameters,
            db::db_get_pool_status,
            db::db_check_and_reconnect,
            db::db_begin_transaction,
            db::db_commit,
            db::db_rollback,
            db::db_explain,
            db::db_get_server_status,
            db::db_get_process_list,
            db::db_kill_process,
            db::db_get_server_variables,
            db::db_get_users,
            db::db_create_user,
            db::db_drop_user,
            db::db_get_user_grants,
            db::db_apply_grants,
            db::db_analyze_indexes,
            db::db_suggest_indexes_for_query,
            db::db_get_slow_query_digest,
            db::db_get_innodb_status,
            db::db_export_data,
            db::db_generate_script,
            db::db_export_database_ddl,
            db::db_get_foreign_keys,
            db::db_get_all_columns,
            db::db_get_schema_bundle,
            db::write_text_file,
            db::read_text_file,
            // Session 连接管理（企业级模式）
            db::db_acquire_session,
            db::db_release_session,
            db::db_switch_database,
            db::db_execute_query_on_session,
            db::db_execute_query_stream_on_session,
            // SSH terminal
            ssh::ssh_connect,
            ssh::ssh_disconnect,
            ssh::ssh_send_data,
            ssh::ssh_resize,
            ssh::ssh_flow_ack,
            ssh::ssh_get_cwd,
            ssh::ssh_exec_command,
            ssh::ssh_collect_metrics,
            ssh::ssh_test_connection,
            ssh::ssh_test_connection_params,
            // SFTP file transfer
            sftp::sftp_connect,
            sftp::sftp_disconnect,
            sftp::sftp_list_dir,
            sftp::sftp_stat,
            sftp::sftp_mkdir,
            sftp::sftp_touch,
            sftp::sftp_delete,
            sftp::sftp_rename,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::local_list_dir,
            sftp::local_mkdir,
            sftp::local_touch,
            sftp::local_delete,
            sftp::local_rename,
            sftp::local_list_recursive,
            sftp::sftp_list_recursive,
            sftp::get_available_drives,
            // Chunked file transfer
            transfer::start_upload_chunked,
            transfer::start_download_chunked,
            transfer::pause_transfer,
            transfer::resume_transfer,
            transfer::cancel_transfer,
            // Batch transfer queue
            transfer::enqueue_batch_upload,
            transfer::enqueue_batch_download,
            transfer::get_queue_status,
            transfer::upload_folder_recursive,
            transfer::download_folder_recursive,
            // SSH tunnels
            tunnel::tunnel_open,
            tunnel::tunnel_close,
            tunnel::tunnel_list,
            // Data import
            import::import_preview,
            import::import_data,
            // Table structure editor
            table_editor::generate_create_table_sql,
            table_editor::generate_alter_table_sql,
            table_editor::execute_ddl,
            table_editor::get_table_detail,
            table_editor::get_table_ddl,
            // Query history
            query_history::save_query_history,
            query_history::list_query_history,
            query_history::delete_query_history,
            query_history::clear_query_history,
            // SQL snippets
            sql_snippet::list_sql_snippets,
            sql_snippet::create_sql_snippet,
            sql_snippet::update_sql_snippet,
            sql_snippet::delete_sql_snippet,
            // Command snippets
            command_snippet::list_command_snippets,
            command_snippet::create_command_snippet,
            command_snippet::update_command_snippet,
            command_snippet::delete_command_snippet,
            // Schema compare
            schema_compare::schema_compare,
            schema_compare::generate_migration_sql,
            // Database backup/restore
            db_backup::db_backup_database,
            db_backup::db_restore_database,
            // Terminal recording
            terminal_recorder::start_recording,
            terminal_recorder::stop_recording,
            terminal_recorder::is_recording,
            terminal_recorder::list_recordings,
            terminal_recorder::read_recording,
            terminal_recorder::export_recording,
            // File editor & permissions & search
            file_editor::sftp_read_file_content,
            file_editor::sftp_write_file_content,
            file_editor::sftp_chmod,
            file_editor::sftp_search_files,
            file_editor::sftp_cancel_search,
            file_editor::local_read_file_content,
            file_editor::local_read_file_binary,
            // Directory sync
            sync::sync_compare,
            // App state KV storage
            app_state::get_app_state,
            app_state::set_app_state,
            app_state::delete_app_state,
            app_state::list_app_state,
            background_job::submit_background_job,
            background_job::update_background_job,
            background_job::get_background_job,
            background_job::list_background_jobs,
            background_job::delete_background_job,
            background_job::cleanup_background_jobs,
            feature_gate::read_feature_gates,
            feature_gate::write_feature_gate,
            feature_gate::delete_feature_gate,
            // 审计日志
            audit_log::query_audit_logs,
            audit_log::get_audit_stats,
            audit_log::cleanup_audit_logs,
            // Import/Export
            import_export::export_connections,
            import_export::preview_import,
            import_export::import_connections,
            import_export::import_navicat_xml,
            import_export::import_termius_json,
            // Local shell
            local_shell::local_shell_spawn,
            local_shell::local_shell_write,
            local_shell::local_shell_resize,
            local_shell::local_shell_close,
            // Diagnostics
            diagnostics::list_crash_logs,
            diagnostics::read_crash_log,
            diagnostics::clear_crash_logs,
            diagnostics::write_error_log,
            // Data sync
            data_sync::sync_data_preview,
            data_sync::sync_data_execute,
            // Scheduler
            scheduler::list_scheduled_tasks,
            scheduler::create_scheduled_task,
            scheduler::update_scheduled_task,
            scheduler::delete_scheduled_task,
            scheduler::toggle_scheduled_task,
            scheduler::list_task_executions,
            scheduler::run_task_now,
            // HTTP 简化更新
            updater::download_update,
            updater::launch_installer,
            updater::reveal_in_folder,
            // Redis
            redis_cmd::redis_connect,
            redis_cmd::redis_disconnect,
            redis_cmd::redis_test_connection,
            redis_cmd::redis_is_connected,
            redis_cmd::redis_ping,
            redis_cmd::redis_select_db,
            redis_cmd::redis_dbsize,
            redis_cmd::redis_current_db,
            redis_cmd::redis_scan_keys,
            redis_cmd::redis_get_key_info,
            redis_cmd::redis_get_value,
            redis_cmd::redis_set_string,
            redis_cmd::redis_delete_keys,
            redis_cmd::redis_rename_key,
            redis_cmd::redis_set_ttl,
            redis_cmd::redis_remove_ttl,
            redis_cmd::redis_hash_get_all,
            redis_cmd::redis_hash_set,
            redis_cmd::redis_hash_del,
            redis_cmd::redis_list_range,
            redis_cmd::redis_list_push,
            redis_cmd::redis_list_set,
            redis_cmd::redis_list_rem,
            redis_cmd::redis_set_members,
            redis_cmd::redis_set_add,
            redis_cmd::redis_set_rem,
            redis_cmd::redis_zset_range,
            redis_cmd::redis_zset_add,
            redis_cmd::redis_zset_rem,
            redis_cmd::redis_get_info,
            redis_cmd::redis_execute_command,
            redis_cmd::redis_pubsub_subscribe,
            redis_cmd::redis_pubsub_add,
            redis_cmd::redis_pubsub_unsubscribe,
            redis_cmd::redis_pubsub_stop,
            redis_cmd::redis_pubsub_get_subscriptions,
            redis_cmd::redis_publish,
            // Slowlog
            redis_cmd::redis_slowlog_get,
            redis_cmd::redis_slowlog_len,
            redis_cmd::redis_slowlog_reset,
            redis_cmd::redis_slowlog_config,
            redis_cmd::redis_set_slowlog_threshold,
            redis_cmd::redis_set_slowlog_max_len,
            // Stream
            redis_cmd::redis_stream_range,
            redis_cmd::redis_stream_add,
            redis_cmd::redis_stream_del,
            redis_cmd::redis_stream_len,
            // Cluster
            redis_cmd::redis_connect_cluster,
            redis_cmd::redis_test_cluster_connection,
            redis_cmd::redis_is_cluster,
            redis_cmd::redis_cluster_info,
            redis_cmd::redis_cluster_nodes,
            // Sentinel
            redis_cmd::redis_connect_sentinel,
            redis_cmd::redis_test_sentinel_connection,
            // Memory Analysis
            redis_cmd::redis_memory_stats,
            redis_cmd::redis_memory_doctor,
            redis_cmd::redis_memory_usage,
            redis_cmd::redis_top_keys_by_memory,
            // Batch Operations
            redis_cmd::redis_batch_delete,
            redis_cmd::redis_batch_set_ttl,
            redis_cmd::redis_batch_export,
            redis_cmd::redis_batch_import,
            // Client List
            redis_cmd::redis_client_list,
            redis_cmd::redis_client_kill,
            // Monitor
            redis_cmd::redis_monitor_start,
            redis_cmd::redis_monitor_stop,
            // Lua Script
            redis_cmd::redis_eval_lua,
            redis_cmd::redis_script_load,
            redis_cmd::redis_script_exists,
            redis_cmd::redis_script_flush,
            // Git
            git_cmd::git_open,
            git_cmd::git_close,
            git_cmd::git_is_open,
            git_cmd::git_validate_repo,
            git_cmd::git_get_status,
            git_cmd::git_current_branch,
            git_cmd::git_get_commits,
            git_cmd::git_get_commit_detail,
            git_cmd::git_stage_file,
            git_cmd::git_unstage_file,
            git_cmd::git_stage_all,
            git_cmd::git_unstage_all,
            git_cmd::git_commit,
            git_cmd::git_get_diff_working,
            git_cmd::git_get_diff_staged,
            git_cmd::git_get_diff_commit,
            git_cmd::git_get_branches,
            git_cmd::git_create_branch,
            git_cmd::git_delete_branch,
            git_cmd::git_checkout_branch,
            git_cmd::git_get_stashes,
            git_cmd::git_create_stash,
            git_cmd::git_apply_stash,
            git_cmd::git_drop_stash,
            git_cmd::git_get_graph,
            // Git — Remote 操作
            git_cmd::git_get_remotes,
            git_cmd::git_push,
            git_cmd::git_pull,
            git_cmd::git_fetch,
            // Git — Merge & Rebase
            git_cmd::git_merge_branch,
            git_cmd::git_abort_merge,
            git_cmd::git_rebase_branch,
            git_cmd::git_abort_rebase,
            // Git — Tag
            git_cmd::git_get_tags,
            git_cmd::git_create_tag,
            git_cmd::git_delete_tag,
            // Git — 文件操作
            git_cmd::git_discard_file,
            git_cmd::git_discard_all,
            git_cmd::git_get_file_content,
            // Git — Config / Amend / Pop Stash
            git_cmd::git_get_config,
            git_cmd::git_amend_commit,
            git_cmd::git_pop_stash,
            // Git — Cherry-pick / Search / Blame / File History
            git_cmd::git_cherry_pick,
            git_cmd::git_search_commits,
            git_cmd::git_blame_file,
            git_cmd::git_file_history,
            git_cmd::git_get_contributors,
            git_cmd::git_interactive_rebase_plan,
            git_cmd::git_interactive_rebase_execute,
            git_cmd::git_interactive_rebase_abort,
            // Screenshot
            screenshot_cmd::screenshot_list_monitors,
            screenshot_cmd::screenshot_list_windows,
            screenshot_cmd::screenshot_capture_fullscreen,
            screenshot_cmd::screenshot_capture_region,
            screenshot_cmd::screenshot_crop_region,
            screenshot_cmd::screenshot_capture_window,
            screenshot_cmd::screenshot_save_to_file,
            screenshot_cmd::screenshot_save_annotated,
            screenshot_cmd::screenshot_copy_to_clipboard,
            screenshot_cmd::screenshot_copy_annotated_to_clipboard,
            screenshot_cmd::screenshot_list_history,
            screenshot_cmd::screenshot_delete,
            screenshot_cmd::screenshot_cleanup,
            screenshot_cmd::screenshot_translate,
            // AI
            ai_cmd::ai_chat_stream,
            ai_cmd::ai_abort_stream,
            ai_cmd::ai_create_completion,
            ai_cmd::ai_list_providers,
            ai_cmd::ai_list_provider_models,
            ai_cmd::ai_save_provider,
            ai_cmd::ai_delete_provider,
            ai_cmd::ai_save_session,
            ai_cmd::ai_list_sessions,
            ai_cmd::ai_get_session,
            ai_cmd::ai_delete_session,
            ai_cmd::ai_save_message,
            ai_cmd::ai_append_transcript_event,
            ai_cmd::ai_list_transcript_events,
            ai_cmd::ai_count_transcript_events,
            ai_cmd::ai_get_usage_stats,
            ai_cmd::ai_get_tools,
            ai_cmd::ai_execute_tool,
            ai_cmd::ai_enforce_tool_result_budget,
            ai_cmd::ai_read_tool_result_file,
            ai_cmd::ai_revert_write_file,
            ai_cmd::ai_list_memories,
            ai_cmd::ai_save_memory,
            ai_cmd::ai_delete_memory,
            ai_cmd::ai_search_memories,
            ai_cmd::ai_save_compaction,
            ai_cmd::ai_list_compactions,
            ai_cmd::create_ai_window,
            ai_cmd::ai_read_workspace_config,
            ai_cmd::ai_write_workspace_config,
            ai_cmd::ai_read_context_file,
            ai_cmd::ai_update_journal_section,
            // Workspace filesystem
            workspace_fs::ws_read_directory,
            workspace_fs::ws_read_directory_recursive,
            workspace_fs::ws_create_file,
            workspace_fs::ws_create_directory,
            workspace_fs::ws_rename_entry,
            workspace_fs::ws_delete_entry,
            workspace_fs::ws_move_entry,
            workspace_fs::ws_watch_directory,
            workspace_fs::ws_unwatch_directory,
            workspace_fs::ws_get_git_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
