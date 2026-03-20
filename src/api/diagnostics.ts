import { invokeCommand } from '@/api/base'

/** 崩溃日志条目（对应后端 CrashLogEntry） */
export interface CrashLogEntry {
  filename: string
  path: string
  size: number
  modified: string
}

/** 获取崩溃日志列表 */
export function listCrashLogs(): Promise<CrashLogEntry[]> {
  return invokeCommand('list_crash_logs', undefined, { source: 'SYSTEM', silent: true })
}

/** 读取指定崩溃日志内容 */
export function readCrashLog(filename: string): Promise<string> {
  return invokeCommand('read_crash_log', { filename }, { source: 'SYSTEM' })
}

/** 清除所有崩溃日志，返回清除数量 */
export function clearCrashLogs(): Promise<number> {
  return invokeCommand('clear_crash_logs', undefined, { source: 'SYSTEM' })
}

/** 写入前端错误日志（追加到 error_YYYYMMDD.log） */
export function writeErrorLog(content: string): Promise<void> {
  return invokeCommand('write_error_log', { content }, { source: 'SYSTEM', silent: true })
}
