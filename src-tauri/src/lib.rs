mod commands;
mod models;
mod services;
mod utils;

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
use commands::ssh::{self, SshEngineState};
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
use services::terminal_recorder::TerminalRecorder;
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
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        // .plugin(tauri_plugin_updater::Builder::new().build()) // 暂时禁用：当前 endpoint 为 HTTP，Tauri updater 要求 HTTPS，启动时会 panic
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            log::info!("App setup started");

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
                    handle.manage(state);
                    log::info!("Storage initialized successfully");

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
            db::db_execute_multi,
            db::db_execute_multi_v2,
            db::db_run_sql_file_stream,
            db::db_pause_sql_import,
            db::db_resume_sql_import,
            db::db_cancel_sql_import,
            db::db_get_databases,
            db::db_get_tables,
            db::db_get_columns,
            db::db_get_table_data,
            db::db_get_create_table,
            db::db_cancel_query,
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
            // Directory sync
            sync::sync_compare,
            // App state KV storage
            app_state::get_app_state,
            app_state::set_app_state,
            app_state::delete_app_state,
            app_state::list_app_state,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
