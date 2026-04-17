<script setup lang="ts">
import type { WorkspaceRoot } from '@/types/workspace-files'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import {
  ChevronRight,
  FolderOpen,
  X,
  RefreshCw,
} from 'lucide-vue-next'

const props = defineProps<{
  root: WorkspaceRoot
}>()

const emit = defineEmits<{
  (e: 'contextmenu', ev: MouseEvent): void
}>()

const store = useWorkspaceFilesStore()

function toggleCollapse() {
  props.root.collapsed = !props.root.collapsed
  // 展开时如果缓存为空，重新加载
  if (!props.root.collapsed && !store.nodeCache.has(props.root.path)) {
    store.refreshRoot(props.root.id)
  }
}

function refresh() {
  store.refreshRoot(props.root.id)
}
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 cursor-pointer group transition-all duration-150 mx-1 rounded-lg"
    :class="root.collapsed ? 'hover:bg-muted/30' : 'bg-muted/20 hover:bg-muted/30'"
    style="height: 36px;"
    @click="toggleCollapse"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <ChevronRight
      class="h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150 flex-shrink-0"
      :class="!root.collapsed && 'rotate-90'"
    />
    <div
      class="w-4 h-4 rounded-[3px] flex items-center justify-center flex-shrink-0"
      style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"
    >
      <FolderOpen class="w-2.5 h-2.5 text-white" />
    </div>
    <span class="flex-1 truncate text-[12px] font-semibold text-foreground/90 tracking-tight">
      {{ root.name }}
    </span>
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
