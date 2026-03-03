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

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS query_history (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                connection_name TEXT,
                database_name TEXT,
                sql_text TEXT NOT NULL,
                execution_time_ms INTEGER NOT NULL DEFAULT 0,
                is_error INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                affected_rows INTEGER NOT NULL DEFAULT 0,
                row_count INTEGER,
                executed_at INTEGER NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // Indexes for query_history
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_qh_conn ON query_history(connection_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_qh_time ON query_history(executed_at DESC)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_qh_sql ON query_history(sql_text COLLATE NOCASE)")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sql_snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                sql_text TEXT NOT NULL,
                category TEXT DEFAULT 'default',
                tags TEXT,
                connection_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // Command snippets table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS command_snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                command TEXT NOT NULL,
                description TEXT,
                category TEXT DEFAULT 'default',
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
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
        let mut tx = self.pool.begin().await?;
        for (index, id) in ids.iter().enumerate() {
            sqlx::query("UPDATE connections SET sort_order = ? WHERE id = ?")
                .bind(index as i32)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
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

    // --- Query History ---

    pub async fn save_query_history(
        &self,
        id: &str,
        connection_id: &str,
        connection_name: Option<&str>,
        database_name: Option<&str>,
        sql_text: &str,
        execution_time_ms: i64,
        is_error: bool,
        error_message: Option<&str>,
        affected_rows: i64,
        row_count: Option<i64>,
        executed_at: i64,
    ) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO query_history (id, connection_id, connection_name, database_name, sql_text, execution_time_ms, is_error, error_message, affected_rows, row_count, executed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(connection_id)
        .bind(connection_name)
        .bind(database_name)
        .bind(sql_text)
        .bind(execution_time_ms)
        .bind(is_error as i32)
        .bind(error_message)
        .bind(affected_rows)
        .bind(row_count)
        .bind(executed_at)
        .execute(&self.pool)
        .await?;

        // 高效清理：找到第 1000 条记录的时间戳，删除更早的记录（利用 idx_qh_time 索引）
        let cutoff_row = sqlx::query(
            "SELECT executed_at FROM query_history ORDER BY executed_at DESC LIMIT 1 OFFSET 1000",
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = cutoff_row {
            let cutoff_time: i64 = row.get("executed_at");
            sqlx::query("DELETE FROM query_history WHERE executed_at < ?")
                .bind(cutoff_time)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    pub async fn list_query_history(
        &self,
        connection_id: Option<&str>,
        search_text: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<QueryHistoryRecord>, AppError> {
        let mut sql = String::from(
            "SELECT id, connection_id, connection_name, database_name, sql_text, execution_time_ms, is_error, error_message, affected_rows, row_count, executed_at FROM query_history WHERE 1=1",
        );
        let mut binds: Vec<String> = vec![];

        if let Some(cid) = connection_id {
            sql.push_str(" AND connection_id = ?");
            binds.push(cid.to_string());
        }
        if let Some(search) = search_text {
            sql.push_str(" AND sql_text LIKE ?");
            binds.push(format!("%{}%", search));
        }

        sql.push_str(" ORDER BY executed_at DESC LIMIT ? OFFSET ?");

        let mut query = sqlx::query(&sql);
        for b in &binds {
            query = query.bind(b);
        }
        query = query.bind(limit).bind(offset);

        let rows = query.fetch_all(&self.pool).await?;

        let records = rows
            .iter()
            .map(|row| QueryHistoryRecord {
                id: row.get("id"),
                connection_id: row.get("connection_id"),
                connection_name: row.get("connection_name"),
                database_name: row.get("database_name"),
                sql_text: row.get("sql_text"),
                execution_time_ms: row.get("execution_time_ms"),
                is_error: row.get::<i32, _>("is_error") != 0,
                error_message: row.get("error_message"),
                affected_rows: row.get("affected_rows"),
                row_count: row.get("row_count"),
                executed_at: row.get("executed_at"),
            })
            .collect();

        Ok(records)
    }

    pub async fn delete_query_history(&self, id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM query_history WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn clear_query_history(&self, connection_id: Option<&str>) -> Result<(), AppError> {
        if let Some(cid) = connection_id {
            sqlx::query("DELETE FROM query_history WHERE connection_id = ?")
                .bind(cid)
                .execute(&self.pool)
                .await?;
        } else {
            sqlx::query("DELETE FROM query_history")
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    // --- SQL Snippets ---

    pub async fn list_sql_snippets(
        &self,
        category: Option<&str>,
        search: Option<&str>,
    ) -> Result<Vec<SqlSnippetRecord>, AppError> {
        let mut sql = String::from(
            "SELECT id, title, description, sql_text, category, tags, connection_id, created_at, updated_at FROM sql_snippets WHERE 1=1",
        );
        let mut binds: Vec<String> = vec![];

        if let Some(cat) = category {
            sql.push_str(" AND category = ?");
            binds.push(cat.to_string());
        }
        if let Some(s) = search {
            sql.push_str(" AND (title LIKE ? OR sql_text LIKE ?)");
            let pattern = format!("%{}%", s);
            binds.push(pattern.clone());
            binds.push(pattern);
        }

        sql.push_str(" ORDER BY updated_at DESC");

        let mut query = sqlx::query(&sql);
        for b in &binds {
            query = query.bind(b);
        }

        let rows = query.fetch_all(&self.pool).await?;

        let records = rows
            .iter()
            .map(|row| SqlSnippetRecord {
                id: row.get("id"),
                title: row.get("title"),
                description: row.get("description"),
                sql_text: row.get("sql_text"),
                category: row.get("category"),
                tags: row.get("tags"),
                connection_id: row.get("connection_id"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(records)
    }

    pub async fn create_sql_snippet(&self, record: &SqlSnippetRecord) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO sql_snippets (id, title, description, sql_text, category, tags, connection_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(&record.title)
        .bind(&record.description)
        .bind(&record.sql_text)
        .bind(&record.category)
        .bind(&record.tags)
        .bind(&record.connection_id)
        .bind(record.created_at)
        .bind(record.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_sql_snippet(&self, record: &SqlSnippetRecord) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE sql_snippets SET title = ?, description = ?, sql_text = ?, category = ?, tags = ?, connection_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&record.title)
        .bind(&record.description)
        .bind(&record.sql_text)
        .bind(&record.category)
        .bind(&record.tags)
        .bind(&record.connection_id)
        .bind(record.updated_at)
        .bind(&record.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_sql_snippet(&self, id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM sql_snippets WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Command Snippets ---

    pub async fn list_command_snippets(
        &self,
        category: Option<&str>,
        search: Option<&str>,
    ) -> Result<Vec<CommandSnippetRecord>, AppError> {
        let mut sql = String::from(
            "SELECT id, title, command, description, category, sort_order, created_at, updated_at FROM command_snippets WHERE 1=1",
        );
        let mut binds: Vec<String> = vec![];

        if let Some(cat) = category {
            sql.push_str(" AND category = ?");
            binds.push(cat.to_string());
        }
        if let Some(s) = search {
            sql.push_str(" AND (title LIKE ? OR command LIKE ? OR description LIKE ?)");
            let pattern = format!("%{}%", s);
            binds.push(pattern.clone());
            binds.push(pattern.clone());
            binds.push(pattern);
        }

        sql.push_str(" ORDER BY sort_order ASC, updated_at DESC");

        let mut query = sqlx::query(&sql);
        for b in &binds {
            query = query.bind(b);
        }

        let rows = query.fetch_all(&self.pool).await?;
        let records = rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                CommandSnippetRecord {
                    id: row.get("id"),
                    title: row.get("title"),
                    command: row.get("command"),
                    description: row.get("description"),
                    category: row.get("category"),
                    sort_order: row.get("sort_order"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();
        Ok(records)
    }

    pub async fn create_command_snippet(&self, record: &CommandSnippetRecord) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO command_snippets (id, title, command, description, category, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(&record.title)
        .bind(&record.command)
        .bind(&record.description)
        .bind(&record.category)
        .bind(record.sort_order)
        .bind(record.created_at)
        .bind(record.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_command_snippet(&self, record: &CommandSnippetRecord) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE command_snippets SET title = ?, command = ?, description = ?, category = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&record.title)
        .bind(&record.command)
        .bind(&record.description)
        .bind(&record.category)
        .bind(record.sort_order)
        .bind(record.updated_at)
        .bind(&record.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_command_snippet(&self, id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM command_snippets WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// --- Data models for query history and snippets ---

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryRecord {
    pub id: String,
    pub connection_id: String,
    pub connection_name: Option<String>,
    pub database_name: Option<String>,
    pub sql_text: String,
    pub execution_time_ms: i64,
    pub is_error: bool,
    pub error_message: Option<String>,
    pub affected_rows: i64,
    pub row_count: Option<i64>,
    pub executed_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlSnippetRecord {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub sql_text: String,
    pub category: Option<String>,
    pub tags: Option<String>,
    pub connection_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSnippetRecord {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}