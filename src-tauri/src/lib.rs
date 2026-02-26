mod commands;
mod models;
mod services;
mod utils;

use commands::connection::{self, StorageState};
use commands::db::{self, DbEngineState};
use commands::import;
use commands::sftp::{self, SftpEngineState};
use commands::ssh::{self, SshEngineState};
use commands::table_editor;
use commands::tunnel::{self, SshTunnelEngineState};
use commands::transfer;
use services::db_engine::DbEngine;
use services::sftp_engine::SftpEngine;
use services::ssh_engine::SshEngine;
use services::ssh_tunnel::SshTunnelEngine;
use services::storage::Storage;
use services::transfer_manager::{TransferManager, TransferManagerState};
use tauri::Manager;

use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Initialize DbEngine
            let db_engine_state: DbEngineState = Arc::new(Mutex::new(DbEngine::new()));
            app.manage(db_engine_state);

            // Initialize SshEngine
            let ssh_engine_state: SshEngineState = Arc::new(Mutex::new(SshEngine::new()));
            app.manage(ssh_engine_state);

            // Initialize SftpEngine
            let sftp_engine_state: SftpEngineState = Arc::new(Mutex::new(SftpEngine::new()));
            app.manage(sftp_engine_state);

            // Initialize SshTunnelEngine
            let tunnel_engine_state: SshTunnelEngineState =
                Arc::new(Mutex::new(SshTunnelEngine::new()));
            app.manage(tunnel_engine_state);

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

            // Initialize SQLite storage (async)
            tauri::async_runtime::spawn(async move {
                match Storage::new().await {
                    Ok(storage) => {
                        let state: StorageState = Arc::new(Mutex::new(storage));
                        handle.manage(state);
                        log::info!("Storage initialized successfully");
                    }
                    Err(e) => {
                        log::error!("Failed to initialize storage: {}", e);
                    }
                }
            });
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
            // Credentials
            connection::get_credential,
            connection::save_credential,
            connection::delete_credential,
            // App
            connection::get_app_version,
            // Database engine
            db::db_connect,
            db::db_disconnect,
            db::db_is_connected,
            db::db_execute_query,
            db::db_get_databases,
            db::db_get_tables,
            db::db_get_columns,
            db::db_get_table_data,
            db::db_get_create_table,
            db::write_text_file,
            // SSH terminal
            ssh::ssh_connect,
            ssh::ssh_disconnect,
            ssh::ssh_send_data,
            ssh::ssh_resize,
            ssh::ssh_test_connection,
            ssh::ssh_test_connection_params,
            // SFTP file transfer
            sftp::sftp_connect,
            sftp::sftp_disconnect,
            sftp::sftp_list_dir,
            sftp::sftp_stat,
            sftp::sftp_mkdir,
            sftp::sftp_delete,
            sftp::sftp_rename,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::local_list_dir,
            sftp::local_mkdir,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
