import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { usePersistence } from '@/plugins/persistence'
import type {
  WorkspaceRoot,
  FileNode,
  FileDecoration,
  DirEntry,
  FileChangeEvent,
  GitFileStatus,
} from '@/types/workspace-files'

export const useWorkspaceFilesStore = defineStore('workspace-files', () => {
  // ─── 状态 ───
  const roots = ref<WorkspaceRoot[]>([])
  const expandedDirs = ref<Set<string>>(new Set())
  const nodeCache = ref<Map<string, FileNode[]>>(new Map())
  const decorations = shallowRef<Map<string, FileDecoration>>(new Map())
  const renamingNodeId = ref<string | null>(null)
  /** 多选节点 ID 集合 */
  const selectedNodes = ref<Set<string>>(new Set())

  /** 当前活跃编辑器上下文（用于 AI IDE 上下文注入 P1-4） */
  interface ActiveEditorInfo {
    path: string
    language: string
    cursorLine: number
    selectedText: string
  }
  const activeEditor = ref<ActiveEditorInfo | null>(null)
  let _editorSetTimer: ReturnType<typeof setTimeout> | null = null

  /** 节流 300ms 更新 activeEditor（Monaco 光标频繁触发） */
  function setActiveEditor(info: ActiveEditorInfo | null): void {
    if (_editorSetTimer) clearTimeout(_editorSetTimer)
    _editorSetTimer = setTimeout(() => {
      activeEditor.value = info
    }, 300)
  }

  // ─── 持久化（仅 roots） ───
  const persistence = usePersistence({
    key: 'workspace-files',
    version: 1,
    serialize: () => ({ roots: roots.value }),
    deserialize: (data: any) => {
      if (data?.roots) {
        roots.value = data.roots
      }
    },
    debounce: 500,
  })

  // ─── 路径 hash 工具（DJB2） ───
  function hashPath(path: string): string {
    let hash = 0
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
    }
    return Math.abs(hash).toString(36).slice(0, 8)
  }

  // ─── Roots 管理 ───
  async function addRoot(path: string): Promise<void> {
    const normalizedPath = path.replace(/\\/g, '/')
    if (roots.value.some(r => r.path === normalizedPath)) return

    const name = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath
    const root: WorkspaceRoot = {
      id: hashPath(normalizedPath),
      path: normalizedPath,
      name,
      collapsed: false,
      sortOrder: roots.value.length,
    }
    roots.value.push(root)

    // 启动监听
    await invoke('ws_watch_directory', { id: root.id, path: normalizedPath })
    // 加载第一层
    await loadChildren(root.id, normalizedPath, 0)
    // 刷新 Git 状态
    refreshGitDecorations(normalizedPath)
  }

  async function removeRoot(id: string): Promise<void> {
    const root = roots.value.find(r => r.id === id)
    if (!root) return

    await invoke('ws_unwatch_directory', { id })
    roots.value = roots.value.filter(r => r.id !== id)

    // 清理缓存
    for (const key of nodeCache.value.keys()) {
      if (key.startsWith(root.path)) {
        nodeCache.value.delete(key)
      }
    }
    // 清理展开状态
    for (const dir of expandedDirs.value) {
      if (dir.startsWith(id + ':')) {
        expandedDirs.value.delete(dir)
      }
    }
  }

  function reorderRoots(fromIndex: number, toIndex: number): void {
    const item = roots.value.splice(fromIndex, 1)[0]
    roots.value.splice(toIndex, 0, item)
    roots.value.forEach((r, i) => r.sortOrder = i)
  }

  // ─── 目录加载 ───
  async function loadChildren(
    rootId: string,
    absolutePath: string,
    depth: number,
  ): Promise<void> {
    const entries: DirEntry[] = await invoke('ws_read_directory', { path: absolutePath })
    const root = roots.value.find(r => r.id === rootId)
    if (!root) return

    const rootPath = root.path
    const nodes: FileNode[] = entries.map(entry => {
      const entryAbsPath = `${absolutePath}/${entry.name}`
      const relativePath = entryAbsPath.slice(rootPath.length + 1)
      const nodeId = `${rootId}:${relativePath}`
      return {
        id: nodeId,
        rootId,
        name: entry.name,
        path: relativePath,
        absolutePath: entryAbsPath,
        depth,
        isDirectory: entry.isDir,
        isExpanded: expandedDirs.value.has(nodeId),
        isLoading: false,
        isCompressed: false,
      }
    })

    nodeCache.value.set(absolutePath, nodes)
    nodeCache.value = new Map(nodeCache.value)
  }

  // ─── 展开/折叠 ───
  async function expandDir(nodeId: string): Promise<void> {
    expandedDirs.value.add(nodeId)
    expandedDirs.value = new Set(expandedDirs.value)

    const node = findNodeById(nodeId)
    if (!node) return

    if (!nodeCache.value.has(node.absolutePath)) {
      await loadChildren(node.rootId, node.absolutePath, node.depth + 1)
    }

    setTimeout(() => prefetchChildren(node), 250)
  }

  function collapseDir(nodeId: string): void {
    expandedDirs.value.delete(nodeId)
    expandedDirs.value = new Set(expandedDirs.value)
  }

  function toggleDir(nodeId: string): void {
    if (expandedDirs.value.has(nodeId)) {
      collapseDir(nodeId)
    } else {
      expandDir(nodeId)
    }
  }

  /** 预取已展开目录的直接子目录 */
  async function prefetchChildren(node: FileNode): Promise<void> {
    const children = nodeCache.value.get(node.absolutePath) || []
    const dirsToFetch = children.filter(
      c => c.isDirectory && !nodeCache.value.has(c.absolutePath)
    )
    await Promise.all(
      dirsToFetch.map(d => loadChildren(d.rootId, d.absolutePath, d.depth + 1))
    )
  }

  // ─── 节点查找 ───
  function findNodeById(nodeId: string): FileNode | undefined {
    for (const nodes of nodeCache.value.values()) {
      const found = nodes.find(n => n.id === nodeId)
      if (found) return found
    }
    return undefined
  }

  // ─── 压缩文件夹 + flatNodes ───
  const flatNodes = computed<FileNode[]>(() => {
    const result: FileNode[] = []

    for (const root of roots.value) {
      // 根标题作为虚拟滚动节点（32px 行高）
      result.push({
        id: `root-header:${root.id}`,
        rootId: root.id,
        name: root.name,
        path: '',
        absolutePath: root.path,
        depth: -1,
        isDirectory: true,
        isExpanded: !root.collapsed,
        isLoading: false,
        isCompressed: false,
        isRootHeader: true,
      })
      if (root.collapsed) continue
      const children = nodeCache.value.get(root.path) || []
      for (const child of children) {
        appendNode(child, result)
      }
    }

    return result
  })

  function appendNode(node: FileNode, result: FileNode[]): void {
    // 压缩文件夹检测
    if (node.isDirectory) {
      const compressed = tryCompress(node)
      if (compressed) {
        result.push(compressed)
        if (expandedDirs.value.has(compressed.id)) {
          const lastSegmentPath = compressed.absolutePath
          const children = nodeCache.value.get(lastSegmentPath) || []
          for (const child of children) {
            appendNode(child, result)
          }
        }
        return
      }
    }

    result.push({ ...node, isExpanded: expandedDirs.value.has(node.id) })

    if (node.isDirectory && expandedDirs.value.has(node.id)) {
      const children = nodeCache.value.get(node.absolutePath) || []
      for (const child of children) {
        appendNode(child, result)
      }
    }
  }

  /** 尝试压缩单子目录链 */
  function tryCompress(node: FileNode): FileNode | null {
    const segments = [node.name]
    let current = node
    let lastAbsPath = node.absolutePath

    while (true) {
      const children = nodeCache.value.get(current.absolutePath)
      if (!children || children.length !== 1 || !children[0].isDirectory) break
      current = children[0]
      segments.push(current.name)
      lastAbsPath = current.absolutePath
    }

    if (segments.length <= 1) return null

    return {
      ...node,
      id: current.id,
      name: segments.join(' / '),
      absolutePath: lastAbsPath,
      isCompressed: true,
      compressedSegments: segments,
      isExpanded: expandedDirs.value.has(current.id),
    }
  }

  // ─── CRUD 操作 ───

  /**
   * 主动刷新一个目录的子节点缓存
   *
   * 依赖 file_watcher 事件有延迟（notify debounce 300ms）甚至偶发不触发，
   * CRUD 操作后必须自己刷新父目录以获得即时反馈。
   */
  async function refreshDirectory(absolutePath: string): Promise<void> {
    // 若父目录还未加载过（未展开），无需刷新，展开时会懒加载
    if (!nodeCache.value.has(absolutePath)) {
      // 但根目录必须刷新
      const isRoot = roots.value.some(r => r.path === absolutePath)
      if (!isRoot) return
    }
    const node = findNodeByAbsPath(absolutePath)
    const depth = node ? (node.depth < 0 ? 0 : node.depth + 1) : 0
    const rootId =
      node?.rootId ??
      roots.value.find(r => absolutePath === r.path || absolutePath.startsWith(r.path + '/'))?.id
    if (!rootId) return
    await loadChildren(rootId, absolutePath, depth)
  }

  async function createFile(parentPath: string, name: string): Promise<void> {
    const fullPath = `${parentPath}/${name}`
    await invoke('ws_create_file', { path: fullPath })
    await refreshDirectory(parentPath)
  }

  async function createDirectory(parentPath: string, name: string): Promise<void> {
    const fullPath = `${parentPath}/${name}`
    await invoke('ws_create_directory', { path: fullPath })
    await refreshDirectory(parentPath)
  }

  async function renameEntry(oldAbsPath: string, newName: string): Promise<void> {
    const parent = oldAbsPath.split('/').slice(0, -1).join('/')
    const newPath = `${parent}/${newName}`
    await invoke('ws_rename_entry', { oldPath: oldAbsPath, newPath })
    renamingNodeId.value = null
    await refreshDirectory(parent)
  }

  async function deleteEntry(absolutePath: string, permanent = false): Promise<void> {
    await invoke('ws_delete_entry', { path: absolutePath, permanent })
    // 从父目录缓存里直接移除该节点，避免整棵树重渲染
    const sep = absolutePath.lastIndexOf('/')
    const parent = sep > 0 ? absolutePath.slice(0, sep) : ''
    if (parent && nodeCache.value.has(parent)) {
      const filtered = nodeCache.value.get(parent)!.filter(n => n.absolutePath !== absolutePath)
      nodeCache.value.set(parent, filtered)
      nodeCache.value = new Map(nodeCache.value)
    }
    // 若被删的是目录，清理其自身缓存及所有子缓存
    for (const key of nodeCache.value.keys()) {
      if (key === absolutePath || key.startsWith(absolutePath + '/')) {
        nodeCache.value.delete(key)
      }
    }
  }

  async function moveEntry(source: string, targetDir: string): Promise<void> {
    const sourceParent = source.split('/').slice(0, -1).join('/')
    await invoke('ws_move_entry', { source, targetDir })
    if (sourceParent) await refreshDirectory(sourceParent)
    await refreshDirectory(targetDir)
  }

  // ─── Git 装饰 ───
  async function refreshGitDecorations(rootPath: string): Promise<void> {
    try {
      const statuses: GitFileStatus[] = await invoke('ws_get_git_status', { repoPath: rootPath })
      const newMap = new Map(decorations.value)
      for (const key of newMap.keys()) {
        if (key.startsWith(rootPath)) {
          newMap.delete(key)
        }
      }
      for (const status of statuses) {
        const absPath = `${rootPath}/${status.path}`
        newMap.set(absPath, { gitStatus: status.status })
      }
      decorations.value = newMap
    } catch {
      // 非 git 仓库，忽略
    }
  }

  // ─── 文件变更事件处理 ───
  async function handleFileChanges(rootId: string, changes: FileChangeEvent[]): Promise<void> {
    const root = roots.value.find(r => r.id === rootId)
    if (!root) return

    const dirsToRefresh = new Set<string>()
    for (const change of changes) {
      const parent = change.path.split('/').slice(0, -1).join('/')
      if (parent) dirsToRefresh.add(parent)
      if (change.newPath) {
        const newParent = change.newPath.split('/').slice(0, -1).join('/')
        if (newParent) dirsToRefresh.add(newParent)
      }
    }

    for (const dir of dirsToRefresh) {
      if (nodeCache.value.has(dir)) {
        const node = findNodeByAbsPath(dir)
        if (node) {
          await loadChildren(node.rootId, dir, node.depth + 1)
        }
      }
    }

    refreshGitDecorations(root.path)
  }

  function findNodeByAbsPath(absPath: string): FileNode | undefined {
    for (const nodes of nodeCache.value.values()) {
      const found = nodes.find(n => n.absolutePath === absPath)
      if (found) return found
    }
    const root = roots.value.find(r => r.path === absPath)
    if (root) {
      return {
        id: root.id,
        rootId: root.id,
        name: root.name,
        path: '',
        absolutePath: root.path,
        depth: -1,
        isDirectory: true,
        isExpanded: true,
        isLoading: false,
        isCompressed: false,
      }
    }
    return undefined
  }

  // ─── 初始化 ───
  let _initialized = false
  async function init(): Promise<void> {
    if (_initialized) return
    _initialized = true

    await persistence.load()
    persistence.autoSave([roots])

    // 恢复监听 + 加载第一层
    for (const root of roots.value) {
      invoke('ws_watch_directory', { id: root.id, path: root.path }).catch((e) => {
        console.warn('[workspace-fs] watch 失败:', root.path, e)
      })
      loadChildren(root.id, root.path, 0).catch((e) => {
        console.warn('[workspace-fs] 首次加载失败:', root.path, e)
      })
      refreshGitDecorations(root.path)
    }

    // 监听文件变更事件（50ms 二次去抖）
    let _changeBuffer: { id: string; changes: FileChangeEvent[] }[] = []
    let _changeTimer: ReturnType<typeof setTimeout> | null = null

    listen<{ id: string; changes: FileChangeEvent[] }>('explorer:changes', (event) => {
      _changeBuffer.push(event.payload)
      if (_changeTimer) clearTimeout(_changeTimer)
      _changeTimer = setTimeout(() => {
        const buffered = _changeBuffer
        _changeBuffer = []
        const merged = new Map<string, FileChangeEvent[]>()
        for (const { id, changes } of buffered) {
          const existing = merged.get(id) || []
          existing.push(...changes)
          merged.set(id, existing)
        }
        for (const [id, changes] of merged) {
          handleFileChanges(id, changes)
        }
      }, 50)
    })
  }

  // ─── 多选操作 ───

  /** 切换节点选中（Ctrl+Click） */
  function toggleSelect(nodeId: string): void {
    const s = new Set(selectedNodes.value)
    if (s.has(nodeId)) s.delete(nodeId)
    else s.add(nodeId)
    selectedNodes.value = s
  }

  /** 范围选中（Shift+Click） */
  function rangeSelect(fromIndex: number, toIndex: number): void {
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    const nodes = flatNodes.value.slice(start, end + 1)
    const s = new Set(selectedNodes.value)
    for (const n of nodes) {
      if (!n.isRootHeader) s.add(n.id)
    }
    selectedNodes.value = s
  }

  /** 清空多选 */
  function clearSelection(): void {
    selectedNodes.value = new Set()
  }

  /** 全选当前目录下的所有文件 */
  function selectAllInDir(dirPath: string, _rootId: string): void {
    const children = nodeCache.value.get(dirPath)
    if (!children) return
    const s = new Set(selectedNodes.value)
    for (const child of children) {
      s.add(child.id)
    }
    selectedNodes.value = s
  }

  /** 批量删除选中节点 */
  async function batchDelete(): Promise<{ success: number; failed: number }> {
    let success = 0, failed = 0
    const deleted: string[] = []

    for (const id of selectedNodes.value) {
      const node = findNodeById(id)
      if (!node) { failed++; continue }
      try {
        await invoke('ws_delete_entry', { path: node.absolutePath, permanent: false })
        deleted.push(node.absolutePath)
        success++
      } catch { failed++ }
    }

    clearSelection()

    // 局部移除缓存节点，避免全量刷新
    for (const absPath of deleted) {
      const sep = absPath.lastIndexOf('/')
      const parent = sep > 0 ? absPath.slice(0, sep) : ''
      if (parent && nodeCache.value.has(parent)) {
        const filtered = nodeCache.value.get(parent)!.filter(n => n.absolutePath !== absPath)
        nodeCache.value.set(parent, filtered)
      }
      for (const key of nodeCache.value.keys()) {
        if (key === absPath || key.startsWith(absPath + '/')) {
          nodeCache.value.delete(key)
        }
      }
    }
    if (deleted.length > 0) {
      nodeCache.value = new Map(nodeCache.value)
    }

    return { success, failed }
  }

  /** 批量复制路径 */
  function batchCopyPaths(relative = false): string[] {
    const paths: string[] = []
    for (const id of selectedNodes.value) {
      const node = findNodeById(id)
      if (node) paths.push(relative ? node.path : node.absolutePath)
    }
    return paths
  }

  /** 刷新指定 root 的文件树（清缓存 + 重载第一层 + Git 状态） */
  async function refreshRoot(rootId: string): Promise<void> {
    if (!root) return

    // 清缓存
    for (const key of nodeCache.value.keys()) {
      if (key.startsWith(root.path)) {
        nodeCache.value.delete(key)
      }
    }
    nodeCache.value = new Map(nodeCache.value)

    // 重载
    await loadChildren(root.id, root.path, 0)
    refreshGitDecorations(root.path)
  }

  return {
    roots,
    expandedDirs,
    nodeCache,
    decorations,
    renamingNodeId,
    selectedNodes,
    activeEditor,
    setActiveEditor,
    flatNodes,
    addRoot,
    removeRoot,
    reorderRoots,
    expandDir,
    collapseDir,
    toggleDir,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    moveEntry,
    findNodeById,
    refreshGitDecorations,
    refreshRoot,
    toggleSelect,
    rangeSelect,
    clearSelection,
    selectAllInDir,
    batchDelete,
    batchCopyPaths,
    init,
  }
})
