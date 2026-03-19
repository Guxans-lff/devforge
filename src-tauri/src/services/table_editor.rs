use linked_hash_map::LinkedHashMap;
use regex::Regex;
use sqlx::{mysql::MySqlPool, postgres::PgPool, Row};
use std::sync::OnceLock;

use crate::models::table_editor::{
    ColumnDefinition, DdlResult, ForeignKeyDefinition, IndexDefinition,
    TableAlteration, TableDefinition, TableDetail,
};
use crate::services::db_drivers::DriverPool;
use crate::utils::error::AppError;

// ---------------------------------------------------------------------------
// Identifier validation & quoting
// ---------------------------------------------------------------------------

static IDENTIFIER_RE: OnceLock<Regex> = OnceLock::new();

fn identifier_regex() -> &'static Regex {
    IDENTIFIER_RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$")
            .expect("identifier regex is valid")
    })
}

fn is_valid_identifier(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 {
        return false;
    }
    identifier_regex().is_match(s)
}

fn validate_identifier(s: &str) -> Result<(), String> {
    if is_valid_identifier(s) {
        Ok(())
    } else {
        Err(format!("Invalid identifier: '{}'", s))
    }
}

fn mysql_quote(s: &str) -> String {
    format!("`{}`", s.replace('`', "``"))
}

fn pg_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn mysql_escape_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

fn pg_escape_string(s: &str) -> String {
    s.replace('\'', "''")
}

// ---------------------------------------------------------------------------
// MySQL DDL generation
// ---------------------------------------------------------------------------

fn mysql_column_def(col: &ColumnDefinition) -> String {
    let type_str = if let Some(ref len) = col.length {
        format!("{}({})", col.data_type, len)
    } else {
        col.data_type.clone()
    };
    let mut parts = vec![mysql_quote(&col.name), type_str];

    if !col.nullable {
        parts.push("NOT NULL".to_string());
    }

    if col.auto_increment {
        parts.push("AUTO_INCREMENT".to_string());
    }

    if let Some(ref dv) = col.default_value {
        let upper = dv.trim().to_uppercase();
        if upper == "CURRENT_TIMESTAMP"
            || upper == "NULL"
            || upper.starts_with("CURRENT_TIMESTAMP")
        {
            parts.push(format!("DEFAULT {}", dv));
        } else {
            parts.push(format!("DEFAULT '{}'", mysql_escape_string(dv)));
        }
    }

    if let Some(ref ou) = col.on_update {
        parts.push(format!("ON UPDATE {}", ou));
    }

    if let Some(ref c) = col.comment {
        parts.push(format!("COMMENT '{}'", mysql_escape_string(c)));
    }

    parts.join(" ")
}

