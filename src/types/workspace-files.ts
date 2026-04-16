/** 工作区根文件夹 */
export interface WorkspaceRoot {
  id: string                    // 路径 hash（DJB2）
  path: string                  // 绝对路径
  name: string                  // 显示名（路径最后一段）
  collapsed: boolean
  sortOrder: number
}

/** 扁平树节点 */
export interface FileNode {
  id: string                    // rootId:relativePath
  rootId: string
  name: string
  path: string                  // 相对路径
  absolutePath: string
  depth: number
  isDirectory: boolean
  isExpanded: boolean
  isLoading: boolean
  /** 压缩文件夹（单子目录链合并） */
  isCompressed: boolean
  compressedSegments?: string[]
  childCount?: number
  /** 是否为工作区根标题行（参与虚拟滚动） */
  isRootHeader?: boolean
}

/** 装饰信息（与节点解耦） */
export interface FileDecoration {
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
  badge?: string
  color?: string
}

/** Tauri 返回的目录条目 */
export interface DirEntry {
  name: string
  isDir: boolean
  size?: number
  modified?: number
}

/** 递归目录条目 */
export interface RecursiveDirEntry {
  relativePath: string
  name: string
  isDir: boolean
  depth: number
}

/** 文件变更事件 */
export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename'
  path: string
  newPath?: string
  isDir: boolean
}

/** Git 文件状态 */
export interface GitFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
}
