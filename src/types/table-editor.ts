export interface ColumnDefinition {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  autoIncrement: boolean
  comment: string | null
}

export interface IndexDefinition {
  name: string
  columns: string[]
  indexType: string // "PRIMARY", "UNIQUE", "INDEX", "FULLTEXT"
}

export interface ForeignKeyDefinition {
  name: string
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete: string | null
  onUpdate: string | null
}

export interface TableDefinition {
  name: string
  database: string
  columns: ColumnDefinition[]
  indexes: IndexDefinition[]
  foreignKeys: ForeignKeyDefinition[]
  engine: string | null
  charset: string | null
  collation: string | null
  comment: string | null
}

export interface ColumnChange {
  changeType: string
  column: ColumnDefinition
  oldName: string | null
  afterColumn: string | null
}

export interface IndexChange {
  changeType: string
  index: IndexDefinition
}

export interface TableAlteration {
  database: string
  table: string
  columnChanges: ColumnChange[]
  indexChanges: IndexChange[]
  newName: string | null
  newComment: string | null
  newEngine: string | null
  newCharset: string | null
}

export interface DdlResult {
  sql: string
  statements: string[]
}

export interface TableDetail {
  name: string
  columns: ColumnDefinition[]
  indexes: IndexDefinition[]
  foreignKeys: ForeignKeyDefinition[]
  engine: string | null
  charset: string | null
  collation: string | null
  comment: string | null
}