fn mysql_create_table(def: &TableDefinition) -> DdlResult {
    let table_ref = format!("{}.{}", mysql_quote(&def.database), mysql_quote(&def.name));
    let mut lines: Vec<String> = Vec::new();

    // Columns
    for col in &def.columns {
        lines.push(format!("  {}", mysql_column_def(col)));
    }

    // Indexes
    for idx in &def.indexes {
        let cols = idx.columns.iter().map(|c| mysql_quote(c)).collect::<Vec<_>>().join(", ");
        let line = match idx.index_type.to_uppercase().as_str() {
            "PRIMARY" => format!("  PRIMARY KEY ({})", cols),
            "UNIQUE" => format!("  UNIQUE INDEX {} ({})", mysql_quote(&idx.name), cols),
            "FULLTEXT" => format!("  FULLTEXT INDEX {} ({})", mysql_quote(&idx.name), cols),
            _ => format!("  INDEX {} ({})", mysql_quote(&idx.name), cols),
        };
        lines.push(line);
    }

    // Foreign keys
    for fk in &def.foreign_keys {
        let cols = fk.columns.iter().map(|c| mysql_quote(c)).collect::<Vec<_>>().join(", ");
        let ref_cols = fk.ref_columns.iter().map(|c| mysql_quote(c)).collect::<Vec<_>>().join(", ");
        let mut fk_line = format!(
            "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            mysql_quote(&fk.name),
            cols,
            mysql_quote(&fk.ref_table),
            ref_cols
        );
        if let Some(ref od) = fk.on_delete {
            fk_line.push_str(&format!(" ON DELETE {}", od));
        }
        if let Some(ref ou) = fk.on_update {
            fk_line.push_str(&format!(" ON UPDATE {}", ou));
        }
        lines.push(fk_line);
    }

    // Table options
    let mut options: Vec<String> = Vec::new();
    if let Some(ref engine) = def.engine {
        options.push(format!("ENGINE={}", engine));
    }
    if let Some(ref charset) = def.charset {
        options.push(format!("DEFAULT CHARSET={}", charset));
    }
    if let Some(ref collation) = def.collation {
        options.push(format!("COLLATE={}", collation));
    }
    if let Some(ref comment) = def.comment {
        options.push(format!("COMMENT='{}'", mysql_escape_string(comment)));
    }

    let options_str = if options.is_empty() {
        String::new()
    } else {
        format!(" {}", options.join(" "))
    };

    let stmt = format!(
        "CREATE TABLE {} (\n{}\n){};",
        table_ref,
        lines.join(",\n"),
        options_str
    );

    DdlResult {
        sql: stmt.clone(),
        statements: vec![stmt],
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL DDL generation
// ---------------------------------------------------------------------------

fn pg_column_def(col: &ColumnDefinition, is_auto: bool) -> String {
    let mut parts = Vec::new();
    parts.push(pg_quote(&col.name));

    if is_auto {
        // Map integer types to SERIAL variants
        let upper = col.data_type.to_uppercase();
        if upper.contains("BIGINT") || upper.contains("INT8") {
            parts.push("BIGSERIAL".to_string());
        } else if upper.contains("SMALLINT") || upper.contains("INT2") {
            parts.push("SMALLSERIAL".to_string());
        } else {
            parts.push("SERIAL".to_string());
        }
    } else {
        let type_str = if let Some(ref len) = col.length {
            format!("{}({})", col.data_type, len)
        } else {
            col.data_type.clone()
        };
        parts.push(type_str);
    }

    if !col.nullable {
        parts.push("NOT NULL".to_string());
    }

    if let Some(ref dv) = col.default_value {
        if !is_auto {
            let upper = dv.trim().to_uppercase();
            if upper == "CURRENT_TIMESTAMP"
                || upper == "NULL"
                || upper == "NOW()"
                || upper.starts_with("CURRENT_TIMESTAMP")
            {
                parts.push(format!("DEFAULT {}", dv));
            } else {
                parts.push(format!("DEFAULT '{}'", pg_escape_string(dv)));
            }
        }
    }

    parts.join(" ")
}

fn pg_create_table(def: &TableDefinition) -> DdlResult {
    let table_ref = format!("{}.{}", pg_quote(&def.database), pg_quote(&def.name));
    let mut lines: Vec<String> = Vec::new();
    let mut stmts: Vec<String> = Vec::new();

    // Columns
    for col in &def.columns {
        lines.push(format!("  {}", pg_column_def(col, col.auto_increment)));
    }

    // Indexes inline: only PRIMARY and UNIQUE constraints
    for idx in &def.indexes {
        let cols = idx.columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
        match idx.index_type.to_uppercase().as_str() {
            "PRIMARY" => lines.push(format!("  PRIMARY KEY ({})", cols)),
            "UNIQUE" => lines.push(format!(
                "  CONSTRAINT {} UNIQUE ({})",
                pg_quote(&idx.name),
                cols
            )),
            _ => {} // handled after CREATE TABLE
        }
    }

    // Foreign keys inline
    for fk in &def.foreign_keys {
        let cols = fk.columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
        let ref_cols = fk.ref_columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
        let mut fk_line = format!(
            "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            pg_quote(&fk.name),
            cols,
            pg_quote(&fk.ref_table),
            ref_cols
        );
        if let Some(ref od) = fk.on_delete {
            fk_line.push_str(&format!(" ON DELETE {}", od));
        }
        if let Some(ref ou) = fk.on_update {
            fk_line.push_str(&format!(" ON UPDATE {}", ou));
        }
        lines.push(fk_line);
    }

    let create_stmt = format!("CREATE TABLE {} (\n{}\n);", table_ref, lines.join(",\n"));
    stmts.push(create_stmt);

    // Separate CREATE INDEX for non-primary, non-unique indexes
    for idx in &def.indexes {
        let upper = idx.index_type.to_uppercase();
        if upper != "PRIMARY" && upper != "UNIQUE" {
            let cols = idx.columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
            stmts.push(format!(
                "CREATE INDEX {} ON {} ({});",
                pg_quote(&idx.name),
                table_ref,
                cols
            ));
        }
    }

    // Table comment
    if let Some(ref comment) = def.comment {
        stmts.push(format!(
            "COMMENT ON TABLE {} IS '{}';",
            table_ref,
            pg_escape_string(comment)
        ));
    }

    // Column comments
    for col in &def.columns {
        if let Some(ref comment) = col.comment {
            stmts.push(format!(
                "COMMENT ON COLUMN {}.{} IS '{}';",
                table_ref,
                pg_quote(&col.name),
                pg_escape_string(comment)
            ));
        }
    }

    let sql = stmts.join("\n");
    DdlResult {
        sql,
        statements: stmts,
    }
}

// ---------------------------------------------------------------------------
// MySQL ALTER TABLE
// ---------------------------------------------------------------------------

fn mysql_alter_table(alt: &TableAlteration) -> DdlResult {
    let table_ref = format!("{}.{}", mysql_quote(&alt.database), mysql_quote(&alt.table));
    let mut stmts: Vec<String> = Vec::new();

    // Rename table
    if let Some(ref new_name) = alt.new_name {
        let new_ref = format!("{}.{}", mysql_quote(&alt.database), mysql_quote(new_name));
        stmts.push(format!("ALTER TABLE {} RENAME TO {};", table_ref, new_ref));
    }

    let target_ref = if let Some(ref new_name) = alt.new_name {
        format!("{}.{}", mysql_quote(&alt.database), mysql_quote(new_name))
    } else {
        table_ref.clone()
    };

    // Column changes
    for cc in &alt.column_changes {
        let stmt = match cc.change_type.as_str() {
            "add" => {
                let col_def = mysql_column_def(&cc.column);
                let pos = cc.after_column.as_ref()
                    .map(|a| format!(" AFTER {}", mysql_quote(a)))
                    .unwrap_or_default();
                format!("ALTER TABLE {} ADD COLUMN {}{};", target_ref, col_def, pos)
            }
            "modify" => {
                let col_def = mysql_column_def(&cc.column);
                format!("ALTER TABLE {} MODIFY COLUMN {};", target_ref, col_def)
            }
            "drop" => {
                format!("ALTER TABLE {} DROP COLUMN {};", target_ref, mysql_quote(&cc.column.name))
            }
            "rename" => {
                let old = cc.old_name.as_deref().unwrap_or(&cc.column.name);
                let col_def = mysql_column_def(&cc.column);
                format!("ALTER TABLE {} CHANGE COLUMN {} {};", target_ref, mysql_quote(old), col_def)
            }
            _ => continue,
        };
        stmts.push(stmt);
    }

    // Index changes
    for ic in &alt.index_changes {
        let stmt = match ic.change_type.as_str() {
            "add" => {
                let cols = ic.index.columns.iter().map(|c| mysql_quote(c)).collect::<Vec<_>>().join(", ");
                match ic.index.index_type.to_uppercase().as_str() {
                    "PRIMARY" => format!("ALTER TABLE {} ADD PRIMARY KEY ({});", target_ref, cols),
                    "UNIQUE" => format!("ALTER TABLE {} ADD UNIQUE INDEX {} ({});", target_ref, mysql_quote(&ic.index.name), cols),
                    "FULLTEXT" => format!("ALTER TABLE {} ADD FULLTEXT INDEX {} ({});", target_ref, mysql_quote(&ic.index.name), cols),
                    _ => format!("ALTER TABLE {} ADD INDEX {} ({});", target_ref, mysql_quote(&ic.index.name), cols),
                }
            }
            "drop" => {
                if ic.index.index_type.to_uppercase() == "PRIMARY" {
                    format!("ALTER TABLE {} DROP PRIMARY KEY;", target_ref)
                } else {
                    format!("ALTER TABLE {} DROP INDEX {};", target_ref, mysql_quote(&ic.index.name))
                }
            }
            _ => continue,
        };
        stmts.push(stmt);
    }

    // Table options
    let mut opts: Vec<String> = Vec::new();
    if let Some(ref engine) = alt.new_engine {
        opts.push(format!("ENGINE={}", engine));
    }
    if let Some(ref charset) = alt.new_charset {
        opts.push(format!("DEFAULT CHARSET={}", charset));
    }
    if let Some(ref comment) = alt.new_comment {
        opts.push(format!("COMMENT='{}'", mysql_escape_string(comment)));
    }
    if !opts.is_empty() {
        stmts.push(format!("ALTER TABLE {} {};", target_ref, opts.join(" ")));
    }

    let sql = stmts.join("\n");
    DdlResult { sql, statements: stmts }
}

// __ALTER_PG__

// ---------------------------------------------------------------------------
// PostgreSQL ALTER TABLE
// ---------------------------------------------------------------------------

fn pg_alter_table(alt: &TableAlteration) -> DdlResult {
    let table_ref = format!("{}.{}", pg_quote(&alt.database), pg_quote(&alt.table));
    let mut stmts: Vec<String> = Vec::new();

    // Rename table
    if let Some(ref new_name) = alt.new_name {
        stmts.push(format!("ALTER TABLE {} RENAME TO {};", table_ref, pg_quote(new_name)));
    }

    let target_ref = if let Some(ref new_name) = alt.new_name {
        format!("{}.{}", pg_quote(&alt.database), pg_quote(new_name))
    } else {
        table_ref.clone()
    };

    // Column changes
    for cc in &alt.column_changes {
        match cc.change_type.as_str() {
            "add" => {
                let col_def = pg_column_def(&cc.column, cc.column.auto_increment);
                stmts.push(format!("ALTER TABLE {} ADD COLUMN {};", target_ref, col_def));
            }
            "modify" => {
                let col_name = pg_quote(&cc.column.name);
                // Type change
                stmts.push(format!(
                    "ALTER TABLE {} ALTER COLUMN {} TYPE {};",
                    target_ref, col_name, cc.column.data_type
                ));
                // Nullable
                if cc.column.nullable {
                    stmts.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL;",
                        target_ref, col_name
                    ));
                } else {
                    stmts.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} SET NOT NULL;",
                        target_ref, col_name
                    ));
                }
                // Default
                if let Some(ref dv) = cc.column.default_value {
                    let upper = dv.trim().to_uppercase();
                    if upper == "CURRENT_TIMESTAMP" || upper == "NULL" || upper == "NOW()" {
                        stmts.push(format!(
                            "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {};",
                            target_ref, col_name, dv
                        ));
                    } else {
                        stmts.push(format!(
                            "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT '{}';",
                            target_ref, col_name, pg_escape_string(dv)
                        ));
                    }
                } else {
                    stmts.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT;",
                        target_ref, col_name
                    ));
                }
                // Comment
                if let Some(ref comment) = cc.column.comment {
                    stmts.push(format!(
                        "COMMENT ON COLUMN {}.{} IS '{}';",
                        target_ref, col_name, pg_escape_string(comment)
                    ));
                }
            }
            "drop" => {
                stmts.push(format!(
                    "ALTER TABLE {} DROP COLUMN {};",
                    target_ref, pg_quote(&cc.column.name)
                ));
            }
            "rename" => {
                let old = cc.old_name.as_deref().unwrap_or(&cc.column.name);
                stmts.push(format!(
                    "ALTER TABLE {} RENAME COLUMN {} TO {};",
                    target_ref, pg_quote(old), pg_quote(&cc.column.name)
                ));
            }
            _ => {}
        }
    }

    // Index changes
    for ic in &alt.index_changes {
        match ic.change_type.as_str() {
            "add" => {
                let cols = ic.index.columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
                match ic.index.index_type.to_uppercase().as_str() {
                    "PRIMARY" => {
                        stmts.push(format!("ALTER TABLE {} ADD PRIMARY KEY ({});", target_ref, cols));
                    }
                    "UNIQUE" => {
                        stmts.push(format!(
                            "ALTER TABLE {} ADD CONSTRAINT {} UNIQUE ({});",
                            target_ref, pg_quote(&ic.index.name), cols
                        ));
                    }
                    _ => {
                        stmts.push(format!(
                            "CREATE INDEX {} ON {} ({});",
                            pg_quote(&ic.index.name), target_ref, cols
                        ));
                    }
                }
            }
            "drop" => {
                if ic.index.index_type.to_uppercase() == "PRIMARY" {
                    // PG primary key constraint name is typically tablename_pkey
                    let pkey_name = format!("{}_pkey", alt.new_name.as_deref().unwrap_or(&alt.table));
                    stmts.push(format!(
                        "ALTER TABLE {} DROP CONSTRAINT {};",
                        target_ref, pg_quote(&pkey_name)
                    ));
                } else {
                    stmts.push(format!("DROP INDEX {}.{};", pg_quote(&alt.database), pg_quote(&ic.index.name)));
                }
            }
            _ => {}
        }
    }

    // Table comment
    if let Some(ref comment) = alt.new_comment {
        stmts.push(format!(
            "COMMENT ON TABLE {} IS '{}';",
            target_ref, pg_escape_string(comment)
        ));
    }

    let sql = stmts.join("\n");
    DdlResult { sql, statements: stmts }
}

