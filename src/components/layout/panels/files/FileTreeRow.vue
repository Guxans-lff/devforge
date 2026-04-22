<script setup lang="ts">
import { computed } from 'vue'
import { useAiChatStore } from '@/stores/ai-chat'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode, FileDecoration } from '@/types/workspace-files'
import {
  ChevronRight,
  Folder,
  FolderOpen,
} from 'lucide-vue-next'
import FileTreeRenameInput from './FileTreeRenameInput.vue'

const props = defineProps<{
  node: FileNode
  focused: boolean
  selected: boolean
  dragOver: boolean
  multiSelected?: boolean
  aiReferenced?: boolean
  taskReferenced?: boolean
  aiReferencedParent?: boolean
  taskReferencedParent?: boolean
  focusedTask?: boolean
  focusedTaskParent?: boolean
}>()

const emit = defineEmits<{
  click: [e: MouseEvent, node: FileNode]
  dblclick: [node: FileNode]
  contextmenu: [e: MouseEvent, node: FileNode]
  dragstart: [e: DragEvent, node: FileNode]
  dragover: [e: DragEvent, node: FileNode]
  dragleave: [e: DragEvent]
  drop: [e: DragEvent, node: FileNode]
}>()

const store = useWorkspaceFilesStore()
const aiStore = useAiChatStore()

const decoration = computed<FileDecoration | undefined>(
  () => store.decorations.get(props.node.absolutePath)
)

const isRenaming = computed(() => store.renamingNodeId === props.node.id)

