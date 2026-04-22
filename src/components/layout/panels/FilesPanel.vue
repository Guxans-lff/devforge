<script setup lang="ts">
/**
 * FilesPanel — 多根工作区本地文件资源管理器
 *
 * 支持多项目文件夹同时浏览、懒加载虚拟滚动、CRUD、
 * 实时文件监听、Git 状态装饰、压缩文件夹。
 */
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useAiChatStore } from '@/stores/ai-chat'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileTree } from '@/composables/useFileTree'
import type { FileNode } from '@/types/workspace-files'
import WorkspaceRootHeader from './files/WorkspaceRootHeader.vue'
import FileTreeRow from './files/FileTreeRow.vue'
import FileSearchDialog from './files/FileSearchDialog.vue'
import FileContextMenu from './files/FileContextMenu.vue'
import {
  FolderPlus,
  FilePlus,
  FolderOpen,
  Search,
  ChevronsDownUp,
} from 'lucide-vue-next'



const store = useWorkspaceFilesStore()
const aiStore = useAiChatStore()
const workspace = useWorkspaceStore()
const scrollContainerRef = ref<HTMLElement | null>(null)
const showSearch = ref(false)

const {
  virtualItems,
  totalSize,
  attachOverscan,
  focusedIndex,
  selectedNodeId,
  focusNodeAtIndex,
  handleKeyDown,
  dragOverNodeId,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleRowClick: treeHandleRowClick,
} = useFileTree(scrollContainerRef)

// ─── 初始化 ───
onMounted(() => {
  store.init()
  if (scrollContainerRef.value) {
    attachOverscan()
  }
})

// ─── 添加工作区文件夹 ───
async function addFolder() {
  const selected = await open({ directory: true, multiple: false })
  if (selected) {
    await store.addRoot(selected as string)
  }
}

// ─── 折叠全部 ───
function collapseAll() {
  store.expandedDirs.clear()
  store.expandedDirs = new Set()
  for (const root of store.roots) {
    root.collapsed = true
  }
}

// ─── 行交互 ───
function openFileInTab(node: FileNode) {
  const existing = workspace.tabs.find(
    t => t.type === 'file-editor' && t.meta?.absolutePath === node.absolutePath,
  )
  if (existing) {
    workspace.setActiveTab(existing.id)
    return
  }
  workspace.addTab({
    id: `file-editor:${node.absolutePath}`,
    type: 'file-editor',
    title: node.name,
    closable: true,
    meta: { absolutePath: node.absolutePath },
  })
}

function handleRowClick(e: MouseEvent, node: FileNode) {
  treeHandleRowClick(e, node, store.flatNodes.indexOf(node))
  // 单击文件 → 直接打开 Tab（忽略多选/范围选择修饰键）
  if (!node.isDirectory && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    openFileInTab(node)
  }
}

function handleRowDblClick(node: FileNode) {
  if (node.isDirectory) {
    store.toggleDir(node.id)
    return
  }
  // 双击文件仍然打开（兼容习惯），聚焦已有 Tab
  openFileInTab(node)
}

// ─── 右键菜单 ───
const contextNode = ref<FileNode | null>(null)
const contextPos = ref({ x: 0, y: 0 })
const showContextMenu = ref(false)

function handleContextMenu(e: MouseEvent, node: FileNode) {
  contextNode.value = node
  contextPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true
}

/** 根节点右键 — 合成伪 FileNode 复用同一菜单（含复制路径） */
function handleRootContextMenu(e: MouseEvent, root: { id: string; path: string; name: string }) {
  contextNode.value = {
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
    isRootHeader: true,
  }
  contextPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true
}

// ─── FileContextMenu 事件处理 ───
async function handleNewFile(parentPath: string) {
  const parent = parentPath || (store.roots[0]?.path ?? '')
  await store.createFile(parent, '新建文件')
  showContextMenu.value = false
}

async function handleNewFolder(parentPath: string) {
  const parent = parentPath || (store.roots[0]?.path ?? '')
  await store.createDirectory(parent, '新建文件夹')
  showContextMenu.value = false
}

function handleRename(node: FileNode) {
  store.renamingNodeId = node.id
  showContextMenu.value = false
}

function handleDelete(node: FileNode) {
  store.deleteEntry(node.absolutePath)
  showContextMenu.value = false
}

async function handleBatchDelete() {
  await store.batchDelete()
  showContextMenu.value = false
}

/** 工具栏：在第一个 root 下新建文件 */
async function toolbarNewFile() {
  if (store.roots.length === 0) return
  const root = store.roots[0]
  if (!root) return
  await store.createFile(root.path, '新建文件')
}

