# 资源管理器升级 + AI 文件操作可视化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DevForge 资源管理器升级为圆润现代风格 + AI 文件操作可视化（毛玻璃卡片 + 并排 Diff）

**Architecture:** 文件树视觉重写 + 多选交互 + 右键菜单完善 → AI 侧新增 diff 计算层 + 3 个新组件 + 改造消息渲染

**Tech Stack:** Vue 3 + TypeScript + Tailwind CSS + jsdiff + TanStack Virtual + Tauri 2

**Spec:** `docs/superpowers/specs/2026-04-16-explorer-ai-fileops-design.md`

---

## 文件结构

### 修改文件
| 文件 | 职责变更 |
|------|----------|
| `src/types/workspace-files.ts` | 无改动 |
| `src/stores/workspace-files.ts` | 新增 selectedNodes Set + 批量操作 actions |
| `src/composables/useFileTree.ts` | 新增多选 Ctrl/Shift click + 批量拖拽 |
| `src/components/layout/panels/FilesPanel.vue` | 布局升级 + 右键菜单升级 + 多选 badge |
| `src/components/layout/panels/files/FileTreeRow.vue` | 完整视觉重写：圆润现代风格 |
| `src/components/layout/panels/files/WorkspaceRootHeader.vue` | 视觉匹配新风格 |
| `src/types/ai.ts` | 新增 FileOperation 类型 |
| `src/components/ai/AiToolCallBlock.vue` | write_file 渲染改用 AiFileOpCard |
| `src/components/ai/AiMessageBubble.vue` | 工具调用聚合为 AiFileOpsGroup |

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/components/layout/panels/files/FileContextMenu.vue` | 右键菜单独立组件 |
| `src/composables/useAiDiff.ts` | diff 计算封装（jsdiff） |
| `src/components/ai/AiFileOpCard.vue` | 单文件操作毛玻璃卡片 |
| `src/components/ai/AiDiffViewer.vue` | 深邃沉浸型并排 Diff |
| `src/components/ai/AiFileOpsGroup.vue` | 文件操作卡片组容器 |

---

## Task 1: 安装 jsdiff 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 diff 包**

```bash
cd D:\Project\DevForge\devforge && npm install diff && npm install -D @types/diff
```

- [ ] **Step 2: 验证安装**

```bash
node -e "const diff = require('diff'); console.log(typeof diff.diffLines)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 jsdiff 用于 AI diff 计算"
```

---

## Task 2: FileTreeRow 视觉重写 — 圆润现代风格

**Files:**
- Modify: `src/components/layout/panels/files/FileTreeRow.vue` (120行 → ~180行)

- [ ] **Step 1: 新增文件类型图标映射**

在 `<script setup>` 中新增文件扩展名→颜色映射:

```typescript
/** 文件扩展名→图标颜色映射 */
const FILE_TYPE_COLORS: Record<string, string> = {
  vue: '#42b883',
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  java: '#e76f00',
  py: '#3776ab',
  rs: '#dea584',
  go: '#00add8',
  css: '#264de4',
  scss: '#cd6799',
  html: '#e34f26',
  json: '#292929',
  md: '#083fa1',
  sql: '#e38c00',
  xml: '#f16529',
  yml: '#cb171e',
  yaml: '#cb171e',
}

const fileColor = computed(() => {
  if (props.node.isDirectory) return null
  const ext = props.node.name.split('.').pop()?.toLowerCase() ?? ''
  return FILE_TYPE_COLORS[ext] ?? '#6b7280'
})
```

- [ ] **Step 2: 重写模板为圆润现代风格**

替换整个 `<template>` 部分:

```vue
<template>
  <div
    class="group flex items-center gap-2 cursor-pointer select-none text-[12.5px] transition-all duration-150 mx-1"
    :class="[
      selected
        ? 'bg-primary/8 rounded-lg relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[2px] before:h-4 before:bg-primary before:rounded-full'
        : 'hover:bg-muted/40 rounded-lg',
      focused && 'ring-1 ring-primary/20 rounded-lg',
      dragOver && 'bg-primary/15 ring-1 ring-primary/30 rounded-lg',
    ]"
    :style="{ paddingLeft: `${node.depth * 16 + 8}px`, height: '32px' }"
    draggable="true"
    @click="$emit('click', node)"
    @dblclick="$emit('dblclick', node)"
    @contextmenu.prevent="$emit('contextmenu', $event, node)"
    @dragstart="$emit('dragstart', $event, node)"
    @dragover.prevent="$emit('dragover', $event, node)"
    @dragleave="$emit('dragleave', $event)"
    @drop.prevent="$emit('drop', $event, node)"
  >
    <!-- 多选 checkbox -->
    <div
      v-if="multiSelected !== undefined"
      class="flex-shrink-0 w-4 h-4 rounded border transition-colors"
      :class="multiSelected
        ? 'bg-primary border-primary text-primary-foreground'
        : 'border-border/40 group-hover:border-border/60'"
    >
      <svg v-if="multiSelected" class="w-3 h-3 m-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <polyline points="20,6 9,17 4,12" />
      </svg>
    </div>

    <!-- 展开箭头 -->
    <div class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
      <ChevronRight
        v-if="node.isDirectory"
        class="h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150"
        :class="node.isExpanded && 'rotate-90'"
      />
    </div>

    <!-- 文件/文件夹图标 -->
    <div class="flex-shrink-0 flex items-center justify-center">
      <template v-if="node.isDirectory">
        <div
          class="w-4 h-4 rounded-[3px] flex items-center justify-center text-[10px]"
          :style="{ background: node.isExpanded
            ? 'linear-gradient(135deg, #60a5fa, #818cf8)'
            : 'linear-gradient(135deg, #f59e0b, #f97316)' }"
        >
          <FolderOpen v-if="node.isExpanded" class="w-2.5 h-2.5 text-white" />
          <Folder v-else class="w-2.5 h-2.5 text-white" />
        </div>
      </template>
      <template v-else>
        <div
          class="w-[7px] h-[7px] rounded-[2px]"
          :style="{ background: fileColor ? `linear-gradient(135deg, ${fileColor}, ${fileColor}cc)` : '#6b7280' }"
        />
      </template>
    </div>

    <!-- 文件名 / 重命名 -->
    <template v-if="isRenaming">
      <FileTreeRenameInput :node="node" />
    </template>
    <template v-else>
      <span
        class="flex-1 truncate transition-colors"
        :class="[
          selected ? 'text-foreground font-medium' : 'text-foreground/80',
          decoration?.gitStatus === 'modified' && 'text-green-400/90',
          decoration?.gitStatus === 'added' && 'text-blue-400/90',
          decoration?.gitStatus === 'deleted' && 'text-red-400/90 line-through',
          decoration?.gitStatus === 'untracked' && 'text-yellow-400/90',
        ]"
      >
        <!-- 压缩目录显示 -->
        <template v-if="node.isCompressed && node.compressedSegments">
          <span v-for="(seg, i) in node.compressedSegments" :key="i">
            <span v-if="i > 0" class="text-muted-foreground/30 mx-0.5">/</span>
            {{ seg }}
          </span>
        </template>
        <template v-else>{{ node.name }}</template>
      </span>
    </template>

    <!-- 目录子项数 badge -->
    <span
      v-if="node.isDirectory && !node.isExpanded && node.childCount"
      class="flex-shrink-0 text-[10px] text-muted-foreground/40 bg-muted/30 px-1.5 rounded-full"
    >
      {{ node.childCount }}
    </span>

    <!-- Git 装饰 pill -->
    <span
      v-if="decoration?.gitStatus && gitStatusLetter"
      class="flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
      :class="gitPillClass"
    >
      {{ gitStatusLetter }}
    </span>
  </div>