// __PUBLIC_API__

// ===========================================================================
// Public API
// ===========================================================================

pub fn generate_create_table(def: &TableDefinition, driver: &str) -> Result<DdlResult, String> {
    validate_identifier(&def.name)?;
    validate_identifier(&def.database)?;
    for col in &def.columns {
        validate_identifier(&col.name)?;
    }
    for idx in &def.indexes {
        if idx.index_type.to_uppercase() != "PRIMARY" {
            validate_identifier(&idx.name)?;
        }
        for c in &idx.columns {
            validate_identifier(c)?;
        }
    }
    for fk in &def.foreign_keys {
        validate_identifier(&fk.name)?;
        validate_identifier(&fk.ref_table)?;
    }

    match driver {
        "postgresql" => Ok(pg_create_table(def)),
        _ => Ok(mysql_create_table(def)),
    }
}

pub fn generate_alter_table(alt: &TableAlteration, driver: &str) -> Result<DdlResult, String> {
    validate_identifier(&alt.table)?;
    validate_identifier(&alt.database)?;
    if let Some(ref n) = alt.new_name {
        validate_identifier(n)?;
    }
    for cc in &alt.column_changes {
        validate_identifier(&cc.column.name)?;
        if let Some(ref old) = cc.old_name {
            validate_identifier(old)?;
        }
    }
    for ic in &alt.index_changes {
        if ic.index.index_type.to_uppercase() != "PRIMARY" {
            validate_identifier(&ic.index.name)?;
        }
    }

    match driver {
        "postgresql" => Ok(pg_alter_table(alt)),
        _ => Ok(mysql_alter_table(alt)),
    }
}

// ---------------------------------------------------------------------------
// get_table_detail — MySQL
// ---------------------------------------------------------------------------

