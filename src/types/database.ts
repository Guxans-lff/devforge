export interface QueryResult {
  columns: ColumnDef[]
  rows: unknown[][]
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  error: string | null
}

export interface ColumnDef {
  name: string
  dataType: string
  nullable: boolean
}

export interface TableInfo {
  name: string
  tableType: string
  rowCount: number | null
  comment: string | null
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  comment: string | null
}

export interface DatabaseInfo {
  name: string
  characterSet: string | null
  collation: string | null
}

export interface DatabaseTreeNode {
  id: string
  label: string
  type: 'database' | 'table' | 'view' | 'column'
  icon?: string
  children?: DatabaseTreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
  meta?: {
    database?: string
    table?: string
    dataType?: string
    isPrimaryKey?: boolean
    nullable?: boolean
    comment?: string
  }
}

export interface SchemaCache {
  databases: Map<string, DatabaseSchema>
}

export interface DatabaseSchema {
  tables: Map<string, TableSchema>
}

export interface TableSchema {
  columns: ColumnInfo[]
  tableType: string
}