// ─── Ctrl+P ───
function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    showSearch.value = true
  }
  if (e.key === 'e' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault()
    scrollContainerRef.value?.focus()
  }
}

onMounted(() => document.addEventListener('keydown', handleGlobalKeyDown))
onUnmounted(() => document.removeEventListener('keydown', handleGlobalKeyDown))

function handleSearchSelect(node: FileNode) {
  selectedNodeId.value = node.id
  const idx = store.flatNodes.indexOf(node)
  if (idx >= 0) {
    focusNodeAtIndex(idx)
  }
}

function normalizePath(path?: string | null): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function parentPathOf(path: string): string {
  const normalized = normalizePath(path)
  const sep = normalized.lastIndexOf('/')
  return sep > 0 ? normalized.slice(0, sep) : normalized
}

function basename(path?: string | null): string {
  const normalized = normalizePath(path)
  if (!normalized) return ''
  return normalized.split('/').filter(Boolean).pop() ?? normalized
}

async function revealPathInTree(path: string): Promise<void> {
  const targetPath = normalizePath(path)
  if (!targetPath) return

  const root = store.roots.find(item => targetPath === item.path || targetPath.startsWith(`${item.path}/`))
  if (!root) return
  root.collapsed = false

  let currentPath = root.path
  const relativeSegments = targetPath.slice(root.path.length).split('/').filter(Boolean)
  const directorySegments = relativeSegments.slice(0, -1)

  for (const segment of directorySegments) {
    if (!store.nodeCache.has(currentPath)) {
      await store.refreshDirectory(currentPath)
    }
    const childPath = `${currentPath}/${segment}`
    const child = store.nodeCache.get(currentPath)?.find(node => node.absolutePath === childPath)
    if (!child?.isDirectory) break
    await store.expandDir(child.id)
    currentPath = child.absolutePath
  }

  await store.refreshDirectory(parentPathOf(targetPath)).catch(() => undefined)
  requestAnimationFrame(() => {
    const index = store.flatNodes.findIndex(node => normalizePath(node.absolutePath) === targetPath)
    focusNodeAtIndex(index)
  })
}

function isAiRoot(rootPath: string): boolean {
  const workDir = aiStore.currentWorkDir
  if (!workDir) return false
  return workDir === rootPath || workDir.startsWith(`${rootPath}/`)
}

function isEditorRoot(rootPath: string): boolean {
  const editorPath = store.activeEditor?.path
  if (!editorPath) return false
  return editorPath === rootPath || editorPath.startsWith(`${rootPath}/`) || editorPath.startsWith(`${rootPath}\\`)
}

const currentAiTabMeta = computed<Record<string, unknown>>(() => {
  const aiTab = workspace.tabs.find(tab => tab.type === 'ai-chat' && tab.id === workspace.activeTabId)
    ?? workspace.tabs.find(tab => tab.type === 'ai-chat')
  return (aiTab?.meta as Record<string, unknown> | undefined) ?? {}
})

