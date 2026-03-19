//! 数据库命令模块 — 按功能域拆分
//!
//! - connection: 连接管理（connect/disconnect/reconnect/session）
//! - query: 查询执行（execute/stream/multi/cancel）
//! - metadata: 元数据读取（databases/tables/columns/views/routines/triggers）
//! - admin: 管理操作（server_status/processes/kill/variables/users/grants）
//! - tools: 工具类（export/import/script/file）

mod query;
mod metadata;
mod admin;
mod tools;

use std::sync::Arc;
use crate::services::db_engine::DbEngine;

pub type DbEngineState = Arc<DbEngine>;

// ===== 连接管理命令 =====

use tauri::{command, AppHandle, Manager};
use crate::commands::connection::StorageState;
use crate::models::connection::{PoolConfig, PoolStatus, ReconnectParams, ReconnectResult, SslConfig};
use crate::models::query::ConnectResult;
use crate::services::credential::CredentialManager;
use crate::utils::error::AppError;

#[command]
pub async fn db_connect(
    app: AppHandle,
    connection_id: String,
) -> Result<ConnectResult, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let engine = app.state::<DbEngineState>().inner().clone();

    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => {
            log::info!("db_connect: credential found for '{}' (id={})",
                conn.name, connection_id);
            pw
        }
        Ok(None) => {
            log::warn!("db_connect: no credential found for '{}' (id={})", conn.name, connection_id);
            return Err(AppError::Credential(format!(
                "No password found for connection '{}'. Please edit the connection and re-enter the password.",
                conn.name
            )));
        }
        Err(e) => {
            log::error!("db_connect: credential read error for '{}': {}", conn.name, e);
            return Err(AppError::Credential(format!("Failed to read credential: {}", e)));
        }
    };

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json)?;

    let driver = config
        .get("driver")
        .and_then(|v| v.as_str())
        .unwrap_or("mysql");

    let database = config
        .get("database")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let db_opt = if database.is_empty() {
        None
    } else {
        Some(database)
    };

    // 从配置中解析 SSL 配置
    let ssl_config: Option<SslConfig> = config.get("ssl")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    // 从配置中解析连接池配置
    let pool_config: Option<PoolConfig> = config.get("pool")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    // 校验连接池参数
    if let Some(ref pc) = pool_config {
        pc.validate().map_err(|e| AppError::Validation(e))?;
    }

    engine.clone().connect(
        connection_id.clone(),
        driver.to_string(),
        conn.host.clone(),
        conn.port,
        conn.username.clone(),
        password.clone(),
        db_opt.map(|s| s.to_string()),
        ssl_config,
        pool_config,
    )
    .await
    .map_err(|e| {
        let err_str = e.to_string();
        let detail = format!("[driver={}, user={}, host={}:{}]",
            driver, conn.username, conn.host, conn.port);
        if err_str.contains("Access denied") || err_str.contains("password authentication failed") {
            AppError::Connection(format!("{}\n\nThe stored password may be incorrect. Please edit this connection, re-enter the password, and save.\n{}", err_str, detail))
        } else {
            AppError::Connection(format!("{}  {}", err_str, detail))
        }
    })?;

    // 连接成功后立即预加载数据库列表，减少一次前端 IPC 往返
    let databases = match engine.get_databases(connection_id.clone()).await {
        Ok(dbs) => dbs,
        Err(e) => {
            log::warn!("db_connect: 预加载数据库列表失败: {}", e);
            vec![] // 预加载失败不影响连接结果，前端可回退到手动加载
        }
    };

    Ok(ConnectResult {
        success: true,
        databases,
    })
}

#[command]
pub async fn db_disconnect(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.disconnect(connection_id).await;
    Ok(true)
}

#[command]
pub async fn db_is_connected(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    Ok(engine.is_connected(connection_id).await)
}

/// 获取连接池状态（活跃/空闲连接数）
#[command]
pub async fn db_get_pool_status(
    app: AppHandle,
    connection_id: String,
) -> Result<PoolStatus, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_pool_status(connection_id).await
}

/// 检查连接状态并在断开时自动重连
#[command]
pub async fn db_check_and_reconnect(
    app: AppHandle,
    connection_id: String,
    reconnect_params: ReconnectParams,
) -> Result<ReconnectResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().check_and_reconnect(connection_id, reconnect_params).await
}

// ===== Session 连接管理 =====

/// 为指定查询 Tab 获取专用 Session 连接
#[command]
pub async fn db_acquire_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .acquire_session(connection_id, tab_id)
        .await?;
    Ok(true)
}

/// 释放指定查询 Tab 的 Session 连接
#[command]
pub async fn db_release_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .release_session(connection_id, tab_id)
        .await;
    Ok(true)
}

/// 在 Session 连接上切换数据库
#[command]
pub async fn db_switch_database(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
    database: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .switch_session_database(connection_id, tab_id, database)
        .await?;
    Ok(true)
}

// 从子模块重新导出所有公开命令
pub use query::*;
pub use metadata::*;
pub use admin::*;
pub use tools::*;