</template>
```

- [ ] **Step 3: 新增 Git pill 样式计算属性**

```typescript
const gitPillClass = computed(() => {
  switch (decoration.value?.gitStatus) {
    case 'modified': return 'bg-green-500/10 text-green-400 border border-green-500/15'
    case 'added': return 'bg-blue-500/10 text-blue-400 border border-blue-500/15'
    case 'deleted': return 'bg-red-500/10 text-red-400 border border-red-500/15'
    case 'untracked': return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/15'
    case 'conflict': return 'bg-orange-500/10 text-orange-400 border border-orange-500/15'
    case 'renamed': return 'bg-purple-500/10 text-purple-400 border border-purple-500/15'
    default: return ''
  }
})
```

- [ ] **Step 4: 新增 multiSelected prop**

```typescript
const props = defineProps<{
  node: FileNode
  focused: boolean
  selected: boolean
  dragOver: boolean
  multiSelected?: boolean  // 新增
}>()
```

- [ ] **Step 5: 验证构建**

```bash
cd D:\Project\DevForge\devforge && npx vue-tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/panels/files/FileTreeRow.vue
git commit -m "feat(explorer): 重写 FileTreeRow 为圆润现代风格"
```

---

## Task 3: WorkspaceRootHeader 视觉升级

**Files:**
- Modify: `src/components/layout/panels/files/WorkspaceRootHeader.vue` (57行)

- [ ] **Step 1: 重写模板匹配新风格**

```vue
<template>
  <div
    class="flex items-center gap-2 px-3 cursor-pointer group transition-all duration-150 mx-1 rounded-lg"
    :class="root.collapsed ? 'hover:bg-muted/30' : 'bg-muted/20 hover:bg-muted/30'"
    style="height: 36px;"
    @click="toggleCollapse"
  >
    <!-- 折叠箭头 -->
    <ChevronRight
      class="h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150 flex-shrink-0"
      :class="!root.collapsed && 'rotate-90'"
    />

    <!-- 根图标 -->
    <div
      class="w-4 h-4 rounded-[3px] flex items-center justify-center flex-shrink-0"
      style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"
    >
      <FolderOpen class="w-2.5 h-2.5 text-white" />
    </div>

    <!-- 根名称 -->
    <span class="flex-1 truncate text-[12px] font-semibold text-foreground/90 tracking-tight">
      {{ root.name }}
    </span>

    <!-- 操作按钮 -->
    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        class="p-1 rounded-md hover:bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground"
        title="刷新"
        @click.stop="refresh"
      >
        <RefreshCw class="h-3 w-3" />
      </button>
      <button
        class="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive"
        title="移除"
        @click.stop="store.removeRoot(root.id)"
      >
        <X class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/panels/files/WorkspaceRootHeader.vue
git commit -m "feat(explorer): WorkspaceRootHeader 视觉升级匹配圆润风格"
```

---

## Task 4: Store 多选状态 + 批量操作

**Files:**
- Modify: `src/stores/workspace-files.ts` (行 16-21 状态定义 + 新增 actions)

- [ ] **Step 1: 新增多选状态**

在 state 定义区域（约 L16-21）新增:

```typescript
/** 多选节点 ID 集合 */
const selectedNodes = ref<Set<string>>(new Set())
```

- [ ] **Step 2: 新增多选 actions**

在 actions 区域新增:

```typescript
/** 切换节点选中（Ctrl+Click） */
function toggleSelect(nodeId: string) {
  const s = new Set(selectedNodes.value)
  if (s.has(nodeId)) s.delete(nodeId)
  else s.add(nodeId)
  selectedNodes.value = s
}

