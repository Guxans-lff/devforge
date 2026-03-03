import type { ColumnInfo } from './database'

export interface ColumnModification {
  columnName: string
  source: ColumnInfo
  target: ColumnInfo
  changes: string[]
}

export interface TableDiff {
  tableName: string
  columnsAdded: ColumnInfo[]
  columnsRemoved: ColumnInfo[]
  columnsModified: ColumnModification[]
}

export interface SchemaDiff {
  tablesOnlyInSource: string[]
  tablesOnlyInTarget: string[]
  tableDiffs: TableDiff[]
}
