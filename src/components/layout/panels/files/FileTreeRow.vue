<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode, FileDecoration } from '@/types/workspace-files'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from 'lucide-vue-next'
import FileTreeRenameInput from './FileTreeRenameInput.vue'

const props = defineProps<{
  node: FileNode
  focused: boolean
  selected: boolean
  dragOver: boolean
}>()

const emit = defineEmits<{
  click: [node: FileNode]
  dblclick: [node: FileNode]
  contextmenu: [e: MouseEvent, node: FileNode]
  dragstart: [e: DragEvent, node: FileNode]
  dragover: [e: DragEvent, node: FileNode]
  dragleave: [e: DragEvent]
  drop: [e: DragEvent, node: FileNode]
}>()

const store = useWorkspaceFilesStore()

const decoration = computed<FileDecoration | undefined>(
  () => store.decorations.get(props.node.absolutePath)
)

const isRenaming = computed(() => store.renamingNodeId === props.node.id)

const gitStatusColor = computed(() => {
  switch (decoration.value?.gitStatus) {
    case 'modified': return 'text-yellow-500'
    case 'added': case 'untracked': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'conflict': return 'text-orange-500'
    case 'renamed': return 'text-blue-500'
    default: return ''
  }
})

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
</script>

<template>
  <div
    class="flex h-7 items-center cursor-pointer select-none text-xs hover:bg-muted/50 transition-colors"
    :class="{
      'bg-primary/10': selected,
      'ring-1 ring-primary/30': focused,
      'bg-primary/20 ring-1 ring-primary/40': dragOver,
    }"
    :style="{ paddingLeft: `${node.depth * 16 + 8}px` }"
    draggable="true"
    @click="emit('click', node)"
    @dblclick="emit('dblclick', node)"
    @contextmenu.prevent="emit('contextmenu', $event, node)"
    @dragstart="emit('dragstart', $event, node)"
    @dragover="emit('dragover', $event, node)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', $event, node)"
  >
    <!-- 展开箭头（目录） -->
    <span v-if="node.isDirectory" class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
      <ChevronRight
        class="h-3 w-3 text-muted-foreground transition-transform duration-150"
        :class="{ 'rotate-90': node.isExpanded }"
      />
    </span>
    <span v-else class="w-4 flex-shrink-0" />

    <!-- 图标 -->
    <component
      :is="node.isDirectory ? (node.isExpanded ? FolderOpen : Folder) : File"
      class="h-4 w-4 flex-shrink-0 mr-1.5"
      :class="node.isDirectory ? 'text-blue-400' : 'text-muted-foreground'"
    />

    <!-- 文件名 / 重命名输入 -->
    <FileTreeRenameInput
      v-if="isRenaming"
      :node="node"
      class="flex-1 min-w-0"
    />
    <span
      v-else
      class="flex-1 truncate"
      :class="gitStatusColor"
    >
      {{ node.name }}
    </span>

    <!-- Git 徽标 -->
    <span
      v-if="gitStatusLetter"
      class="flex-shrink-0 ml-1 mr-2 text-[10px] font-bold"
      :class="gitStatusColor"
    >
      {{ gitStatusLetter }}
    </span>
  </div>
</template>