/** 范围选中（Shift+Click） — 需要 flatNodes 上下文 */
function rangeSelect(fromIndex: number, toIndex: number) {
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
function clearSelection() {
  selectedNodes.value = new Set()
}

/** 全选当前目录下的所有文件 */
function selectAllInDir(dirPath: string, rootId: string) {
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
  for (const id of selectedNodes.value) {
    const node = findNodeById(id)
    if (!node) { failed++; continue }
    try {
      await invoke('delete_entry', { path: node.absolutePath, isDirectory: node.isDirectory })
      success++
    } catch { failed++ }
  }
  clearSelection()
  // 刷新所有受影响的根目录
  const rootIds = new Set([...selectedNodes.value].map(id => id.split(':')[0]))
  for (const rid of rootIds) {
    await refreshRoot(rid)
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
```

- [ ] **Step 3: 在 return 中导出新状态和方法**

```typescript
return {
  // ... 现有导出
  selectedNodes,
  toggleSelect,
  rangeSelect,
  clearSelection,
  selectAllInDir,
  batchDelete,
  batchCopyPaths,
}
```

- [ ] **Step 4: 验证构建**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace-files.ts
git commit -m "feat(explorer): store 新增多选状态和批量操作"
```

---

## Task 5: useFileTree 多选逻辑

**Files:**
- Modify: `src/composables/useFileTree.ts` (行 32-92 键盘处理)

- [ ] **Step 1: 新增多选 click handler**

在 composable 内新增:

```typescript
/** 最后一次单击的索引（用于 Shift 范围选） */
const lastClickIndex = ref<number | null>(null)

/** 处理行点击（支持 Ctrl/Shift 多选） */
function handleRowClick(e: MouseEvent, node: FileNode, index: number) {
  if (node.isRootHeader) return

  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Click: 切换选中
    store.toggleSelect(node.id)
    lastClickIndex.value = index
  } else if (e.shiftKey && lastClickIndex.value !== null) {
    // Shift+Click: 范围选
    store.rangeSelect(lastClickIndex.value, index)
  } else {
    // 普通点击: 清空多选，单选此节点
    store.clearSelection()
    selectedNodeId.value = node.id
    focusedIndex.value = index
    lastClickIndex.value = index

    // 目录展开/折叠
    if (node.isDirectory) {
      store.toggleDir(node.id)
    }
  }
}
```

- [ ] **Step 2: 键盘 Ctrl+A 支持**

在 handleKeyDown 中新增 Ctrl+A case:

```typescript
if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
  e.preventDefault()
  // 全选当前可见节点
  const flat = store.flatNodes
  const s = new Set<string>()
  for (const n of flat) {
    if (!n.isRootHeader) s.add(n.id)
  }
  store.selectedNodes = s
}
```

- [ ] **Step 3: 返回新方法**

```typescript
return {
  // ... 现有导出
  handleRowClick,
  lastClickIndex,
}
```

- [ ] **Step 4: Commit**

```bash
git add src/composables/useFileTree.ts
git commit -m "feat(explorer): useFileTree 新增多选 Ctrl/Shift 交互"
```

---

## Task 6: FileContextMenu 右键菜单组件

**Files:**
- Create: `src/components/layout/panels/files/FileContextMenu.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 文件树右键菜单 — 圆润现代风格
 *
 * 支持文件/目录/根目录/空白区四种上下文
 */
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'
import {
  File, FolderPlus, FilePlus, Pencil, Trash2, Copy,
  FolderOpen, ExternalLink, CopyCheck, FileText,
} from 'lucide-vue-next'

const props = defineProps<{
  node: FileNode | null
  position: { x: number; y: number }
  multiSelectedCount: number
}>()

const emit = defineEmits<{
  close: []
  newFile: [parentPath: string]
  newFolder: [parentPath: string]
  rename: [node: FileNode]
  delete: [node: FileNode]
  batchDelete: []
}>()

const store = useWorkspaceFilesStore()

/** 菜单项配置 */
interface MenuItem {
  label: string
  icon: any
  action: () => void
  danger?: boolean
  separator?: boolean
}

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  const n = props.node

  if (!n) {
    // 空白区
    items.push({ label: '新建文件', icon: FilePlus, action: () => emit('newFile', '') })
    items.push({ label: '新建文件夹', icon: FolderPlus, action: () => emit('newFolder', '') })
    return items
  }

  // 多选模式
  if (props.multiSelectedCount > 1) {
    items.push({
      label: `批量删除 (${props.multiSelectedCount})`,
      icon: Trash2,
      action: () => emit('batchDelete'),
      danger: true,
    })
    items.push({
      label: '复制路径',
      icon: Copy,
      action: async () => {
        const paths = store.batchCopyPaths()
        await writeText(paths.join('\n'))
        emit('close')
      },
    })
    return items
  }

  // 单选
  if (n.isDirectory) {
    items.push({ label: '新建文件', icon: FilePlus, action: () => emit('newFile', n.absolutePath) })
    items.push({ label: '新建文件夹', icon: FolderPlus, action: () => emit('newFolder', n.absolutePath) })
    items.push({ label: '', icon: null, action: () => {}, separator: true })
  }

  items.push({
    label: '复制路径',
    icon: Copy,
    action: async () => { await writeText(n.absolutePath); emit('close') },
  })
  items.push({
    label: '复制相对路径',
    icon: CopyCheck,
    action: async () => { await writeText(n.path); emit('close') },
  })
  items.push({
    label: '复制名称',
    icon: FileText,
    action: async () => { await writeText(n.name); emit('close') },
  })

  items.push({ label: '', icon: null, action: () => {}, separator: true })

  items.push({
    label: '重命名',
    icon: Pencil,
    action: () => emit('rename', n),
  })

  items.push({
    label: '在文件管理器中显示',
    icon: ExternalLink,
    action: async () => {
      try { await revealItemInDir(n.absolutePath) } catch {}
      emit('close')
    },
  })

  items.push({ label: '', icon: null, action: () => {}, separator: true })

  items.push({
    label: '删除',
    icon: Trash2,
    action: () => emit('delete', n),
    danger: true,
  })

  return items
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50"
      @click="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    >
      <div
        class="absolute min-w-[180px] rounded-xl border border-border/30 bg-popover/95 backdrop-blur-xl shadow-xl py-1.5 text-[12px]"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
        @click.stop
      >
        <template v-for="(item, i) in menuItems" :key="i">
          <div v-if="item.separator" class="my-1 h-px bg-border/20 mx-2" />
          <button
            v-else
            class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg mx-1 transition-colors"
            :class="item.danger
              ? 'hover:bg-destructive/10 text-destructive/80 hover:text-destructive'
              : 'hover:bg-muted/50 text-foreground/80 hover:text-foreground'"
            style="width: calc(100% - 8px);"
            @click="item.action(); item.danger || $emit('close')"
          >
            <component :is="item.icon" class="h-3.5 w-3.5 opacity-60" />
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/panels/files/FileContextMenu.vue
git commit -m "feat(explorer): 新建 FileContextMenu 圆润风格右键菜单"
```

---

## Task 7: FilesPanel 集成升级

**Files:**
- Modify: `src/components/layout/panels/FilesPanel.vue` (336行)

- [ ] **Step 1: 导入新组件和多选逻辑**

新增 import:
```typescript
import FileContextMenu from './files/FileContextMenu.vue'
```

替换现有右键菜单 Teleport 为 FileContextMenu 组件调用。

- [ ] **Step 2: 更新行点击事件绑定**

将 FileTreeRow 的 `@click` 改为使用 `handleRowClick`:

```vue
<FileTreeRow
  :node="item"
  :focused="focusedIndex === index"
  :selected="selectedNodeId === item.id"
  :drag-over="dragOverNodeId === item.id"
  :multi-selected="store.selectedNodes.has(item.id) ? true : undefined"
  @click="(node) => fileTree.handleRowClick($event, node, index)"
  @dblclick="handleDblClick"
  @contextmenu="handleContextMenu"
  @dragstart="fileTree.handleDragStart"
  @dragover="fileTree.handleDragOver"
  @dragleave="fileTree.handleDragLeave"
  @drop="fileTree.handleDrop"
/>
```

- [ ] **Step 3: 多选 badge 显示**

在工具栏区域新增:
```vue
<span
  v-if="store.selectedNodes.size > 0"
  class="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full"
>
  {{ store.selectedNodes.size }} 个选中
</span>
```

- [ ] **Step 4: 替换右键菜单为 FileContextMenu**

```vue
<FileContextMenu
  v-if="showContextMenu"
  :node="contextNode"
  :position="contextPos"
  :multi-selected-count="store.selectedNodes.size"
  @close="showContextMenu = false"
  @new-file="contextNewFile"
  @new-folder="contextNewFolder"
  @rename="contextRename"
  @delete="contextDelete"
  @batch-delete="handleBatchDelete"
/>
```

- [ ] **Step 5: 验证构建**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/panels/FilesPanel.vue
git commit -m "feat(explorer): FilesPanel 集成多选+新右键菜单"
```

---

## Task 8: useAiDiff — diff 计算封装

**Files:**
- Create: `src/composables/useAiDiff.ts`

- [ ] **Step 1: 创建 diff 计算 composable**

```typescript
/**
 * AI Diff 计算 — 基于 jsdiff
 *
 * 提供行级对齐 + 字符级差异高亮数据
 */
import { diffLines, diffChars, type Change } from 'diff'

/** 单行 diff 信息 */
export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'empty'
  content: string
  lineNumber: number | null
  /** 字符级差异片段（仅 added/removed 行） */
  charDiffs?: CharDiff[]
}

/** 字符级差异 */
export interface CharDiff {
  value: string
  type: 'unchanged' | 'added' | 'removed'
}

/** 并排 Diff 结果 */
export interface SideBySideDiff {
  left: DiffLine[]
  right: DiffLine[]
  stats: { added: number; removed: number }
}

/**
 * 计算并排 Diff（左旧右新，行对齐）
 */
export function computeSideBySideDiff(oldText: string, newText: string): SideBySideDiff {
  const changes = diffLines(oldText, newText)
  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let leftLineNum = 1
  let rightLineNum = 1
  let added = 0
  let removed = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const lines = change.value.replace(/\n$/, '').split('\n')

    if (!change.added && !change.removed) {
      // 未变行 — 左右同步
      for (const line of lines) {
        left.push({ type: 'unchanged', content: line, lineNumber: leftLineNum++ })
        right.push({ type: 'unchanged', content: line, lineNumber: rightLineNum++ })
      }
    } else if (change.removed) {
      // 检查下一个 change 是否为 added（配对修改行）
      const next = changes[i + 1]
      if (next?.added) {
        // 修改行：左删右增，计算字符级差异
        const removedLines = lines
        const addedLines = next.value.replace(/\n$/, '').split('\n')
        const maxLen = Math.max(removedLines.length, addedLines.length)

        for (let j = 0; j < maxLen; j++) {
          if (j < removedLines.length && j < addedLines.length) {
            const charChanges = diffChars(removedLines[j], addedLines[j])
            const leftChars = charChanges.filter(c => !c.added).map(c => ({
              value: c.value, type: (c.removed ? 'removed' : 'unchanged') as CharDiff['type'],
            }))
            const rightChars = charChanges.filter(c => !c.removed).map(c => ({
              value: c.value, type: (c.added ? 'added' : 'unchanged') as CharDiff['type'],
            }))
            left.push({ type: 'removed', content: removedLines[j], lineNumber: leftLineNum++, charDiffs: leftChars })
            right.push({ type: 'added', content: addedLines[j], lineNumber: rightLineNum++, charDiffs: rightChars })
          } else if (j < removedLines.length) {
            left.push({ type: 'removed', content: removedLines[j], lineNumber: leftLineNum++ })
            right.push({ type: 'empty', content: '', lineNumber: null })
          } else {
            left.push({ type: 'empty', content: '', lineNumber: null })
            right.push({ type: 'added', content: addedLines[j], lineNumber: rightLineNum++ })
          }
        }
        removed += removedLines.length
        added += addedLines.length
        i++ // 跳过 next（已处理）
      } else {
        // 纯删除行
        for (const line of lines) {
          left.push({ type: 'removed', content: line, lineNumber: leftLineNum++ })
          right.push({ type: 'empty', content: '', lineNumber: null })
          removed++
        }
      }
    } else if (change.added) {
      // 纯新增行
      for (const line of lines) {
        left.push({ type: 'empty', content: '', lineNumber: null })
        right.push({ type: 'added', content: line, lineNumber: rightLineNum++ })
        added++
      }
    }
  }

  return { left, right, stats: { added, removed } }
}

/**
 * 计算 mini diff（简化的增删行列表，限制行数）
 */
export function computeMiniDiff(
  oldText: string,
  newText: string,
  maxLines = 10,
): { lines: { type: 'added' | 'removed'; content: string }[]; truncated: number } {
  const changes = diffLines(oldText, newText)
  const lines: { type: 'added' | 'removed'; content: string }[] = []

  for (const change of changes) {
    if (change.added || change.removed) {
      const type = change.added ? 'added' as const : 'removed' as const
      const changeLines = change.value.replace(/\n$/, '').split('\n')
      for (const line of changeLines) {
        lines.push({ type, content: line })
      }
    }
  }

  if (lines.length <= maxLines) return { lines, truncated: 0 }
  return { lines: lines.slice(0, maxLines), truncated: lines.length - maxLines }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/composables/useAiDiff.ts
git commit -m "feat(ai): 新建 useAiDiff — jsdiff 并排 diff 计算"
```

---

## Task 9: FileOperation 类型定义

**Files:**
- Modify: `src/types/ai.ts`

- [ ] **Step 1: 新增 FileOperation 类型**

在 ToolCallInfo 类型定义之后新增:

```typescript
/** AI 文件操作信息 */
export interface FileOperation {
  /** 操作类型 */
  op: 'create' | 'modify' | 'delete'
  /** 文件路径 */
  path: string
  /** 文件名 */
  fileName: string
  /** 旧内容（modify 时存在） */
  oldContent?: string
  /** 新内容（create/modify 时存在） */
  newContent?: string
  /** 操作状态 */
  status: 'pending' | 'applied' | 'rejected' | 'error'
  /** 错误信息 */
  errorMessage?: string
  /** 关联的 toolCall ID */
  toolCallId: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/ai.ts
git commit -m "feat(ai): 新增 FileOperation 类型定义"
```

---

## Task 10: AiFileOpCard — 单文件操作卡片

**Files:**
- Create: `src/components/ai/AiFileOpCard.vue`

- [ ] **Step 1: 创建毛玻璃折叠卡片组件**

```vue
<script setup lang="ts">
/**
 * AI 文件操作卡片 — 毛玻璃折叠风格
 *
 * 展示单个文件的操作结果（创建/修改/删除），
 * 支持展开 mini diff 和并排 Diff
 */
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { computeMiniDiff } from '@/composables/useAiDiff'
import type { FileOperation } from '@/types/ai'
import { ChevronRight, Check, X, Columns2 } from 'lucide-vue-next'
import AiDiffViewer from './AiDiffViewer.vue'

const props = defineProps<{
  op: FileOperation
  autoExpand?: boolean
}>()

const emit = defineEmits<{
  apply: [op: FileOperation]
  reject: [op: FileOperation]
  'update:status': [status: FileOperation['status']]
}>()

const expanded = ref(props.autoExpand ?? false)
const showDiffViewer = ref(false)

/** 文件扩展名→颜色 */
const FILE_COLORS: Record<string, string> = {
  vue: '#42b883', ts: '#3178c6', js: '#f7df1e', java: '#e76f00',
  py: '#3776ab', rs: '#dea584', css: '#264de4', html: '#e34f26',
}

const fileColor = computed(() => {
  const ext = props.op.fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILE_COLORS[ext] ?? '#6b7280'
})

/** mini diff 数据 */
const miniDiff = computed(() => {
  if (props.op.op === 'create' || !props.op.oldContent || !props.op.newContent) return null
  return computeMiniDiff(props.op.oldContent, props.op.newContent, 10)
})

/** 增删统计 */
const stats = computed(() => {
  if (!miniDiff.value) {
    if (props.op.op === 'create' && props.op.newContent) {
      return { added: props.op.newContent.split('\n').length, removed: 0 }
    }
    if (props.op.op === 'delete' && props.op.oldContent) {
      return { added: 0, removed: props.op.oldContent.split('\n').length }
    }
    return { added: 0, removed: 0 }
  }
  const added = miniDiff.value.lines.filter(l => l.type === 'added').length
  const removed = miniDiff.value.lines.filter(l => l.type === 'removed').length
  return { added, removed }
})

const isApplied = computed(() => props.op.status === 'applied')
const isRejected = computed(() => props.op.status === 'rejected')

/** 应用更改 */
async function handleApply() {
  emit('apply', props.op)
}

/** 撤销更改 */
async function handleReject() {
  emit('reject', props.op)
}

/** 路径中提取目录 */
const dirPath = computed(() => {
  const parts = props.op.path.replace(/\\/g, '/').split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/') + '/'
})
</script>

<template>
  <div
    class="rounded-xl border transition-all duration-200"
    :class="[
      isApplied ? 'border-green-500/15 bg-green-500/[0.02] opacity-70' :
      isRejected ? 'border-border/10 bg-muted/5 opacity-50' :
      'border-white/[0.06] bg-white/[0.02] backdrop-blur-xl',
    ]"
  >
    <!-- 头部 — 点击展开/折叠 -->
    <div
      class="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none"
      @click="expanded = !expanded"
    >
      <!-- 展开箭头 -->
      <ChevronRight
        class="h-2.5 w-2.5 transition-transform duration-150 flex-shrink-0"
        :class="[
          expanded ? 'rotate-90 text-primary/60' : 'text-muted-foreground/40',
        ]"
      />

      <!-- 文件类型色点 -->
      <div
        class="w-2 h-2 rounded-[2px] flex-shrink-0"
        :style="{ background: `linear-gradient(135deg, ${fileColor}, ${fileColor}cc)` }"
      />

      <!-- 文件名 -->
      <span class="font-medium text-[12px] text-foreground/90">{{ op.fileName }}</span>

      <!-- 目录路径 -->
      <span class="text-[10px] text-muted-foreground/30 truncate">{{ dirPath }}</span>

      <!-- NEW 标签 -->
      <span
        v-if="op.op === 'create'"
        class="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/15 text-indigo-400"
      >NEW</span>

      <!-- DEL 标签 -->
      <span
        v-if="op.op === 'delete'"
        class="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/15 text-red-400"
      >DEL</span>

      <!-- 已应用/已撤销标记 -->
      <Check v-if="isApplied" class="h-3.5 w-3.5 text-green-400 ml-auto flex-shrink-0" />
      <span v-else-if="isRejected" class="text-[10px] text-muted-foreground/30 line-through ml-auto">已撤销</span>

      <!-- 增删统计 -->
      <div v-if="!isApplied && !isRejected" class="ml-auto flex gap-1.5 flex-shrink-0">
        <span v-if="stats.added" class="text-[10px] text-green-400">+{{ stats.added }}</span>
        <span v-if="stats.removed" class="text-[10px] text-red-400">-{{ stats.removed }}</span>
      </div>
    </div>

    <!-- mini diff 展开区 -->
    <div v-if="expanded && !showDiffViewer" class="border-t border-white/[0.03]">
      <!-- mini diff 内容 -->
      <div v-if="miniDiff" class="px-3.5 py-2 font-mono text-[10px] leading-[1.7] bg-black/15">
        <div
          v-for="(line, i) in miniDiff.lines"
          :key="i"
          :class="line.type === 'removed' ? 'text-red-400/70' : 'text-green-400/70'"
        >
          <span class="select-none">{{ line.type === 'removed' ? '- ' : '+ ' }}</span>{{ line.content }}
        </div>
        <div v-if="miniDiff.truncated > 0" class="text-muted-foreground/30 mt-1">
          ... 还有 {{ miniDiff.truncated }} 行改动
        </div>
      </div>

      <!-- 新建文件预览 -->
      <div v-else-if="op.op === 'create' && op.newContent" class="px-3.5 py-2 font-mono text-[10px] leading-[1.7] bg-black/15 text-green-400/60">
        <div v-for="(line, i) in op.newContent.split('\n').slice(0, 10)" :key="i">
          <span class="select-none text-green-400/30">+ </span>{{ line }}
        </div>
        <div v-if="(op.newContent.split('\n').length) > 10" class="text-muted-foreground/30 mt-1">
          ... 还有 {{ op.newContent.split('\n').length - 10 }} 行
        </div>
      </div>

      <!-- 操作栏 -->
      <div v-if="!isApplied && !isRejected" class="px-3.5 py-2 flex gap-3 border-t border-white/[0.03]">
        <button class="text-[10px] font-medium text-green-400 hover:text-green-300 transition-colors" @click.stop="handleApply">Apply</button>
        <button class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors" @click.stop="handleReject">Reject</button>
        <button
          v-if="op.op === 'modify'"
          class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          @click.stop="showDiffViewer = true"
        >Side-by-side</button>
      </div>
    </div>

    <!-- 并排 Diff 全量视图 -->
    <div v-if="showDiffViewer && op.oldContent && op.newContent" class="border-t border-white/[0.03]">
      <AiDiffViewer
        :old-text="op.oldContent"
        :new-text="op.newContent"
        :file-name="op.fileName"
        :dir-path="dirPath"
        @apply="handleApply"
        @reject="handleReject"
        @close="showDiffViewer = false"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ai/AiFileOpCard.vue
git commit -m "feat(ai): 新建 AiFileOpCard 毛玻璃折叠卡片"
```

---

## Task 11: AiDiffViewer — 深邃沉浸型并排 Diff

**Files:**
- Create: `src/components/ai/AiDiffViewer.vue`

- [ ] **Step 1: 创建并排 Diff 组件**

```vue
<script setup lang="ts">
/**
 * 深邃沉浸型并排 Diff — 左旧右新
 *
 * 行级对齐 + 字符级 pill 高亮
 */
import { computed } from 'vue'
import { computeSideBySideDiff, type DiffLine, type CharDiff } from '@/composables/useAiDiff'
import { Check, X, FileText, Copy } from 'lucide-vue-next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

const props = defineProps<{
  oldText: string
  newText: string
  fileName: string
  dirPath?: string
  description?: string
}>()

const emit = defineEmits<{
  apply: []
  reject: []
  close: []
}>()

/** 计算 diff 数据 */
const diff = computed(() => computeSideBySideDiff(props.oldText, props.newText))

/** 是否大 diff（超过 500 行总改动） */
const isLargeDiff = computed(() =>
  diff.value.stats.added + diff.value.stats.removed > 500
)

/** 文件扩展名→颜色 */
const FILE_COLORS: Record<string, string> = {
  vue: '#42b883', ts: '#3178c6', js: '#f7df1e', java: '#e76f00',
  py: '#3776ab', rs: '#dea584', css: '#264de4', html: '#e34f26',
}

const fileColor = computed(() => {
  const ext = props.fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILE_COLORS[ext] ?? '#6b7280'
})

/** 复制新内容 */
async function copyNewContent() {
  await writeText(props.newText)
}
</script>

<template>
  <div
    class="rounded-2xl overflow-hidden relative"
    style="background: linear-gradient(160deg, #08080f, #0f0f1a, #0a0a14);"
  >
    <!-- 微光晕 -->
    <div
      class="absolute -top-10 right-10 w-40 h-40 pointer-events-none"
      style="background: radial-gradient(circle, rgba(99,102,241,0.06), transparent 70%);"
    />

    <!-- 文件信息栏 -->
    <div class="flex items-center gap-2.5 px-4 py-3 relative z-10">
      <div
        class="w-7 h-7 rounded-[10px] flex items-center justify-center shadow-lg"
        style="background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 2px 10px rgba(99,102,241,0.25);"
      >
        <FileText class="w-3.5 h-3.5 text-white" />
      </div>
      <div>
        <div class="font-semibold text-[13px] text-[#f0f0ff] tracking-tight">{{ fileName }}</div>
        <div class="text-[10px] text-white/25 mt-0.5">{{ dirPath }}{{ description ? ` · ${description}` : '' }}</div>
      </div>
      <div class="ml-auto flex gap-1.5">
        <span
          class="text-[10px] px-2.5 py-0.5 rounded-full border"
          style="background: rgba(74,222,128,0.06); border-color: rgba(74,222,128,0.1); color: #4ade80;"
        >+{{ diff.stats.added }}</span>
        <span
          class="text-[10px] px-2.5 py-0.5 rounded-full border"
          style="background: rgba(248,113,113,0.06); border-color: rgba(248,113,113,0.1); color: #f87171;"
        >−{{ diff.stats.removed }}</span>
      </div>
    </div>

    <!-- 列标题 -->
    <div class="flex mx-3.5 rounded-t-lg overflow-hidden border border-b-0" style="border-color: rgba(255,255,255,0.04);">
      <div
        class="flex-1 px-3.5 py-1.5 text-[9px] uppercase tracking-[1.5px] font-semibold flex items-center gap-1.5"
        style="background: rgba(248,113,113,0.03); color: rgba(248,113,113,0.5);"
      >
        <span class="w-[5px] h-[5px] rounded-full" style="background: rgba(248,113,113,0.4);"></span>
        Before
      </div>
      <div class="w-px" style="background: rgba(255,255,255,0.04);"></div>
      <div
        class="flex-1 px-3.5 py-1.5 text-[9px] uppercase tracking-[1.5px] font-semibold flex items-center gap-1.5"
        style="background: rgba(74,222,128,0.03); color: rgba(74,222,128,0.5);"
      >
        <span class="w-[5px] h-[5px] rounded-full" style="background: rgba(74,222,128,0.4);"></span>
        After
      </div>
    </div>

    <!-- Diff 主体 -->
    <div
      class="flex mx-3.5 rounded-b-lg overflow-hidden border border-t-0 font-mono text-[10.5px]"
      style="border-color: rgba(255,255,255,0.04); background: rgba(0,0,0,0.2);"
      :class="isLargeDiff && 'max-h-[400px] overflow-y-auto'"
    >
      <!-- 左列 Before -->
      <div class="flex-1 min-w-0">
        <div
          v-for="(line, i) in diff.left"
          :key="'l' + i"
          class="flex items-center"
          :class="[
            line.type === 'removed' && 'border-l-2',
            line.type === 'empty' && '',
          ]"
          :style="{
            borderColor: line.type === 'removed' ? 'rgba(248,113,113,0.5)' : 'transparent',
            background: line.type === 'removed'
              ? 'linear-gradient(90deg, rgba(248,113,113,0.08), rgba(248,113,113,0.02))'
              : line.type === 'empty'
                ? 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.008) 4px, rgba(255,255,255,0.008) 8px)'
                : 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.015)',
            padding: '3px 0',
          }"
        >
          <span
            class="w-9 text-right pr-2.5 flex-shrink-0 text-[9px]"
            :style="{ color: line.type === 'removed' ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)' }"
          >{{ line.lineNumber ?? '' }}</span>
          <span class="truncate" :style="{ color: line.type === 'unchanged' ? 'rgba(255,255,255,0.18)' : '#e5e5eb' }">
            <template v-if="line.charDiffs">
              <span
                v-for="(cd, j) in line.charDiffs"
                :key="j"
                :style="{
                  background: cd.type === 'removed' ? 'rgba(248,113,113,0.12)' : 'transparent',
                  color: cd.type === 'removed' ? '#fca5a5' : undefined,
                  padding: cd.type === 'removed' ? '1px 3px' : '0',
                  borderRadius: cd.type === 'removed' ? '3px' : '0',
                }"
              >{{ cd.value }}</span>
            </template>
            <template v-else>{{ line.content }}</template>
          </span>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="w-px" style="background: rgba(255,255,255,0.04);"></div>

      <!-- 右列 After -->
      <div class="flex-1 min-w-0">
        <div
          v-for="(line, i) in diff.right"
          :key="'r' + i"
          class="flex items-center"
          :class="[
            line.type === 'added' && 'border-r-2',
            line.type === 'empty' && '',
          ]"
          :style="{
            borderColor: line.type === 'added' ? 'rgba(74,222,128,0.5)' : 'transparent',
            background: line.type === 'added'
              ? 'linear-gradient(270deg, rgba(74,222,128,0.08), rgba(74,222,128,0.02))'
              : line.type === 'empty'
                ? 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.008) 4px, rgba(255,255,255,0.008) 8px)'
                : 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.015)',
            padding: '3px 0',
          }"
        >
          <span
            class="w-9 text-right pr-2.5 flex-shrink-0 text-[9px]"
            :style="{ color: line.type === 'added' ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.08)' }"
          >{{ line.lineNumber ?? '' }}</span>
          <span class="truncate" :style="{ color: line.type === 'unchanged' ? 'rgba(255,255,255,0.18)' : '#e5e5eb' }">
            <template v-if="line.charDiffs">
              <span
                v-for="(cd, j) in line.charDiffs"
                :key="j"
                :style="{
                  background: cd.type === 'added' ? 'rgba(74,222,128,0.1)' : 'transparent',
                  color: cd.type === 'added' ? '#86efac' : undefined,
                  padding: cd.type === 'added' ? '1px 3px' : '0',
                  borderRadius: cd.type === 'added' ? '3px' : '0',
                }"
              >{{ cd.value }}</span>
            </template>
            <template v-else>{{ line.content }}</template>
          </span>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="flex items-center gap-2 px-3.5 py-3">
      <button
        class="flex items-center gap-1.5 px-5 py-[7px] rounded-[10px] text-[11px] font-semibold text-white border-none cursor-pointer"
        style="background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 2px 12px rgba(34,197,94,0.2);"
        @click="$emit('apply')"
      >
        <Check class="w-3 h-3" />
        应用更改
      </button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="$emit('reject')"
      >撤销</button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="$emit('close')"
      >收起</button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="copyNewContent"
      >
        <Copy class="w-3 h-3" />
      </button>
      <div class="ml-auto flex items-center gap-1.5">
        <div
          class="w-[5px] h-[5px] rounded-full"
          style="background: linear-gradient(135deg, #6366f1, #a855f7); box-shadow: 0 0 4px rgba(99,102,241,0.3);"
        />
        <span class="text-[9px]" style="color: rgba(255,255,255,0.15);">AI generated</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ai/AiDiffViewer.vue
