#![allow(dead_code)]

use crate::models::connection::{Connection, ConnectionGroup};
use crate::models::import_export::*;
use crate::services::credential::CredentialManager;
use crate::services::storage::Storage;
use anyhow::{Context, Result};
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

const EXPORT_VERSION: i32 = 1;

/// 连接导入导出服务
pub struct ImportExportService<'a> {
    storage: &'a Storage,
}

impl<'a> ImportExportService<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 导出连接（包含密码）
    pub async fn export_connections(
        &self,
        connection_ids: Option<Vec<String>>,
    ) -> Result<ConnectionExport> {
        let all_connections = self.storage.list_connections().await?;
        let all_groups = self.storage.list_groups().await?;

        // 过滤连接
        let connections_to_export: Vec<Connection> = if let Some(ids) = connection_ids {
            all_connections
                .into_iter()
                .filter(|c| ids.contains(&c.id))
                .collect()
        } else {
            all_connections
        };

        // 构建分组名称映射
        let group_map: HashMap<String, String> = all_groups
            .iter()
            .map(|g| (g.id.clone(), g.name.clone()))
            .collect();

        // 转换连接（包含从凭据管理器读取密码）
        let mut export_items = Vec::new();
        for conn in connections_to_export {
            let config: HashMap<String, serde_json::Value> =
                serde_json::from_str(&conn.config_json).unwrap_or_default();

            let group_name = conn.group_id.and_then(|gid| group_map.get(&gid).cloned());

            // 从 Windows Credential Manager 读取密码
            let password = match CredentialManager::get(&conn.id) {
                Ok(pwd) => pwd,
                Err(e) => {
                    log::warn!("Failed to read credential for '{}': {}", conn.name, e);
                    None
                }
            };

            export_items.push(ConnectionExportItem {
                name: conn.name,
                conn_type: conn.connection_type,
                group_name,
                host: conn.host,
                port: conn.port as i32,
                username: conn.username,
                password,
                config,
                color: conn.color,
            });
        }

        // 转换分组
        let mut export_groups = Vec::new();
        for group in all_groups {
            let parent_name = group
                .parent_id
                .and_then(|pid| group_map.get(&pid).cloned());

            export_groups.push(ConnectionGroupExport {
                name: group.name,
                parent_name,
            });
        }

        Ok(ConnectionExport {
            version: EXPORT_VERSION,
            exported_at: Utc::now().timestamp(),
            connections: export_items,
            groups: export_groups,
        })
    }

    /// 预览导入
    pub async fn preview_import(&self, data: ConnectionExport) -> Result<ImportPreview> {
        // 验证版本
        if data.version != EXPORT_VERSION {
            anyhow::bail!("Unsupported export version: {}", data.version);
        }

        let existing_connections = self.storage.list_connections().await?;
        let existing_names: Vec<String> = existing_connections.iter().map(|c| c.name.clone()).collect();

        // 检测冲突
        let conflicts: Vec<String> = data
            .connections
            .iter()
            .filter(|c| existing_names.contains(&c.name))
            .map(|c| c.name.clone())
            .collect();

        Ok(ImportPreview {
            connections: data.connections,
            groups: data.groups,
            conflicts,
        })
    }

    /// 导入连接
    pub async fn import_connections(
        &self,
        data: ConnectionExport,
        options: ImportOptions,
    ) -> Result<ImportResult> {
        // 验证版本
        if data.version != EXPORT_VERSION {
            anyhow::bail!("Unsupported export version: {}", data.version);
        }

        let mut result = ImportResult {
            success: true,
            imported: 0,
            skipped: 0,
            failed: 0,
            errors: Vec::new(),
        };

        // 先导入分组
        let mut group_map: HashMap<String, String> = HashMap::new();
        for group_export in &data.groups {
            match self.import_group(group_export, &group_map).await {
                Ok(group_id) => {
                    group_map.insert(group_export.name.clone(), group_id);
                }
                Err(e) => {
                    result.errors.push(format!("Failed to import group '{}': {}", group_export.name, e));
                }
            }
        }

        // 导入连接
        let existing_connections = self.storage.list_connections().await?;
        let existing_names: HashMap<String, String> = existing_connections
            .iter()
            .map(|c| (c.name.clone(), c.id.clone()))
            .collect();

        for conn_export in &data.connections {
            match self
                .import_connection(conn_export, &options, &existing_names, &group_map)
                .await
            {
                Ok(imported) => {
                    if imported {
                        result.imported += 1;
                    } else {
                        result.skipped += 1;
                    }
                }
                Err(e) => {
                    result.failed += 1;
                    result.errors.push(format!("Failed to import '{}': {}", conn_export.name, e));
                }
            }
        }

        result.success = result.failed == 0;
        Ok(result)
    }

    async fn import_group(
        &self,
        group_export: &ConnectionGroupExport,
        _group_map: &HashMap<String, String>,
    ) -> Result<String> {
        // 检查是否已存在
        let existing_groups = self.storage.list_groups().await?;
        if let Some(existing) = existing_groups.iter().find(|g| g.name == group_export.name) {
            return Ok(existing.id.clone());
        }

        // 创建新分组
        let group = ConnectionGroup {
            id: Uuid::new_v4().to_string(),
            name: group_export.name.clone(),
            sort_order: 0,
            parent_id: None,
        };

        self.storage.create_group(&group).await
            .context("Failed to create group")?;
        Ok(group.id)
    }

    async fn import_connection(
        &self,
        conn_export: &ConnectionExportItem,
        options: &ImportOptions,
        existing_names: &HashMap<String, String>,
        group_map: &HashMap<String, String>,
    ) -> Result<bool> {
        // 检查冲突
        if let Some(existing_id) = existing_names.get(&conn_export.name) {
            match options.conflict_strategy {
                ConflictStrategy::Skip => {
                    return Ok(false); // 跳过
                }
                ConflictStrategy::Overwrite => {
                    // 删除现有连接及其凭据
                    let _ = CredentialManager::delete(existing_id);
                    self.storage.delete_connection(existing_id).await?;
                }
                ConflictStrategy::Rename => {
                    // 重命名：添加后缀
                    return self
                        .import_connection_with_rename(conn_export, options, group_map)
                        .await;
                }
            }
        }

        // 创建连接
        self.create_connection_from_export(conn_export, options, group_map)
            .await?;
        Ok(true)
    }

    async fn import_connection_with_rename(
        &self,
        conn_export: &ConnectionExportItem,
        options: &ImportOptions,
        group_map: &HashMap<String, String>,
    ) -> Result<bool> {
        let mut new_export = conn_export.clone();
        let mut counter = 1;

        loop {
            new_export.name = format!("{} ({})", conn_export.name, counter);
            let existing = self.storage.list_connections().await?;
            if !existing.iter().any(|c| c.name == new_export.name) {
                break;
            }
            counter += 1;
        }

        self.create_connection_from_export(&new_export, options, group_map)
            .await?;
        Ok(true)
    }

    async fn create_connection_from_export(
        &self,
        conn_export: &ConnectionExportItem,
        options: &ImportOptions,
        group_map: &HashMap<String, String>,
    ) -> Result<()> {
        let group_id = conn_export
            .group_name
            .as_ref()
            .and_then(|gname| group_map.get(gname).cloned());

        let config_json = serde_json::to_string(&conn_export.config)?;
        let now = Utc::now().timestamp_millis();

        let conn = Connection {
            id: Uuid::new_v4().to_string(),
            name: conn_export.name.clone(),
            connection_type: conn_export.conn_type.clone(),
            group_id,
            host: conn_export.host.clone(),
            port: conn_export.port as u16,
            username: conn_export.username.clone(),
            config_json,
            color: conn_export.color.clone(),
            sort_order: 0,
            created_at: now,
            updated_at: now,
        };

        self.storage.create_connection(&conn).await
            .context("Failed to create connection")?;

        // 如果 JSON 中有密码且用户选择导入密码，写入 Windows Credential Manager
        if options.import_passwords {
            if let Some(ref password) = conn_export.password {
                if !password.is_empty() {
                    if let Err(e) = CredentialManager::save(&conn.id, password) {
                        log::warn!("Failed to save credential for '{}': {}", conn_export.name, e);
                    }
                }
            }
        }

        Ok(())
    }
}
