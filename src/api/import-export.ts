import { invokeCommand } from '@/api/base'

// 导出格式
export interface ConnectionExport {
  version: number  // 导出格式版本
  exportedAt: number  // 导出时间戳
  connections: ConnectionExportItem[]
  groups: ConnectionGroupExport[]
}

export interface ConnectionExportItem {
  name: string
  type: string  // 'database' | 'ssh' | 'sftp'
  groupName?: string  // 分组名称（而不是 ID）
  host: string
  port: number
  username: string
  password?: string  // 可选，明文密码
  config: Record<string, any>  // 类型特定配置
  color?: string
}

export interface ConnectionGroupExport {
  name: string
  parentName?: string  // 父分组名称
}

// 导入选项
export interface ImportOptions {
  conflictStrategy: 'skip' | 'overwrite' | 'rename'  // 冲突处理策略
  importPasswords: boolean  // 是否导入密码
}

// 导入结果
export interface ImportResult {
  success: boolean
  imported: number  // 成功导入的连接数
  skipped: number  // 跳过的连接数
  failed: number  // 失败的连接数
  errors: string[]  // 错误信息
}

// 导入预览
export interface ImportPreview {
  connections: ConnectionExportItem[]
  groups: ConnectionGroupExport[]
  conflicts: string[]  // 冲突的连接名称
}

// API 函数

export function exportConnections(connectionIds?: string[]): Promise<ConnectionExport> {
  return invokeCommand('export_connections', { connectionIds })
}

export function importConnections(
  data: ConnectionExport,
  options: ImportOptions
): Promise<ImportResult> {
  return invokeCommand('import_connections', { data, options })
}

export function previewImport(data: ConnectionExport): Promise<ImportPreview> {
  return invokeCommand('preview_import', { data })
}

// Navicat 导入
export function importNavicatXml(xmlContent: string): Promise<ConnectionExport> {
  return invokeCommand('import_navicat_xml', { xmlContent })
}

// Termius 导入
export function importTermiusJson(jsonContent: string): Promise<ConnectionExport> {
  return invokeCommand('import_termius_json', { jsonContent })
}
