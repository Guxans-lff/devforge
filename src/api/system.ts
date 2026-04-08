/**
 * 系统级 Tauri 命令封装
 * 包含：数据路径、启动配置、文件操作、安装器等
 */
import { invokeCommand } from './base'

/** 获取推荐的数据存储路径 */
export function getSuggestedDataPath(): Promise<string> {
  return invokeCommand('get_suggested_data_path')
}

/** 更新启动配置（数据存储路径等） */
export function updateBootConfig(dataStoragePath: string): Promise<void> {
  return invokeCommand('update_boot_config', { dataStoragePath })
}

/** 下载更新安装包 */
export function downloadUpdate(url: string, sha256: string | null): Promise<{ savedPath: string; fileSize: number }> {
  return invokeCommand('download_update', { url, sha256 })
}

/** 启动安装器 */
export function launchInstaller(path: string): Promise<void> {
  return invokeCommand('launch_installer', { path })
}

/** 在文件管理器中打开所在目录 */
export function revealInFolder(path: string): Promise<void> {
  return invokeCommand('reveal_in_folder', { path })
}
