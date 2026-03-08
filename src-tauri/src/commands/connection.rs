use chrono::Utc;
use tauri::{command, State};
use uuid::Uuid;

use crate::models::connection::{
    Connection, ConnectionGroup, CreateConnectionRequest, PoolConfig, SslConfig, UpdateConnectionRequest,
};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;
use crate::services::storage::Storage;

use std::sync::Arc;

/// Storage 内部使用 SqlitePool（本身线程安全且支持并发），无需外层 Mutex
pub type StorageState = Arc<Storage>;

// --- Connection CRUD ---

#[command]
pub async fn create_connection(
    storage: State<'_, StorageState>,
    req: CreateConnectionRequest,
) -> Result<Connection, String> {
    let now = Utc::now().timestamp_millis();
    let id = Uuid::new_v4().to_string();

    let conn = Connection {
        id: id.clone(),
        name: req.name,
        connection_type: req.connection_type,
        group_id: req.group_id,
        host: req.host,
        port: req.port,
        username: req.username,
        config_json: req.config_json,
        color: req.color,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };

    storage.create_connection(&conn).await.map_err(|e| e.to_string())?;

    if let Some(password) = req.password {
        if !password.is_empty() {
            CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
            // Verify credential was stored correctly
            let stored = CredentialManager::get(&id).map_err(|e| e.to_string())?;
            if stored.as_deref() != Some(password.as_str()) {
                log::warn!("Credential verification failed for new connection {}: stored_len={:?}, expected_len={}",
                    id, stored.as_ref().map(|s| s.len()), password.len());
            } else {
                log::info!("Credential saved and verified for connection {} (len={})", id, password.len());
            }
        }
    }

    Ok(conn)
}

#[command]
pub async fn update_connection(
    storage: State<'_, StorageState>,
    id: String,
    req: UpdateConnectionRequest,
) -> Result<Connection, String> {
    let mut conn = storage.get_connection(&id).await.map_err(|e| e.to_string())?;

    if let Some(name) = req.name {
        conn.name = name;
    }
    if let Some(group_id) = req.group_id {
        conn.group_id = Some(group_id);
    }
    if let Some(host) = req.host {
        conn.host = host;
    }
    if let Some(port) = req.port {
        conn.port = port;
    }
    if let Some(username) = req.username {
        conn.username = username;
    }
    if let Some(config_json) = req.config_json {
        conn.config_json = config_json;
    }
    if let Some(color) = req.color {
        conn.color = Some(color);
    }

    conn.updated_at = Utc::now().timestamp_millis();
    storage.update_connection(&conn).await.map_err(|e| e.to_string())?;

    if let Some(password) = req.password {
        if password.is_empty() {
            let _ = CredentialManager::delete(&id);
        } else {
            CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
            // Verify credential was stored correctly
            let stored = CredentialManager::get(&id).map_err(|e| e.to_string())?;
            if stored.as_deref() != Some(password.as_str()) {
                log::warn!("Credential verification failed for connection {}: stored_len={:?}, expected_len={}",
                    id, stored.as_ref().map(|s| s.len()), password.len());
            } else {
                log::info!("Credential updated and verified for connection {} (len={})", id, password.len());
            }
        }
    }

    Ok(conn)
}

#[command]
pub async fn delete_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<bool, String> {
    storage.delete_connection(&id).await.map_err(|e| e.to_string())?;
    let _ = CredentialManager::delete(&id);
    Ok(true)
}

#[command]
pub async fn list_connections(
    storage: State<'_, StorageState>,
) -> Result<Vec<Connection>, String> {
    storage.list_connections().await.map_err(|e| e.to_string())
}

