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
import {
  FolderPlus,
  FilePlus,
  FolderOpen,
  Search,
  ChevronsDownUp,
  Terminal,
  ExternalLink,
  Bot,
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
function handleRowClick(node: FileNode) {
  selectedNodeId.value = node.id
  focusedIndex.value = store.flatNodes.indexOf(node)
}

function handleRowDblClick(node: FileNode) {
  if (node.isDirectory) {
    store.toggleDir(node.id)
  }
  // TODO: 文件双击打开编辑器 Tab（后续任务）
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

async function contextNewFile() {
  if (!contextNode.value) return
  const parent = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  await store.createFile(parent, '新建文件')
}

async function contextNewFolder() {
  if (!contextNode.value) return
  const parent = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  await store.createDirectory(parent, '新建文件夹')
}

function contextRename() {
  if (contextNode.value) {
    store.renamingNodeId = contextNode.value.id
  }
}

function contextDelete() {
  if (contextNode.value) {
    store.deleteEntry(contextNode.value.absolutePath)
  }
}

async function contextCopyPath() {
  if (contextNode.value) {
    await navigator.clipboard.writeText(contextNode.value.absolutePath)
  }
}

function contextOpenInTerminal() {
  if (!contextNode.value) return
  const dir = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  workspace.addTab({
    id: `terminal-${Date.now()}`,
    type: 'local-terminal',
    title: dir.split('/').pop() || 'Terminal',
    closable: true,
    meta: { cwd: dir },
  })
}

async function contextRevealInExplorer() {
  if (!contextNode.value) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(contextNode.value.absolutePath)
}

function contextSetAiWorkDir() {
  if (!contextNode.value) return
  const dir = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  console.log('[workspace-fs] 设置 AI workDir:', dir)
}

/** 工具栏：在第一个 root 下新建文件 */
async function toolbarNewFile() {
  if (store.roots.length === 0) return
  const root = store.roots[0]
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
          :key="item.key"
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
            :root="store.roots.find(r => r.id === store.flatNodes[item.index].rootId)!"
          />
          <!-- 文件行 -->
          <FileTreeRow
            v-else
            :node="store.flatNodes[item.index]"
            :focused="focusedIndex === item.index"
            :selected="selectedNodeId === store.flatNodes[item.index]?.id"
            :drag-over="dragOverNodeId === store.flatNodes[item.index]?.id"
            @click="handleRowClick(store.flatNodes[item.index])"
            @dblclick="handleRowDblClick(store.flatNodes[item.index])"
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
    <Teleport to="body">
      <div
        v-if="showContextMenu"
        class="fixed inset-0 z-50"
        @click="showContextMenu = false"
        @contextmenu.prevent="showContextMenu = false"
      >
        <div
          class="absolute z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md"
          :style="{ left: `${contextPos.x}px`, top: `${contextPos.y}px` }"
        >
          <button class="context-item" @click="contextNewFile(); showContextMenu = false">
            <FilePlus class="h-3.5 w-3.5" /> 新建文件
          </button>
          <button class="context-item" @click="contextNewFolder(); showContextMenu = false">
            <FolderPlus class="h-3.5 w-3.5" /> 新建文件夹
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextRename(); showContextMenu = false">
            重命名 <span class="ml-auto text-[10px] text-muted-foreground">F2</span>
          </button>
          <button class="context-item text-destructive" @click="contextDelete(); showContextMenu = false">
            删除 <span class="ml-auto text-[10px] text-muted-foreground">Del</span>
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextCopyPath(); showContextMenu = false">
            复制路径
          </button>
          <button class="context-item" @click="contextOpenInTerminal(); showContextMenu = false">
            <Terminal class="h-3.5 w-3.5" /> 在终端中打开
          </button>
          <button class="context-item" @click="contextRevealInExplorer(); showContextMenu = false">
            <ExternalLink class="h-3.5 w-3.5" /> 在系统资源管理器中显示
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextSetAiWorkDir(); showContextMenu = false">
            <Bot class="h-3.5 w-3.5" /> 作为 AI 工作目录
          </button>
        </div>
      </div>
    </Teleport>

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

<style scoped>
.context-item {
  @apply flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer;
}
</style>