git commit -m "feat(ai): 新建 AiDiffViewer 深邃沉浸型并排 Diff"
```

---

## Task 12: AiFileOpsGroup — 卡片组容器

**Files:**
- Create: `src/components/ai/AiFileOpsGroup.vue`

- [ ] **Step 1: 创建卡片组组件**

```vue
<script setup lang="ts">
/**
 * AI 文件操作卡片组 — Accept All / Reject All
 */
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { FileOperation } from '@/types/ai'
import AiFileOpCard from './AiFileOpCard.vue'
import { Check, X } from 'lucide-vue-next'

const props = defineProps<{
  operations: FileOperation[]
}>()

const emit = defineEmits<{
  'update:operations': [ops: FileOperation[]]
}>()

/** 是否有待处理操作 */
const hasPending = computed(() =>
  props.operations.some(op => op.status === 'pending')
)

/** 改动≥3行的自动展开 */
function shouldAutoExpand(op: FileOperation): boolean {
  if (op.op === 'create') return true
  if (!op.oldContent || !op.newContent) return false
  const oldLines = op.oldContent.split('\n').length
  const newLines = op.newContent.split('\n').length
  return Math.abs(newLines - oldLines) >= 3 || op.op === 'delete'
}

/** 应用单个操作 */
async function handleApply(op: FileOperation) {
  try {
    if (op.op === 'modify' && op.oldContent) {
      // 检查磁盘冲突
      const currentContent: string = await invoke('read_file_text', { path: op.path })
      if (currentContent !== op.oldContent) {
        const ok = confirm(`文件 ${op.fileName} 已被外部修改，是否强制覆盖？`)
        if (!ok) return
      }
    }

    if (op.op !== 'delete' && op.newContent) {
      await invoke('write_file', { path: op.path, content: op.newContent })
    } else if (op.op === 'delete') {
      await invoke('delete_entry', { path: op.path, isDirectory: false })
    }

    updateOpStatus(op.toolCallId, 'applied')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

/** 撤销单个操作 */
async function handleReject(op: FileOperation) {
  try {
    if (op.op === 'modify' && op.oldContent) {
      await invoke('write_file', { path: op.path, content: op.oldContent })
    } else if (op.op === 'create') {
      await invoke('delete_entry', { path: op.path, isDirectory: false })
    }
    updateOpStatus(op.toolCallId, 'rejected')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

/** 更新操作状态 */
function updateOpStatus(toolCallId: string, status: FileOperation['status'], errorMessage?: string) {
  const updated = props.operations.map(op =>
    op.toolCallId === toolCallId ? { ...op, status, errorMessage } : op
  )
  emit('update:operations', updated)
}

/** Accept All */
async function acceptAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') {
      await handleApply(op)
    }
  }
}

/** Reject All */
async function rejectAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') {
      await handleReject(op)
    }
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- 文件卡片列表 -->
    <AiFileOpCard
      v-for="op in operations"
      :key="op.toolCallId"
      :op="op"
      :auto-expand="shouldAutoExpand(op)"
      @apply="handleApply"
      @reject="handleReject"
    />

    <!-- 全局操作 -->
    <div v-if="hasPending && operations.length > 1" class="flex gap-2 pt-1">
      <button
        class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[11px] font-medium transition-colors"
        style="background: linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.06)); border: 1px solid rgba(74,222,128,0.15); color: #4ade80;"
        @click="acceptAll"
      >
        <Check class="w-3 h-3" />
        Accept All
      </button>
      <button
        class="px-4 py-2 rounded-[10px] text-[11px] text-muted-foreground/40 transition-colors"
        style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);"
        @click="rejectAll"
      >Reject All</button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ai/AiFileOpsGroup.vue
