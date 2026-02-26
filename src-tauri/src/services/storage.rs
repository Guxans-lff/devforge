use std::path::PathBuf;

use directories::ProjectDirs;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::models::connection::{Connection, ConnectionGroup};
use crate::utils::error::AppError;

pub struct Storage {
    pool: SqlitePool,
}

impl Storage {
    pub async fn new() -> Result<Self, AppError> {
        let db_path = Self::get_db_path()?;

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        let storage = Self { pool };
        storage.run_migrations().await?;

        Ok(storage)
    }

    fn get_db_path() -> Result<PathBuf, AppError> {
        let dirs = ProjectDirs::from("com", "devforge", "DevForge")
            .ok_or_else(|| AppError::Other("Failed to determine app data directory".into()))?;
        Ok(dirs.data_dir().join("devforge.db"))
    }

    async fn run_migrations(&self) -> Result<(), AppError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                group_id TEXT,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                color TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS connection_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                parent_id TEXT
            )",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // --- Connections ---

    pub async fn list_connections(&self) -> Result<Vec<Connection>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, type, group_id, host, port, username, config_json, color, sort_order, created_at, updated_at
             FROM connections ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let connections = rows
            .iter()
            .map(|row| Connection {
                id: row.get("id"),
                name: row.get("name"),
                connection_type: row.get("type"),
                group_id: row.get("group_id"),
                host: row.get("host"),
                port: row.get::<i32, _>("port") as u16,
                username: row.get("username"),
                config_json: row.get("config_json"),
                color: row.get("color"),
                sort_order: row.get("sort_order"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(connections)
    }

    pub async fn get_connection(&self, id: &str) -> Result<Connection, AppError> {
        let row = sqlx::query(
            "SELECT id, name, type, group_id, host, port, username, config_json, color, sort_order, created_at, updated_at
             FROM connections WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::ConnectionNotFound(id.to_string()))?;

        Ok(Connection {
            id: row.get("id"),
            name: row.get("name"),
            connection_type: row.get("type"),
            group_id: row.get("group_id"),
            host: row.get("host"),
            port: row.get::<i32, _>("port") as u16,
            username: row.get("username"),
            config_json: row.get("config_json"),
            color: row.get("color"),
            sort_order: row.get("sort_order"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn create_connection(&self, conn: &Connection) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO connections (id, name, type, group_id, host, port, username, config_json, color, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&conn.id)
        .bind(&conn.name)
        .bind(&conn.connection_type)
        .bind(&conn.group_id)
        .bind(&conn.host)
        .bind(conn.port as i32)
        .bind(&conn.username)
        .bind(&conn.config_json)
        .bind(&conn.color)
        .bind(conn.sort_order)
        .bind(conn.created_at)
        .bind(conn.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_connection(&self, conn: &Connection) -> Result<(), AppError> {
        let result = sqlx::query(
            "UPDATE connections SET name = ?, type = ?, group_id = ?, host = ?, port = ?, username = ?, config_json = ?, color = ?, sort_order = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&conn.name)
        .bind(&conn.connection_type)
        .bind(&conn.group_id)
        .bind(&conn.host)
        .bind(conn.port as i32)
        .bind(&conn.username)
        .bind(&conn.config_json)
        .bind(&conn.color)
        .bind(conn.sort_order)
        .bind(conn.updated_at)
        .bind(&conn.id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::ConnectionNotFound(conn.id.clone()));
        }

        Ok(())
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM connections WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::ConnectionNotFound(id.to_string()));
        }

        Ok(())
    }

    pub async fn reorder_connections(&self, ids: &[String]) -> Result<(), AppError> {
        for (index, id) in ids.iter().enumerate() {
            sqlx::query("UPDATE connections SET sort_order = ? WHERE id = ?")
                .bind(index as i32)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    // --- Groups ---

    pub async fn list_groups(&self) -> Result<Vec<ConnectionGroup>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, sort_order, parent_id FROM connection_groups ORDER BY sort_order ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let groups = rows
            .iter()
            .map(|row| ConnectionGroup {
                id: row.get("id"),
                name: row.get("name"),
                sort_order: row.get("sort_order"),
                parent_id: row.get("parent_id"),
            })
            .collect();

        Ok(groups)
    }

    pub async fn create_group(&self, group: &ConnectionGroup) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO connection_groups (id, name, sort_order, parent_id) VALUES (?, ?, ?, ?)",
        )
        .bind(&group.id)
        .bind(&group.name)
        .bind(group.sort_order)
        .bind(&group.parent_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn update_group(&self, group: &ConnectionGroup) -> Result<(), AppError> {
        sqlx::query("UPDATE connection_groups SET name = ?, sort_order = ?, parent_id = ? WHERE id = ?")
            .bind(&group.name)
            .bind(group.sort_order)
            .bind(&group.parent_id)
            .bind(&group.id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn delete_group(&self, id: &str) -> Result<(), AppError> {
        // Ungroup connections in this group
        sqlx::query("UPDATE connections SET group_id = NULL WHERE group_id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        sqlx::query("DELETE FROM connection_groups WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}