function readMetaPaths(key: 'aiReferencedPaths' | 'taskReferencedPaths' | 'focusedTaskPaths' | 'focusedFilePaths'): string[] {
  const value = currentAiTabMeta.value[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const aiReferencedPaths = computed(() => new Set(readMetaPaths('aiReferencedPaths')))
const taskReferencedPaths = computed(() => new Set(readMetaPaths('taskReferencedPaths')))
const focusedTaskPaths = computed(() => new Set(readMetaPaths('focusedTaskPaths')))
const focusedTaskPathList = computed(() => readMetaPaths('focusedTaskPaths'))
const focusedFilePaths = computed(() => new Set(readMetaPaths('focusedFilePaths')))
const focusedFilePathList = computed(() => readMetaPaths('focusedFilePaths'))
const focusedTaskLabel = computed(() => {
  const value = currentAiTabMeta.value.focusedTaskLabel
  return typeof value === 'string' ? value : ''
})
const focusedFileLabel = computed(() => {
  const value = currentAiTabMeta.value.focusedFileLabel
  return typeof value === 'string' ? value : ''
})

const aiContextSummary = computed(() => {
  const workDir = aiStore.currentWorkDir
  const activeEditor = store.activeEditor
  const focusedPath = focusedTaskPathList.value[0] ?? ''
  const focusedFilePath = focusedFilePathList.value[0] ?? ''

  return {
    hasContext: Boolean(
      workDir
      || activeEditor
      || focusedTaskPaths.value.size > 0
      || focusedFilePaths.value.size > 0
      || taskReferencedPaths.value.size > 0
      || aiReferencedPaths.value.size > 0,
    ),
    workDir,
    workDirName: basename(workDir),
    editorName: basename(activeEditor?.path),
    cursorLine: activeEditor?.cursorLine ?? null,
    focusedPath,
    focusedName: basename(focusedPath),
    focusedTaskLabel: focusedTaskLabel.value,
    focusedFilePath,
    focusedFileName: basename(focusedFilePath),
    focusedFileLabel: focusedFileLabel.value,
    taskPathCount: taskReferencedPaths.value.size,
    aiPathCount: aiReferencedPaths.value.size,
  }
})

const aiContextPrimaryLabel = computed(() => {
  if (aiContextSummary.value.focusedName) {
    return `当前 ${aiContextSummary.value.focusedName}`
  }
  if (aiContextSummary.value.focusedFileName) {
    return `当前 ${aiContextSummary.value.focusedFileName}`
  }
  if (aiContextSummary.value.editorName) {
    return `当前 ${aiContextSummary.value.editorName}${aiContextSummary.value.cursorLine !== null ? `:${aiContextSummary.value.cursorLine}` : ''}`
  }
  if (aiContextSummary.value.workDirName) {
    return `当前目录 ${aiContextSummary.value.workDirName}`
  }
  return ''
})

const aiContextSecondaryLabel = computed(() => {
  if (aiContextSummary.value.focusedTaskLabel) {
    return aiContextSummary.value.focusedTaskLabel
  }
  if (aiContextSummary.value.focusedFileLabel && aiContextSummary.value.focusedFileLabel !== aiContextSummary.value.focusedFileName) {
    return aiContextSummary.value.focusedFileLabel
  }
  if (aiContextSummary.value.workDir) {
    return aiContextSummary.value.workDir
  }
  return ''
})

function isReferencedBySet(rootPath: string, paths: Set<string>): boolean {
  for (const path of paths) {
    if (path === rootPath || path.startsWith(`${rootPath}/`) || path.startsWith(`${rootPath}\\`)) {
      return true
    }
  }
  return false
}

function isAiReferencedRoot(rootPath: string): boolean {
  return isReferencedBySet(rootPath, aiReferencedPaths.value)
}

function isTaskReferencedRoot(rootPath: string): boolean {
  return isReferencedBySet(rootPath, taskReferencedPaths.value)
}

function isParentReferencedBySet(nodePath: string, paths: Set<string>): boolean {
  for (const path of paths) {
    if (path.startsWith(`${nodePath}/`) || path.startsWith(`${nodePath}\\`)) {
      return true
    }
  }
  return false
}

function isFocusedTaskRoot(rootPath: string): boolean {
  return isReferencedBySet(rootPath, focusedTaskPaths.value) || isReferencedBySet(rootPath, focusedFilePaths.value)
}

watch(
  () => [...focusedTaskPathList.value, ...focusedFilePathList.value],
  (paths) => {
    const firstPath = paths[0]
    if (!firstPath) return
    void revealPathInTree(firstPath)
  },
  { deep: true },
)
</script>

<template>
  <div class="flex h-full flex-col" @keydown="handleKeyDown" tabindex="0">
    <!-- 工具栏 -->
    <div class="flex items-center gap-0.5 border-b px-2 py-1">
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="添加工作区文件夹"
        @click="addFolder"
      >
        <FolderPlus class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="新建文件"
        @click="toolbarNewFile"
      >
        <FilePlus class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="搜索文件 (Ctrl+P)"
        @click="showSearch = true"
      >
        <Search class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="折叠全部"
        @click="collapseAll"
      >
        <ChevronsDownUp class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <!-- 多选 badge -->
      <span
        v-if="store.selectedNodes.size > 0"
        class="ml-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full"
      >
        {{ store.selectedNodes.size }} 个选中
      </span>
    </div>

    <!-- 空状态 -->
    <div
      v-if="aiContextSummary.hasContext"
      class="border-b border-border/40 bg-muted/20 px-3 py-2.5"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">
          <span>当前上下文</span>
          <span
            v-if="aiContextSummary.workDirName"
            class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary"
          >
            {{ aiContextSummary.workDirName }}
          </span>
        </div>
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/52">
          <span v-if="aiContextSummary.aiPathCount > 0" class="rounded-full border border-sky-500/15 bg-sky-500/8 px-1.5 py-0.5 text-sky-400">
            相关 {{ aiContextSummary.aiPathCount }}
          </span>
          <span v-if="aiContextSummary.taskPathCount > 0" class="rounded-full border border-amber-500/15 bg-amber-500/8 px-1.5 py-0.5 text-amber-400">
            相关 {{ aiContextSummary.taskPathCount }}
          </span>
        </div>
      </div>
      <div v-if="aiContextPrimaryLabel || aiContextSecondaryLabel" class="mt-2 space-y-1">
        <p
          v-if="aiContextPrimaryLabel"
          class="truncate text-[11px] font-medium text-foreground/78"
          :title="aiContextSummary.focusedTaskLabel || aiContextSummary.focusedPath || aiContextSummary.focusedFilePath"
        >
          {{ aiContextPrimaryLabel }}
        </p>
        <p
          v-if="aiContextSecondaryLabel"
          class="truncate text-[11px] text-muted-foreground/62"
          :title="aiContextSecondaryLabel"
        >
          {{ aiContextSecondaryLabel }}
        </p>
      </div>
    </div>

    <div
      v-if="store.roots.length === 0"
      class="flex flex-col items-center justify-center py-10 text-center flex-1"
    >
      <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
        <FolderOpen class="h-5 w-5 text-muted-foreground/30" />
      </div>
      <p class="text-xs text-muted-foreground/60">暂无工作区文件夹</p>
      <button
        class="mt-3 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
        @click="addFolder"
      >
        添加文件夹
      </button>
    </div>

    <!-- 文件树 -->
    <div
      v-else
      ref="scrollContainerRef"
      class="flex-1 overflow-auto min-h-0"
    >
      <div :style="{ height: `${totalSize}px`, position: 'relative' }">
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: `${item.size}px`,
            transform: `translateY(${item.start}px)`,
          }"
        >
          <!-- 根标题行 -->
          <WorkspaceRootHeader
            v-if="store.flatNodes[item.index]?.isRootHeader"
            :root="store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!"
            :ai-active="isAiRoot(store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!.path)"
            :editor-active="isEditorRoot(store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!.path)"
            :ai-referenced-active="isAiReferencedRoot(store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!.path)"
            :task-referenced-active="isTaskReferencedRoot(store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!.path)"
            :focused-active="isFocusedTaskRoot(store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!.path)"
            @contextmenu="(ev: MouseEvent) => handleRootContextMenu(ev, store.roots.find(r => r.id === store.flatNodes[item.index]?.rootId)!)"
          />
          <!-- 文件行 -->
          <FileTreeRow
            v-else
            :node="store.flatNodes[item.index]!"
            :focused="focusedIndex === item.index"
            :selected="selectedNodeId === store.flatNodes[item.index]?.id"
            :drag-over="dragOverNodeId === store.flatNodes[item.index]?.id"
            :multi-selected="store.selectedNodes.size > 0 ? store.selectedNodes.has(store.flatNodes[item.index]?.id ?? '') : undefined"
            :ai-referenced="aiReferencedPaths.has(store.flatNodes[item.index]!.absolutePath)"
            :task-referenced="taskReferencedPaths.has(store.flatNodes[item.index]!.absolutePath)"
            :ai-referenced-parent="isParentReferencedBySet(store.flatNodes[item.index]!.absolutePath, aiReferencedPaths)"
            :task-referenced-parent="isParentReferencedBySet(store.flatNodes[item.index]!.absolutePath, taskReferencedPaths)"
            :focused-task="focusedTaskPaths.has(store.flatNodes[item.index]!.absolutePath) || focusedFilePaths.has(store.flatNodes[item.index]!.absolutePath)"
            :focused-task-parent="isParentReferencedBySet(store.flatNodes[item.index]!.absolutePath, focusedTaskPaths) || isParentReferencedBySet(store.flatNodes[item.index]!.absolutePath, focusedFilePaths)"
            @click="(ev: MouseEvent, node: FileNode) => handleRowClick(ev, node)"
            @dblclick="handleRowDblClick(store.flatNodes[item.index]!)"
            @contextmenu="handleContextMenu"
            @dragstart="handleDragStart"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          />
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <FileContextMenu
      v-if="showContextMenu"
      :node="contextNode"
      :position="contextPos"
      :multi-selected-count="store.selectedNodes.size"
      @close="showContextMenu = false"
      @new-file="handleNewFile"
      @new-folder="handleNewFolder"
      @rename="handleRename"
      @delete="handleDelete"
      @batch-delete="handleBatchDelete"
    />

    <!-- Ctrl+P 搜索 -->
    <Teleport to="body">
      <FileSearchDialog
        v-if="showSearch"
        @close="showSearch = false"
        @select="handleSearchSelect"
      />
    </Teleport>
  </div>
</template>