git commit -m "feat(ai): 新建 AiFileOpsGroup 文件操作卡片组"
```

---

## Task 13: AiToolCallBlock 改造 — write_file 渲染

**Files:**
- Modify: `src/components/ai/AiToolCallBlock.vue` (265行)

- [ ] **Step 1: 修改 write_file 成功态渲染**

在 import 中新增:
```typescript
import AiFileOpCard from './AiFileOpCard.vue'
import type { FileOperation } from '@/types/ai'
```

在模板中，替换 write_file 成功展示区域（约 L214-240），将 AiCodeBlock 预览替换为 AiFileOpCard:

将 write_file 的 `result` 解析为 FileOperation 并传给 AiFileOpCard。

具体改动：在 computed 中新增 `fileOperation`:
```typescript
const fileOperation = computed<FileOperation | null>(() => {
  if (!isFileOp.value || props.toolCall.name !== 'write_file') return null
  if (props.toolCall.status !== 'success') return null
  const args = props.toolCall.parsedArgs
  return {
    op: 'modify', // 简化处理，后续可根据 result 判断 create/modify
    path: (args?.path as string) ?? '',
    fileName: ((args?.path as string) ?? '').split(/[/\\]/).pop() ?? '',
    oldContent: undefined, // write_file 结果中无旧内容，需从上下文获取
    newContent: (args?.content as string) ?? '',
    status: 'pending',
    toolCallId: props.toolCall.id,
  }
})
```

模板中在 write_file 成功区替换为:
```vue
<AiFileOpCard
  v-if="fileOperation"
  :op="fileOperation"
  :auto-expand="true"
  @apply="() => {}"
  @reject="() => {}"