function normalizePath(path?: string | null): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrParentPath(parentPath: string, childPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`)
}

/** 文件扩展名到类型色的映射 */
const FILE_TYPE_COLORS: Record<string, string> = {
  vue: '#42b883', ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e',
  java: '#e76f00', py: '#3776ab', rs: '#dea584', go: '#00add8',
  css: '#264de4', scss: '#cd6799', html: '#e34f26', json: '#292929',
  md: '#083fa1', sql: '#e38c00', xml: '#f16529', yml: '#cb171e', yaml: '#cb171e',
}

/** 根据文件扩展名返回对应颜色 */
const fileColor = computed(() => {
  if (props.node.isDirectory) return null
  const ext = props.node.name.split('.').pop()?.toLowerCase() ?? ''
  return FILE_TYPE_COLORS[ext] ?? '#6b7280'
})

/** Git 状态字母标识 */
const gitStatusLetter = computed(() => {
  switch (decoration.value?.gitStatus) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'untracked': return 'U'
    case 'conflict': return 'C'
    case 'renamed': return 'R'
    default: return ''
  }
})

/** Git 状态 pill 样式类 */
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

const normalizedNodePath = computed(() => normalizePath(props.node.absolutePath))
const normalizedWorkDir = computed(() => normalizePath(aiStore.currentWorkDir))
const normalizedEditorPath = computed(() => normalizePath(store.activeEditor?.path))

const isAiWorkdirNode = computed(() =>
  Boolean(normalizedWorkDir.value) && normalizedNodePath.value === normalizedWorkDir.value,
)

const isAiWorkdirParent = computed(() =>
  props.node.isDirectory
  && Boolean(normalizedWorkDir.value)
  && !isAiWorkdirNode.value
  && isSameOrParentPath(normalizedNodePath.value, normalizedWorkDir.value),
)

const isEditorNode = computed(() =>
  Boolean(normalizedEditorPath.value) && normalizedNodePath.value === normalizedEditorPath.value,
)

const isEditorParent = computed(() =>
  props.node.isDirectory
  && Boolean(normalizedEditorPath.value)
  && !isEditorNode.value
  && isSameOrParentPath(normalizedNodePath.value, normalizedEditorPath.value),
)
</script>

<template>
  <div
    class="group flex items-center gap-2 cursor-pointer select-none text-[12.5px] transition-all duration-150 mx-1"
    :class="[
      selected
        ? 'bg-primary/8 rounded-lg relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[2px] before:h-4 before:bg-primary before:rounded-full'
        : focusedTask
          ? 'bg-orange-500/18 hover:bg-orange-500/22 rounded-lg relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[2px] before:h-4 before:bg-orange-400 before:rounded-full'
          : isEditorNode
            ? 'bg-emerald-500/10 hover:bg-emerald-500/15 rounded-lg'
          : focusedTaskParent
            ? 'bg-orange-500/6 hover:bg-orange-500/10 rounded-lg'
          : taskReferenced
            ? 'bg-amber-500/9 hover:bg-amber-500/13 rounded-lg'
          : taskReferencedParent
            ? 'bg-amber-500/4 hover:bg-amber-500/8 rounded-lg'
          : isAiWorkdirNode
            ? 'bg-primary/8 hover:bg-primary/12 rounded-lg'
            : aiReferenced
              ? 'bg-sky-500/7 hover:bg-sky-500/11 rounded-lg'
            : aiReferencedParent
              ? 'bg-sky-500/3 hover:bg-sky-500/7 rounded-lg'
            : isEditorParent || isAiWorkdirParent
              ? 'bg-muted/25 hover:bg-muted/35 rounded-lg'
              : 'hover:bg-muted/40 rounded-lg',
      focused && 'ring-1 ring-primary/20 rounded-lg',
      dragOver && 'bg-primary/15 ring-1 ring-primary/30 rounded-lg',
      (isEditorNode || isAiWorkdirNode) && 'ring-1 ring-inset',
      isEditorNode && 'ring-emerald-500/20',
      isAiWorkdirNode && 'ring-primary/20',
      focusedTask && 'ring-1 ring-inset ring-orange-500/35',
      focusedTaskParent && !focusedTask && 'ring-1 ring-inset ring-orange-500/12',
      taskReferenced && !focusedTask && 'ring-1 ring-inset ring-amber-500/18',
      taskReferencedParent && !focusedTask && !taskReferenced && 'ring-1 ring-inset ring-amber-500/8',
      aiReferenced && !focusedTask && !taskReferenced && 'ring-1 ring-inset ring-sky-500/16',
      aiReferencedParent && !focusedTask && !focusedTaskParent && !aiReferenced && !taskReferenced && !taskReferencedParent && 'ring-1 ring-inset ring-sky-500/8',
    ]"
    :style="{ paddingLeft: `${node.depth * 16 + 8}px`, height: '32px' }"
    draggable="true"
    @click="$emit('click', $event, node)"
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
        <template v-if="(node as any).isCompressed && (node as any).compressedSegments">
          <span v-for="(seg, i) in (node as any).compressedSegments" :key="i">
            <span v-if="(i as number) > 0" class="text-muted-foreground/30 mx-0.5">/</span>
            {{ seg }}
          </span>
        </template>
        <template v-else>{{ node.name }}</template>
      </span>
    </template>

    <!-- 目录子项数 badge -->
    <span
      v-if="focusedTask"
      class="flex-shrink-0 rounded-full border border-orange-500/25 bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-orange-300"
    >
      当前
    </span>
    <span
      v-else-if="focusedTaskParent"
      class="flex-shrink-0 rounded-full border border-orange-500/12 bg-orange-500/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-orange-300/75"
    >
      相关
    </span>
    <span
      v-else-if="taskReferenced"
      class="flex-shrink-0 rounded-full border border-amber-500/18 bg-amber-500/8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-amber-400"
    >
      相关
    </span>
    <span
      v-else-if="taskReferencedParent"
      class="flex-shrink-0 rounded-full border border-amber-500/12 bg-amber-500/4 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-amber-300/70"
    >
      相关
    </span>
    <span
      v-else-if="isAiWorkdirNode"
      class="flex-shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-primary"
    >
      当前
    </span>
    <span
      v-else-if="isEditorNode"
      class="flex-shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-emerald-400"
    >
      当前
    </span>
    <span
      v-else-if="aiReferenced"
      class="flex-shrink-0 rounded-full border border-sky-500/16 bg-sky-500/7 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-sky-400/90"
    >
      相关
    </span>
    <span
      v-else-if="aiReferencedParent"
      class="flex-shrink-0 rounded-full border border-sky-500/10 bg-sky-500/3 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-sky-300/65"
    >
      相关
    </span>

    <span
      v-if="node.isDirectory && !node.isExpanded && (node as any).childCount"
      class="flex-shrink-0 text-[10px] text-muted-foreground/40 bg-muted/30 px-1.5 rounded-full"
    >
      {{ (node as any).childCount }}
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
