import { invoke } from '@tauri-apps/api/core'

/** 读取远程文件文本内容 */
export function sftpReadFileContent(
  connectionId: string,
  remotePath: string,
  maxSize?: number,
): Promise<string> {
  return invoke('sftp_read_file_content', { connectionId, remotePath, maxSize })
}

/** 写入文本内容到远程文件 */
export function sftpWriteFileContent(
  connectionId: string,
  remotePath: string,
  content: string,
): Promise<void> {
  return invoke('sftp_write_file_content', { connectionId, remotePath, content })
}

/** 修改远程文件权限 */
export function sftpChmod(
  connectionId: string,
  path: string,
  mode: number,
): Promise<void> {
  return invoke('sftp_chmod', { connectionId, path, mode })
}

/** 启动搜索远程文件（流式，结果通过 event 推送，返回搜索完成状态） */
export function sftpSearchFiles(
  connectionId: string,
  basePath: string,
  pattern: string,
  caseSensitive?: boolean,
  maxDepth?: number,
): Promise<{ cancelled: boolean; total: number }> {
  return invoke('sftp_search_files', { connectionId, basePath, pattern, caseSensitive, maxDepth })
}

/** 取消正在进行的搜索 */
export function sftpCancelSearch(connectionId: string): Promise<void> {
  return invoke('sftp_cancel_search', { connectionId })
}

/** 读取本地文件文本内容 */
export function localReadFileContent(
  path: string,
  maxSize?: number,
): Promise<string> {
  return invoke('local_read_file_content', { path, maxSize })
}