/>
```

- [ ] **Step 2: 验证构建**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiToolCallBlock.vue
git commit -m "feat(ai): AiToolCallBlock write_file 改用毛玻璃卡片渲染"
```

---

## Task 14: AiMessageBubble 聚合工具调用

**Files:**
- Modify: `src/components/ai/AiMessageBubble.vue` (260行)

- [ ] **Step 1: 新增 import 和聚合逻辑**

```typescript
import AiFileOpsGroup from './AiFileOpsGroup.vue'
import type { FileOperation } from '@/types/ai'
```

新增 computed:
```typescript
/** 从工具调用中提取文件操作列表 */
const fileOperations = computed<FileOperation[]>(() => {
  if (!props.message.toolCalls) return []
  return props.message.toolCalls
    .filter(tc => tc.name === 'write_file' && tc.status === 'success')
    .map(tc => {
      const args = tc.parsedArgs ?? {}
      const path = (args.path as string) ?? ''
      return {
        op: 'modify' as const,
        path,
        fileName: path.split(/[/\\]/).pop() ?? '',
        newContent: (args.content as string) ?? '',
        status: 'pending' as const,
        toolCallId: tc.id,
      }
    })
})

/** 非文件操作的工具调用 */
const otherToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(tc => tc.name !== 'write_file')
)
```

