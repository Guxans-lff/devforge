<script setup lang="ts">
/**
 * FilesPanel — 多根工作区本地文件资源管理器
 *
 * 支持多项目文件夹同时浏览、懒加载虚拟滚动、CRUD、
 * 实时文件监听、Git 状态装饰、压缩文件夹。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
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
const workspace = useWorkspaceStore()
const scrollContainerRef = ref<HTMLElement | null>(null)
const showSearch = ref(false)

const {
  virtualItems,
  totalSize,
  attachOverscan,
  focusedIndex,
  selectedNodeId,
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
    focusedIndex.value = idx
  }
}
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