#[command]
pub async fn get_connection_by_id(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<Connection, String> {
    storage.get_connection(&id).await.map_err(|e| e.to_string())
}

#[command]
pub async fn reorder_connections(
    storage: State<'_, StorageState>,
    ids: Vec<String>,
) -> Result<bool, String> {
    storage.reorder_connections(&ids).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn test_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<TestResult, String> {
    let conn = storage.get_connection(&id).await.map_err(|e| e.to_string())?;

    let password = CredentialManager::get(&id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json).unwrap_or_default();
    let driver = config.get("driver").and_then(|v| v.as_str()).unwrap_or("mysql");
    let database = config.get("database").and_then(|v| v.as_str()).unwrap_or("");
    let db_opt = if database.is_empty() { None } else { Some(database) };

    // 从配置中解析 SSL 配置
    let ssl_config: Option<SslConfig> = config.get("ssl")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    // 从配置中解析连接池配置
    let pool_config: Option<PoolConfig> = config.get("pool")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    match DbEngine::test_connect(driver, &conn.host, conn.port, &conn.username, &password, db_opt, ssl_config.as_ref(), pool_config.as_ref()).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}

#[command]
pub async fn test_connection_params(
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    driver: Option<String>,
    ssl_config: Option<SslConfig>,
    pool_config: Option<PoolConfig>,
) -> Result<TestResult, String> {
    let drv = driver.as_deref().unwrap_or("mysql");
    let db_opt = database.as_deref().filter(|d| !d.is_empty());

    match DbEngine::test_connect(drv, &host, port, &username, &password, db_opt, ssl_config.as_ref(), pool_config.as_ref()).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}

// --- Groups ---

#[command]
pub async fn list_groups(
    storage: State<'_, StorageState>,
) -> Result<Vec<ConnectionGroup>, String> {
    storage.list_groups().await.map_err(|e| e.to_string())
}

#[command]
pub async fn create_group(
    storage: State<'_, StorageState>,
    name: String,
) -> Result<ConnectionGroup, String> {
    let group = ConnectionGroup {
        id: Uuid::new_v4().to_string(),
        name,
        sort_order: 0,
        parent_id: None,
    };

    storage.create_group(&group).await.map_err(|e| e.to_string())?;
    Ok(group)
}

#[command]
pub async fn delete_group(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<bool, String> {
    storage.delete_group(&id).await.map_err(|e| e.to_string())?;
    Ok(true)
}

/// 更新分组：支持重命名和移动分组到新的父级
/// - group_id: 要更新的分组 ID
/// - name: 新的分组名称
/// - parent_id: 新的父级分组 ID（None 表示移到根级，Some("") 也视为根级）
/// 移动分组时会校验：不能移动到自身或其后代下，且嵌套深度不能超过 3 级
#[command]
pub async fn update_group(
    storage: State<'_, StorageState>,
    group_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    // 获取当前分组
    let mut group = storage.get_group(&group_id).await.map_err(|e| e.to_string())?;

    // 规范化 parent_id：空字符串视为 None（根级）
    let new_parent_id = parent_id.filter(|p| !p.is_empty());

    // 如果要移动到新的父级分组，需要进行校验
    if new_parent_id != group.parent_id {
        if let Some(ref target_parent_id) = new_parent_id {
            // 不能移动到自身
            if target_parent_id == &group_id {
                return Err("不能将分组移动到自身下".to_string());
            }

            // 不能移动到自己的后代分组下（防止循环引用）
            let is_descendant = storage
                .is_descendant_of(&group_id, target_parent_id)
                .await
                .map_err(|e| e.to_string())?;
            if is_descendant {
                return Err("不能将分组移动到其子分组下".to_string());
            }

            // 校验嵌套深度：目标父级深度 + 当前分组子树深度 + 1（当前分组自身）不能超过 3
            let parent_depth = storage
                .get_group_depth(target_parent_id)
                .await
                .map_err(|e| e.to_string())?;
            let children_depth = storage
                .get_max_children_depth(&group_id)
                .await
                .map_err(|e| e.to_string())?;
            let total_depth = parent_depth + 1 + children_depth;

            if total_depth > 3 {
                return Err(format!(
                    "分组嵌套深度不能超过 3 级（当前操作将导致 {} 级嵌套）",
                    total_depth
                ));
            }
        }
    }

    // 更新分组信息
    group.name = name;
    group.parent_id = new_parent_id;

    storage.update_group(&group).await.map_err(|e| e.to_string())?;
    Ok(group)
}

/// 移动连接到指定分组
/// - connection_id: 要移动的连接 ID
/// - target_group_id: 目标分组 ID（None 或空字符串表示移到根级）
#[command]
pub async fn move_connection(
    storage: State<'_, StorageState>,
    connection_id: String,
    target_group_id: Option<String>,
) -> Result<bool, String> {
    // 规范化：空字符串视为 None（根级）
    let group_id = target_group_id.filter(|g| !g.is_empty());

    // 如果指定了目标分组，验证分组是否存在
    if let Some(ref gid) = group_id {
        storage.get_group(gid).await.map_err(|e| e.to_string())?;
    }

    storage
        .move_connection_to_group(&connection_id, group_id.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    Ok(true)
}

/// 切换连接的收藏状态
/// 在连接的 config_json 中切换 isFavorite 字段
/// - connection_id: 要切换收藏状态的连接 ID
/// 返回切换后的收藏状态（true=已收藏，false=未收藏）
#[command]
pub async fn toggle_favorite(
    storage: State<'_, StorageState>,
    connection_id: String,
) -> Result<bool, String> {
    // 获取当前连接
    let mut conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    // 解析 config_json
    let mut config: serde_json::Value =
        serde_json::from_str(&conn.config_json).unwrap_or_default();

    // 切换 isFavorite 字段
    let current_favorite = config
        .get("isFavorite")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let new_favorite = !current_favorite;

    config["isFavorite"] = serde_json::Value::Bool(new_favorite);

    // 更新 config_json 和时间戳
    conn.config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    conn.updated_at = Utc::now().timestamp_millis();

    storage
        .update_connection(&conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(new_favorite)
}

// --- Credential ---

#[command]
pub async fn get_credential(id: String) -> Result<Option<String>, String> {
    CredentialManager::get(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn save_credential(id: String, password: String) -> Result<bool, String> {
    CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn delete_credential(id: String) -> Result<bool, String> {
    CredentialManager::delete(&id).map_err(|e| e.to_string())?;
    Ok(true)
}

// --- App ---

#[command]
pub async fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// --- Types ---

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}
