export interface ColumnMapping {
  sourceColumn: string
  targetColumn: string
}

export interface ImportConfig {
  filePath: string
  fileType: string
  connectionId: string
  database: string
  table: string
  columnMapping: ColumnMapping[]
  hasHeader: boolean
  delimiter: string | null
  batchSize: number | null
}

export interface ImportPreview {
  columns: string[]
  sampleRows: string[][]
  totalRows: number | null
}

export interface ImportProgress {
  importedRows: number
  totalRows: number
  status: string
  error: string | null
}

export interface ImportResult {
  success: boolean
  importedRows: number
  error: string | null
}
