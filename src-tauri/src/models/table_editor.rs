use serde::{Deserialize, Serialize};

/// Column definition for creating/altering tables
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub length: Option<String>,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
    pub on_update: Option<String>,
    pub comment: Option<String>,
}

/// Index definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDefinition {
    pub name: String,
    pub columns: Vec<String>,
    pub index_type: String, // "PRIMARY", "UNIQUE", "INDEX", "FULLTEXT"
}

/// Foreign key definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyDefinition {
    pub name: String,
    pub columns: Vec<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

/// Full table definition for CREATE TABLE
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDefinition {
    pub name: String,
    pub database: String,
    pub columns: Vec<ColumnDefinition>,
    pub indexes: Vec<IndexDefinition>,
    pub foreign_keys: Vec<ForeignKeyDefinition>,
    pub engine: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}
/// Column change for ALTER TABLE
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnChange {
    pub change_type: String, // "add", "modify", "drop", "rename"
    pub column: ColumnDefinition,
    pub old_name: Option<String>,
    pub after_column: Option<String>,
}

/// Index change for ALTER TABLE
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexChange {
    pub change_type: String, // "add", "drop"
    pub index: IndexDefinition,
}

/// Table alteration definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableAlteration {
    pub database: String,
    pub table: String,
    pub column_changes: Vec<ColumnChange>,
    pub index_changes: Vec<IndexChange>,
    pub new_name: Option<String>,
    pub new_comment: Option<String>,
    pub new_engine: Option<String>,
    pub new_charset: Option<String>,
}

/// Result of DDL generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdlResult {
    pub sql: String,
    pub statements: Vec<String>,
}

/// Table detail info (for loading existing table into editor)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    pub indexes: Vec<IndexDefinition>,
    pub foreign_keys: Vec<ForeignKeyDefinition>,
    pub engine: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}