async fn mysql_table_detail(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<TableDetail, AppError> {
    // Table metadata
    let table_row = sqlx::query(
        "SELECT ENGINE, TABLE_COLLATION, TABLE_COMMENT \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"
    )
    .bind(database)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let (engine, collation, table_comment) = match table_row {
        Some(ref r) => (
            r.try_get::<Option<String>, _>("ENGINE").unwrap_or(None),
            r.try_get::<Option<String>, _>("TABLE_COLLATION").unwrap_or(None),
            r.try_get::<Option<String>, _>("TABLE_COMMENT").unwrap_or(None),
        ),
        None => (None, None, None),
    };

    // Derive charset from collation (e.g. "utf8mb4_unicode_ci" -> "utf8mb4")
    let charset = collation.as_ref().and_then(|c| c.split('_').next().map(String::from));

    // Columns
    // 注意：MySQL 8.0 的 information_schema 中部分列是 longtext/enum，
    // sqlx 无法直接解码为 String，需要 CAST 转换
    let col_rows = sqlx::query(
        "SELECT CAST(COLUMN_NAME AS CHAR(200)) AS COLUMN_NAME, \
                CAST(COLUMN_TYPE AS CHAR(500)) AS COLUMN_TYPE, \
                CAST(IS_NULLABLE AS CHAR(10)) AS IS_NULLABLE, \
                CAST(COLUMN_DEFAULT AS CHAR(1000)) AS COLUMN_DEFAULT, \
                CAST(EXTRA AS CHAR(500)) AS EXTRA, \
                CAST(COLUMN_KEY AS CHAR(10)) AS COLUMN_KEY, \
                CAST(COLUMN_COMMENT AS CHAR(2000)) AS COLUMN_COMMENT \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION"
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let columns: Vec<ColumnDefinition> = col_rows.iter().map(|r| {
        let extra: String = r.try_get("EXTRA").unwrap_or_default();
        let comment: Option<String> = r.try_get("COLUMN_COMMENT").unwrap_or(None);
        let column_type: String = r.try_get("COLUMN_TYPE").unwrap_or_default();
        let column_key: String = r.try_get("COLUMN_KEY").unwrap_or_default();

        // 解析 COLUMN_TYPE: "varchar(255)" -> ("VARCHAR", Some("255"))
        // "decimal(10,2)" -> ("DECIMAL", Some("10,2"))
        // "bigint" -> ("BIGINT", None)
        // "bigint unsigned" -> ("BIGINT UNSIGNED", None)
        // "int(11) unsigned" -> ("INT UNSIGNED", Some("11"))
        let (data_type, length) = {
            let re = Regex::new(r"^(\w+)(?:\((.+?)\))?(.*)$").unwrap();
            if let Some(caps) = re.captures(&column_type) {
                let base = caps[1].to_uppercase();
                let len = caps.get(2).map(|m| m.as_str().to_string());
                let suffix = caps.get(3).map(|m| m.as_str().trim().to_uppercase()).unwrap_or_default();
                if suffix.is_empty() {
                    (base, len)
                } else {
                    (format!("{} {}", base, suffix), len)
                }
            } else {
                (column_type.to_uppercase(), None)
            }
        };

        // 从 EXTRA 提取 ON UPDATE 值
        let on_update = if extra.contains("on update") {
            extra.split("on update ")
                .nth(1)
                .map(|s| s.trim().to_string())
        } else {
            None
        };

        ColumnDefinition {
            name: r.try_get("COLUMN_NAME").unwrap_or_default(),
            data_type,
            length,
            nullable: r.try_get::<String, _>("IS_NULLABLE").unwrap_or_default() == "YES",
            is_primary_key: column_key == "PRI",
            default_value: r.try_get("COLUMN_DEFAULT").unwrap_or(None),
            auto_increment: extra.contains("auto_increment"),
            on_update,
            comment: comment.filter(|c| !c.is_empty()),
        }
    }).collect();

// __MYSQL_INDEXES__

    // Indexes
    let idx_rows = sqlx::query(
        "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX"
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let mut index_map: LinkedHashMap<String, (Vec<String>, String, bool)> =
        LinkedHashMap::new();
    for r in &idx_rows {
        let idx_name: String = r.try_get("INDEX_NAME").unwrap_or_default();
        let col_name: String = r.try_get("COLUMN_NAME").unwrap_or_default();
        let non_unique: i64 = r.try_get::<i32, _>("NON_UNIQUE").unwrap_or(1) as i64;
        let idx_type_raw: String = r.try_get("INDEX_TYPE").unwrap_or_default();
        let entry = index_map.entry(idx_name.clone()).or_insert_with(|| {
            (Vec::new(), idx_type_raw.clone(), non_unique != 0)
        });
        entry.0.push(col_name);
    }

    let indexes: Vec<IndexDefinition> = index_map.into_iter().map(|(name, (cols, raw_type, non_unique))| {
        let index_type = if name == "PRIMARY" {
            "PRIMARY".to_string()
        } else if !non_unique {
            "UNIQUE".to_string()
        } else if raw_type == "FULLTEXT" {
            "FULLTEXT".to_string()
        } else {
            "INDEX".to_string()
        };
        IndexDefinition { name, columns: cols, index_type }
    }).collect();

    // Foreign keys
    let fk_rows = sqlx::query(
        "SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, \
                kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, \
                rc.DELETE_RULE, rc.UPDATE_RULE \
         FROM information_schema.KEY_COLUMN_USAGE kcu \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
           ON rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA \
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
         WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION"
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let mut fk_map: LinkedHashMap<String, ForeignKeyDefinition> =
        LinkedHashMap::new();
    for r in &fk_rows {
        let cname: String = r.try_get("CONSTRAINT_NAME").unwrap_or_default();
        let col: String = r.try_get("COLUMN_NAME").unwrap_or_default();
        let ref_tbl: String = r.try_get("REFERENCED_TABLE_NAME").unwrap_or_default();
        let ref_col: String = r.try_get("REFERENCED_COLUMN_NAME").unwrap_or_default();
        let on_del: Option<String> = r.try_get("DELETE_RULE").ok();
        let on_upd: Option<String> = r.try_get("UPDATE_RULE").ok();
        let entry = fk_map.entry(cname.clone()).or_insert_with(|| ForeignKeyDefinition {
            name: cname,
            columns: Vec::new(),
            ref_table: ref_tbl,
            ref_columns: Vec::new(),
            on_delete: on_del.filter(|s| s != "RESTRICT"),
            on_update: on_upd.filter(|s| s != "RESTRICT"),
        });
        entry.columns.push(col);
        entry.ref_columns.push(ref_col);
    }
    let foreign_keys: Vec<ForeignKeyDefinition> = fk_map.into_iter().map(|(_, v)| v).collect();

    let table_comment = table_comment.filter(|c| !c.is_empty());

    Ok(TableDetail {
        name: table.to_string(),
        columns,
        indexes,
        foreign_keys,
        engine,
        charset,
        collation,
        comment: table_comment,
    })
}

// __PG_DETAIL__

// ---------------------------------------------------------------------------
// get_table_detail — PostgreSQL
// ---------------------------------------------------------------------------

async fn pg_table_detail(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<TableDetail, AppError> {
    // Table comment
    let tbl_comment_row = sqlx::query(
        "SELECT obj_description(c.oid) AS table_comment \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relname = $2"
    )
    .bind(schema)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let table_comment: Option<String> = tbl_comment_row
        .and_then(|r| r.try_get("table_comment").unwrap_or(None));

    // Columns
    let col_rows = sqlx::query(
        "SELECT c.column_name, c.data_type, c.udt_name, \
                c.character_maximum_length, c.numeric_precision, c.numeric_scale, \
                c.is_nullable, c.column_default, \
                pgd.description AS column_comment \
         FROM information_schema.columns c \
         LEFT JOIN pg_catalog.pg_statio_all_tables st \
           ON st.schemaname = c.table_schema AND st.relname = c.table_name \
         LEFT JOIN pg_catalog.pg_description pgd \
           ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position \
         WHERE c.table_schema = $1 AND c.table_name = $2 \
         ORDER BY c.ordinal_position"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    // Primary key columns
    let pk_rows = sqlx::query(
        "SELECT a.attname \
         FROM pg_index ix \
         JOIN pg_class t ON t.oid = ix.indrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
         WHERE n.nspname = $1 AND t.relname = $2 AND ix.indisprimary"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let pk_cols: Vec<String> = pk_rows.iter()
        .map(|r| r.try_get::<String, _>("attname").unwrap_or_default())
        .collect();

    let columns: Vec<ColumnDefinition> = col_rows.iter().map(|r| {
        let udt: String = r.try_get("udt_name").unwrap_or_default();
        let max_len: Option<i32> = r.try_get("character_maximum_length").unwrap_or(None);
        let num_precision: Option<i32> = r.try_get("numeric_precision").unwrap_or(None);
        let num_scale: Option<i32> = r.try_get("numeric_scale").unwrap_or(None);
        let col_default: Option<String> = r.try_get("column_default").unwrap_or(None);
        let col_name: String = r.try_get("column_name").unwrap_or_default();

        let data_type = udt.to_uppercase();

        // 构建 length
        let length = if let Some(len) = max_len {
            Some(len.to_string())
        } else if let Some(prec) = num_precision {
            if let Some(scale) = num_scale {
                if scale > 0 {
                    Some(format!("{},{}", prec, scale))
                } else {
                    Some(prec.to_string())
                }
            } else {
                Some(prec.to_string())
            }
        } else {
            None
        };

        let auto_increment = col_default
            .as_ref()
            .map(|d| d.contains("nextval("))
            .unwrap_or(false);

        // Strip nextval default for auto-increment columns
        let default_value = if auto_increment {
            None
        } else {
            col_default
        };

        let comment: Option<String> = r.try_get("column_comment").unwrap_or(None);
        let is_primary_key = pk_cols.contains(&col_name);

        ColumnDefinition {
            name: col_name,
            data_type,
            length,
            nullable: r.try_get::<String, _>("is_nullable").unwrap_or_default() == "YES",
            is_primary_key,
            default_value,
            auto_increment,
            on_update: None,
            comment: comment.filter(|c| !c.is_empty()),
        }
    }).collect();

// __PG_INDEXES__

    // Indexes
    let idx_rows = sqlx::query(
        "SELECT i.relname AS index_name, \
                a.attname AS column_name, \
                ix.indisprimary, ix.indisunique \
         FROM pg_index ix \
         JOIN pg_class t ON t.oid = ix.indrelid \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
         WHERE n.nspname = $1 AND t.relname = $2 \
         ORDER BY i.relname, a.attnum"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let mut index_map: LinkedHashMap<String, (Vec<String>, bool, bool)> =
        LinkedHashMap::new();
    for r in &idx_rows {
        let idx_name: String = r.try_get("index_name").unwrap_or_default();
        let col_name: String = r.try_get("column_name").unwrap_or_default();
        let is_primary: bool = r.try_get("indisprimary").unwrap_or(false);
        let is_unique: bool = r.try_get("indisunique").unwrap_or(false);
        let entry = index_map.entry(idx_name).or_insert_with(|| (Vec::new(), is_primary, is_unique));
        entry.0.push(col_name);
    }

    let indexes: Vec<IndexDefinition> = index_map.into_iter().map(|(name, (cols, is_primary, is_unique))| {
        let index_type = if is_primary {
            "PRIMARY".to_string()
        } else if is_unique {
            "UNIQUE".to_string()
        } else {
            "INDEX".to_string()
        };
        IndexDefinition { name, columns: cols, index_type }
    }).collect();

    // Foreign keys
    let fk_rows = sqlx::query(
        "SELECT tc.constraint_name, kcu.column_name, \
                ccu.table_name AS ref_table, ccu.column_name AS ref_column, \
                rc.delete_rule, rc.update_rule \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name \
          AND tc.table_schema = kcu.table_schema \
         JOIN information_schema.constraint_column_usage ccu \
           ON ccu.constraint_name = tc.constraint_name \
          AND ccu.table_schema = tc.table_schema \
         JOIN information_schema.referential_constraints rc \
           ON rc.constraint_name = tc.constraint_name \
          AND rc.constraint_schema = tc.table_schema \
         WHERE tc.constraint_type = 'FOREIGN KEY' \
           AND tc.table_schema = $1 AND tc.table_name = $2 \
         ORDER BY tc.constraint_name, kcu.ordinal_position"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let mut fk_map: LinkedHashMap<String, ForeignKeyDefinition> =
        LinkedHashMap::new();
    for r in &fk_rows {
        let cname: String = r.try_get("constraint_name").unwrap_or_default();
        let col: String = r.try_get("column_name").unwrap_or_default();
        let ref_tbl: String = r.try_get("ref_table").unwrap_or_default();
        let ref_col: String = r.try_get("ref_column").unwrap_or_default();
        let on_del: Option<String> = r.try_get("delete_rule").ok();
        let on_upd: Option<String> = r.try_get("update_rule").ok();
        let entry = fk_map.entry(cname.clone()).or_insert_with(|| ForeignKeyDefinition {
            name: cname,
            columns: Vec::new(),
            ref_table: ref_tbl,
            ref_columns: Vec::new(),
            on_delete: on_del.filter(|s| s != "NO ACTION"),
            on_update: on_upd.filter(|s| s != "NO ACTION"),
        });
        if !entry.columns.contains(&col) {
            entry.columns.push(col);
        }
        if !entry.ref_columns.contains(&ref_col) {
            entry.ref_columns.push(ref_col);
        }
    }
    let foreign_keys: Vec<ForeignKeyDefinition> = fk_map.into_iter().map(|(_, v)| v).collect();

    Ok(TableDetail {
        name: table.to_string(),
        columns,
        indexes,
        foreign_keys,
        engine: None,
        charset: None,
        collation: None,
        comment: table_comment,
    })
}

// ---------------------------------------------------------------------------
// Public: get_table_detail dispatcher
// ---------------------------------------------------------------------------

pub async fn get_table_detail(
    pool: &DriverPool,
    database: &str,
    table: &str,
) -> Result<TableDetail, AppError> {
    match pool {
        DriverPool::MySql(p) => mysql_table_detail(p, database, table).await,
        DriverPool::Postgres(p) => pg_table_detail(p, database, table).await,
    }
}

// ---------------------------------------------------------------------------
// Public: get_table_ddl dispatcher
// ---------------------------------------------------------------------------

pub async fn get_table_ddl(
    pool: &DriverPool,
    database: &str,
    table: &str,
) -> Result<String, AppError> {
    match pool {
        DriverPool::MySql(p) => mysql_table_ddl(p, database, table).await,
        DriverPool::Postgres(p) => pg_table_ddl(p, database, table).await,
    }
}

async fn mysql_table_ddl(pool: &MySqlPool, database: &str, table: &str) -> Result<String, AppError> {
    let sql = format!("SHOW CREATE TABLE {}.{}", mysql_quote(database), mysql_quote(table));
    let row = sqlx::query(&sql).fetch_one(pool).await
        .map_err(|e| AppError::Database(e))?;
    let ddl: String = row.try_get(1).unwrap_or_default();
    Ok(ddl)
}

async fn pg_table_ddl(pool: &PgPool, database: &str, table: &str) -> Result<String, AppError> {
    // PostgreSQL 没有 SHOW CREATE TABLE，需要从 information_schema 拼接
    let detail = pg_table_detail(pool, database, table).await?;
    let schema = database; // PG 中 database 参数实际是 schema
    let mut lines: Vec<String> = Vec::new();
    for col in &detail.columns {
        let type_str = if let Some(ref len) = col.length {
            format!("{}({})", col.data_type, len)
        } else {
            col.data_type.clone()
        };
        let mut parts = vec![pg_quote(&col.name), type_str];
        if !col.nullable { parts.push("NOT NULL".to_string()); }
        if let Some(ref dv) = col.default_value { parts.push(format!("DEFAULT {}", dv)); }
        lines.push(format!("  {}", parts.join(" ")));
    }
    for idx in &detail.indexes {
        let cols = idx.columns.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ");
        match idx.index_type.to_uppercase().as_str() {
            "PRIMARY" => lines.push(format!("  PRIMARY KEY ({})", cols)),
            "UNIQUE" => lines.push(format!("  CONSTRAINT {} UNIQUE ({})", pg_quote(&idx.name), cols)),
            _ => {}
        };
    }
    let mut ddl = format!("CREATE TABLE {}.{} (\n{}\n)", pg_quote(schema), pg_quote(&detail.name), lines.join(",\n"));
    if let Some(ref comment) = detail.comment {
        ddl.push_str(&format!(";\nCOMMENT ON TABLE {}.{} IS '{}'", pg_quote(schema), pg_quote(&detail.name), pg_escape_string(comment)));
    }
    Ok(ddl)
}

// ===========================================================================
// 单元测试
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::table_editor::*;

    // -----------------------------------------------------------------------
    // 辅助函数：构建测试数据
    // -----------------------------------------------------------------------

    fn col(name: &str, data_type: &str) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: data_type.to_string(),
            length: None,
            nullable: true,
            is_primary_key: false,
            default_value: None,
            auto_increment: false,
            on_update: None,
            comment: None,
        }
    }

    fn col_full(
        name: &str, data_type: &str, length: Option<&str>,
        nullable: bool, auto_inc: bool, default: Option<&str>,
        on_update: Option<&str>, comment: Option<&str>,
    ) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: data_type.to_string(),
            length: length.map(|s| s.to_string()),
            nullable,
            is_primary_key: false,
            default_value: default.map(|s| s.to_string()),
            auto_increment: auto_inc,
            on_update: on_update.map(|s| s.to_string()),
            comment: comment.map(|s| s.to_string()),
        }
    }

    fn idx(name: &str, cols: &[&str], idx_type: &str) -> IndexDefinition {
        IndexDefinition {
            name: name.to_string(),
            columns: cols.iter().map(|s| s.to_string()).collect(),
            index_type: idx_type.to_string(),
        }
    }

    fn fk(name: &str, cols: &[&str], ref_table: &str, ref_cols: &[&str],
           on_delete: Option<&str>, on_update: Option<&str>) -> ForeignKeyDefinition {
        ForeignKeyDefinition {
            name: name.to_string(),
            columns: cols.iter().map(|s| s.to_string()).collect(),
            ref_table: ref_table.to_string(),
            ref_columns: ref_cols.iter().map(|s| s.to_string()).collect(),
            on_delete: on_delete.map(|s| s.to_string()),
            on_update: on_update.map(|s| s.to_string()),
        }
    }

    fn base_table_def(name: &str, db: &str, columns: Vec<ColumnDefinition>) -> TableDefinition {
        TableDefinition {
            name: name.to_string(),
            database: db.to_string(),
            columns,
            indexes: vec![],
            foreign_keys: vec![],
            engine: None,
            charset: None,
            collation: None,
            comment: None,
        }
    }

    fn base_alteration(db: &str, table: &str) -> TableAlteration {
        TableAlteration {
            database: db.to_string(),
            table: table.to_string(),
            column_changes: vec![],
            index_changes: vec![],
            new_name: None,
            new_comment: None,
            new_engine: None,
            new_charset: None,
        }
    }

    // -----------------------------------------------------------------------
    // 标识符校验
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_identifier_normal() {
        assert!(validate_identifier("users").is_ok());
        assert!(validate_identifier("_private").is_ok());
        assert!(validate_identifier("col123").is_ok());
    }

    #[test]
    fn test_validate_identifier_chinese() {
        assert!(validate_identifier("用户表").is_ok());
        assert!(validate_identifier("字段_name").is_ok());
    }

    #[test]
    fn test_validate_identifier_empty() {
        assert!(validate_identifier("").is_err());
    }

    #[test]
    fn test_validate_identifier_too_long() {
        let long = "a".repeat(129);
        assert!(validate_identifier(&long).is_err());
        // 128 个字符刚好通过
        let ok = "a".repeat(128);
        assert!(validate_identifier(&ok).is_ok());
    }

    #[test]
    fn test_validate_identifier_special_chars() {
        assert!(validate_identifier("drop;--").is_err());
        assert!(validate_identifier("col name").is_err());
        assert!(validate_identifier("123start").is_err());
    }

    // -----------------------------------------------------------------------
    // MySQL CREATE TABLE
    // -----------------------------------------------------------------------

    #[test]
    fn test_mysql_create_basic_table() {
        let def = TableDefinition {
            name: "users".to_string(),
            database: "mydb".to_string(),
            columns: vec![
                col_full("id", "BIGINT", None, false, true, None, None, None),
                col_full("name", "VARCHAR", Some("255"), false, false, None, None, Some("用户名")),
                col("email", "VARCHAR"),
            ],
            indexes: vec![idx("PRIMARY", &["id"], "PRIMARY")],
            foreign_keys: vec![],
            engine: Some("InnoDB".to_string()),
            charset: Some("utf8mb4".to_string()),
            collation: None,
            comment: Some("用户表".to_string()),
        };
        let result = generate_create_table(&def, "mysql").unwrap();
        assert!(result.sql.contains("CREATE TABLE `mydb`.`users`"));
        assert!(result.sql.contains("`id` BIGINT NOT NULL AUTO_INCREMENT"));
        assert!(result.sql.contains("`name` VARCHAR(255) NOT NULL COMMENT '用户名'"));
        assert!(result.sql.contains("PRIMARY KEY (`id`)"));
        assert!(result.sql.contains("ENGINE=InnoDB"));
        assert!(result.sql.contains("DEFAULT CHARSET=utf8mb4"));
        assert!(result.sql.contains("COMMENT='用户表'"));
        assert_eq!(result.statements.len(), 1);
    }

    #[test]
    fn test_mysql_create_with_indexes_and_fk() {
        let def = TableDefinition {
            name: "orders".to_string(),
            database: "shop".to_string(),
            columns: vec![
                col_full("id", "INT", None, false, true, None, None, None),
                col("user_id", "INT"),
                col("status", "VARCHAR"),
            ],
            indexes: vec![
                idx("PRIMARY", &["id"], "PRIMARY"),
                idx("idx_user", &["user_id"], "INDEX"),
                idx("uk_status", &["user_id", "status"], "UNIQUE"),
                idx("ft_status", &["status"], "FULLTEXT"),
            ],
            foreign_keys: vec![
                fk("fk_user", &["user_id"], "users", &["id"], Some("CASCADE"), Some("CASCADE")),
            ],
            engine: None,
            charset: None,
            collation: None,
            comment: None,
        };
        let result = generate_create_table(&def, "mysql").unwrap();
        assert!(result.sql.contains("PRIMARY KEY (`id`)"));
        assert!(result.sql.contains("INDEX `idx_user` (`user_id`)"));
        assert!(result.sql.contains("UNIQUE INDEX `uk_status` (`user_id`, `status`)"));
        assert!(result.sql.contains("FULLTEXT INDEX `ft_status` (`status`)"));
        assert!(result.sql.contains("CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)"));
        assert!(result.sql.contains("ON DELETE CASCADE"));
        assert!(result.sql.contains("ON UPDATE CASCADE"));
    }

    #[test]
    fn test_mysql_column_def_default_and_on_update() {
        let c = col_full(
            "updated_at", "TIMESTAMP", None,
            false, false, Some("CURRENT_TIMESTAMP"),
            Some("CURRENT_TIMESTAMP"), None,
        );
        let def_str = mysql_column_def(&c);
        assert!(def_str.contains("DEFAULT CURRENT_TIMESTAMP"));
        assert!(def_str.contains("ON UPDATE CURRENT_TIMESTAMP"));
        // CURRENT_TIMESTAMP 不应该被引号包裹
        assert!(!def_str.contains("DEFAULT 'CURRENT_TIMESTAMP'"));
    }

    #[test]
    fn test_mysql_column_def_string_default() {
        let c = col_full("status", "VARCHAR", Some("20"), true, false, Some("active"), None, None);
        let def_str = mysql_column_def(&c);
        assert!(def_str.contains("DEFAULT 'active'"));
    }

    #[test]
    fn test_mysql_column_def_null_default() {
        let c = col_full("deleted_at", "TIMESTAMP", None, true, false, Some("NULL"), None, None);
        let def_str = mysql_column_def(&c);
        // NULL 不应被引号包裹
        assert!(def_str.contains("DEFAULT NULL"));
        assert!(!def_str.contains("DEFAULT 'NULL'"));
    }

    // -----------------------------------------------------------------------
    // MySQL ALTER TABLE
    // -----------------------------------------------------------------------

    #[test]
    fn test_mysql_alter_rename_table() {
        let mut alt = base_alteration("mydb", "old_name");
        alt.new_name = Some("new_name".to_string());
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("ALTER TABLE `mydb`.`old_name` RENAME TO `mydb`.`new_name`"));
    }

    #[test]
    fn test_mysql_alter_add_column() {
        let mut alt = base_alteration("mydb", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "add".to_string(),
            column: col_full("age", "INT", None, true, false, Some("0"), None, None),
            old_name: None,
            after_column: Some("name".to_string()),
        }];
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("ADD COLUMN `age` INT DEFAULT '0' AFTER `name`"));
    }

    #[test]
    fn test_mysql_alter_modify_column() {
        let mut alt = base_alteration("mydb", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "modify".to_string(),
            column: col_full("name", "VARCHAR", Some("500"), false, false, None, None, None),
            old_name: None,
            after_column: None,
        }];
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("MODIFY COLUMN `name` VARCHAR(500) NOT NULL"));
    }

    #[test]
    fn test_mysql_alter_drop_column() {
        let mut alt = base_alteration("mydb", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "drop".to_string(),
            column: col("age", "INT"),
            old_name: None,
            after_column: None,
        }];
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("DROP COLUMN `age`"));
    }

    #[test]
    fn test_mysql_alter_rename_column() {
        let mut alt = base_alteration("mydb", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "rename".to_string(),
            column: col_full("username", "VARCHAR", Some("255"), false, false, None, None, None),
            old_name: Some("name".to_string()),
            after_column: None,
        }];
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("CHANGE COLUMN `name` `username` VARCHAR(255) NOT NULL"));
    }

    #[test]
    fn test_mysql_alter_add_drop_index() {
        let mut alt = base_alteration("mydb", "users");
        alt.index_changes = vec![
            IndexChange {
                change_type: "add".to_string(),
                index: idx("idx_email", &["email"], "INDEX"),
            },
            IndexChange {
                change_type: "drop".to_string(),
                index: idx("idx_old", &["old_col"], "INDEX"),
            },
            IndexChange {
                change_type: "drop".to_string(),
                index: idx("PRIMARY", &["id"], "PRIMARY"),
            },
        ];
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("ADD INDEX `idx_email` (`email`)"));
        assert!(result.sql.contains("DROP INDEX `idx_old`"));
        assert!(result.sql.contains("DROP PRIMARY KEY"));
    }

    #[test]
    fn test_mysql_alter_table_options() {
        let mut alt = base_alteration("mydb", "users");
        alt.new_engine = Some("MyISAM".to_string());
        alt.new_charset = Some("utf8mb4".to_string());
        alt.new_comment = Some("新注释".to_string());
        let result = generate_alter_table(&alt, "mysql").unwrap();
        assert!(result.sql.contains("ENGINE=MyISAM"));
        assert!(result.sql.contains("DEFAULT CHARSET=utf8mb4"));
        assert!(result.sql.contains("COMMENT='新注释'"));
    }

    // -----------------------------------------------------------------------
    // PostgreSQL CREATE TABLE
    // -----------------------------------------------------------------------

    #[test]
    fn test_pg_create_basic_table() {
        let def = TableDefinition {
            name: "users".to_string(),
            database: "public".to_string(),
            columns: vec![
                col_full("id", "BIGINT", None, false, true, None, None, None),
                col_full("name", "VARCHAR", Some("255"), false, false, None, None, Some("用户名")),
                col("email", "TEXT"),
            ],
            indexes: vec![idx("PRIMARY", &["id"], "PRIMARY")],
            foreign_keys: vec![],
            engine: None,
            charset: None,
            collation: None,
            comment: Some("用户表".to_string()),
        };
        let result = generate_create_table(&def, "postgresql").unwrap();
        // 自增列映射为 BIGSERIAL
        assert!(result.sql.contains("\"id\" BIGSERIAL NOT NULL"));
        assert!(result.sql.contains("\"name\" VARCHAR(255) NOT NULL"));
        assert!(result.sql.contains("PRIMARY KEY (\"id\")"));
        // 表注释是独立语句
        assert!(result.sql.contains("COMMENT ON TABLE \"public\".\"users\" IS '用户表'"));
        // 列注释是独立语句
        assert!(result.sql.contains("COMMENT ON COLUMN \"public\".\"users\".\"name\" IS '用户名'"));
        // 至少 3 条语句：CREATE TABLE + 表注释 + 列注释
        assert!(result.statements.len() >= 3);
    }

    #[test]
    fn test_pg_serial_mapping() {
        // SMALLINT -> SMALLSERIAL
        let def = base_table_def("t", "public", vec![
            col_full("a", "SMALLINT", None, false, true, None, None, None),
            col_full("b", "INT", None, false, true, None, None, None),
            col_full("c", "BIGINT", None, false, true, None, None, None),
        ]);
        let result = generate_create_table(&def, "postgresql").unwrap();
        assert!(result.sql.contains("SMALLSERIAL"));
        assert!(result.sql.contains("SERIAL"));
        assert!(result.sql.contains("BIGSERIAL"));
    }

    #[test]
    fn test_pg_create_separate_indexes() {
        let def = TableDefinition {
            name: "posts".to_string(),
            database: "public".to_string(),
            columns: vec![col("id", "INT"), col("title", "TEXT")],
            indexes: vec![
                idx("PRIMARY", &["id"], "PRIMARY"),
                idx("idx_title", &["title"], "INDEX"),
            ],
            foreign_keys: vec![],
            engine: None, charset: None, collation: None, comment: None,
        };
        let result = generate_create_table(&def, "postgresql").unwrap();
        // 普通索引是独立的 CREATE INDEX 语句
        assert!(result.sql.contains("CREATE INDEX \"idx_title\" ON \"public\".\"posts\" (\"title\")"));
        assert!(result.statements.len() == 2); // CREATE TABLE + CREATE INDEX
    }

    // -----------------------------------------------------------------------
    // PostgreSQL ALTER TABLE
    // -----------------------------------------------------------------------

    #[test]
    fn test_pg_alter_type_and_nullable() {
        let mut alt = base_alteration("public", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "modify".to_string(),
            column: col_full("name", "TEXT", None, false, false, None, None, None),
            old_name: None,
            after_column: None,
        }];
        let result = generate_alter_table(&alt, "postgresql").unwrap();
        assert!(result.sql.contains("ALTER COLUMN \"name\" TYPE TEXT"));
        assert!(result.sql.contains("ALTER COLUMN \"name\" SET NOT NULL"));
        assert!(result.sql.contains("ALTER COLUMN \"name\" DROP DEFAULT"));
    }

    #[test]
    fn test_pg_alter_rename_column() {
        let mut alt = base_alteration("public", "users");
        alt.column_changes = vec![ColumnChange {
            change_type: "rename".to_string(),
            column: col("username", "VARCHAR"),
            old_name: Some("name".to_string()),
            after_column: None,
        }];
        let result = generate_alter_table(&alt, "postgresql").unwrap();
        assert!(result.sql.contains("RENAME COLUMN \"name\" TO \"username\""));
    }

    #[test]
    fn test_pg_alter_add_drop_index() {
        let mut alt = base_alteration("public", "users");
        alt.index_changes = vec![
            IndexChange {
                change_type: "add".to_string(),
                index: idx("idx_email", &["email"], "INDEX"),
            },
            IndexChange {
                change_type: "drop".to_string(),
                index: idx("PRIMARY", &["id"], "PRIMARY"),
            },
        ];
        let result = generate_alter_table(&alt, "postgresql").unwrap();
        assert!(result.sql.contains("CREATE INDEX \"idx_email\" ON \"public\".\"users\" (\"email\")"));
        // PG 删主键用 DROP CONSTRAINT tablename_pkey
        assert!(result.sql.contains("DROP CONSTRAINT \"users_pkey\""));
    }

    #[test]
    fn test_pg_alter_table_comment() {
        let mut alt = base_alteration("public", "users");
        alt.new_comment = Some("更新后的注释".to_string());
        let result = generate_alter_table(&alt, "postgresql").unwrap();
        assert!(result.sql.contains("COMMENT ON TABLE \"public\".\"users\" IS '更新后的注释'"));
    }

    // -----------------------------------------------------------------------
    // 公共 API 校验
    // -----------------------------------------------------------------------

    #[test]
    fn test_generate_create_invalid_table_name() {
        let def = base_table_def("drop;--", "mydb", vec![col("id", "INT")]);
        assert!(generate_create_table(&def, "mysql").is_err());
    }

    #[test]
    fn test_generate_create_invalid_column_name() {
        let def = base_table_def("t", "mydb", vec![col("col name", "INT")]);
        assert!(generate_create_table(&def, "mysql").is_err());
    }

    #[test]
    fn test_generate_alter_invalid_new_name() {
        let mut alt = base_alteration("mydb", "users");
        alt.new_name = Some("123bad".to_string());
        assert!(generate_alter_table(&alt, "mysql").is_err());
    }

    #[test]
    fn test_mysql_escape_single_quote() {
        let def = TableDefinition {
            name: "t".to_string(),
            database: "db".to_string(),
            columns: vec![col("id", "INT")],
            indexes: vec![],
            foreign_keys: vec![],
            engine: None, charset: None, collation: None,
            comment: Some("it's a table".to_string()),
        };
        let result = generate_create_table(&def, "mysql").unwrap();
        assert!(result.sql.contains("COMMENT='it\\'s a table'"));
    }

    #[test]
    fn test_driver_dispatch() {
        let def = base_table_def("t", "db", vec![col("id", "INT")]);
        // 默认走 MySQL
        let mysql_result = generate_create_table(&def, "mysql").unwrap();
        assert!(mysql_result.sql.contains('`'));
        // PG 用双引号
        let pg_result = generate_create_table(&def, "postgresql").unwrap();
        assert!(pg_result.sql.contains('"'));
    }
}
