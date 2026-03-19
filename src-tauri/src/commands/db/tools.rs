//! 工具命令（导出/导入/脚本/文件操作）

use tauri::{command, ipc::Channel, AppHandle, Manager};

use crate::models::import_export::{ExportRequest, ExportResult};
use crate::models::query::{ScriptOptions, SqlFileProgress, SqlImportOptions};
use crate::utils::error::AppError;
use super::DbEngineState;

// ===== SQL 导入命令 =====

#[command]
pub async fn db_pause_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>();
    if let Some(tx) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        let _ = tx.send(crate::services::db_engine::ImportCommand::Paused);
    }
    Ok(())
}

#[command]
pub async fn db_resume_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>();
    if let Some(tx) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        let _ = tx.send(crate::services::db_engine::ImportCommand::Running);
    }
    Ok(())
}

#[command]
pub async fn db_cancel_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>();
    if let Some(tx) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        let _ = tx.send(crate::services::db_engine::ImportCommand::Cancelled);
    }
    Ok(())
}

#[command]
pub async fn db_run_sql_file_stream(
    app: AppHandle,
    connection_id: String,
    import_id: String,
    file_path: String,
    options: SqlImportOptions,
    database: Option<String>,
    on_progress: Channel<SqlFileProgress>,
) -> Result<(), AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.run_sql_file_stream(connection_id, import_id, file_path, options, database, on_progress)
        .await
}

// ===== 数据导出命令 =====

/// 多格式数据导出
#[command]
pub async fn db_export_data(
    app: AppHandle,
    connection_id: String,
    request: ExportRequest,
) -> Result<ExportResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .export_data(connection_id, request, app)
        .await
}

// ===== DDL 脚本生成命令 =====

/// 生成单个数据库对象的脚本
#[command]
pub async fn db_generate_script(
    app: AppHandle,
    connection_id: String,
    database: String,
    object_name: String,
    script_type: String,
    options: ScriptOptions,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .generate_script(connection_id, database, object_name, script_type, options)
        .await
}

/// 导出整个数据库的 DDL 结构脚本
#[command]
pub async fn db_export_database_ddl(
    app: AppHandle,
    connection_id: String,
    database: String,
    options: ScriptOptions,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .export_database_ddl(connection_id, database, options)
        .await
}

// ===== 文件操作命令 =====

/// 读取文本文件内容
#[command]
pub async fn read_text_file(path: String) -> Result<String, AppError> {
    let raw = std::path::Path::new(&path);

    if !raw.is_absolute() {
        return Err(AppError::Validation("Read denied: path must be absolute".into()));
    }

    if !raw.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("File not found: {}", path),
        )));
    }

    tokio::fs::read_to_string(raw)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), AppError> {
    let raw = std::path::Path::new(&path);

    if !raw.is_absolute() {
        return Err(AppError::Validation("Write denied: path must be absolute".into()));
    }

    let parent = raw.parent()
        .ok_or_else(|| AppError::Validation("Write denied: cannot determine parent directory".into()))?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| AppError::Validation("Write denied: parent directory does not exist".into()))?;

    let file_name = raw.file_name()
        .ok_or_else(|| AppError::Validation("Write denied: invalid file name".into()))?;

    let target = canonical_parent.join(file_name);

    let allowed = if let Some(dirs) = directories::UserDirs::new() {
        let mut allowed_dirs: Vec<std::path::PathBuf> = Vec::new();

        if let Some(doc) = dirs.document_dir() {
            if let Ok(p) = doc.canonicalize() { allowed_dirs.push(p); }
        }
        if let Some(dl) = dirs.download_dir() {
            if let Ok(p) = dl.canonicalize() { allowed_dirs.push(p); }
        }
        if let Some(desktop) = dirs.desktop_dir() {
            if let Ok(p) = desktop.canonicalize() { allowed_dirs.push(p); }
        }
        if let Some(home) = dirs.home_dir().canonicalize().ok() {
            allowed_dirs.push(home);
        }

        allowed_dirs.iter().any(|d| canonical_parent.starts_with(d))
    } else {
        false
    };

    if !allowed {
        return Err(AppError::Permission("Write denied: path must be within user home directory".into()));
    }

    tokio::fs::write(&target, content.as_bytes())
        .await
        .map_err(AppError::from)
}
