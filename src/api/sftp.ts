import { invokeCommand } from '@/api/base'
import type { FileEntry, FileInfo } from '@/types/fileManager'

export function sftpConnect(connectionId: string): Promise<boolean> {
  return invokeCommand('sftp_connect', { connectionId })
}

export function sftpDisconnect(connectionId: string): Promise<boolean> {
  return invokeCommand('sftp_disconnect', { connectionId })
}

export function sftpListDir(connectionId: string, path: string): Promise<FileEntry[]> {
  return invokeCommand('sftp_list_dir', { connectionId, path })
}

export function sftpStat(connectionId: string, path: string): Promise<FileInfo> {
  return invokeCommand('sftp_stat', { connectionId, path })
}

export function sftpMkdir(connectionId: string, path: string): Promise<boolean> {
  return invokeCommand('sftp_mkdir', { connectionId, path })
}

export function sftpDelete(
  connectionId: string,
  path: string,
  isDir: boolean,
): Promise<boolean> {
  return invokeCommand('sftp_delete', { connectionId, path, isDir })
}

export function sftpRename(
  connectionId: string,
  oldPath: string,
  newPath: string,
): Promise<boolean> {
  return invokeCommand('sftp_rename', { connectionId, oldPath, newPath })
}

export function sftpDownload(
  connectionId: string,
  remotePath: string,
  localPath: string,
): Promise<string> {
  return invokeCommand('sftp_download', { connectionId, remotePath, localPath })
}

export function sftpUpload(
  connectionId: string,
  localPath: string,
  remotePath: string,
): Promise<string> {
  return invokeCommand('sftp_upload', { connectionId, localPath, remotePath })
}

// 分块上传(带实时进度)
export function startUploadChunked(
  id: string,
  connectionId: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invokeCommand('start_upload_chunked', { id, connectionId, localPath, remotePath })
}

// 分块下载(带实时进度)
export function startDownloadChunked(
  id: string,
  connectionId: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  return invokeCommand('start_download_chunked', { id, connectionId, remotePath, localPath })
}

// 暂停传输
export function pauseTransfer(id: string): Promise<void> {
  return invokeCommand('pause_transfer', { id })
}

// 恢复传输
export function resumeTransfer(id: string, connectionId: string): Promise<void> {
  return invokeCommand('resume_transfer', { id, connectionId })
}

// 取消传输
export function cancelTransfer(id: string): Promise<void> {
  return invokeCommand('cancel_transfer', { id })
}

export function localListDir(path: string): Promise<FileEntry[]> {
  return invokeCommand('local_list_dir', { path })
}

export function localMkdir(path: string): Promise<void> {
  return invokeCommand('local_mkdir', { path })
}

export function localDelete(path: string): Promise<void> {
  return invokeCommand('local_delete', { path })
}

export function localRename(oldPath: string, newPath: string): Promise<void> {
  return invokeCommand('local_rename', { oldPath, newPath })
}

// Recursive directory listing
export async function localListRecursive(path: string): Promise<Array<[string, number]>> {
  return invokeCommand('local_list_recursive', { path })
}

export async function sftpListRecursive(
  connectionId: string,
  path: string,
): Promise<Array<[string, number]>> {
  return invokeCommand('sftp_list_recursive', { connectionId, path })
}

// Batch folder transfer
export async function uploadFolderRecursive(
  connectionId: string,
  localFolder: string,
  remoteFolder: string,
): Promise<string[]> {
  return invokeCommand('upload_folder_recursive', { connectionId, localFolder, remoteFolder })
}

export async function downloadFolderRecursive(
  connectionId: string,
  remoteFolder: string,
  localFolder: string,
): Promise<string[]> {
  return invokeCommand('download_folder_recursive', { connectionId, remoteFolder, localFolder })
}

// Get available drives (Windows) or mount points (Unix)
export async function getAvailableDrives(): Promise<string[]> {
  return invokeCommand('get_available_drives')
}