- [ ] **Step 2: 修改模板工具调用渲染区**

将约 L250-256 的工具调用渲染替换为:

```vue
<!-- 文件操作组（聚合 write_file） -->
<AiFileOpsGroup
  v-if="fileOperations.length > 0"
  :operations="fileOperations"
/>

<!-- 其他工具调用 -->
<div v-if="otherToolCalls.length" class="space-y-1">
  <AiToolCallBlock
    v-for="tc in otherToolCalls"
    :key="tc.id"
    :tool-call="tc"
  />
</div>
```

- [ ] **Step 3: 验证构建**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/AiMessageBubble.vue
git commit -m "feat(ai): AiMessageBubble 聚合 write_file 为文件操作卡片组"
```

---

## Task 15: 全量构建验证

**Files:** 无新改动

- [ ] **Step 1: TypeScript 检查**

```bash
cd D:\Project\DevForge\devforge && npx vue-tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 2: Vite 构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 启动开发服务器验证**

```bash
npm run dev
```

打开浏览器验证:
1. 文件树圆润现代风格
2. 右键菜单正常工作
3. Ctrl+Click 多选
4. AI 对话中 write_file 显示毛玻璃卡片
5. 点击 Side-by-side 展开并排 Diff

- [ ] **Step 4: 最终 commit（如有修复）**

```bash
git add -A
git commit -m "fix: 构建验证修复"
```
