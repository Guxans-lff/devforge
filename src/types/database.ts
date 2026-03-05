export interface QueryResult {
  columns: ColumnDef[]
  rows: unknown[][]
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  error: string | null
  totalCount: number | null
  truncated: boolean
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

export interface ViewInfo {
  name: string
  definer: string | null
  checkOption: string | null
  isUpdatable: string | null
}

export interface RoutineInfo {
  name: string
  routineType: string
  definer: string | null
  created: string | null
  modified: string | null
  comment: string | null
}

export interface TriggerInfo {
  name: string
  event: string
  timing: string
  tableName: string
  statement: string | null
}

export interface DatabaseTreeNode {
  id: string
  label: string
  type: 'database' | 'table' | 'view' | 'column' | 'folder' | 'procedure' | 'function' | 'trigger'
  icon?: string
  children?: DatabaseTreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
  folderType?: 'tables' | 'views' | 'procedures' | 'functions' | 'triggers'
  meta?: {
    database?: string
    table?: string
    dataType?: string
    isPrimaryKey?: boolean
    nullable?: boolean
    comment?: string
    objectType?: string
    routineType?: string
    definer?: string
    created?: string
    event?: string
    timing?: string
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
